import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateModManifest, type ClaudeModManifest } from './manifest.js';
import { ModPermissionsAuditor, type ModAuditResult } from './audit/ModPermissionsAuditor.js';

export interface DiscoveredMod { root: string; manifest?: ClaudeModManifest; staticHooks?: string[]; audit: ModAuditResult }

/** Reads manifests and source bytes only; never imports or executes a Mod. */
export async function auditModDirectory(directory: string): Promise<DiscoveredMod> {
  const fallback = ModPermissionsAuditor.auditSource('', {});
  try {
    const root = await realpath(directory);
    let raw: unknown;
    for (const filename of ['vessel.mod.json', 'claude.mod', 'package.json']) {
      try {
        const manifestPath = await realpath(path.join(root, filename));
        if (path.dirname(manifestPath) !== root) throw new Error('Manifest escape');
        const json = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
        raw = filename === 'package.json' ? json['claude.mod'] : json;
        if (raw !== undefined) break;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const manifest = validateModManifest(raw);
    const audit = ModPermissionsAuditor.auditSource('', manifest as unknown as Record<string, unknown>);
    if (!audit.safe) return { root, manifest, audit };
    const entry = await realpath(path.resolve(root, manifest.entrypoint));
    const relative = path.relative(root, entry);
    if (relative.split(path.sep).includes('..') || path.isAbsolute(relative)) throw new Error('Source escape');
    const source = await readFile(entry, 'utf8');
    const staticHooks = ['observe', 'rewriteToolInput', 'rewritePromptFragment', 'interceptToolCall'].filter(hook => new RegExp(`\\b${hook}\\b`).test(source));
    return { root, manifest, staticHooks, audit: ModPermissionsAuditor.auditSource(source, manifest as unknown as Record<string, unknown>) };
  } catch {
    return { root: path.resolve(directory), audit: { ...fallback, violations: ['Invalid, missing or inaccessible manifest/source; Mod root confinement required.'] } };
  }
}

export async function discoverMods(workspaceRoot: string): Promise<DiscoveredMod[]> {
  const directory = path.resolve(workspaceRoot, '.harness', 'mods');
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const mods: DiscoveredMod[] = [];
  if (entries.some(entry => ['vessel.mod.json', 'claude.mod', 'package.json'].includes(entry.name))) mods.push(await auditModDirectory(directory));
  for (const entry of entries.filter(entry => entry.isDirectory() || entry.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(directory, entry.name);
    // Symlinked roots can escape workspace discovery; report rather than follow them.
    if (entry.isSymbolicLink()) mods.push({ root: child, audit: { ...ModPermissionsAuditor.auditSource('', {}), violations: ['Symlinked Mod directory denied.'] } });
    else mods.push(await auditModDirectory(child));
  }
  return mods;
}
