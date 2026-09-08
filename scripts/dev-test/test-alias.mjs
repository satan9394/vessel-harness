/**
 * Dev-only module resolver for the sandboxed test lane.
 * Maps `vitest` -> in-process shim and `@vessel/*` -> package src (mirroring
 * vitest.config.ts aliases) so tests run against source directly.
 *
 * Usage: node --experimental-transform-types --import ./scripts/dev-test/test-alias.mjs ...
 */
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

const ALIASES = new Map([
  ['@vessel/shared', 'packages/shared/src/index.ts'],
  ['@vessel/core', 'packages/core/src/index.ts'],
  ['@vessel/llm', 'packages/llm/src/index.ts'],
  ['@vessel/behavior', 'packages/behavior/src/index.ts'],
  ['@vessel/context', 'packages/context/src/index.ts'],
  ['@vessel/tools', 'packages/tools/src/index.ts'],
  ['@vessel/policy', 'packages/policy/src/index.ts'],
  ['@vessel/runtime', 'packages/runtime/src/index.ts'],
  ['@vessel/memory', 'packages/memory/src/index.ts'],
  ['@vessel/skills', 'packages/skills/src/index.ts'],
  ['@vessel/agents', 'packages/agents/src/index.ts'],
  ['@vessel/telemetry', 'packages/telemetry/src/index.ts'],
  ['@vessel/cli', 'apps/cli/src/index.ts'],
  ['@vessel/bench-runners', 'benchmarks/runners/src/index.ts'],
]);

const SHIM_URL = pathToFileURL(path.join(root, 'scripts/dev-test/vitest-shim.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vitest') {
    return { url: SHIM_URL, shortCircuit: true };
  }
  if (specifier.startsWith('@vessel/')) {
    const rel = ALIASES.get(specifier);
    if (rel) {
      return { url: pathToFileURL(path.join(root, rel)).href, shortCircuit: true };
    }
  }
  // relative `./x.js` imports -> `./x.ts` (type-stripping source lane)
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    const fromDir = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : root;
    const base = specifier.slice(0, -3);
    const tsPath = path.resolve(fromDir, base + '.ts');
    if (fs.existsSync(tsPath)) {
      return { url: pathToFileURL(tsPath).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

register(new URL('./test-alias.mjs', import.meta.url));
