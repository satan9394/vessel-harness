import fs from 'node:fs';
import { spawn } from 'node:child_process';
const checks = [
  ['web-tests', 'node', ['node_modules/vitest/vitest.mjs', 'run', '--root', 'apps/web']],
  ['web-types', 'node', ['node_modules/typescript/bin/tsc', '-p', 'apps/web/tsconfig.json', '--noEmit']],
  ['web-build', 'npm', ['run', '-w', '@vessel/web', 'build']],
];
await Promise.all(checks.map(([name, command, args]) => new Promise(resolve => {
  const started = new Date().toISOString();
  const windowsNpm = process.platform === 'win32' && command === 'npm';
  const child = spawn(windowsNpm ? process.env.ComSpec : command, windowsNpm ? ['/d', '/s', '/c', 'npm ' + args.join(' ')] : args, { windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  child.on('close', code => {
    fs.writeFileSync(new URL(name + '.json', import.meta.url), JSON.stringify({ command: [command, ...args].join(' '), started, ended: new Date().toISOString(), code, stdout, stderr }, null, 2));
    console.log(JSON.stringify({ name, code, stdout: stdout.slice(-1800), stderr: stderr.slice(-500) }));
    if (code) process.exitCode = 1;
    resolve();
  });
})));
