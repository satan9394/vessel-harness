import * as fs from 'node:fs';
import * as path from 'node:path';

import type { PolicyRule } from '@vessel/shared';

import { classifySkillTrust, parseSkillFrontmatterLocal } from '../load/SkillLoader.js';
import type { SkillTrustMarkerId } from '../load/SkillLoader.js';
import type { SkillIndexEntry } from '../index.js';

/** Normalized Claude lifecycle event name. Unknown events remain declarations. */
export type ClaudeHookEvent = string;

/** Opaque hook metadata. `commands` are retained for audit and never executed. */
export interface ClaudeHookSpec {
  matcher?: string;
  commands?: string[];
  condition?: string;
}

export type ClaudeHookDeclaration = string | ClaudeHookSpec;
export type ClaudePluginHooks = Record<string, ClaudeHookDeclaration[] | undefined>;

/**
 * The supported, normalized subset of a Claude compatible plugin manifest.
 * Unknown manifest fields are intentionally ignored at this boundary.
 */
export interface ClaudePluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  /** Relative skill directories or SKILL.md paths inside the plugin root. */
  skills?: string[];
  hooks?: ClaudePluginHooks;
}

/**
 * A PolicyRule carrying provenance for an external hook declaration.
 *
 * The matcher is the only executable value produced by this package. It
 * checks a tool-call record and never starts the command named by the hook.
 */
export interface ClaudeHookPolicyRule extends PolicyRule {
  pluginId: string;
  hookEvent: 'preToolUse';
  /** Original declaration, retained for audit/UI display only. */
  source: string;
  matcher?: string;
  commands?: string[];
  condition?: string;
}

/** A hook phase that has no corresponding runtime policy lifecycle today. */
export interface ClaudeHookDeclarationOnly {
  id: string;
  pluginId: string;
  hookEvent: ClaudeHookEvent;
  source: string;
  matcher?: string;
  commands?: string[];
  condition?: string;
  enforced: false;
  reason: string;
  match?: never;
  action?: never;
}

export interface DiscoveredPlugin {
  id: string;
  manifest: ClaudePluginManifest;
  rootDir: string;
  skills: SkillIndexEntry[];
  /** A plugin with an unsafe skill/provenance result is visible but not loadable. */
  isTrusted: boolean;
  /** Pre-call deny rules; no external hook command is ever executed. */
  policyRules?: ClaudeHookPolicyRule[];
  /** Post-call hooks remain visible but cannot run in the current policy lifecycle. */
  declarationOnlyHooks?: ClaudeHookDeclarationOnly[];
}

const MAX_PLUGIN_SCAN_DEPTH = 8;
const MAX_PLUGIN_MANIFESTS = 256;
const MAX_PLUGIN_MANIFEST_BYTES = 256 * 1024;
const MAX_SKILL_SCAN_DEPTH = 6;
const MAX_SKILLS_PER_PLUGIN = 256;
const MAX_HOOK_CONFIG_BYTES = 256 * 1024;
const MAX_PLUGIN_SKILL_BYTES = 1024 * 1024;
const MAX_TEXT_FIELD_LENGTH = 2048;

const KNOWN_TOOL_NAMES = new Map<string, string>([
  ['read', 'Read'],
  ['write', 'Write'],
  ['edit', 'Edit'],
  ['glob', 'Glob'],
  ['grep', 'Grep'],
  ['shell', 'Shell'],
  ['bash', 'Shell'],
  ['mcp', 'MCP'],
  ['subagent', 'Subagent'],
  ['task', 'Subagent'],
]);

interface RecordLike {
  [key: string]: unknown;
}

interface NormalizedManifest {
  manifest: ClaudePluginManifest;
  invalid: boolean;
  hookFile?: string;
}

interface SkillDiscoveryResult {
  skills: SkillIndexEntry[];
  unsafeReference: boolean;
}

interface ManifestCandidate {
  manifestPath: string;
  rootDir: string;
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text.slice(0, MAX_TEXT_FIELD_LENGTH) : undefined;
}

function normalizePluginName(value: unknown): string | undefined {
  const name = boundedString(value);
  if (!name || name === '.' || name === '..') return undefined;
  // Names are used in skill IDs and rule IDs. Reject path/control characters
  // instead of allowing a manifest to manufacture an ambiguous namespace.
  if (/[\\/\0\r\n]/.test(name)) return undefined;
  return name.slice(0, 128);
}

function normalizeStringList(value: unknown): { values: string[]; invalid: boolean; declared: boolean } {
  if (value === undefined) return { values: [], invalid: false, declared: false };
  if (typeof value === 'string') {
    const item = value.trim();
    return { values: item ? [item] : [], invalid: !item, declared: true };
  }
  if (!Array.isArray(value)) return { values: [], invalid: true, declared: true };
  const values: string[] = [];
  let invalid = false;
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      invalid = true;
      continue;
    }
    values.push(item.trim().slice(0, MAX_TEXT_FIELD_LENGTH));
  }
  return { values, invalid, declared: true };
}

/**
 * Claude manifests in the wild use both the simplified string-list form and
 * the official `{ matcher, hooks: [{ type, command }] }` form. We retain a
 * matcher or command as opaque text; no command is interpreted or executed.
 */
function normalizeHookList(value: unknown): { values: ClaudeHookDeclaration[]; invalid: boolean; declared: boolean } {
  if (value === undefined) return { values: [], invalid: false, declared: false };
  if (typeof value === 'string') {
    const item = value.trim();
    return { values: item ? [item] : [], invalid: !item, declared: true };
  }
  if (!Array.isArray(value)) {
    if (isRecord(value)) return normalizeHookItem(value);
    return { values: [], invalid: true, declared: true };
  }

  const values: ClaudeHookDeclaration[] = [];
  let invalid = false;
  for (const item of value) {
    const normalized = typeof item === 'string' ? normalizeStringList(item) : normalizeHookItem(item);
    values.push(...normalized.values);
    invalid ||= normalized.invalid;
  }
  return { values, invalid, declared: true };
}

function normalizeHookItem(value: unknown): { values: ClaudeHookDeclaration[]; invalid: boolean; declared: boolean } {
  if (!isRecord(value)) return { values: [], invalid: true, declared: true };
  const matcher = boundedString(value.matcher ?? value.match);
  const command = boundedString(value.command);
  const condition = boundedString(value.if);
  const nested = value.hooks === undefined ? undefined : normalizeHookList(value.hooks);
  const nestedValues = nested?.values ?? [];
  if (nestedValues.length > 0) {
    const values = nestedValues.map((entry): ClaudeHookSpec => {
      const child = typeof entry === 'string' ? { commands: [entry] } : entry;
      const commands = [...(command ? [command] : []), ...(child.commands ?? [])];
      return {
        ...(matcher ?? child.matcher ? { matcher: matcher ?? child.matcher } : {}),
        ...(commands.length ? { commands } : {}),
        ...(condition ?? child.condition ? { condition: condition ?? child.condition } : {}),
      };
    });
    return { values, invalid: nested!.invalid, declared: true };
  }
  if (!matcher && !command) return { values: [], invalid: true, declared: true };
  return {
    values: [{
      ...(matcher ? { matcher } : {}),
      ...(command ? { commands: [command] } : {}),
      ...(condition ? { condition } : {}),
    }],
    invalid: false,
    declared: true,
  };
}

function normalizeHookEvent(value: string): string {
  const normalized = value.replace(/[^A-Za-z]/g, '').toLowerCase();
  if (normalized === 'pretooluse' || normalized === 'beforetooluse') return 'preToolUse';
  if (normalized === 'posttooluse' || normalized === 'aftertooluse') return 'postToolUse';
  const event = value.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(event) ? event : '';
}

function normalizeHookObject(value: unknown): { hooks?: ClaudePluginHooks; hookFile?: string; invalid: boolean } {
  if (value === undefined) return { invalid: false };
  // Hook files are parsed as bounded JSON data below, never treated as scripts.
  if (typeof value === 'string' && /\.json$/i.test(value.trim())) {
    return { hookFile: value.trim(), invalid: false };
  }
  if (typeof value === 'string' || Array.isArray(value)) {
    const list = normalizeHookList(value);
    return {
      ...(list.values.length ? { hooks: { preToolUse: list.values } } : {}),
      invalid: list.invalid,
    };
  }
  if (!isRecord(value)) return { invalid: true };

  const hooks: ClaudePluginHooks = {};
  let invalid = false;
  for (const [rawEvent, rawDeclarations] of Object.entries(value)) {
    const event = normalizeHookEvent(rawEvent);
    if (!event) {
      invalid = true;
      continue;
    }
    const normalized = normalizeHookList(rawDeclarations);
    if (normalized.declared) hooks[event] = [...(hooks[event] ?? []), ...normalized.values];
    invalid ||= normalized.invalid;
  }
  return { ...(Object.keys(hooks).length ? { hooks } : {}), invalid };
}

function normalizeManifest(value: unknown): NormalizedManifest | undefined {
  if (!isRecord(value)) return undefined;
  const name = normalizePluginName(value.name);
  if (!name) return undefined;

  const skillList = normalizeStringList(value.skills ?? value.skill_paths ?? value.skillPaths);
  const hookObject = normalizeHookObject(value.hooks);
  const authorValue = value.author;
  const author = typeof authorValue === 'string'
    ? boundedString(authorValue)
    : isRecord(authorValue)
      ? boundedString(authorValue.name)
      : undefined;

  const manifest: ClaudePluginManifest = {
    name,
    ...(boundedString(value.version) ? { version: boundedString(value.version) } : {}),
    ...(boundedString(value.description) ? { description: boundedString(value.description) } : {}),
    ...(author ? { author } : {}),
    ...(skillList.declared ? { skills: skillList.values } : {}),
    ...(hookObject.hooks ? { hooks: hookObject.hooks } : {}),
  };
  return {
    manifest,
    invalid: skillList.invalid || hookObject.invalid,
    ...(hookObject.hookFile ? { hookFile: hookObject.hookFile } : {}),
  };
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function safeRealPath(rootDir: string, candidate: string): string | undefined {
  try {
    const root = fs.realpathSync.native(rootDir);
    const resolved = fs.realpathSync.native(candidate);
    return isPathInside(root, resolved) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function isSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return true;
  }
}

function addManifestCandidate(candidates: ManifestCandidate[], seen: Set<string>, manifestPath: string, workspaceRoot: string): void {
  try {
    if (isSymlink(manifestPath)) return;
    const absolute = path.resolve(manifestPath);
    if (!isPathInside(workspaceRoot, absolute)) return;
    const realManifest = safeRealPath(workspaceRoot, absolute);
    if (!realManifest || !realManifest.toLowerCase().endsWith(`${path.sep}plugin.json`)) return;
    const parent = path.dirname(absolute);
    const parentName = path.basename(parent).toLowerCase();
    const rootDir = parentName === '.claude-plugin' || parentName === '.claw-plugin' ? path.dirname(parent) : parent;
    const safeRoot = safeRealPath(workspaceRoot, rootDir);
    if (!safeRoot || seen.has(realManifest.toLowerCase())) return;
    seen.add(realManifest.toLowerCase());
    // Keep the caller-visible path spelling (especially on Windows, where
    // realpathSync.native may return an 8.3 short name) after canonical
    // validation has completed.
    candidates.push({ manifestPath: absolute, rootDir: path.resolve(rootDir) });
  } catch {
    // Discovery is best effort. A malformed/unreadable candidate is not a
    // reason to make the host fail, and no candidate is executed here.
  }
}

function scanForManifestFiles(rootDir: string, workspaceRoot: string, candidates: ManifestCandidate[], seen: Set<string>, depth = 0): void {
  if (candidates.length >= MAX_PLUGIN_MANIFESTS || depth > MAX_PLUGIN_SCAN_DEPTH) return;
  if (isSymlink(rootDir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (candidates.length >= MAX_PLUGIN_MANIFESTS) return;
    const candidate = path.join(rootDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && entry.name.toLowerCase() === 'plugin.json') {
      addManifestCandidate(candidates, seen, candidate, workspaceRoot);
    } else if (entry.isDirectory() && depth < MAX_PLUGIN_SCAN_DEPTH) {
      scanForManifestFiles(candidate, workspaceRoot, candidates, seen, depth + 1);
    }
  }
}

function collectManifestCandidates(workspaceRoot: string): ManifestCandidate[] {
  const candidates: ManifestCandidate[] = [];
  const seen = new Set<string>();
  const direct = [
    path.join(workspaceRoot, 'plugin.json'),
    path.join(workspaceRoot, '.claude-plugin', 'plugin.json'),
    path.join(workspaceRoot, '.claw-plugin', 'plugin.json'),
    path.join(workspaceRoot, '.claude', 'plugin.json'),
    path.join(workspaceRoot, '.claw', 'plugin.json'),
    path.join(workspaceRoot, '.vessel', 'plugin.json'),
  ];
  for (const manifestPath of direct) addManifestCandidate(candidates, seen, manifestPath, workspaceRoot);

  // Only recurse through recognized ecosystem roots. This avoids treating an
  // arbitrary package's nested plugin.json as an installed plugin and bounds
  // the amount of filesystem a hostile workspace can make us inspect.
  for (const rootName of ['.claude', '.claw', '.vessel', 'plugins']) {
    scanForManifestFiles(path.join(workspaceRoot, rootName), workspaceRoot, candidates, seen);
  }
  return candidates;
}

function safeResolveReference(pluginRoot: string, reference: string): string | undefined {
  try {
    const lexical = path.resolve(pluginRoot, reference);
    if (!isPathInside(pluginRoot, lexical)) return undefined;
    return safeRealPath(pluginRoot, lexical) ? lexical : undefined;
  } catch {
    return undefined;
  }
}

function readPluginHookFile(pluginRoot: string, reference?: string): { hooks?: ClaudePluginHooks; invalid: boolean } {
  const defaultPath = path.join(pluginRoot, 'hooks', 'hooks.json');
  let target: string | undefined;
  if (reference !== undefined) {
    target = safeResolveReference(pluginRoot, reference);
    if (!target) return { invalid: true };
  } else {
    try {
      if (!fs.existsSync(defaultPath)) return { invalid: false };
      target = safeResolveReference(pluginRoot, 'hooks/hooks.json');
      if (!target) return { invalid: true };
    } catch {
      return { invalid: true };
    }
  }

  try {
    if (isSymlink(target)) return { invalid: true };
    const stats = fs.statSync(target);
    if (!stats.isFile() || stats.size > MAX_HOOK_CONFIG_BYTES) return { invalid: true };
    const payload: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!isRecord(payload)) return { invalid: true };
    const events = isRecord(payload.hooks)
      ? payload.hooks
      : payload.description === undefined
        ? payload
        : undefined;
    if (!isRecord(events)) return { invalid: true };
    const normalized = normalizeHookObject(events);
    if (normalized.hookFile) return { invalid: true };
    return { hooks: normalized.hooks, invalid: normalized.invalid };
  } catch {
    return { invalid: true };
  }
}

function mergePluginHooks(...sources: (ClaudePluginHooks | undefined)[]): ClaudePluginHooks | undefined {
  const merged: ClaudePluginHooks = {};
  for (const source of sources) {
    for (const [event, declarations] of Object.entries(source ?? {})) {
      if (declarations?.length) merged[event] = [...(merged[event] ?? []), ...declarations];
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function collectSkillFiles(startPath: string, pluginRoot: string, out: string[], depth = 0): void {
  if (out.length >= MAX_SKILLS_PER_PLUGIN || depth > MAX_SKILL_SCAN_DEPTH) return;
  const safeStart = safeRealPath(pluginRoot, startPath);
  if (!safeStart || isSymlink(startPath)) return;
  let stats: fs.Stats;
  try {
    stats = fs.statSync(safeStart);
  } catch {
    return;
  }
  if (stats.isFile()) {
    if (path.basename(startPath).toLowerCase() === 'skill.md') out.push(path.resolve(startPath));
    return;
  }
  if (!stats.isDirectory()) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(startPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_SKILLS_PER_PLUGIN) return;
    if (entry.isSymbolicLink()) continue;
    const child = path.join(startPath, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') out.push(path.resolve(child));
    else if (entry.isDirectory() && depth < MAX_SKILL_SCAN_DEPTH) collectSkillFiles(child, pluginRoot, out, depth + 1);
  }
}

function inferSkillName(skillPath: string, pluginRoot: string): string {
  const parent = path.basename(path.dirname(skillPath));
  if (parent && parent.toLowerCase() !== 'skills') return parent;
  const relative = path.relative(pluginRoot, path.dirname(skillPath));
  return relative && relative !== '.' ? path.basename(relative) : 'default';
}

function namespacedSkillName(pluginName: string, name: string): string {
  const safeName = name.trim().replace(/[\\/\0\r\n]/g, '-').slice(0, 128) || 'skill';
  return `${pluginName}:${safeName}`;
}

function indexSkill(pluginName: string, pluginRoot: string, skillPath: string): SkillIndexEntry | undefined {
  try {
    const stats = fs.statSync(skillPath);
    if (!stats.isFile() || stats.size > MAX_PLUGIN_SKILL_BYTES) return undefined;
    const text = fs.readFileSync(skillPath, 'utf8');
    const frontmatter = parseSkillFrontmatterLocal(text);
    const trust = classifySkillTrust(text);
    const rawName = frontmatter.name?.trim() || inferSkillName(skillPath, pluginRoot);
    return {
      name: namespacedSkillName(pluginName, rawName),
      description: (frontmatter.description ?? '').slice(0, 1536),
      sourcePath: skillPath,
      rank: 0,
      trusted: trust.trusted,
      ...(trust.marker ? { untrustedMarker: trust.marker } : {}),
    };
  } catch {
    return undefined;
  }
}

function discoverPluginSkills(pluginName: string, pluginRoot: string, manifest: ClaudePluginManifest): SkillDiscoveryResult {
  const requested = manifest.skills ?? [];
  const starts: string[] = [];
  let unsafeReference = false;
  for (const reference of requested) {
    const safe = safeResolveReference(pluginRoot, reference);
    if (!safe) {
      unsafeReference = true;
      continue;
    }
    starts.push(safe);
  }
  // Auto-discovery covers official `.claude/skills`, `.claw/skills`, and the
  // common root `skills` shape when plugin.json omits the field.
  starts.push(
    path.join(pluginRoot, 'skills'),
    path.join(pluginRoot, '.claude', 'skills'),
    path.join(pluginRoot, '.claw', 'skills'),
  );

  const files: string[] = [];
  const seenFiles = new Set<string>();
  for (const start of starts) {
    if (!safeRealPath(pluginRoot, start)) continue;
    const before = files.length;
    collectSkillFiles(start, pluginRoot, files);
    for (let index = before; index < files.length; index += 1) {
      const file = files[index]!;
      const key = file.toLowerCase();
      if (seenFiles.has(key)) {
        files.splice(index, 1);
        index -= 1;
      } else {
        seenFiles.add(key);
      }
    }
  }

  const skills: SkillIndexEntry[] = [];
  const seenNames = new Set<string>();
  for (const file of files) {
    const entry = indexSkill(pluginName, pluginRoot, file);
    if (!entry) {
      unsafeReference = true;
      continue;
    }
    if (seenNames.has(entry.name)) continue;
    seenNames.add(entry.name);
    skills.push(entry);
  }
  return { skills, unsafeReference };
}

function sanitizeRuleId(value: string): string {
  return value.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 128) || 'plugin';
}

function hookMatcher(declaration: ClaudeHookDeclaration): string | undefined {
  return typeof declaration === 'string' ? declaration.trim() || undefined : declaration.matcher?.trim() || undefined;
}

function hookCommands(declaration: ClaudeHookDeclaration): string[] | undefined {
  if (typeof declaration === 'string') return undefined;
  return declaration.commands?.length ? declaration.commands : undefined;
}

function hookCondition(declaration: ClaudeHookDeclaration): string | undefined {
  return typeof declaration === 'string' ? undefined : declaration.condition;
}

function hookSource(declaration: ClaudeHookDeclaration): string {
  if (typeof declaration === 'string') return declaration;
  return hookMatcher(declaration) ?? hookCommands(declaration)?.join('; ') ?? 'all tools';
}

function hookToolSelector(matcher: string | undefined): string | undefined {
  if (!matcher || matcher === '*') return undefined;
  // Only an exact known tool name is narrow enough to translate safely.
  // Regexes, shell conditions, and compound matchers fail closed for all tools.
  return KNOWN_TOOL_NAMES.get(matcher.toLowerCase());
}

/**
 * Convert pre-call hook declarations to deny rules that can be installed in
 * the Policy Engine. Unknown/script-shaped declarations fail closed for every
 * tool call; known tool matchers are narrowed to that tool. Post-call hooks
 * are not runtime rules because the current PolicyRule contract only runs
 * before a tool call. No source is passed to a process API.
 */
export function mapClaudeHooksToPolicyRules(
  pluginId: string,
  hooks: ClaudePluginManifest['hooks'] | undefined,
): ClaudeHookPolicyRule[] {
  if (!hooks) return [];
  const rules: ClaudeHookPolicyRule[] = [];
  for (const [index, declaration] of (hooks.preToolUse ?? []).entries()) {
    const matcher = hookMatcher(declaration);
    const selector = hookToolSelector(matcher);
    const safePluginId = sanitizeRuleId(pluginId);
    rules.push({
      id: `plugin:${safePluginId}:hook:preToolUse:${index}`,
      domain: 'tools',
      action: 'deny',
      reason: 'external preToolUse hook is declaration-only; tool call is denied until an explicit Vessel policy is added',
      pluginId,
      hookEvent: 'preToolUse',
      source: hookSource(declaration),
      ...(typeof declaration !== 'string' && matcher ? { matcher } : {}),
      ...(hookCommands(declaration) ? { commands: hookCommands(declaration) } : {}),
      ...(hookCondition(declaration) ? { condition: hookCondition(declaration) } : {}),
      match: (call) => selector === undefined || call.toolName.toLowerCase() === selector.toLowerCase(),
    });
  }
  return rules;
}

/** Preserve hooks without a pre-tool enforcement phase as auditable declarations. */
export function mapClaudeHooksToDeclarations(
  pluginId: string,
  hooks: ClaudePluginManifest['hooks'] | undefined,
): ClaudeHookDeclarationOnly[] {
  if (!hooks) return [];
  const safePluginId = sanitizeRuleId(pluginId);
  return Object.entries(hooks).flatMap(([event, declarations]) => {
    if (event === 'preToolUse' || !declarations?.length) return [];
    return declarations.map((declaration, index) => ({
      id: `plugin:${safePluginId}:hook:${sanitizeRuleId(event)}:${index}`,
      pluginId,
      hookEvent: event,
      source: hookSource(declaration),
      ...(typeof declaration !== 'string' && hookMatcher(declaration) ? { matcher: hookMatcher(declaration) } : {}),
      ...(hookCommands(declaration) ? { commands: hookCommands(declaration) } : {}),
      ...(hookCondition(declaration) ? { condition: hookCondition(declaration) } : {}),
      enforced: false as const,
      reason: `${event} is declaration-only in the current PolicyRule lifecycle; the declaration is preserved and never executed`,
    }));
  });
}

/** Alias with a plugin-shaped argument for callers that already discovered it. */
export function mapPluginHooksToPolicyRules(plugin: Pick<DiscoveredPlugin, 'id' | 'manifest'>): ClaudeHookPolicyRule[] {
  return mapClaudeHooksToPolicyRules(plugin.id, plugin.manifest.hooks);
}

function readPlugin(candidate: ManifestCandidate): DiscoveredPlugin | undefined {
  let raw: unknown;
  try {
    const stats = fs.statSync(candidate.manifestPath);
    if (!stats.isFile() || stats.size > MAX_PLUGIN_MANIFEST_BYTES) return undefined;
    raw = JSON.parse(fs.readFileSync(candidate.manifestPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
  const normalized = normalizeManifest(raw);
  if (!normalized) return undefined;
  const { manifest } = normalized;
  const hookFile = readPluginHookFile(candidate.rootDir, normalized.hookFile);
  manifest.hooks = mergePluginHooks(manifest.hooks, hookFile.hooks);
  const skillResult = discoverPluginSkills(manifest.name, candidate.rootDir, manifest);
  const policyRules = mapClaudeHooksToPolicyRules(manifest.name, manifest.hooks);
  const declarationOnlyHooks = mapClaudeHooksToDeclarations(manifest.name, manifest.hooks);
  const isTrusted = !normalized.invalid && !hookFile.invalid && !skillResult.unsafeReference && skillResult.skills.every((skill) => skill.trusted);
  return {
    id: manifest.name,
    manifest,
    rootDir: candidate.rootDir,
    skills: skillResult.skills,
    isTrusted,
    ...(policyRules.length ? { policyRules } : {}),
    ...(declarationOnlyHooks.length ? { declarationOnlyHooks } : {}),
  };
}

/** Adapt workspace-level .claude/skills and .claw/skills roots without a manifest. */
function readWorkspaceSkillRoot(workspaceRoot: string, ecosystem: 'claude' | 'claw'): DiscoveredPlugin | undefined {
  const rootDir = path.join(workspaceRoot, `.${ecosystem}`);
  const skillsDir = path.join(rootDir, 'skills');
  try {
    const rootStats = fs.lstatSync(rootDir);
    const skillsStats = fs.lstatSync(skillsDir);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return undefined;
    if (!skillsStats.isDirectory() || skillsStats.isSymbolicLink()) return undefined;
  } catch {
    return undefined;
  }

  const name = `${ecosystem}-workspace`;
  const manifest: ClaudePluginManifest = { name, skills: ['./skills'] };
  const result = discoverPluginSkills(name, rootDir, manifest);
  if (result.skills.length === 0 && !result.unsafeReference) return undefined;
  return {
    id: name,
    manifest,
    rootDir,
    skills: result.skills,
    isTrusted: !result.unsafeReference && result.skills.every((skill) => skill.trusted),
  };
}

/**
 * Discover Claude/Claw compatible plugin manifests in a workspace.
 *
 * Discovery is deliberately bounded, read-only, symlink-resistant, and
 * fail-soft. Invalid manifests disappear from the result; a valid plugin with
 * an unsafe skill reference remains visible as `isTrusted: false` so callers
 * can explain why it was not made loadable.
 */
export function discoverClaudePlugins(workspaceRoot: string): DiscoveredPlugin[] {
  let root: string;
  try {
    root = path.resolve(workspaceRoot);
    if (!fs.statSync(root).isDirectory()) return [];
  } catch {
    return [];
  }
  if (!safeRealPath(root, root)) return [];

  const plugins: DiscoveredPlugin[] = [];
  for (const candidate of collectManifestCandidates(root)) {
    const plugin = readPlugin(candidate);
    if (plugin) plugins.push(plugin);
  }
  for (const ecosystem of ['claude', 'claw'] as const) {
    const plugin = readWorkspaceSkillRoot(root, ecosystem);
    if (plugin && !plugins.some((item) => item.rootDir === plugin.rootDir)) plugins.push(plugin);
  }
  return plugins.sort((left, right) => {
    const byName = left.id.localeCompare(right.id);
    return byName || left.rootDir.localeCompare(right.rootDir);
  });
}
