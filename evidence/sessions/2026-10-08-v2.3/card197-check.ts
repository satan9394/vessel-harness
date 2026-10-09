/** Runnable fixture proof: node --import tsx evidence/sessions/2026-10-08-v2.3/card197-check.ts */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SymbolGraphService } from '../../../packages/context/src/ast/symbolGraph.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-card197-proof-'));
try {
  const api = 'export interface Contract { execute(): number }; export function execute() { return 1 }';
  const files = {
    'api.ts': api,
    'barrel.ts': 'export { execute as run } from "./api.js"; export * from "./api.js";',
    'caller.ts': 'import { run, Contract } from "./barrel.js"; import * as api from "@vessel/api"; export function caller() { return run() + api.execute() }; class Impl implements Contract { execute() { return run() } }',
    'noise.ts': 'function execute() { return 9 }; function local() { return execute() }; function shadow(execute: () => number) { return execute() }; const text = "execute()";',
  };
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  const graph = new SymbolGraphService({ workspaceRoot: root, paths: { '@vessel/*': ['./*.ts'] } });
  await graph.indexFiles(Object.keys(files));
  const expected = ['caller.ts#caller', 'caller.ts#execute'];
  const actual = (await graph.getIncomingReferences('api.ts#execute')).map(node => node.id).sort();
  assert.deepEqual(actual, expected);
  for (let index = 0; index < 8; index++) {
    fs.writeFileSync(path.join(root, 'api.ts'), `${api}\nexport const warm${index} = ${index};`);
    await graph.indexFiles(['api.ts']);
  }
  const samplesMs: number[] = [];
  for (let index = 0; index < 12; index++) {
    fs.writeFileSync(path.join(root, 'api.ts'), `${api}\nexport const edit${index} = ${index};`);
    const start = performance.now(); await graph.indexFiles(['api.ts']); samplesMs.push(performance.now() - start);
    assert.equal((await graph.findSymbols({ symbolName: `edit${index}` })).length, 1);
    assert.equal((await graph.getIncomingReferences('api.ts#execute')).length, 2);
  }
  console.log(JSON.stringify({ command: 'node --import tsx evidence/sessions/2026-10-08-v2.3/card197-check.ts', fixtureFiles: Object.keys(files),
    precision: 1, expectedCallers: expected, actualCallers: actual, warmupEdits: 8, measuredEdits: 12,
    samplesMs, maximumMs: Math.max(...samplesMs), meanMs: samplesMs.reduce((a, b) => a + b, 0) / samplesMs.length,
    timingScope: 'UTF-8 source read, parse changed file, rebuild/check cached explicit files and resolve all graph edges; excludes disk write and subsequent assertions',
  }, null, 2));
  // 2026-10-08 revised user-approved DoD: retain every sample; mean <=15ms, peak <=25ms.
  assert.ok(samplesMs.reduce((a, b) => a + b, 0) / samplesMs.length <= 15, 'mean warmed real-edit update must complete within 15ms');
  assert.ok(Math.max(...samplesMs) <= 25, 'peak warmed real-edit update must complete within 25ms');
} finally {
  // This process owns this newly-created os.tmpdir fixture; repository deletion exception applies.
  fs.rmSync(root, { recursive: true, force: true });
}
