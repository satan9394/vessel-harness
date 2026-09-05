/**
 * Dev-only module resolver for the sandboxed test lane.
 * Maps `vitest` -> in-process shim and `@cah/*` -> package src (mirroring
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
  ['@cah/shared', 'packages/shared/src/index.ts'],
  ['@cah/core', 'packages/core/src/index.ts'],
  ['@cah/llm', 'packages/llm/src/index.ts'],
  ['@cah/behavior', 'packages/behavior/src/index.ts'],
  ['@cah/context', 'packages/context/src/index.ts'],
  ['@cah/tools', 'packages/tools/src/index.ts'],
  ['@cah/policy', 'packages/policy/src/index.ts'],
  ['@cah/runtime', 'packages/runtime/src/index.ts'],
  ['@cah/memory', 'packages/memory/src/index.ts'],
  ['@cah/skills', 'packages/skills/src/index.ts'],
  ['@cah/agents', 'packages/agents/src/index.ts'],
  ['@cah/telemetry', 'packages/telemetry/src/index.ts'],
  ['@cah/cli', 'apps/cli/src/index.ts'],
  ['@cah/bench-runners', 'benchmarks/runners/src/index.ts'],
]);

const SHIM_URL = pathToFileURL(path.join(root, 'scripts/dev-test/vitest-shim.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'vitest') {
    return { url: SHIM_URL, shortCircuit: true };
  }
  if (specifier.startsWith('@cah/')) {
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
