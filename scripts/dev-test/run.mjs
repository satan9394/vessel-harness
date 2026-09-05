/**
 * Dev-only test discovery + runner for sandboxed environments (no spawn needed).
 * Imports every `*.test.ts` under the vitest include roots; node:test executes
 * the registered tests inline and the spec reporter prints a summary.
 *
 * Usage: node --experimental-transform-types --import ./scripts/dev-test/test-alias.mjs ./scripts/dev-test/run.mjs
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOTS = [
  'packages/shared/src',
  'packages/core/src',
  'packages/llm/src',
  'packages/behavior/src',
  'packages/context/src',
  'packages/tools/src',
  'packages/policy/src',
  'packages/runtime/src',
  'packages/memory/src',
  'packages/skills/src',
  'packages/agents/src',
  'packages/telemetry/src',
  'apps/cli/src',
  'benchmarks/runners/src',
];

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.test.ts')) out.push(full);
  }
}

const root = fileURLToPath(new URL('../..', import.meta.url));
const files = [];
for (const r of ROOTS) walk(path.join(root, r), files);
files.sort();

let failed = 0;
for (const f of files) {
  try {
    await import(pathToFileURL(f).href);
  } catch (err) {
    failed += 1;
    console.error(`[dev-run] failed to load ${path.relative(root, f)}: ${err.message}`);
  }
}
if (failed > 0) {
  console.error(`[dev-run] ${failed} test file(s) failed to load`);
  process.exitCode = 1;
}
