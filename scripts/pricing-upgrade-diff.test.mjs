import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./pricing-upgrade-diff.mjs', import.meta.url));
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-diff-test-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function run(dir, oldData, newData) {
  const old = path.join(dir, 'old.json'), next = path.join(dir, 'new.json'), out = path.join(dir, 'out.json');
  fs.writeFileSync(old, typeof oldData === 'string' ? oldData : JSON.stringify(oldData));
  fs.writeFileSync(next, typeof newData === 'string' ? newData : JSON.stringify(newData));
  return { out, result: spawnSync(process.execPath, [script, '--from', old, '--to', next, '--out', out], { encoding: 'utf8' }) };
}
const price = { input: 1, output: 2, cacheRead: 0 };
test('skips unchanged values and emits changed rows in repair format', () => fixture(dir => {
  const { out, result } = run(dir, { models: { unchanged: price, changed: price } }, { models: { unchanged: { ...price }, changed: { ...price, cacheWrite: 0 } } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [{ key: 'changed', from: price, to: { ...price, cacheWrite: 0 } }]);
}));
test('skips added and removed models with reasons', () => fixture(dir => {
  const { out, result } = run(dir, { models: { removed: price } }, { models: { added: price } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), []);
  assert.match(result.stderr, /removed model removed.*no new value/);
  assert.match(result.stderr, /new model added.*no old value/);
}));
test('rejects malformed JSON, missing fields and negative prices without modifying output', () => fixture(dir => {
  for (const bad of ['{', {}, { models: { x: { input: 1 } } }, { models: { x: { ...price, cacheRead: -1 } } }]) {
    const output = path.join(dir, 'out.json');
    fs.writeFileSync(output, 'existing');
    const { result } = run(dir, bad, { models: { x: price } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pricing-upgrade-diff:/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'existing');
  }
}));
