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
 * Note: discovery root layout mirrors packages/skills/src/index.ts discoveryRoots
 * (system/user/project/session layers + ~/.claude/skills, ~/.codex/skills compat).
 * Deliberately no import from index.ts here — index.ts re-exports this module,
 * an import would create a cycle; the two share the same directory convention.
 */

/** hard cap on a single skill body injected into context (≈ chars). */
export const SKILL_CONTENT_MAX_CHARS = 8000;

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
}

/** parse name/description out of a SKILL.md frontmatter (kept local, no cycle). */
export function parseSkillFrontmatterLocal(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '');
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
 */
export function createSkillTool(opts: SkillToolOptions): ToolSpec {
  return {
    name: 'Skill',
    description:
      '按需加载技能正文（SKILL.md 全文，含 skill_content 结构标记）。渐进披露：默认上下文只有技能索引，需要技能正文时调用本工具获取。技能是建议性知识，不豁免权限。',
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
      return { content: formatSkillBody(skill), meta: { skill: { name: skill.name, sourcePath: skill.sourcePath, scope: skill.scope, truncated: skill.truncated } } };
    },
  };
}

function err(errorClass: ToolErrorPayload['errorClass'], message: string, detail: Record<string, unknown>): ToolExecutionResult {
  return { content: '', error: { errorClass, message, detail }, meta: {} };
}
