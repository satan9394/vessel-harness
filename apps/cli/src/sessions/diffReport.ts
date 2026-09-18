import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

/**
 * 会话改动的只读汇总（`vessel diff` 与 TUI `/diff` 共用）。
 *
 * 只读：从会话日志的 `tool/call` 记录里聚合 Write/Edit 触碰的文件与执行过的 shell，
 * 再附一次工作区 `git status --short`（不是 git 仓库 / 无 git → 省略，绝不报错）。
 * 不执行任何回滚 —— 回滚动作留给用户自己的 git。
 */

export interface TouchedFile {
  path: string;
  tool: string;
  count: number;
}

export interface SessionChanges {
  touched: TouchedFile[];
  shellCommands: string[];
  /** `git status --short` 行；工作区不是 git 仓库或 git 不可用时为 undefined。 */
  gitStatus?: string[];
}

interface RawRecord {
  type?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
}

/** Parse a session.jsonl, dropping a torn tail line (same rule as core `Session`). */
export function parseSessionRecords(file: string): RawRecord[] {
  const out: RawRecord[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line) as RawRecord);
    } catch {
      /* torn tail line: drop it */
    }
  }
  return out;
}

/**
 * Collect the read-only change summary for a session log. `gitStatus` is best-effort:
 * a non-repo workspace or a missing git binary yields `undefined`, never an error.
 */
export function collectSessionChanges(sessionFile: string, workspaceRoot: string): SessionChanges {
  const touched = new Map<string, TouchedFile>();
  const shellCommands: string[] = [];
  for (const r of parseSessionRecords(sessionFile)) {
    if (r.type !== 'tool/call') continue;
    const tool = String(r.toolName ?? '');
    const a = (r.arguments ?? {}) as Record<string, unknown>;
    if (tool === 'Write' || tool === 'Edit') {
      const p = typeof a.path === 'string' ? a.path : typeof a.file_path === 'string' ? a.file_path : undefined;
      if (p !== undefined && p !== '') {
        const e = touched.get(p) ?? { path: p, tool, count: 0 };
        e.count += 1;
        touched.set(p, e);
      }
    } else if (tool === 'Shell') {
      const cmd = typeof a.command === 'string' ? a.command : undefined;
      if (cmd !== undefined && cmd !== '') shellCommands.push(cmd);
    }
  }

  let gitStatus: string[] | undefined;
  const g = spawnSync('git', ['-C', workspaceRoot, 'status', '--short'], { encoding: 'utf8' });
  if (g.status === 0 && typeof g.stdout === 'string') {
    gitStatus = g.stdout.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0);
  }

  return { touched: [...touched.values()], shellCommands, ...(gitStatus !== undefined ? { gitStatus } : {}) };
}

/** Human rendering shared by the CLI command and the TUI slash command. */
export function renderSessionChanges(changes: SessionChanges, sessionId: string, workspaceRoot: string): string {
  const lines: string[] = [`[vessel diff] 会话 ${sessionId}（${workspaceRoot}）`];
  if (changes.touched.length === 0) lines.push('  本会话没有 Write/Edit 记录。');
  else {
    lines.push('  本会话改动过的文件：');
    for (const t of changes.touched) lines.push(`    ${t.path}  (${t.tool} ×${t.count})`);
  }
  if (changes.shellCommands.length > 0) {
    lines.push(`  本会话执行过的 shell（${changes.shellCommands.length} 条，未判定是否改文件）：`);
    for (const c of changes.shellCommands) lines.push(`    ${c}`);
  }
  if (changes.gitStatus !== undefined) {
    lines.push('  工作区 git status --short：');
    for (const l of changes.gitStatus) lines.push(`    ${l}`);
  } else {
    lines.push('  （工作区不是 git 仓库或 git 不可用；跳过 git status）');
  }
  lines.push('  只读提示，不执行任何回滚。');
  return lines.join('\n');
}
