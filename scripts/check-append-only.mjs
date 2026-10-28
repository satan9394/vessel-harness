#!/usr/bin/env node
/**
 * check-append-only.mjs — 断言指定路径的 git 工作树改动「只有新增、没有删除」。
 *
 * 用途：文档对账类任务（卡 354/355 一类）要求「只在卡末尾追加结论，不改正文」。
 * 光靠契约文字约束不住，这里给一条可执行判据：任何 `-` 行都算违规。
 *
 * 用法：
 *   node scripts/check-append-only.mjs tasks/170-*.md      # 由 PowerShell 展开后传入
 *   node scripts/check-append-only.mjs tasks/170-a.md tasks/170-b.md
 *
 * 退出码：0 = 全部只有新增；1 = 有删除或改动无法判定。
 */
import { execFileSync } from 'node:child_process';

const paths = process.argv.slice(2).filter((p) => p && !p.startsWith('-'));
if (paths.length === 0) {
  console.error('usage: node scripts/check-append-only.mjs <path> [path...]');
  process.exit(2);
}

let diff = '';
try {
  diff = execFileSync('git', ['diff', '--unified=0', '--', ...paths], { encoding: 'utf8' });
} catch (error) {
  console.error(`git diff failed: ${error?.message ?? error}`);
  process.exit(1);
}

const files = new Map();
let current = null;
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) {
    current = line.slice(6);
    if (!files.has(current)) files.set(current, { added: 0, removed: [] });
    continue;
  }
  if (!current) continue;
  if (line.startsWith('+') && !line.startsWith('+++')) files.get(current).added += 1;
  if (line.startsWith('-') && !line.startsWith('---')) files.get(current).removed.push(line);
}

if (files.size === 0) {
  console.log('no changes under the given paths (nothing to check)');
  process.exit(0);
}

let violations = 0;
for (const [file, stat] of files) {
  const ok = stat.removed.length === 0;
  if (!ok) violations += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${file}  +${stat.added} -${stat.removed.length}`);
  for (const line of stat.removed.slice(0, 5)) console.log(`       ${line}`);
}

if (violations > 0) {
  console.error(`\n${violations} file(s) contain deletions; append-only reconciliation must not change existing lines.`);
  process.exit(1);
}
console.log('\nappend-only check passed');
