import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ToolExecutionResult, ToolSpec, ToolErrorPayload } from '@vessel/shared';

/**
 * skills/load — SKILL.md content loading (V0.3-M3; ARCHITECTURE §4.9).
 *
 * Progressive disclosure: by default only the index (name + description)
 * enters context; on demand (`skill({name})` tool / loadSkillContent) the
 * SKILL.md body is re-read from disk and returned — never cached wholesale,
 * re-read at call time (D3 decision point 11: 调用时重读). The body keeps its
 * `<skill_content>/<skill_resources>/<skill_instructions>` structure markers
 * so the model can distinguish instructions from resources.
 *
 * Token discipline: SKILL_CONTENT_MAX_CHARS caps the injected body; overflow is
 * clipped with a marker instead of silently truncating mid-block.
 *
 * §18 skill provenance is now ENFORCED, not merely labelled. `classifySkillTrust()`
 * below is the single trust judgement in the package — it scans the WHOLE
 * SKILL.md text (the old implementation only looked at the first 400 chars, so a
 * marker past that window reported trusted:true). The same verdict drives the
 * index labels (search/SkillSearch.ts, index.ts) and the `Skill` tool: an
 * untrusted skill stays visible in the index (users must still learn it exists)
 * but its body is refused with DENIED/reason='untrusted-skill' and never
 * returned for injection.
 *
 * Note: discovery root layout mirrors packages/skills/src/index.ts discoveryRoots
 * (system/user/project/session layers + ~/.claude/skills, ~/.codex/skills compat).
 * Deliberately no import from index.ts here — index.ts re-exports this module,
 * an import would create a cycle; the two share the same directory convention.
 */

/** hard cap on a single skill body injected into context (≈ chars). */
export const SKILL_CONTENT_MAX_CHARS = 8000;

/**
 * §18 UNTRUSTED markers — leak / reverse-engineering signals in a SKILL.md.
 *
 * This is the ONE trust judgement in the package: search/SkillSearch.ts (index +
 * provenance view), index.ts (the system-prompt skill index) and the `Skill`
 * tool all call classifySkillTrust() below. There is deliberately no second
 * copy, so an index label can never disagree with the load gate.
 *
 * Patterns are matched against `normalizeSkillTrustText()` (whitespace runs
 * collapsed to one space, lowercased), so a marker torn apart by a line break or
 * indentation still matches: "UNTRUSTED<newline>RESEARCH DATA",
 * "UNTRUSTED   RESEARCH<newline>DATA", and the hyphen line-break
 * "reverse-<newline>engineered".
 *
 * Why whitespace normalization and not more: only whitespace INSIDE the phrase
 * is tolerated, so the phrase tokens must still be adjacent. Ordinary prose that
 * merely uses the words "untrusted" and "research data" in different sentences
 * is not flagged (that would turn every security note into a false positive).
 * `逆向` / `leaked` keep their pre-existing case-insensitive substring semantics
 * with no word boundaries added — narrowing them (`\bleaked\b` would stop
 * matching "unleaked") would silently drop text the old check caught, and this
 * card must not loosen any criterion in either direction.
 */
export type SkillTrustMarkerId = 'untrusted-research-data' | 'reverse-engineered' | 'leaked';

export const SKILL_TRUST_MARKERS: readonly { id: SkillTrustMarkerId; pattern: RegExp }[] = [
  { id: 'untrusted-research-data', pattern: /untrusted research data/ },
  { id: 'reverse-engineered', pattern: /逆向|reverse-\s?engineered/ },
  { id: 'leaked', pattern: /leaked/ },
];

/** whitespace runs → one space + lowercase, so markers split across lines match. */
function normalizeSkillTrustText(text: string): string {
  return text.replace(/\s+/g, ' ').toLowerCase();
}

export interface SkillTrustVerdict {
  trusted: boolean;
  /** which marker flipped the verdict (audit trail + rejection reason) */
  marker?: SkillTrustMarkerId;
}

/**
 * Trust verdict for one SKILL.md text, scanning the WHOLE text.
 *
 * Cost note (why full-text is affordable): every caller already did
 * `fs.readFileSync(skillMd, 'utf8')` on the entire file before calling this
 * (SkillLoader.loadSkillContent, SkillSearch.listRaw, index.listIndex), so the
 * scan adds no I/O — just one linear normalization pass plus three regex tests
 * over a string already resident in memory. It is deliberately NOT bounded by
 * SKILL_CONTENT_MAX_CHARS: that constant clips the injected body only, and a
 * marker in the clipped tail must still condemn the file.
 */
export function classifySkillTrust(text: string): SkillTrustVerdict {
  const normalized = normalizeSkillTrustText(text);
  for (const { id, pattern } of SKILL_TRUST_MARKERS) {
    if (pattern.test(normalized)) return { trusted: false, marker: id };
  }
  return { trusted: true };
}

/** how the injected body is framed (ARCHITECTURE §4.9 three-part marker). */
export const SKILL_BODY_HEADER = 'skill_content';

export type SkillScope = 'system' | 'user' | 'project' | 'session';

export interface LoadedSkill {
  name: string;
  sourcePath: string;
  scope: SkillScope;
  rank: number;
  description: string;
  /** full SKILL.md text with frontmatter + body markers preserved */
  body: string;
  /** clipped? */
  truncated: boolean;
  /**
   * §18 provenance verdict, computed over the WHOLE file. false ⇒ the `Skill`
   * tool refuses to hand `body` to the model (fail-closed).
   */
  trusted: boolean;
  /** which marker made it untrusted (absent when trusted) — carries the refusal reason */
  untrustedMarker?: SkillTrustMarkerId;
}

/** parse name/description out of a SKILL.md frontmatter (kept local, no cycle). */
export function parseSkillFrontmatterLocal(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    // 手写解析代替 `/^([A-Za-z0-9_-]+):\s*(.*)$/`：正则的 `\s*` 与 `.*` 重叠，CodeQL
    // 报 js/polynomial-redos；语义（键字符集、冒号后去空白、值去引号）逐字不变。
    const trimmed = line.trim();
    const sep = trimmed.indexOf(':');
    if (sep > 0 && /^[A-Za-z0-9_-]+$/.test(trimmed.slice(0, sep))) {
      out[trimmed.slice(0, sep)] = trimmed.slice(sep + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { name: out.name, description: out.description };
}

/** ordered discovery roots: nearest layer first (lowest rank = highest precedence). */
function discoveryDirs(workspaceRoot: string, scope: SkillScope): { dir: string; rank: number }[] {
  const roots: { dir: string; rank: number }[] = [];
  if (scope === 'project' || scope === 'session') {
    roots.push({ dir: path.join(workspaceRoot, '.vessel', 'skills'), rank: 100 });
    roots.push({ dir: path.join(workspaceRoot, '.agents', 'skills'), rank: 200 });
  }
  if (scope === 'user' || scope === 'system') {
    roots.push({ dir: path.join(os.homedir(), '.vessel', 'skills'), rank: 400 });
    roots.push({ dir: path.join(os.homedir(), '.claude', 'skills'), rank: 500 });
  }
  if (scope === 'session') {
    // session scope additionally overlays user dirs for on-demand loading
    roots.push({ dir: path.join(os.homedir(), '.vessel', 'skills'), rank: 400 });
    roots.push({ dir: path.join(os.homedir(), '.claude', 'skills'), rank: 500 });
  }
  // de-duplicate (session overlaps project+user already pushed)
  const seen = new Set<string>();
  return roots.filter((r) => (seen.has(r.dir) ? false : (seen.add(r.dir), true)));
}

/**
 * Resolve a skill by name across discovery layers (nearest wins, same as
 * listIndex) and load its full SKILL.md body from disk at call time.
 */
export function loadSkillContent(name: string, workspaceRoot: string, scope: SkillScope = 'project'): LoadedSkill | undefined {
  const wanted = name.trim();
  if (!wanted) return undefined;
  for (const { dir, rank } of discoveryDirs(workspaceRoot, scope)) {
    if (!fs.existsSync(dir)) continue;
    let skillMd: string | null = null;
    try {
      // only immediate child skill dirs (same layout as listIndex)
      const skillDir = path.join(dir, wanted);
      const candidate = path.join(skillDir, 'SKILL.md');
      if (fs.existsSync(candidate)) skillMd = candidate;
    } catch {
      continue;
    }
    if (!skillMd) continue;
    const raw = fs.readFileSync(skillMd, 'utf8');
    const fm = parseSkillFrontmatterLocal(raw);
    // §18: judge the WHOLE file. The body below may be clipped to
    // SKILL_CONTENT_MAX_CHARS, but a marker sitting in the clipped tail still
    // condemns the skill — so the verdict is taken from `raw`, never from the
    // injected (truncated) body.
    const trust = classifySkillTrust(raw);
    const truncated = raw.length > SKILL_CONTENT_MAX_CHARS;
    const body = truncated ? `${raw.slice(0, SKILL_CONTENT_MAX_CHARS)}\n…(skill 正文超长截断)` : raw;
    return {
      name: fm.name ?? wanted,
      sourcePath: skillMd,
      scope,
      rank,
      description: fm.description ?? '',
      body,
      truncated,
      trusted: trust.trusted,
      ...(trust.marker ? { untrustedMarker: trust.marker } : {}),
    };
  }
  return undefined;
}

/** present a loaded skill as a self-describing injectable text block. */
export function formatSkillBody(skill: LoadedSkill): string {
  const rel = path.basename(path.dirname(skill.sourcePath));
  const header = `[skill:${skill.name} @ ${rel} (${skill.scope})]`;
  return `${header}\n\n<${SKILL_BODY_HEADER}>\n${skill.body}\n</${SKILL_BODY_HEADER}>`;
}

export interface SkillToolOptions {
  workspaceRoot: string;
  /** discovery scope */
  scope?: SkillScope;
}

/**
 * skills — `Skill` tool: on-demand SKILL.md body injection (ARCHITECTURE §4.9).
 * Returns the full body with structure markers; the caller decides whether to
 * inject it into context (progressive disclosure — the tool is invoked when
 * the model needs the body, not preloaded). Skill content is advisory
 * knowledge — execution enforcement stays in policy/sandbox (技能执行不豁免权限).
 *
 * §18 gate (fail-closed): this tool is the ONLY model-facing path that returns a
 * skill body, so the untrusted verdict is enforced here. An untrusted skill
 * still appears in the index (visibility preserved — users must know it exists)
 * but `execute` refuses with DENIED/reason='untrusted-skill' and `content: ''`,
 * so the context builder injects only "[DENIED] …" (context/builder
 * recordToMessage) and no byte of the body can reach the model.
 */
export function createSkillTool(opts: SkillToolOptions): ToolSpec {
  return {
    name: 'Skill',
    description:
      '按需加载技能正文（SKILL.md 全文，含 skill_content 结构标记）。渐进披露：默认上下文只有技能索引，需要技能正文时调用本工具获取。技能是建议性知识，不豁免权限。被判为 UNTRUSTED 的技能（泄露/逆向来源）仍会出现在索引里，但本工具会拒绝装载其正文（DENIED: untrusted-skill）。',
    family: 'other',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名' },
      },
      required: ['name'],
    },
    async execute(args): Promise<ToolExecutionResult> {
      const name = String(args.name ?? '');
      const skill = loadSkillContent(name, opts.workspaceRoot, opts.scope ?? 'project');
      if (!skill) {
        return err('INVALID_ARGS', `Skill "${name}" not found (list available skills first)`, {});
      }
      if (!skill.trusted) {
        // verdict comes from loadSkillContent (the same classifySkillTrust call);
        // this site enforces it, it never re-judges — no second opinion to drift.
        const reason = 'untrusted-skill';
        const marker = skill.untrustedMarker ?? 'unknown';
        return err(
          'DENIED',
          `Skill "${skill.name}" 被判为 UNTRUSTED（命中标记：${marker}）——泄露/逆向来源的 Prompt 不得直接进入上下文（任务书 §18），正文已拒绝装载。该技能仍可在技能索引中看到，但不可装载。`,
          { reason, marker, name: skill.name, sourcePath: skill.sourcePath, scope: skill.scope },
          {
            skill: {
              name: skill.name,
              sourcePath: skill.sourcePath,
              scope: skill.scope,
              trusted: false,
              denied: true,
              reason,
              marker,
            },
          },
        );
      }
      return {
        content: formatSkillBody(skill),
        meta: { skill: { name: skill.name, sourcePath: skill.sourcePath, scope: skill.scope, truncated: skill.truncated, trusted: true } },
      };
    },
  };
}

function err(
  errorClass: ToolErrorPayload['errorClass'],
  message: string,
  detail: Record<string, unknown>,
  meta: Record<string, unknown> = {},
): ToolExecutionResult {
  return { content: '', error: { errorClass, message, detail }, meta };
}
