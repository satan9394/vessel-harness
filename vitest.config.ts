import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));

// Map workspace package names to their TS sources so Vitest tests run
// against source directly (no build step required).
const packages = [
  'shared',
  'core',
  'llm',
  'behavior',
  'context',
  'tools',
  'policy',
  'runtime',
  'memory',
  'skills',
  'agents',
  'telemetry',
  'engine',
  'application',
];

const alias: Record<string, string> = {};
for (const p of packages) {
  alias[`@vessel/${p}`] = path.join(root, `packages/${p}/src/index.ts`);
}
alias['@vessel/bench-runners'] = path.join(root, 'benchmarks/runners/src/index.ts');
alias['@vessel/local-server'] = path.join(root, 'apps/local-server/src/index.ts');

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    // 全局隔离兜底（AGENTS.md §8）：把新增的状态根指向一次性临时目录，
    // 详见 vitest.setup.ts 的说明。
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'index.test.ts',
      'packages/*/src/**/*.test.ts',
      'apps/cli/src/**/*.test.ts',
      'apps/local-server/src/**/*.test.ts',
      'benchmarks/runners/src/**/*.test.ts',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
