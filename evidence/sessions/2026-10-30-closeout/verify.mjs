import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const evidence = import.meta.dirname;
const repo = path.resolve(evidence, '../../..');
const startup = JSON.parse(fs.readFileSync(path.join(evidence, 'startup.json')));
const commands = [
  ['t2-focused-final', ['node_modules/vitest/vitest.mjs', 'run', 'packages/agents/src/team/teamApproveAndRun.test.ts', 'apps/local-server/src/teamStageApi.test.ts']],
  ['web-tests-final', ['node_modules/vitest/vitest.mjs', 'run', '--root', 'apps/web']],
  ['web-types-final', ['node_modules/typescript/bin/tsc', '-p', 'apps/web/tsconfig.json', '--noEmit']],
  ['runtime-build', ['node_modules/typescript/bin/tsc', '-b', 'tsconfig.json', '--pretty', 'false']],
];
await Promise.all(commands.map(([name, args]) => new Promise(resolve => {
  const startedAt = new Date().toISOString(); const stdout = []; const stderr = [];
  const child = spawn(process.execPath, args, { cwd: repo, windowsHide: true });
  child.stdout.on('data', data => stdout.push(data)); child.stderr.on('data', data => stderr.push(data));
  child.on('close', exitCode => {
    fs.writeFileSync(path.join(evidence, name + '.json'), JSON.stringify({ command: 'node ' + args.join(' '), startedAt, completedAt: new Date().toISOString(), exitCode, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }, null, 2));
    console.log(JSON.stringify({ name, exitCode })); if (exitCode) process.exitCode = 1; resolve();
  });
})));
