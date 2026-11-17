import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const batches = {
  batch1: [
    'packages/runtime/src/process',
    'packages/runtime/src/sandbox',
    'packages/tools/src/git/worktree.test.ts',
    'packages/tools/src/tools.test.ts',
  ],
  batch2: [
    'apps/cli/src/providers/providerFactory.failover.test.ts',
    'apps/cli/src/ui',
    'packages/memory',
    'packages/shared/src/toolPins.test.ts',
    'apps/cli/src/commands/toolPins.test.ts',
  ],
};
const batch = process.argv[2];
if (!batches[batch]) throw new Error('Expected batch1 or batch2');
mkdirSync(dir, { recursive: true });
const results = [];
const commands = batches[batch].map(path => ({
  command: process.execPath,
  args: ['node_modules/vitest/vitest.mjs', 'run', path],
}));
commands.push({ command: 'pwsh', args: ['-NoProfile', '-Command', 'npx tsc -b tsconfig.json'] });
for (const [index, spec] of commands.entries()) {
  const start = Date.now();
  const child = spawn(spec.command, spec.args, { windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  const log = `${batch}-${index + 1}.log`;
  writeFileSync(new URL(log, import.meta.url), output);
  const result = { ...spec, exit: code, seconds: (Date.now() - start) / 1000, log };
  results.push(result);
  writeFileSync(new URL(`${batch}-results.json`, import.meta.url), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(result));
  console.log(output.split('\n').filter(line => /Test Files|Tests\s/.test(line)).join('\n'));
  if (code !== 0) { console.log(output.slice(-7000)); process.exit(code ?? 1); }
}
