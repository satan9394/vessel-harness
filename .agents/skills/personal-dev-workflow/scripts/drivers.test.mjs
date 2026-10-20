import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { invocation, validateProfile, modelPromptContext } from './drivers.mjs';
import { write as atomicWrite } from './pdw.mjs';

const project = fileURLToPath(new URL(fs.existsSync(new URL('../../../package.json', import.meta.url)) ? '../../../' : '../../../../', import.meta.url));
const evidence = path.join(project, '.pdw', 'test-runs', `drivers-${Date.now()}-${process.pid}`);
fs.mkdirSync(evidence, { recursive: true });
console.log(`Preserved driver fixtures: ${evidence}`);
const write = (file, contents = '') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); return file; };
const files = { prompt: write(path.join(evidence, 'prompt.txt'), 'Fixture task'), schema: 'schema.json', final: 'final.json' };
const mock = write(path.join(evidence, 'mock.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));');
const probe = write(path.join(evidence, 'probe.mjs'), `import { findExecutable } from ${JSON.stringify(new URL('./drivers.mjs', import.meta.url).href)}; console.log(JSON.stringify(findExecutable(process.argv[2])));`);
const triple = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' }[process.arch];

function discoveryFixture(name) {
  const root = path.join(evidence, name), bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  return { root, bin };
}
function discover(fixture, name = 'codex', extra = []) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
  env.PATH = [fixture.bin, ...extra, path.join(process.env.SystemRoot, 'System32')].join(path.delimiter);
  env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  const result = spawnSync(process.execPath, [probe, name], { cwd: fixture.root, env, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function npmCodex(fixture) {
  write(path.join(fixture.bin, 'codex.cmd'), '@echo off\r\n');
  const root = path.join(fixture.bin, 'node_modules', '@openai', 'codex');
  write(path.join(root, 'package.json'), JSON.stringify({ name: '@openai/codex', type: 'module', bin: { codex: 'bin/codex.js' } }));
  write(path.join(root, 'bin', 'codex.js'));
  return root;
}
const windows = { skip: process.platform !== 'win32' || !triple };
test('Windows atomic writes tolerate a short reader lock but fail on a persistent lock', windows, async () => {
  const script = write(path.join(evidence, 'reader-lock.ps1'), `param($Target, $Ready, [int]$Hold)
$stream = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try { [IO.File]::WriteAllText($Ready, 'locked'); Start-Sleep -Milliseconds $Hold } finally { $stream.Dispose() }
`);
  for (const [name, hold, succeeds] of [['transient', 250, true], ['persistent', 4000, false]]) {
    const target = write(path.join(evidence, `${name}.json`), 'original');
    const ready = path.join(evidence, `${name}.ready`);
    const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-File', script, target, ready, String(hold)], { windowsHide: true, stdio: 'ignore' });
    const done = new Promise(resolve => child.once('close', resolve));
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    try {
      assert.ok(fs.existsSync(ready), 'reader must actually hold the file lock');
      if (succeeds) { atomicWrite(target, 'updated'); assert.equal(fs.readFileSync(target, 'utf8'), 'updated'); }
      else { assert.throws(() => atomicWrite(target, 'updated'), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)); assert.equal(fs.readFileSync(target, 'utf8'), 'original'); }
    } finally { await done; }
  }
});

test('OpenCode effort selects the same explicit variant as TUI /effort', () => {
  const profile = { backend: 'opencode', executable: process.execPath, args: [mock], model: 'workbuddy/deepseek-v4.1-flash', reasoning_effort: 'high' };
  const run = invocation(profile, 'scan', files);
  assert.equal(run.args[run.args.indexOf('--model') + 1], 'workbuddy/deepseek-v4.1-flash#high');
  assert.ok(!run.args.includes('--config'));
  assert.match(modelPromptContext(profile), /deepseek-v4\.1-flash#high/);
  for (const bad of [
    { ...profile, model: undefined },
    { ...profile, reasoning_effort: 'invented' },
    { ...profile, model: 'workbuddy/deepseek-v4.1-flash#low' },
    { ...profile, backend: 'agy' },
  ]) assert.throws(() => validateProfile(bad), /reasoning_effort/);
  assert.doesNotThrow(() => validateProfile({ ...profile, model: 'workbuddy/deepseek-v4.1-flash#high', reasoning_effort: undefined }));
});
test('discovery prefers a PATH native executable over an earlier npm shim', windows, () => {
  const fixture = discoveryFixture('native-preference'), root = npmCodex(fixture);
  write(path.join(root, 'vendor', triple, 'bin', 'codex.exe'));
  const native = write(path.join(fixture.root, 'native', 'codex.exe'));
  assert.equal(discover(fixture, 'codex', [path.dirname(native)]).toLowerCase(), native.toLowerCase());
});
test('discovery resolves current nested npm optional platform package', windows, () => {
  const fixture = discoveryFixture('optional-nested'), root = npmCodex(fixture);
  const platform = path.join(root, 'node_modules', '@openai', `codex-win32-${process.arch}`);
  write(path.join(platform, 'package.json'), '{"name":"@openai/codex"}');
  const native = write(path.join(platform, 'vendor', triple, 'bin', 'codex.exe'));
  assert.equal(discover(fixture), native);
});
test('discovery resolves hoisted npm optional platform package', windows, () => {
  const fixture = discoveryFixture('optional-hoisted'); npmCodex(fixture);
  const platform = path.join(fixture.bin, 'node_modules', '@openai', `codex-win32-${process.arch}`);
  write(path.join(platform, 'package.json'), '{"name":"@openai/codex"}');
  const native = write(path.join(platform, 'vendor', triple, 'bin', 'codex.exe'));
  assert.equal(discover(fixture), native);
});
test('discovery resolves legacy package-local vendor fallback', windows, () => {
  const fixture = discoveryFixture('legacy-vendor'), root = npmCodex(fixture);
  const native = write(path.join(root, 'vendor', triple, 'bin', 'codex.exe'));
  assert.equal(discover(fixture), native);
});
test('discovery returns null when a shim has no actual native binary', windows, () => {
  const fixture = discoveryFixture('missing-native'), root = npmCodex(fixture);
  const platform = path.join(root, 'node_modules', '@openai', `codex-win32-${process.arch}`);
  write(path.join(platform, 'package.json'), '{"name":"@openai/codex"}');
  assert.equal(discover(fixture), null);
});
test('discovery skips executable-named directories and quoted PATH entries work', windows, () => {
  const fixture = discoveryFixture('directory-not-native');
  fs.mkdirSync(path.join(fixture.bin, 'codex.exe'));
  const native = write(path.join(fixture.root, 'quoted bin', 'codex.exe'));
  assert.equal(discover(fixture, 'codex', [`"${path.dirname(native)}"`]).toLowerCase(), native.toLowerCase());
});
test('discovery checks the current directory and configured PATHEXT', windows, () => {
  const fixture = discoveryFixture('current-directory');
  const native = write(path.join(fixture.root, 'codex.exe'));
  assert.equal(discover(fixture).toLowerCase(), native.toLowerCase());
});
test('discovery preserves OpenCode npm native fallback', windows, () => {
  const fixture = discoveryFixture('opencode-fallback');
  write(path.join(fixture.bin, 'opencode.cmd'));
  const native = write(path.join(fixture.bin, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'));
  assert.equal(discover(fixture, 'opencode'), native);
});

const forbidden = [
  ['--add-dir', '../outside'], ['--add-dir=../outside'], ['-C', '../outside'], ['-C../outside'], ['-C=../outside'],
  ['--cd', '../outside'], ['--cd=../outside'], ['--dir', '../outside'], ['--dir=../outside'], ['--directory', '../outside'], ['--directory=../outside'],
  ['--cwd=../outside'], ['--working-directory', '../outside'], ['--project=other'], ['--new-project', 'other'],
  ['--sandbox', 'danger-full-access'], ['--sandbox=danger-full-access'], ['-s', 'danger-full-access'], ['-sdanger-full-access'],
  ['--config', 'sandbox_mode="danger-full-access"'], ['--config=sandbox_mode="danger-full-access"'], ['-c', 'sandbox_mode="danger-full-access"'], ['-csandbox_mode="danger-full-access"'],
  ['--profile', 'unsafe'], ['--profile=unsafe'], ['-p', 'unsafe'], ['-punsafe'],
  ['--ask-for-approval', 'never'], ['--ask-for-approval=never'], ['-a', 'never'], ['-anever'],
  ['--full-auto'], ['--auto'], ['--yolo'], ['--approve-for-me'], ['--dangerously-bypass-approvals-and-sandbox'], ['--dangerously-bypass-hook-trust'],
  ['--permissions', 'all'], ['--permission-mode=all'], ['--mode', 'accept-edits'],
  ['--model', 'different'], ['--model=different'], ['-m', 'different'], ['-mdifferent'],
  ['--reasoning-effort', 'low'], ['--reasoning-effort=low'], ['--effort=low'], ['--variant', 'low'], ['--variant=low'], ['--oss'], ['--local-provider=other'], ['--enable', 'feature'], ['--disable=feature'], ['--worktree'], ['--'],
];
for (const backend of ['codex', 'opencode', 'agy']) {
  test(`${backend} rejects working-root, policy, config and model prefix overrides`, () => {
    for (const args of forbidden) assert.throws(() => invocation({ backend, executable: process.execPath, args: [mock, 'fixture', ...args], model: 'fixture/model' }, 'scan', files), /profile\.args.*(?:reserved|override|bypass)/i, JSON.stringify(args));
  });
}
test('args must be an array of strings before launch', () => {
  for (const args of ['--add-dir=../outside', null, {}, [42], [null], [mock, {}], new Array(1)]) {
    assert.throws(() => invocation({ backend: 'codex', executable: process.execPath, args }, 'scan', files), /profile\.args.*array.*strings/i, JSON.stringify(args));
  }
});
test('shared profile validation rejects unknown backends and invalid explicit models', () => {
  for (const profile of [undefined, {}, { backend: 'unknown' }]) assert.throws(() => validateProfile(profile), /Unsupported backend/);
  for (const model of [42, '', '   ']) assert.throws(() => validateProfile({ backend: 'codex', model }), /model must be a nonempty string/);
  assert.doesNotThrow(() => validateProfile({ backend: 'codex', model: 'fixture/model', reasoning_effort: 'medium' }));
  assert.doesNotThrow(() => validateProfile({ backend: 'codex' }));
  assert.doesNotThrow(() => validateProfile({ backend: 'codex', model: null }));
  assert.doesNotThrow(() => validateProfile({ backend: 'agy', model: null }));
  assert.throws(() => validateProfile({ backend: 'codex', model: null, prompt_guidance: 'Guidance' }), /explicit model/);
  assert.throws(() => validateProfile({ backend: 'codex', model: null, reasoning_effort: 'medium' }), /explicit model/);
});
test('benign node fixture prefixes launch and driver-owned model/policy stay intact', () => {
  for (const backend of ['codex', 'opencode', 'agy']) {
    const profile = { backend, executable: process.execPath, args: [mock, 'fixture'], model: 'fixture/model', ...(backend === 'codex' ? { reasoning_effort: 'medium' } : {}) };
    const run = invocation(profile, 'scan', files);
    const child = spawnSync(run.executable, run.args, { input: run.stdin, encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0, child.stderr);
    const received = JSON.parse(child.stdout);
    assert.equal(received[0], 'fixture');
    assert.equal(received[received.indexOf('--model') + 1], profile.model);
    if (backend === 'codex') {
      assert.equal(received[received.indexOf('--sandbox') + 1], 'read-only');
      assert.equal(received[received.indexOf('--config') + 1], 'model_reasoning_effort="medium"');
    }
  }
  assert.doesNotThrow(() => invocation({ backend: 'codex', executable: process.execPath }, 'scan', files));
});
