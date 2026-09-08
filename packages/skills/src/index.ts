import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SkillIndexEntry {
  name: string;
  description: string;
  sourcePath: string;
  rank: number;
}

/**
 * skills — v0.1 minimal skeleton (ARCHITECTURE §4.9): SKILL.md frontmatter
 * parse + directory index. Only name+description enter the index (正文不注入);
 * full skill lifecycle (content injection, scope conflict, search) is V0.3.
 */
export function parseSkillFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (kv) out[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, '');
  }
  return { name: out.name, description: out.description };
}

function discoveryRoots(workspaceRoot: string, scope: 'system' | 'user' | 'project' | 'session'): { dir: string; rank: number }[] {
  const roots: { dir: string; rank: number }[] = [];
  if (scope === 'project' || scope === 'session') {
    roots.push({ dir: path.join(workspaceRoot, '.vessel', 'skills'), rank: 100 });
    roots.push({ dir: path.join(workspaceRoot, '.agents', 'skills'), rank: 200 });
  }
  if (scope === 'user' || scope === 'system') {
    roots.push({ dir: path.join(os.homedir(), '.vessel', 'skills'), rank: 400 });
    roots.push({ dir: path.join(os.homedir(), '.claude', 'skills'), rank: 500 });
  }
  return roots;
}

/** Directory index only — name + escaped description (D3 decision point 11). */
export function listIndex(workspaceRoot: string, scope: 'system' | 'user' | 'project' | 'session' = 'project'): SkillIndexEntry[] {
  const out: SkillIndexEntry[] = [];
  const seen = new Set<string>();
  for (const { dir, rank } of discoveryRoots(workspaceRoot, scope)) {
    if (!fs.existsSync(dir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMd = path.join(dir, e.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      try {
        const fm = parseSkillFrontmatter(fs.readFileSync(skillMd, 'utf8'));
        const name = fm.name ?? e.name;
        if (seen.has(name)) continue; // nearest layer wins on name conflict
        seen.add(name);
        out.push({
          name,
          description: (fm.description ?? '').slice(0, 1536),
          sourcePath: skillMd,
          rank,
        });
      } catch {
        continue;
      }
    }
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export function formatIndexText(entries: SkillIndexEntry[]): string {
  if (entries.length === 0) return '';
  return entries.map((s) => `- ${s.name}: ${s.description}`).join('\n');
}

export * from './load/SkillLoader.js';
export * from './search/SkillSearch.js';
