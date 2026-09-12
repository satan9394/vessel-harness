/**
 * Dev-only test discovery + runner for sandboxed environments (no spawn needed).
 *
 * **覆盖范围（如实，勿再声称"全部"）**：它跑 `ROOT_FILES` + `ROOTS` 列出的路径下的
 * `*.test.ts`。当前**不等同于** `npm run test:all`，差两处、且都是结构性的：
 *   1. **不含 `apps/web/src`**——web 是**独立 vitest root**（需要 `@vitejs/plugin-react`
 *      与 `react-dom/server`，根 `vitest.config.ts` 的 `include` 本来也不含它）；
 *   2. 只认 `*.test.ts`，**不认 `*.test.tsx`**（web 的用例是 tsx）。
 * ⇒ 本脚本是"受限环境下的替代通道"，**不是全量**；要全量请跑 `npm run test:all`。
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
  // Round 121 更正：此前漏了它（文件头却声称"every *.test.ts under the vitest include roots"）
  'apps/local-server/src',
  'benchmarks/runners/src',
];

/** 与根 `vitest.config.ts` 的 include 对齐：根目录下这一个散文件也要跑。 */
const ROOT_FILES = ['index.test.ts'];

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
for (const f of ROOT_FILES) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) files.push(p);
}
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
