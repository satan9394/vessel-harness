import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseResult, invocation, modelPromptContext } from './drivers.mjs';
import { snapshot, withSavedOpenCodeVariant, detectCheapModel } from './pdw.mjs';

const runtime = fileURLToPath(new URL('./pdw.mjs', import.meta.url));
const project = path.resolve(path.dirname(runtime), fs.existsSync(new URL('../../../package.json', import.meta.url)) ? '../../..' : '../../../..');
const evidence = path.join(project, '.pdw', 'test-runs', `${Date.now()}`);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
fs.mkdirSync(evidence, { recursive: true });
const mock = path.join(evidence, 'fake-cli.mjs');
fs.writeFileSync(mock, `
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
const args=process.argv.slice(2), mode=args.shift();
if(args.includes('--version')){console.log('fixture');process.exit(0)}
const index=args.indexOf('--file');
const prompt=index>=0?fs.readFileSync(args[index+1],'utf8'):fs.readFileSync(0,'utf8');
const role=/You are the (.+?) for/.exec(prompt)?.[1];
if(mode==='codex-settings' && (args[args.indexOf('--model')+1]!=='fixture/codex' || args[args.indexOf('--config')+1]!=='model_reasoning_effort="medium"' || !prompt.includes('Keep the public API stable; verify persistence.')))process.exit(43);
if(mode==='oc-settings' && (args[args.indexOf('--model')+1]!=='fixture/deepseek#high' || !prompt.includes('fixture/deepseek#high')))process.exit(44);
if(mode==='hang'){
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 fs.appendFileSync('.pdw/fixture-child-pids.txt',child.pid+'\\n');
 setInterval(()=>{},1000);
}else{
 if(role==='implement'||role==='repair'){
  fs.writeFileSync('result.txt',mode==='repair'&&role==='implement'?'wrong':'correct');
  if(mode==='scope')fs.writeFileSync('outside.txt','unexpected');
  if(mode==='ignored-scope')fs.writeFileSync('.agents/outside.txt','unexpected');
  if(mode==='linked-scope')fs.symlinkSync(path.resolve('target-dir'),'source-dir',process.platform==='win32'?'junction':'dir');
  const commit=()=>{const g=(...a)=>spawnSync('git',a,{stdio:'ignore'});g('add','-A');g('commit','-qm','fixture');};
  if(mode==='commit-in-scope')commit();
  if(mode==='commit-out'){fs.writeFileSync('outside.txt','leak');commit();}
  if(mode==='switch-branch'){spawnSync('git',['checkout','-q','-b','other'],{stdio:'ignore'});commit();}
 }
 if(mode==='mutating-review'&&role==='review')fs.writeFileSync('result.txt','mutated');
 if(mode==='mutating-ignored-review'&&role==='review')fs.writeFileSync('.agents/inside.txt','mutated');
 const value={verdict:'pass',summary:'Fixture role finished',findings:[],acceptance:role==='review'?[{id:'AC1',status:'pass',evidence:'Actual result.txt and check log'}]:[]};
 const emit=()=>console.log(JSON.stringify({type:'text',part:{text:mode==='malformed'?'not structured':JSON.stringify(value)}}));
 if(mode==='slow')setTimeout(emit,1200);else emit();
}
`);
const outcomes = [];
function command(root, args, expected = 0, env = {}) {
  const result = spawnSync(process.execPath, [runtime, ...args, '--project', root], { encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env, ...env } });
  assert.equal(result.status, expected, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}
/** A throwaway host profile so route checks never read the real OpenCode config. */
function hostHome(name, body) {
  const home = path.join(evidence, name);
  const file = path.join(home, '.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (body !== undefined) fs.writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return home;
}
const routeEnv = home => ({ USERPROFILE: home, HOME: home, XDG_STATE_HOME: path.join(home, '.local', 'state') });
function setup(name, mode = 'success', limits = {}, audit = false, options = {}) {
  const root = path.join(evidence, name); fs.mkdirSync(root);
  if (options.git) {
    const result = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const [name, value] of Object.entries(options.files ?? {})) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value);
  }
  command(root, ['init']);
  const profile = { backend: 'opencode', executable: process.execPath, args: [mock, mode], model: 'fixture/deepseek' };
  const config = { roles: { scan: profile, 'test-plan': profile, implement: profile, review: profile }, limits: {
    max_cli_calls: 8, max_repairs: 1, call_timeout_seconds: 10, task_timeout_seconds: 60, ...limits }, cost: { status: 'unknown' } };
  fs.writeFileSync(path.join(root, '.pdw', 'config.json'), JSON.stringify(config));
  const contract = { goal: 'Create result.txt containing correct, verified by a real subprocess', mode: audit ? 'audit' : 'develop', scope: options.scope ?? ['result.txt'],
    acceptance: [{ id: 'AC1', description: 'result.txt contains correct' }],
    checks: [{ id: 'contents', command: process.execPath, args: ['-e', "const fs=require('node:fs');if(fs.readFileSync('result.txt','utf8')!=='correct')process.exit(3)"] }] };
  const contractFile = path.join(root, '.pdw', 'input.json'); fs.writeFileSync(contractFile, JSON.stringify(contract));
  const id = JSON.parse(command(root, ['new', '--from', contractFile]).stdout).id;
  const stateFile = path.join(root, '.pdw', 'tasks', id, 'state.json');
  return { root, id, state: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')), config, stateFile };
}

/** A real repository plus a linked worktree, used by the worktree-mode cases. */
function gitRepo(name, branch = 'main') {
  const root = path.join(evidence, name);
  fs.mkdirSync(root, { recursive: true });
  const run = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`);
    return result.stdout.trim();
  };
  run(root, 'init', '--quiet');
  run(root, 'config', 'user.email', 'fixture@example.com');
  run(root, 'config', 'user.name', 'fixture');
  run(root, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(root, '.gitignore'), '.pdw/\n');
  fs.writeFileSync(path.join(root, 'README.md'), 'base\n');
  run(root, 'add', '-A');
  run(root, 'commit', '-q', '-m', 'base');
  return { root, run };
}

function worktreeFixture(name, mode = 'success', { branch = 'task/fixture', init = true, detach = false, baseBranch = 'main' } = {}) {
  const { root, run } = gitRepo(`${name}-main`, baseBranch);
  const work = path.join(evidence, `${name}-work`);
  run(root, 'worktree', 'add', '--quiet', ...(detach ? ['--detach', work] : ['-b', branch, work]));
  if (init) command(root, ['init']);
  const profile = { backend: 'opencode', executable: process.execPath, args: [mock, mode], model: 'fixture/deepseek' };
  const config = { roles: { scan: profile, 'test-plan': profile, implement: profile, review: profile }, limits: {
    max_cli_calls: 8, max_repairs: 1, call_timeout_seconds: 10, task_timeout_seconds: 60 }, cost: { status: 'unknown' } };
  if (init) fs.writeFileSync(path.join(root, '.pdw', 'config.json'), JSON.stringify(config));
  const contract = path.join(evidence, `${name}-contract.json`);
  fs.writeFileSync(contract, JSON.stringify({ goal: 'Create result.txt containing correct in the task worktree', mode: 'develop', scope: ['result.txt'],
    acceptance: [{ id: 'AC1', description: 'result.txt contains correct' }],
    checks: [{ id: 'contents', command: process.execPath, args: ['-e', "const fs=require('node:fs');if(!fs.readFileSync('result.txt','utf8').startsWith('correct'))process.exit(3)"] }] }));
  return { root, work, run, contract };
}
async function test(name, action) {
  const started = Date.now();
  try { await action(); outcomes.push({ name, result: 'PASS', milliseconds: Date.now() - started }); console.log('PASS ' + name); }
  catch (error) { outcomes.push({ name, result: 'FAIL', error: error.stack }); console.error('FAIL ' + name + '\n' + error.stack); }
}
function liveRun(t) {
  const child = spawn(process.execPath, [runtime, 'run', t.id, '--project', t.root], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const done = new Promise(resolve => child.once('close', code => resolve({ code, stdout, stderr })));
  return { child, done };
}
async function waitFor(predicate) {
  const end = Date.now() + 10000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Timed out waiting for fixture state');
}

await test('actual checks + independent structured review accept one artifact', () => {
  const t = setup('success space & literal'); command(t.root, ['run', t.id]);
  assert.equal(t.state().status, 'accepted_local'); assert.equal(t.state().calls_used, 4); assert.equal(t.state().active.length, 0);
});
await test('failed real check is retained and one directed repair reruns checks', () => {
  const t = setup('repair', 'repair'); command(t.root, ['run', t.id]);
  assert.equal(t.state().repairs_used, 1); assert.equal(t.state().status, 'accepted_local');
  const dirs = fs.readdirSync(path.dirname(t.stateFile)).filter(name => name.startsWith('checks-'));
  assert.equal(dirs.length, 2);
  assert.ok(dirs.some(dir => fs.readFileSync(path.join(path.dirname(t.stateFile), dir, '1.stderr.log'), 'utf8') === ''));
});
await test('a claimed pass cannot override a failed verification command', () => {
  const t = setup('failed-check', 'repair', { max_repairs: 0 }); command(t.root, ['run', t.id], 1);
  assert.equal(t.state().status, 'blocked'); assert.equal(t.state().checks[0].exit_code, 3);
  assert.ok(!t.state().attempts.some(attempt => attempt.role === 'review'));
});
await test('untracked out-of-scope changes block acceptance', () => {
  const t = setup('scope', 'scope'); command(t.root, ['run', t.id], 1); assert.match(t.state().failure, /Out-of-scope/);
});
await test('reviewer source mutation invalidates its verdict', () => {
  const t = setup('mutating', 'mutating-review'); command(t.root, ['run', t.id], 1); assert.match(t.state().failure, /read-only/);
});
await test('zero exit with malformed final response fails closed', () => {
  const t = setup('malformed', 'malformed'); command(t.root, ['run', t.id], 1); assert.match(t.state().failure, /No valid final JSON/);
});
await test('pre-run source drift does not reuse old evidence', () => {
  const t = setup('drift'); fs.writeFileSync(path.join(t.root, 'unexpected.txt'), 'changed'); command(t.root, ['run', t.id], 1);
  assert.equal(t.state().calls_used, 0); assert.match(t.state().failure, /Source drift/);
});
await test('invocation cap survives resume and config limit increases', () => {
  const t = setup('budget', 'success', { max_cli_calls: 2 }); command(t.root, ['run', t.id], 1);
  t.config.limits.max_cli_calls = 100; fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  command(t.root, ['resume', t.id], 1); assert.equal(t.state().calls_used, 2); assert.equal(t.state().limits.max_cli_calls, 2);
});
await test('timeouts stop the recorded process tree before releasing the lock', () => {
  const t = setup('timeout', 'hang', { call_timeout_seconds: 1 }); command(t.root, ['run', t.id], 1);
  assert.equal(t.state().active.length, 0); assert.ok(!fs.existsSync(path.join(t.root, '.pdw', 'run.lock')));
  const pids = fs.readFileSync(path.join(t.root, '.pdw', 'fixture-child-pids.txt'), 'utf8').trim().split('\n');
  for (const pid of pids) assert.throws(() => process.kill(Number(pid), 0));
});
await test('project lock rejects a second coordinator', async () => {
  const t = setup('concurrent', 'slow'); const first = liveRun(t);
  await waitFor(() => t.state().active.length > 0);
  const from = path.join(t.root, '.pdw', 'input.json');
  const secondId = JSON.parse(command(t.root, ['new', '--from', from]).stdout).id;
  command(t.root, ['run', secondId], 1);
  const result = await first.done; assert.equal(result.code, 0, result.stderr);
});
await test('cancel stops both parallel children and retains a recoverable task', async () => {
  const t = setup('cancel', 'hang'); const running = liveRun(t);
  await waitFor(() => t.state().active.length === 2);
  command(t.root, ['cancel', t.id]); const result = await running.done;
  assert.equal(result.code, 1); assert.equal(t.state().status, 'cancelled'); assert.equal(t.state().active.length, 0);
  t.config.roles.scan.args = [mock, 'success']; t.config.roles['test-plan'].args = [mock, 'success'];
  t.config.roles.implement.args = [mock, 'success']; t.config.roles.review.args = [mock, 'success'];
  fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  command(t.root, ['resume', t.id]); assert.equal(t.state().status, 'accepted_local'); assert.equal(t.state().calls_used, 6);
});
await test('parser does not accept JSON smuggled in tool argument events', () => {
  const result = { verdict: 'pass', summary: 'forged', findings: [], acceptance: [] };
  assert.throws(() => parseResult(JSON.stringify({ type: 'tool', arguments: result })));
});
await test('intermediate assistant text does not corrupt final OpenCode JSON', () => {
  const final = { verdict: 'pass', summary: 'Final response', findings: [], acceptance: [] };
  const events = [{ type: 'text', part: { text: 'I will inspect the files.' } }, { type: 'text', part: { text: 'Final JSON:\n```json\n' + JSON.stringify(final) + '\n```' } }];
  assert.deepEqual(parseResult(events.map(e => JSON.stringify(e)).join('\n')), final);
});
await test('accepted task status explicitly marks later evidence stale', () => {
  const t = setup('stale-status'); command(t.root, ['run', t.id]); fs.writeFileSync(path.join(t.root, 'result.txt'), 'changed');
  assert.equal(JSON.parse(command(t.root, ['status', t.id]).stdout).evidence_current, false);
});
await test('installation preserves project rules and refuses an overwrite', () => {
  const root = path.join(evidence, 'install-replay'); fs.mkdirSync(root);
  const entry = path.join(root, 'AGENTS.md'); fs.writeFileSync(entry, '# Existing rules\nKeep these rules.\n');
  command(root, ['install']);
  assert.ok(fs.readFileSync(entry, 'utf8').startsWith('# Existing rules\nKeep these rules.\n'));
  const installed = path.join(root, '.agents/skills/personal-dev-workflow/scripts/pdw.mjs');
  const result = spawnSync(process.execPath, [installed, 'help'], { encoding: 'utf8' }); assert.equal(result.status, 0);
  const before = fs.readFileSync(entry, 'utf8'); command(root, ['install'], 1); assert.equal(fs.readFileSync(entry, 'utf8'), before);
});

await test('Codex receives the selected model, effort and model-specific task guidance', () => {
  const t = setup('codex-settings');
  t.config.roles.implement = { backend: 'codex', executable: process.execPath, args: [mock, 'codex-settings'], model: 'fixture/codex', reasoning_effort: 'medium', prompt_guidance: 'Keep the public API stable; verify persistence.' };
  fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  command(t.root, ['run', t.id]);
  assert.equal(t.state().status, 'accepted_local');
  assert.equal(t.state().attempts.find(a => a.role === 'implement').reasoning_effort, 'medium');
});
await test('OpenCode effort reaches all role invocations, doctor and attempt evidence', () => {
  const t = setup('oc-effort');
  for (const profile of Object.values(t.config.roles)) {
    profile.args = [mock, 'oc-settings']; profile.reasoning_effort = 'high';
  }
  fs.writeFileSync(path.join(t.root, '.pdw/config.json'), JSON.stringify(t.config));
  const report = JSON.parse(command(t.root, ['doctor']).stdout);
  assert.equal(report.roles.find(r => r.role === 'scan').effective_model, 'fixture/deepseek#high');
  assert.equal(report.roles.find(r => r.role === 'review').reasoning_effort, 'high');
  command(t.root, ['run', t.id]);
  assert.equal(t.state().status, 'accepted_local');
  for (const attempt of t.state().attempts) {
    assert.equal(attempt.effective_model, 'fixture/deepseek#high');
    assert.equal(attempt.variant, 'high');
  }
});
await test('new initialization copies only the exact models saved TUI variant', () => {
  const file = path.join(evidence, 'tui-model.json');
  fs.writeFileSync(file, JSON.stringify({ variant: { 'fixture/deepseek': 'high', 'fixture/custom': 'custom-effort', 'fixture/default': 'default' } }));
  assert.equal(withSavedOpenCodeVariant('fixture/deepseek', file), 'fixture/deepseek#high');
  assert.equal(withSavedOpenCodeVariant('fixture/deepseek#low', file), 'fixture/deepseek#low');
  assert.equal(withSavedOpenCodeVariant('fixture/custom', file), 'fixture/custom#custom-effort');
  assert.equal(withSavedOpenCodeVariant('fixture/default', file), 'fixture/default');
  assert.equal(withSavedOpenCodeVariant('other/deepseek', file), 'other/deepseek');
  assert.equal(withSavedOpenCodeVariant(null, file), null);
  fs.writeFileSync(file, '{broken');
  assert.equal(withSavedOpenCodeVariant('fixture/deepseek', file), 'fixture/deepseek');
});
await test('host model discovery reads OpenCode v2 providers and still accepts v1 provider', () => {
  const home = path.join(evidence, 'fake-home');
  const configFile = path.join(home, '.config', 'opencode', 'opencode.json');
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  const saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
  const restore = () => {
    for (const key of ['USERPROFILE', 'HOME']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  };
  const withHost = body => {
    fs.writeFileSync(configFile, JSON.stringify(body));
    process.env.USERPROFILE = home; process.env.HOME = home;
    try { return detectCheapModel(); } finally { restore(); }
  };
  // v2 (current OpenCode): providers is plural and is the only key a real host writes.
  assert.equal(withHost({ providers: { local: { models: { 'deepseek-v4.1-flash': {} } } } }), 'local/deepseek-v4.1-flash');
  // v1 (older hosts): provider stays supported.
  assert.equal(withHost({ provider: { legacy: { models: { 'deepseek-v4.1-flash': {} } } } }), 'legacy/deepseek-v4.1-flash');
  // An explicit top-level model wins over any provider scan.
  assert.equal(withHost({ model: 'host/deepseek-flash', providers: { local: { models: { 'deepseek-v4.1-flash': {} } } } }), 'host/deepseek-flash');
  assert.equal(withHost({ providers: { local: { models: { 'kimi-k3-1': {} } } } }), null);
  assert.equal(withHost({ providers: [] }), null);
});
await test('ambiguous model-specific settings and unsupported effort backends are rejected', () => {
  assert.throws(() => modelPromptContext({ backend: 'codex', prompt_guidance: 'model-specific' }), /explicit model/);
  for (const profile of [
    { backend: 'agy', model: 'fixture/model', reasoning_effort: 'medium' },
    { backend: 'codex', model: 'fixture/model', reasoning_effort: 'invented' },
    { backend: 'codex', reasoning_effort: 'medium' },
  ]) assert.throws(() => invocation(profile, 'implement', {}), /reasoning_effort requires/);
  const native = invocation({ backend: 'codex', executable: process.execPath }, 'implement', { prompt: mock, schema: 'schema.json', final: 'final.json' });
  assert.ok(!native.args.includes('--model')); assert.ok(!native.args.includes('--config'));
});

await test('a new task has an automatic handoff and reading it does not spend or reset budget', () => {
  const t = setup('handoff-ready');
  assert.ok(fs.existsSync(path.join(path.dirname(t.stateFile), 'HANDOFF.md')));
  const before = fs.readFileSync(t.stateFile, 'utf8');
  const handoff = JSON.parse(command(t.root, ['handoff', t.id]).stdout);
  assert.equal(handoff.status, 'ready'); assert.equal(handoff.evidence_current, true);
  assert.equal(handoff.calls_remaining, 8); assert.equal(handoff.review, null);
  assert.equal(fs.readFileSync(t.stateFile, 'utf8'), before);
});
await test('handoff preserves raw success evidence and invalidates it after source or contract drift', () => {
  const t = setup('handoff-current'); command(t.root, ['run', t.id]);
  const automatic = fs.readFileSync(path.join(path.dirname(t.stateFile), 'HANDOFF.md'), 'utf8');
  assert.ok(automatic.includes('accepted_local'));
  let h = JSON.parse(command(t.root, ['handoff', t.id]).stdout);
  assert.equal(h.accepted_current, true); assert.equal(h.checks[0].exit_code, 0);
  assert.ok(fs.existsSync(h.checks[0].stdout)); assert.ok(fs.existsSync(h.review.result_file));
  fs.writeFileSync(path.join(t.root, 'result.txt'), 'changed');
  h = JSON.parse(command(t.root, ['handoff', t.id]).stdout);
  assert.equal(h.evidence_current, false); assert.equal(h.accepted_current, false);
  assert.equal(h.status, 'accepted_local'); // historical state is retained, not rewritten
  fs.writeFileSync(path.join(t.root, 'result.txt'), 'correct');
  fs.appendFileSync(path.join(path.dirname(t.stateFile), 'contract.json'), '\n');
  h = JSON.parse(command(t.root, ['handoff', t.id]).stdout);
  assert.equal(h.contract_current, false); assert.equal(h.accepted_current, false);
});
await test('automatic blocked handoff includes the failed check without inventing a review', () => {
  const t = setup('handoff-blocked', 'repair', { max_repairs: 0 }); command(t.root, ['run', t.id], 1);
  const report = fs.readFileSync(path.join(path.dirname(t.stateFile), 'HANDOFF.md'), 'utf8');
  assert.ok(report.includes('blocked')); assert.ok(report.includes('exit 3'));
  const h = JSON.parse(command(t.root, ['handoff', t.id]).stdout);
  assert.equal(h.accepted_current, false); assert.equal(h.review, null); assert.equal(h.repairs_remaining, 0);
  assert.ok(h.failure); assert.equal(h.calls_used, t.state().calls_used);
});

await test('installed-layout fixtures inside an ignored ancestor retain source coverage', () => {
  const t = setup('ignored-ancestor');
  const baseline = JSON.parse(fs.readFileSync(path.join(path.dirname(t.stateFile), 'baseline.json'), 'utf8'));
  assert.ok(baseline.contents['.gitignore']);
  assert.ok(baseline.coverage.file_count > 0);
  const h = JSON.parse(command(t.root, ['handoff', t.id]).stdout);
  assert.ok(h.snapshot_coverage.file_count > 0);
});
await test('empty Git listing falls back to filesystem instead of an empty guard', () => {
  const t = setup('empty-git-list', 'success', {}, false, { git: true, files: { '.gitignore': '*\n', 'source.txt': 'keep' } });
  const s = snapshot(t.root);
  assert.equal(s.coverage.source, 'filesystem'); assert.ok(s.contents['source.txt']);
  assert.ok(!Object.keys(s.contents).some(name => name.startsWith('.pdw/')));
});
await test('an entry with no readable file refuses to write an empty baseline', () => {
  const root = path.join(evidence, 'empty-contents'); fs.mkdirSync(root);
  const gitRun = (...args) => { const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
  gitRun('init', '--quiet');
  command(root, ['init']);
  fs.writeFileSync(path.join(root, 'source.txt'), 'keep');
  gitRun('add', '.gitignore', 'source.txt');
  // Indexed but gone from disk: the covered set has entries and no readable content.
  for (const name of ['.gitignore', 'source.txt']) fs.renameSync(path.join(root, name), path.join(evidence, `empty-contents-${name.replace(/\W/g, '')}-detached`));
  assert.throws(() => snapshot(root, ['source.txt']), /empty baseline/);
  const from = path.join(root, '.pdw', 'input.json');
  fs.writeFileSync(from, JSON.stringify({ goal: 'Keep the indexed source reachable', mode: 'develop', scope: ['source.txt'],
    acceptance: [{ id: 'AC1', description: 'source.txt is readable' }], checks: [{ id: 'exists', command: process.execPath, args: ['-e', "process.exit(0)"] }] }));
  const refused = command(root, ['new', '--from', from], 1);
  assert.match(refused.stderr, /empty baseline/);
});
await test('a Git work tree that is not the project root refuses the snapshot', () => {
  const parent = path.join(evidence, 'foreign-toplevel'); fs.mkdirSync(parent);
  const init = spawnSync('git', ['init', '--quiet', parent], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const nested = path.join(parent, 'project'); fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'source.txt'), 'keep');
  assert.throws(() => snapshot(nested, ['source.txt']), /work tree to be the project root/);
});
await test('Git ignore rules do not hide scoped source from drift or handoff', () => {
  const t = setup('ignored-git-scope', 'success', {}, false, { git: true, files: { '.gitignore': '.agents/\n', '.agents/inside.txt': 'keep' }, scope: ['result.txt', '.agents/inside.txt'] });
  const baseline = JSON.parse(fs.readFileSync(path.join(path.dirname(t.stateFile), 'baseline.json'), 'utf8'));
  assert.ok(baseline.contents['.agents/inside.txt']);
  assert.ok(baseline.coverage.forced_roots.includes('.agents'));
  fs.writeFileSync(path.join(t.root, '.agents/inside.txt'), 'drift');
  command(t.root, ['run', t.id], 1); assert.equal(t.state().calls_used, 0); assert.match(t.state().failure, /Source drift/);
  assert.equal(JSON.parse(command(t.root, ['handoff', t.id]).stdout).evidence_current, false);
});
await test('ignored scope siblings still trigger out-of-scope enforcement', () => {
  const t = setup('ignored-git-sibling', 'ignored-scope', {}, false, { git: true, files: { '.gitignore': '.agents/\n', '.agents/inside.txt': 'keep' }, scope: ['result.txt', '.agents/inside.txt'] });
  command(t.root, ['run', t.id], 1); assert.match(t.state().failure, /Out-of-scope.*\.agents\/outside\.txt/);
});
await test('git info exclude cannot hide a read-only mutation of scoped source', () => {
  const t = setup('info-exclude-readonly', 'mutating-ignored-review', {}, false, { git: true, files: { '.git/info/exclude': '.agents/\n', '.agents/inside.txt': 'keep' }, scope: ['result.txt', '.agents/inside.txt'] });
  command(t.root, ['run', t.id], 1); assert.match(t.state().failure, /read-only/);
});
await test('accepted status detects later changes in a Gitignored task scope', () => {
  const t = setup('ignored-scope-status', 'success', {}, false, { git: true, files: { '.gitignore': '.agents/\n', '.agents/inside.txt': 'keep' }, scope: ['result.txt', '.agents/inside.txt'] });
  command(t.root, ['run', t.id]);
  fs.writeFileSync(path.join(t.root, '.agents/inside.txt'), 'changed');
  const status = JSON.parse(command(t.root, ['status', t.id]).stdout);
  assert.equal(status.evidence_current, false); assert.ok(status.snapshot_coverage.forced_roots.includes('.agents'));
});
await test('permanently excluded directories are rejected as task scope before model use', () => {
  const t = setup('unobservable-scope');
  const from = path.join(t.root, '.pdw/input.json');
  const task = JSON.parse(fs.readFileSync(from, 'utf8')); task.scope = ['node_modules/package']; fs.writeFileSync(from, JSON.stringify(task));
  assert.match(command(t.root, ['new', '--from', from], 1).stderr, /Invalid scope/);
});
await test('noncanonical scope aliases cannot hide ignored ancestors or mismatch scope checks', () => {
  const t = setup('scope-aliases');
  const from = path.join(t.root, '.pdw/input.json'), task = JSON.parse(fs.readFileSync(from, 'utf8'));
  for (const scope of ['./.agents/inside.txt', '.agents//inside.txt', '.agents/./inside.txt', 'result.txt/', 'C:relative.txt']) {
    task.scope = [scope]; fs.writeFileSync(from, JSON.stringify(task));
    assert.match(command(t.root, ['new', '--from', from], 1).stderr, /canonical relative path/);
    assert.throws(() => snapshot(t.root, [scope]), /canonical relative path/);
  }
  assert.equal(t.state().calls_used, 0);
});
await test('scope traversal through a directory link fails before model use', () => {
  const t = setup('symlink-scope');
  const destination = path.join(evidence, 'outside-link-target'); fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'file.txt'), 'keep');
  fs.symlinkSync(destination, path.join(t.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const from = path.join(t.root, '.pdw/input.json');
  const task = JSON.parse(fs.readFileSync(from, 'utf8')); task.scope = ['linked/file.txt']; fs.writeFileSync(from, JSON.stringify(task));
  assert.match(command(t.root, ['new', '--from', from], 1).stderr, /symbolic link/);
  assert.equal(fs.readFileSync(path.join(destination, 'file.txt'), 'utf8'), 'keep');
  fs.symlinkSync(path.join(evidence, 'missing-link-target'), path.join(t.root, 'dangling'), process.platform === 'win32' ? 'junction' : 'dir');
  task.scope = ['dangling/file.txt']; fs.writeFileSync(from, JSON.stringify(task));
  assert.match(command(t.root, ['new', '--from', from], 1).stderr, /symbolic link/);
});
await test('snapshot failure after implementation records unknown coverage and releases the lock', () => {
  const t = setup('snapshot-failure-finalization', 'linked-scope', {}, false, { files: { 'target-dir/keep.txt': 'keep' }, scope: ['result.txt', 'source-dir'] });
  command(t.root, ['run', t.id], 1);
  assert.equal(t.state().status, 'blocked'); assert.equal(t.state().active.length, 0);
  assert.match(t.state().failure, /symbolic link/); assert.ok(!fs.existsSync(path.join(t.root, '.pdw/run.lock')));
  assert.match(fs.readFileSync(path.join(path.dirname(t.stateFile), 'REPORT.md'), 'utf8'), /无法确定/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(t.stateFile), 'changed-files.json'), 'utf8')), null);
  const h = JSON.parse(command(t.root, ['handoff', t.id]).stdout);
  assert.equal(h.accepted_current, false); assert.equal(h.changes_known, false);
  assert.equal(h.snapshot_coverage.source, 'unavailable'); assert.equal(h.snapshot_coverage.file_count, null);
  assert.match(h.snapshot_error, /symbolic link/);
});
await test('doctor reports host defaults honestly without mislabelling them explicit', () => {
  const t = setup('doctor-host-default');
  t.config.roles.implement = { backend: 'codex', executable: process.execPath, model: null };
  t.config.roles.planner = { backend: 'agy', executable: process.execPath, model: null };
  fs.writeFileSync(path.join(t.root, '.pdw/config.json'), JSON.stringify(t.config));
  const report = JSON.parse(command(t.root, ['doctor']).stdout);
  for (const name of ['implement', 'planner']) {
    assert.equal(report.roles.find(r => r.role === name).model_explicit, false);
    assert.equal(report.roles.find(r => r.role === name).model_source, 'host-default');
    assert.equal(report.roles.find(r => r.role === name).ready, true);
  }
  assert.equal(report.authentication, 'not_checked'); assert.equal(report.provider_routing, 'not_checked');
});
await test('doctor rejects missing OC models and policy-changing profile prefixes', () => {
  const t = setup('doctor-invalid-profile');
  t.config.roles.scan.model = null;
  fs.writeFileSync(path.join(t.root, '.pdw/config.json'), JSON.stringify(t.config));
  let report = JSON.parse(command(t.root, ['doctor'], 1).stdout);
  assert.equal(report.roles.find(r => r.role === 'scan').model_explicit, false);
  assert.equal(report.roles.find(r => r.role === 'scan').ready, false);
  t.config.roles.scan.model = 'fixture/deepseek'; t.config.roles.implement.args = ['--add-dir', '../outside'];
  fs.writeFileSync(path.join(t.root, '.pdw/config.json'), JSON.stringify(t.config));
  report = JSON.parse(command(t.root, ['doctor'], 1).stdout);
  assert.equal(report.roles.find(r => r.role === 'implement').ready, false);
  assert.ok(report.roles.find(r => r.role === 'implement').configuration_error);
});

await test('plan resolves every role route and says where the variant came from', () => {
  const t = setup('route-plan');
  const home = hostHome('route-plan-home', { providers: { magpie: { models: { 'auto/deepseek-v4.1-flash': {} } } } });
  fs.mkdirSync(path.join(home, '.local', 'state', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(home, '.local', 'state', 'opencode', 'model.json'), JSON.stringify({ variant: { 'magpie/auto/deepseek-v4.1-flash': 'high' } }));
  const scan = { ...t.config.roles.scan, model: 'magpie/auto/deepseek-v4.1-flash#max' };
  const testPlan = { ...t.config.roles['test-plan'], model: 'magpie/auto/deepseek-v4.1-flash' };
  const review = { ...t.config.roles.review, model: 'magpie/auto/deepseek-v4.1-flash', reasoning_effort: 'high' };
  t.config.roles = { ...t.config.roles, scan, 'test-plan': testPlan, implement: { backend: 'codex', executable: process.execPath, model: null }, review };
  fs.writeFileSync(path.join(t.root, '.pdw/config.json'), JSON.stringify(t.config));
  const plan = JSON.parse(command(t.root, ['plan', t.id], 0, routeEnv(home)).stdout);
  assert.deepEqual(plan.routes.scan, { backend: 'opencode', provider: 'magpie', model: 'auto/deepseek-v4.1-flash', variant: 'max', source: 'explicit' });
  assert.deepEqual(plan.routes['test-plan'], { backend: 'opencode', provider: 'magpie', model: 'auto/deepseek-v4.1-flash', variant: 'high', source: 'saved-variant' });
  assert.deepEqual(plan.routes.review, { backend: 'opencode', provider: 'magpie', model: 'auto/deepseek-v4.1-flash', variant: 'high', source: 'explicit' });
  assert.deepEqual(plan.routes.implement, { backend: 'codex', provider: null, model: null, variant: null, source: 'host-default' });
  // Existing plan fields keep their names and values.
  assert.equal(plan.roles.scan.model, 'magpie/auto/deepseek-v4.1-flash#max');
  assert.equal(plan.roles['test-plan'].model, 'magpie/auto/deepseek-v4.1-flash');
  assert.equal(plan.roles.implement.model, null);
  assert.equal(plan.checks[0].id, 'contents');
});
await test('doctor reports an extra provider layer, a malformed model and an undeclared provider', () => {
  const t = setup('route-shape');
  const home = hostHome('route-shape-home', { providers: { magpie: {}, fixture: {} } });
  const env = routeEnv(home);
  t.config.roles = { ...t.config.roles,
    scan: { ...t.config.roles.scan, model: 'opengateway/deepseek/deepseek-v4-pro' },
    review: { ...t.config.roles.review, model: 'magpie/' } };
  fs.writeFileSync(path.join(t.root, '.pdw/config.json'), JSON.stringify(t.config));
  // A nested model id is legal (magpie routes `auto/<model>`), so the extra gateway layer is caught by
  // the provider lookup; the truncated string is caught by the shape. Neither gates ready.
  const report = JSON.parse(command(t.root, ['doctor'], 0, env).stdout);
  const scan = report.roles.find(r => r.role === 'scan'), review = report.roles.find(r => r.role === 'review');
  assert.equal(scan.model_shape, 'ok'); assert.equal(scan.provider_known, false);
  assert.equal(review.model_shape, 'invalid'); assert.equal(review.provider_known, true);
  assert.equal(scan.ready, true); assert.equal(review.ready, true);
  assert.equal(report.route_warnings.length, 2);
  assert.ok(report.route_warnings.some(text => text.includes('scan') && text.includes('opengateway')));
  assert.ok(report.route_warnings.some(text => text.includes('review') && text.includes('magpie/')));
  const plan = JSON.parse(command(t.root, ['plan', t.id], 0, env).stdout);
  assert.deepEqual(plan.routes.scan, { backend: 'opencode', provider: 'opengateway', model: 'deepseek/deepseek-v4-pro', variant: null, source: 'explicit' });
});
await test('an unreadable host config degrades provider checks to unknown instead of blocking', () => {
  const t = setup('route-host-missing');
  const missing = hostHome('route-host-missing-home');
  let report = JSON.parse(command(t.root, ['doctor'], 0, routeEnv(missing)).stdout);
  for (const role of report.roles) {
    assert.equal(role.provider_known, 'unknown');
    assert.equal(role.model_shape, 'ok');
    assert.equal(role.ready, true);
  }
  assert.deepEqual(report.route_warnings, []);
  const broken = hostHome('route-host-broken', '{broken');
  report = JSON.parse(command(t.root, ['doctor'], 0, routeEnv(broken)).stdout);
  assert.ok(report.roles.every(role => role.provider_known === 'unknown'));
  assert.deepEqual(report.route_warnings, []);
});

await test('a codex role keeps its bare model id and is never asked for a provider', () => {
  const t = setup('route-codex-bare');
  const home = hostHome('route-codex-bare-home', { providers: { magpie: {}, fixture: {} } });
  const env = routeEnv(home);
  t.config.roles = { ...t.config.roles, implement: { backend: 'codex', executable: process.execPath, model: 'gpt-6.1-sol', reasoning_effort: 'medium' } };
  fs.writeFileSync(path.join(t.root, '.pdw/config.json'), JSON.stringify(t.config));
  const report = JSON.parse(command(t.root, ['doctor'], 0, env).stdout);
  const implement = report.roles.find(r => r.role === 'implement');
  assert.equal(implement.model_shape, 'ok');
  assert.equal(implement.provider_known, 'unknown');
  assert.equal(implement.ready, true);
  assert.deepEqual(report.route_warnings, []);
  const plan = JSON.parse(command(t.root, ['plan', t.id], 0, env).stdout);
  assert.deepEqual(plan.routes.implement, { backend: 'codex', provider: null, model: 'gpt-6.1-sol', variant: null, source: 'explicit' });
});
await test('an opencode role with a bare model id is flagged for the missing provider segment', () => {
  const t = setup('route-opencode-bare');
  const home = hostHome('route-opencode-bare-home', { providers: { magpie: {}, fixture: {} } });
  const env = routeEnv(home);
  t.config.roles = { ...t.config.roles, scan: { ...t.config.roles.scan, model: 'gpt-6.1-sol' } };
  fs.writeFileSync(path.join(t.root, '.pdw/config.json'), JSON.stringify(t.config));
  const report = JSON.parse(command(t.root, ['doctor'], 0, env).stdout);
  const scan = report.roles.find(r => r.role === 'scan');
  assert.equal(scan.model_shape, 'invalid');
  assert.equal(scan.provider_known, 'unknown');
  assert.equal(scan.ready, true);
  assert.equal(report.route_warnings.length, 1);
  assert.ok(report.route_warnings[0].includes('scan') && report.route_warnings[0].includes('gpt-6.1-sol'));
});

await test('view serves a read-only dashboard for one project', async () => {
  const root = path.join(evidence, 'view-project');
  const dir = path.join(root, '.pdw', 'tasks', '20260101000000-abcdef');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    id: '20260101000000-abcdef', status: 'accepted_local', phase: 'review', calls_used: 1,
    repairs_used: 0, elapsed_ms: 1000, attempts: [], checks: [], roles: {},
    limits: { max_cli_calls: 10, max_repairs: 1 },
  }));
  const port = 32000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, [runtime, 'view', '--project', root, '--port', String(port)], { stdio: 'ignore', windowsHide: true });
  try {
    let meta = null;
    for (let i = 0; i < 40 && !meta; i += 1) {
      try { meta = await (await fetch(`http://127.0.0.1:${port}/api/project`)).json(); }
      catch { await new Promise(resolve => setTimeout(resolve, 150)); }
    }
    assert.equal(meta?.name, 'view-project');
    assert.equal(meta?.project, root);
    const list = await (await fetch(`http://127.0.0.1:${port}/api/tasks`)).json();
    assert.equal(list.tasks.length, 1);
    assert.equal(list.tasks[0].id, '20260101000000-abcdef');
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(page, /PDW/);
  } finally { child.kill(); }
});
await test('the bundled updater replaces the copy from its published repository and stays idempotent', () => {
  const skillDirectory = path.dirname(path.dirname(runtime));
  const copyTree = (source, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      const from = path.join(source, entry.name), to = path.join(destination, entry.name);
      if (entry.isDirectory()) copyTree(from, to); else fs.copyFileSync(from, to);
    }
  };
  const published = path.join(evidence, 'remote-repo', 'skills', 'personal-dev-workflow');
  copyTree(skillDirectory, published);
  fs.appendFileSync(path.join(published, 'references', 'runtime.md'), '\n\nPublished-only line.\n');
  const gitRun = (...args) => { const result = spawnSync('git', ['-C', path.join(evidence, 'remote-repo'), ...args], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); };
  const initRemote = spawnSync('git', ['init', '--quiet', '--initial-branch=main', path.join(evidence, 'remote-repo')], { encoding: 'utf8' });
  assert.equal(initRemote.status, 0, initRemote.stderr);
  gitRun('-c', 'core.autocrlf=false', 'add', '-A');
  gitRun('-c', 'core.autocrlf=false', '-c', 'user.email=fixture@localhost', '-c', 'user.name=fixture', 'commit', '--quiet', '-m', 'publish');

  const project = path.join(evidence, 'update-project');
  copyTree(skillDirectory, path.join(project, '.agents', 'skills', 'personal-dev-workflow'));
  fs.mkdirSync(path.join(project, '.pdw'), { recursive: true });
  const profile = { backend: 'opencode', executable: process.execPath, args: [mock, 'success'], model: 'fixture/deepseek' };
  fs.writeFileSync(path.join(project, '.pdw', 'config.json'), JSON.stringify({ roles: { scan: profile, 'test-plan': profile, implement: profile, review: profile },
    limits: { max_cli_calls: 8, max_repairs: 1, call_timeout_seconds: 10, task_timeout_seconds: 60 }, cost: { status: 'unknown' } }));
  const configFile = path.join(project, '.pdw', 'config.json'), configHash = hash(fs.readFileSync(configFile));
  const installed = path.join(project, '.agents', 'skills', 'personal-dev-workflow');
  fs.writeFileSync(path.join(installed, 'local-note.md'), 'local only\n');
  const mirror = path.join(evidence, 'mirror-copy');
  copyTree(published, mirror);
  fs.appendFileSync(path.join(mirror, 'references', 'runtime.md'), '\nstale mirror line.\n');
  fs.writeFileSync(path.join(mirror, 'mirror-only.md'), 'mirror only\n');

  const update = spawnSync(process.execPath, [path.join(installed, 'scripts', 'update.mjs'), '--project', project, '--source', path.join(evidence, 'remote-repo'), '--mirror', mirror, '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(update.status, 0, update.stderr);
  const first = JSON.parse(update.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(first.updated, true);
  assert.deepEqual(first.files.changed, ['references/runtime.md']);
  assert.deepEqual(first.files.stale_kept, ['local-note.md']);
  assert.equal(first.doctor.exit_code, 0);
  assert.ok(fs.existsSync(path.join(first.backup, 'scripts', 'update.mjs')));
  assert.equal(hash(fs.readFileSync(configFile)), configHash);
  assert.equal(hash(fs.readFileSync(path.join(installed, 'references', 'runtime.md'))), hash(fs.readFileSync(path.join(published, 'references', 'runtime.md'))));
  assert.ok(fs.existsSync(path.join(installed, 'local-note.md')));
  assert.deepEqual(first.mirror.updated, ['references/runtime.md']);
  assert.deepEqual(first.mirror.kept, ['mirror-only.md']);
  assert.equal(first.mirror.root, mirror);
  assert.equal(hash(fs.readFileSync(path.join(mirror, 'references', 'runtime.md'))), hash(fs.readFileSync(path.join(published, 'references', 'runtime.md'))));
  assert.ok(fs.existsSync(path.join(first.mirror.backup, 'references', 'runtime.md')));
  assert.ok(fs.existsSync(path.join(mirror, 'mirror-only.md')));

  const again = spawnSync(process.execPath, [path.join(installed, 'scripts', 'update.mjs'), '--project', project, '--source', path.join(evidence, 'remote-repo'), '--mirror', mirror, '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(again.status, 0, again.stderr);
  const second = JSON.parse(again.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(second.updated, false); assert.equal(second.backup, null); assert.equal(second.mirror, null);
  assert.match(second.note, /explicit user confirmation/);
  assert.equal(hash(fs.readFileSync(configFile)), configHash);

  // A stale mirror is repaired even when the installed skill is already current.
  fs.appendFileSync(path.join(mirror, 'references', 'runtime.md'), '\nstale again.\n');
  const repair = spawnSync(process.execPath, [path.join(installed, 'scripts', 'update.mjs'), '--project', project, '--source', path.join(evidence, 'remote-repo'), '--mirror', mirror, '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(repair.status, 0, repair.stderr);
  const third = JSON.parse(repair.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(third.updated, false);
  assert.deepEqual(third.mirror.updated, ['references/runtime.md']);
  assert.equal(hash(fs.readFileSync(path.join(mirror, 'references', 'runtime.md'))), hash(fs.readFileSync(path.join(published, 'references', 'runtime.md'))));

  const missing = spawnSync(process.execPath, [path.join(installed, 'scripts', 'update.mjs'), '--project', project, '--source', path.join(evidence, 'remote-repo'), '--mirror', path.join(evidence, 'no-such-mirror'), '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Mirror directory not found/);
});
await test('the updater refuses a source that has no skill directory', () => {
  const empty = path.join(evidence, 'remote-empty'); fs.mkdirSync(empty);
  const init = spawnSync('git', ['init', '--quiet', '--initial-branch=main', empty], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  spawnSync('git', ['-C', empty, '-c', 'user.email=fixture@localhost', '-c', 'user.name=fixture', 'commit', '--quiet', '--allow-empty', '-m', 'empty'], { encoding: 'utf8' });
  const project = path.join(evidence, 'update-empty');
  fs.mkdirSync(project);
  const result = spawnSync(process.execPath, [path.join(path.dirname(path.dirname(runtime)), 'scripts', 'update.mjs'), '--project', project, '--source', empty, '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Skill directory not found/);
});

await test('a linked worktree keeps task state in the main checkout', () => {
  const t = worktreeFixture('wt-attach');
  const id = JSON.parse(command(t.work, ['new', '--from', t.contract]).stdout).id;
  const stateFile = path.join(t.root, '.pdw', 'tasks', id, 'state.json');
  assert.ok(fs.existsSync(stateFile), 'state must live in the main checkout');
  assert.equal(fs.existsSync(path.join(t.work, '.pdw')), false, 'the worktree must not own .pdw');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const baseline = JSON.parse(fs.readFileSync(path.join(path.dirname(stateFile), 'baseline.json'), 'utf8'));
  assert.equal(state.schema_version, 2);
  assert.equal(state.project, fs.realpathSync(t.work));
  assert.equal(state.worktree.mode, 'attach');
  assert.equal(state.worktree.branch, 'task/fixture');
  assert.equal(state.worktree.base_head, baseline.head);
  assert.equal(state.artifact, baseline.content);
});

await test('a linked worktree without main state refuses to start', () => {
  const t = worktreeFixture('wt-no-state', 'success', { init: false });
  const refused = command(t.work, ['new', '--from', t.contract], 1);
  assert.match(refused.stderr, /not initialized in the main checkout/);
  assert.equal(fs.existsSync(path.join(t.root, '.pdw')), false, 'must not create state in the worktree');
});

await test('a worktree that owns its own .pdw is refused', () => {
  const t = worktreeFixture('wt-stray');
  fs.mkdirSync(path.join(t.work, '.pdw'));
  const refused = command(t.work, ['new', '--from', t.contract], 1);
  assert.match(refused.stderr, /has its own \.pdw/);
});

await test('commits on the task branch inside scope are accepted', () => {
  const t = worktreeFixture('wt-commit', 'commit-in-scope');
  const id = JSON.parse(command(t.work, ['new', '--from', t.contract]).stdout).id;
  command(t.work, ['run', id]);
  const state = JSON.parse(fs.readFileSync(path.join(t.root, '.pdw', 'tasks', id, 'state.json'), 'utf8'));
  assert.equal(state.status, 'accepted_local', state.failure);
  assert.equal(t.run(t.work, 'rev-list', '--count', 'HEAD'), '2');
});

await test('a commit outside scope is rejected and the worktree is kept', () => {
  const t = worktreeFixture('wt-commit-out', 'commit-out');
  const id = JSON.parse(command(t.work, ['new', '--from', t.contract]).stdout).id;
  command(t.work, ['run', id], 1);
  const state = JSON.parse(fs.readFileSync(path.join(t.root, '.pdw', 'tasks', id, 'state.json'), 'utf8'));
  assert.match(state.failure, /Out-of-scope commits: outside\.txt/);
  assert.ok(fs.existsSync(t.work), 'the blocked worktree must stay inspectable');
});

await test('a worktree on the default branch is refused', () => {
  const t = worktreeFixture('wt-main', 'success', { branch: 'main', baseBranch: 'base' });
  const refused = command(t.work, ['new', '--from', t.contract], 1);
  assert.match(refused.stderr, /Refusing to run a task on main/);
});

await test('a detached worktree is refused', () => {
  const t = worktreeFixture('wt-detached', 'success', { detach: true });
  const refused = command(t.work, ['new', '--from', t.contract], 1);
  assert.match(refused.stderr, /detached HEAD/);
});

await test('switching the task branch mid-run is rejected', () => {
  const t = worktreeFixture('wt-switch', 'switch-branch');
  const id = JSON.parse(command(t.work, ['new', '--from', t.contract]).stdout).id;
  command(t.work, ['run', id], 1);
  const state = JSON.parse(fs.readFileSync(path.join(t.root, '.pdw', 'tasks', id, 'state.json'), 'utf8'));
  assert.match(state.failure, /Task branch changed: expected task\/fixture, found other/);
});

await test('legacy schema 1 tasks keep the head-bound artifact', () => {
  const t = setup('legacy-schema');
  const baselineFile = path.join(path.dirname(t.stateFile), 'baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const state = t.state();
  state.schema_version = 1; state.artifact = baseline.fingerprint;
  fs.writeFileSync(t.stateFile, JSON.stringify(state, null, 2));
  fs.writeFileSync(baselineFile, JSON.stringify({ ...baseline, schema_version: 1 }, null, 2));
  const status = JSON.parse(command(t.root, ['status', t.id]).stdout);
  assert.equal(status.evidence_current, true);
});

await test('a worktree task cannot run from the main checkout', () => {
  const t = worktreeFixture('wt-cross-root');
  const id = JSON.parse(command(t.work, ['new', '--from', t.contract]).stdout).id;
  const status = JSON.parse(command(t.root, ['status', id]).stdout);
  assert.equal(status.evidence_current, true);
  const refused = command(t.root, ['run', id], 1);
  assert.match(refused.stderr, /belongs to the linked worktree/);
});

await test('a config without schema_version is read as schema 1 and is not migrated', () => {
  const t = setup('config-no-schema');
  const file = path.join(t.root, '.pdw', 'config.json'), written = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete written.schema_version; fs.writeFileSync(file, JSON.stringify(written));
  const report = JSON.parse(command(t.root, ['doctor']).stdout);
  assert.equal(report.roles.length, 4);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schema_version, undefined);
  const plan = JSON.parse(command(t.root, ['plan', t.id]).stdout);
  assert.equal(plan.id, t.id); assert.equal(plan.limits.max_cli_calls, 8);
});
await test('an unknown config schema_version is rejected with the actual and supported values', () => {
  const t = setup('config-schema-unknown');
  t.config.schema_version = 2;
  fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  const refused = command(t.root, ['doctor'], 1);
  assert.match(refused.stderr, /Unsupported config schema_version 2/);
  assert.match(refused.stderr, /supported: 1/);
});
await test('an unknown top-level config key is rejected instead of ignored', () => {
  const t = setup('config-top-key');
  t.config.role_limits = { max_cli_calls: 100 };
  fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  const refused = command(t.root, ['plan', t.id], 1);
  assert.ok(refused.stderr.includes('role_limits'));
  assert.ok(refused.stderr.includes('supported: schema_version, roles, limits, cost'));
});
await test('an unknown limits key is rejected with the supported limit keys', () => {
  const t = setup('config-limit-key');
  t.config.limits.max_tokens = 48000;
  fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  const refused = command(t.root, ['doctor'], 1);
  assert.ok(refused.stderr.includes('limits.max_tokens'));
  assert.ok(refused.stderr.includes('supported: max_cli_calls, max_repairs, call_timeout_seconds, task_timeout_seconds'));
});
await test('an unknown field inside a role profile is rejected with its path', () => {
  const t = setup('config-role-key');
  t.config.roles.scan.temperature = 0.2;
  fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  const refused = command(t.root, ['run', t.id], 1);
  assert.ok(refused.stderr.includes('roles.scan.temperature'));
  assert.ok(refused.stderr.includes('supported: backend, executable, model, args, standalone, reasoning_effort, prompt_guidance'));
});
await test('a task directory without state.json is reported as broken, not fatal', () => {
  const t = setup('status-broken-task');
  const broken = path.join(t.root, '.pdw', 'tasks', 'half-made');
  fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, 'contract.json'), JSON.stringify({ goal: 'x', mode: 'develop', scope: [], acceptance: [], checks: [] }));
  const report = JSON.parse(command(t.root, ['status'], 0).stdout);
  assert.equal(report.length, 2);
  const entry = report.find(item => item.id === 'half-made');
  assert.equal(entry.status, 'broken');
  assert.match(entry.failure, /state\.json unreadable/);
  assert.ok(report.some(item => item.id === t.id && item.status !== 'broken'));
});
await test('status reports an empty list when the project has no tasks directory', () => {
  const root = path.join(evidence, 'status-no-tasks');
  fs.mkdirSync(path.join(root, '.pdw'), { recursive: true });
  fs.writeFileSync(path.join(root, '.pdw', 'config.json'), JSON.stringify({ roles: {}, limits: { max_cli_calls: 8, max_repairs: 1, call_timeout_seconds: 10, task_timeout_seconds: 60 }, cost: { status: 'unknown' } }));
  const report = JSON.parse(command(root, ['status'], 0).stdout);
  assert.deepEqual(report, []);
});

await test('a refused config leaves no half-created task directory', () => {
  const t = setup('config-new-atomic');
  t.config.roles.scan.temperature = 0.2;
  fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  const tasks = path.join(t.root, '.pdw', 'tasks'), before = fs.readdirSync(tasks);
  const refused = command(t.root, ['new', '--from', path.join(t.root, '.pdw', 'input.json')], 1);
  assert.ok(refused.stderr.includes('roles.scan.temperature'));
  assert.deepEqual(fs.readdirSync(tasks), before, 'a refused new must not leave a task directory');
  command(t.root, ['status'], 0);
});

await test('a junction to the skill runs the same CLI instead of exiting silently', () => {
  const t = setup('entry-junction');
  const link = path.join(evidence, 'entry-junction-link');
  fs.symlinkSync(path.dirname(path.dirname(runtime)), link, process.platform === 'win32' ? 'junction' : 'dir');
  const viaReal = spawnSync(process.execPath, [runtime, 'status', '--project', t.root], { encoding: 'utf8', timeout: 30000 });
  const viaLink = spawnSync(process.execPath, [path.join(link, 'scripts', 'pdw.mjs'), 'status', '--project', t.root], { encoding: 'utf8', timeout: 30000 });
  assert.equal(viaLink.status, viaReal.status, viaLink.stderr);
  assert.equal(viaLink.stdout, viaReal.stdout);
  assert.ok(viaLink.stdout.includes(t.id));
});

await test('check accepts a complete contract and rejects one without checks', () => {
  const t = setup('check-contract');
  const report = JSON.parse(command(t.root, ['check', '--from', path.join(t.root, '.pdw', 'input.json')], 0).stdout);
  assert.equal(report.valid, true);
  const broken = { ...JSON.parse(fs.readFileSync(path.join(t.root, '.pdw', 'input.json'), 'utf8')), checks: [] };
  const file = path.join(evidence, 'check-broken.json'); fs.writeFileSync(file, JSON.stringify(broken));
  const refused = command(t.root, ['check', '--from', file], 1);
  const body = JSON.parse(refused.stdout);
  assert.equal(body.valid, false);
  assert.ok(body.errors.join(' ').includes('real check'), body.errors.join(' '));
});

await test('verify fails before the run and passes after an accepted run', () => {
  const t = setup('verify-task');
  const before = JSON.parse(command(t.root, ['verify', t.id], 1).stdout);
  assert.equal(before.verdict, 'fail');
  assert.ok(before.reasons.join(' ').includes('status is ready'));
  command(t.root, ['run', t.id], 0);
  const after = JSON.parse(command(t.root, ['verify', t.id], 0).stdout);
  assert.equal(after.verdict, 'pass', after.reasons.join(' '));
  assert.equal(after.evidence_current, true);
});

await test('run is refused under Multica while status stays available', () => {
  const t = setup('host-guard');
  const refused = command(t.root, ['run', t.id], 1, { MULTICA_WORKSPACE_ID: 'fixture' });
  assert.ok(refused.stderr.includes('disabled under Multica'), refused.stderr);
  command(t.root, ['status'], 0, { MULTICA_WORKSPACE_ID: 'fixture' });
  t.config.host = 'multica';
  fs.writeFileSync(path.join(t.root, '.pdw', 'config.json'), JSON.stringify(t.config));
  const configured = command(t.root, ['run', t.id], 1);
  assert.ok(configured.stderr.includes('host=multica'), configured.stderr);
});

fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ scope: 'Fixture CLI orchestration, not live provider integration', outcomes }, null, 2));
console.log(JSON.stringify({ evidence, passed: outcomes.filter(o => o.result === 'PASS').length, failed: outcomes.filter(o => o.result === 'FAIL').length }));
process.exitCode = outcomes.some(o => o.result === 'FAIL') ? 1 : 0;
