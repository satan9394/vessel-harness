// Same Card 197 fixture, with a baseline/candidate pair under identical bounded CPU work.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-ast-repair-'));
const workers = [];
try {
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  const parser = pathToFileURL(path.join(repo, 'node_modules/typescript-parser/lib/typescript.js')).href;
  const baseline = execFileSync('git', ['show', 'HEAD:packages/context/src/ast/symbolGraph.ts'], { cwd: repo, encoding: 'utf8' })
    .replace("'typescript-parser'", JSON.stringify(parser));
  fs.writeFileSync(path.join(tmp, 'baseline.ts'), baseline);
  const fixture = fs.readFileSync(path.join(repo, 'evidence/sessions/2026-10-08-v2.3/card197-check.ts'), 'utf8');
  for (let index = 0; index < 2; index++) workers.push(new Worker(`
    const { parentPort } = require('node:worker_threads');
    const { createHash } = require('node:crypto');
    const bytes = Buffer.alloc(16384, 1);
    parentPort.postMessage('ready');
    function work() { for (let n = 0; n < 100; n++) createHash('sha256').update(bytes).digest(); setImmediate(work); }
    work();
  `, { eval: true }));
  await Promise.all(workers.map(worker => new Promise(resolve => worker.once('message', resolve))));
  const results = [];
  for (const [label, source] of [
    ['baseline', path.join(tmp, 'baseline.ts')],
    ['candidate', path.join(repo, 'packages/context/src/ast/symbolGraph.ts')],
  ]) {
    const script = path.join(tmp, `${label}-check.ts`);
    fs.writeFileSync(script, fixture.replace("'../../../packages/context/src/ast/symbolGraph.js'", JSON.stringify(pathToFileURL(source).href)));
    const run = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: repo, encoding: 'utf8', timeout: 30000 });
    console.log(`=== ${label}: unchanged Card 197 assertions, two SHA-256 workers ===`);
    console.log(run.stdout); console.log(run.stderr); console.log(`exit=${run.status}`);
    results.push({ label, exit: run.status });
  }
  if (results.at(-1).exit !== 0) process.exitCode = 1;
} finally {
  await Promise.all(workers.map(worker => worker.terminate()));
  // Only this process's os.tmpdir test fixture, per repository cleanup exception.
  fs.rmSync(tmp, { recursive: true, force: true });
}
