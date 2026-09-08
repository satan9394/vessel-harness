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
];

const alias: Record<string, string> = {};
for (const p of packages) {
  alias[`@vessel/${p}`] = path.join(root, `packages/${p}/src/index.ts`);
}
alias['@vessel/bench-runners'] = path.join(root, 'benchmarks/runners/src/index.ts');

export default defineConfig({
  resolve: { alias },
  test: {
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/cli/src/**/*.test.ts',
      'benchmarks/runners/src/**/*.test.ts',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
