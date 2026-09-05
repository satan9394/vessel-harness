import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Instruction {
  sourcePath: string;
  scope: 'project' | 'subdir';
  content: string;
}

/**
 * context/instructions — AGENTS.md chain discovery (ARCHITECTURE §4.4).
 * Walks from cwd upward within the workspace root boundary, broad → specific.
 * Instructions are injected as user messages with source='instruction'.
 */
export function discoverInstructions(cwd: string, workspaceRoot: string): Instruction[] {
  const out: Instruction[] = [];
  const seen = new Set<string>();
  const names = ['AGENTS.md', 'CLAUDE.md', 'agent.md'];

  // broad → specific: root first, then descending toward cwd
  const dirs: string[] = [];
  let d = path.resolve(workspaceRoot);
  const target = path.resolve(cwd);
  dirs.push(d);
  const rel = path.relative(d, target);
  if (rel && !rel.startsWith('..')) {
    const parts = rel.split(/[\\/]/);
    let cur = d;
    for (const p of parts) {
      cur = path.join(cur, p);
      if (cur !== d) dirs.push(cur);
    }
  }

  for (const dir of dirs) {
    for (const name of names) {
      const p = path.join(dir, name);
      if (seen.has(p)) continue;
      seen.add(p);
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8').slice(0, 50_000);
          out.push({
            sourcePath: p,
            scope: dir === path.resolve(workspaceRoot) ? 'project' : 'subdir',
            content,
          });
        } catch {
          // unreadable instruction file: skip silently
        }
      }
    }
  }
  return out;
}
