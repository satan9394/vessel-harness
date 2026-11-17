import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const output = readFileSync(new URL('gate-batched.log', import.meta.url), 'utf8').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const match = output.match(/all steps green; logs: ([^\r\n]+)/);
assert.ok(match, 'full gate has not finished green');
const source = resolve(match[1]);
assert.ok(source.startsWith(resolve(tmpdir()) + '\\'), 'expected runner log directory under system TEMP');
const target = new URL('gate-logs/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const name of readdirSync(source)) copyFileSync(join(source, name), new URL(name, target));
const steps = [...output.matchAll(/^(\S+)[ \t]+exit=(\d+)[ \t]+(\d+)s[ \t]*(.*)$/gm)].map(([, step, exit, seconds, summary]) => ({ step, exit: Number(exit), seconds: Number(seconds), summary: summary.trim() }));
assert.equal(steps.length, 17);
assert.ok(steps.every(step => step.exit === 0));
const totals = { root: { files: 0, passed: 0, skipped: 0 }, web: { files: 0, passed: 0, skipped: 0 } };
for (const step of steps) {
  const counts = step.summary.match(/Test Files\s+(\d+) passed.*Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?/);
  if (!counts) continue;
  const group = step.step === 'web-root' ? totals.web : totals.root;
  group.files += Number(counts[1]);
  group.passed += Number(counts[2]);
  group.skipped += Number(counts[3] ?? 0);
}
const result = { command: 'pwsh -NoProfile -File scripts/gate-batched.ps1', exit: 0, steps, totals, totalsMeaning: 'Sum of invocation summaries, not deduplicated tests: root-index also matches memory/sessionIndex.test.ts.', runnerTempLogs: source, copiedLogs: 'gate-logs/' };
writeFileSync(new URL('gate-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
