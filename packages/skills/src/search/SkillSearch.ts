import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ToolExecutionResult, ToolSpec, ToolErrorPayload } from '@vessel/shared';

import type { SkillScope } from '../load/SkillLoader.js';

/**
 * skills/search — Skill Search + Provenance + scope-conflict resolution
 * (V0.3-M4; ARCHITECTURE §4.9 / 任务书 §12 Skill Scope/Search/Provenance).
 *
 * searchSkills: keyword search over name+description across discovery layers.
 * resolveSkill: nearest-wins resolution WITH provenance — reports every layer
 *   that shadows a same-named skill (audit trail), not just the winner.
 * Skill Provenance is a safety dimension (任务书 §18): a leaked/reverse-
 *   engineered skill must be markable UNTRUSTED and never enter System Prompt
 *   directly — provenance carries the source layer + path + a `trusted` flag
 *   the caller can enforce.
 *
 * Discovery layout mirrors packages/skills/src/load/SkillLoader.ts and
 * packages/skills/src/index.ts (deliberately duplicated to avoid import cycles;
 * the directory convention is shared by comment).
 */

export interface SkillRecord {
  name: string;
  description: string;
  sourcePath: string;
  scope: SkillScope;
  rank: number;
  /** provenance safety flag — reverse-engineered/leaked skills are untrusted */
  trusted: boolean;
}

/** discovery roots per scope (project/session → workspace dirs; user/system → home dirs). */
export function skillDiscoveryDirs(workspaceRoot: string, scope: SkillScope): { dir: string; rank: number; scope: SkillScope }[] {
  const out: { dir: string; rank: number; scope: SkillScope }[] = [];
  const push = (dir: string, rank: number, s: SkillScope) => {
    if (!out.some((o) => o.dir === dir)) out.push({ dir, rank, scope: s });
  };
  if (scope === 'project' || scope === 'session') {
    push(path.join(workspaceRoot, '.dsh', 'skills'), 100, 'project');
    push(path.join(workspaceRoot, '.agents', 'skills'), 200, 'project');
  }
  if (scope === 'user' || scope === 'system' || scope === 'session') {
    push(path.join(os.homedir(), '.dsh', 'skills'), 400, 'user');
    push(path.join(os.homedir(), '.claude', 'skills'), 500, 'user');
    push(path.join(os.homedir(), '.codex', 'skills'), 500, 'user');
  }
  return out.sort((a, b) => a.rank - b.rank);
}

function parseFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { name: out.name, description: out.description };
}

/** list every skill dir under a discovery root (no dedupe — provenance view). */
function listRaw(workspaceRoot: string, scope: SkillScope): SkillRecord[] {
  const out: SkillRecord[] = [];
  for (const { dir, rank, scope: s } of skillDiscoveryDirs(workspaceRoot, scope)) {
    if (!fs.existsSync(dir)) continue;
    let names: string[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const n of names) {
      const skillMd = path.join(dir, n, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      let text = '';
      try {
        text = fs.readFileSync(skillMd, 'utf8');
      } catch {
        continue;
      }
      const fm = parseFrontmatter(text);
      const name = fm.name ?? n;
      // leaked/reverse-engineered markers (任务书 §18 UNTRUSTED RESEARCH DATA)
      const trusted = !/UNTRUSTED RESEARCH DATA|逆向|leaked|reverse-engineered/i.test(text.slice(0, 400));
      out.push({ name, description: fm.description ?? '', sourcePath: skillMd, scope: s, rank, trusted });
    }
  }
  return out;
}

/** resolve one skill name with full provenance (all layers + winner). */
export function resolveSkill(name: string, workspaceRoot: string, scope: SkillScope = 'project'): { winner?: SkillRecord; layers: SkillRecord[] } {
  const wanted = name.trim();
  const layers = listRaw(workspaceRoot, scope).filter((r) => r.name === wanted).sort((a, b) => a.rank - b.rank);
  return { winner: layers[0], layers };
}

/** keyword search across layers; dedupe by name keeping nearest (progressive list). */
export function searchSkills(keyword: string, workspaceRoot: string, scope: SkillScope = 'project'): SkillRecord[] {
  const kw = keyword.toLowerCase();
  const all = listRaw(workspaceRoot, scope)
    .filter((r) => r.name.toLowerCase().includes(kw) || r.description.toLowerCase().includes(kw))
    .sort((a, b) => a.rank - b.rank);
  const seen = new Set<string>();
  return all.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
}

export interface SkillSearchToolOptions {
  workspaceRoot: string;
  scope?: SkillScope;
}

/** `SkillSearch` tool — keyword search + provenance (+ conflict resolution view). */
export function createSkillSearchTool(opts: SkillSearchToolOptions): ToolSpec {
  return {
    name: 'SkillSearch',
    description:
      '按关键字检索技能（名称/描述），返回命中 + 来源（scope/sourcePath/可信度）。也可用 resolve 查看同名技能在多层作用域的冲突裁决。',
    family: 'search',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '检索关键字' },
        resolve: { type: 'string', description: '可选：查看某技能名的分层来源与裁决' },
      },
      required: [],
    },
    async execute(args): Promise<ToolExecutionResult> {
      const scope = (opts.scope ?? 'project') as SkillScope;
      try {
        if (args.resolve != null) {
          const res = resolveSkill(String(args.resolve), opts.workspaceRoot, scope);
          if (!res.winner) return err('INVALID_ARGS', `Skill "${args.resolve}" not found`, {});
          const lines = res.layers.map((l) => `- ${l.name} @ ${l.scope} rank=${l.rank} ${l.trusted ? 'trusted' : 'UNTRUSTED'} (${l.sourcePath})`);
          return {
            content: `resolve "${args.resolve}": winner=${res.winner.scope} (rank ${res.winner.rank})\n${lines.join('\n')}`,
            meta: { skills: { resolve: args.resolve, winner: res.winner.scope, layers: res.layers.length } },
          };
        }
        const kw = String(args.keyword ?? '');
        if (!kw) return err('INVALID_ARGS', 'SkillSearch: keyword required', {});
        const hits = searchSkills(kw, opts.workspaceRoot, scope);
        if (hits.length === 0) return ok(`(no skill matches "${kw}")`, { count: 0 });
        const lines = hits.map((h) => `- ${h.name}: ${h.description}  [${h.scope}${h.trusted ? '' : ' UNTRUSTED'}]`);
        return ok(lines.join('\n'), { count: hits.length });
      } catch (e) {
        return err('TOOL_FAILURE', `SkillSearch failed: ${(e as Error).message}`, {});
      }
    },
  };
}

function ok(content: string, meta: Record<string, unknown>): ToolExecutionResult {
  return { content, meta: { skills: meta } };
}

function err(errorClass: ToolErrorPayload['errorClass'], message: string, detail: Record<string, unknown>): ToolExecutionResult {
  return { content: '', error: { errorClass, message, detail }, meta: {} };
}
