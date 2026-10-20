#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findExecutable, invocation, parseResult, resultSchema, modelPromptContext, validateProfile, modelSettings } from './drivers.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '1.3.3-local';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const stamp = () => new Date().toISOString();
const ignored = new Set(['.git', '.pdw', 'node_modules', '.next', '.turbo', '__pycache__']);

export function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing symlink output: ${file}`);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(temp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  // Windows readers can briefly deny replacement; keep the original intact and bound retries.
  const deadline = Date.now() + 1000;
  for (;;) {
    try { fs.renameSync(temp, file); break; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(20, deadline - Date.now()));
    }
  }
}

function managedRoot(project) {
  const root = fs.realpathSync(project);
  const store = path.join(root, '.pdw');
  if (fs.existsSync(store) && fs.lstatSync(store).isSymbolicLink()) throw new Error('.pdw cannot be a symbolic link');
  return { root, store };
}

function git(root, args, input) {
  const result = spawnSync('git', ['-C', root, ...args], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return result.status === 0 || (args[0] === 'check-ignore' && result.status === 1) ? result.stdout : null;
}

function validateScope(scope) {
  if (typeof scope !== 'string' || !scope || scope.includes('\\') || path.isAbsolute(scope) || path.win32.parse(scope).root
    || scope.split('/').some(part => part === '..' || ignored.has(part))
    || (scope !== '.' && scope.split('/').some(part => !part || part === '.'))) throw new Error(`Invalid scope (use a canonical relative path): ${scope}`);
}

/** Real paths of two directories, compared case-insensitively on Windows. */
function sameDirectory(left, right) {
  const normalize = value => {
    let resolved;
    try { resolved = fs.realpathSync.native(value); } catch { resolved = path.resolve(value); }
    return resolved.replace(/[\\/]+$/, '');
  };
  const a = normalize(left), b = normalize(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function snapshot(root, scopes = []) {
  const tracked = git(root, ['ls-files', '-c', '-o', '--exclude-standard', '-z']);
  const files = new Set(tracked?.split('\0').filter(Boolean) ?? []);
  const prefixes = [];
  for (const scope of scopes) {
    validateScope(scope);
    let relative = '';
    for (const part of scope.split('/').filter(part => part && part !== '.')) {
      relative = relative ? `${relative}/${part}` : part;
      prefixes.push(relative);
      const file = path.join(root, relative);
      let stat;
      try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (stat.isSymbolicLink()) throw new Error(`Scope traverses symbolic link: ${scope}`);
    }
  }
  const ignoredPaths = tracked === null ? '' : git(root, ['check-ignore', '--no-index', '-z', '--stdin'], [root, ...prefixes].join('\0') + '\0');
  if (ignoredPaths === null) throw new Error('Cannot determine Git ignore coverage; snapshot aborted');
  const gitIgnored = new Set(ignoredPaths.split('\0').filter(Boolean));
  const filesystem = tracked === null || files.size === 0 || gitIgnored.has(root) || scopes.includes('.');
  // Path hygiene (see the empty-contents baseline defect): when the Git listing is
  // trustworthy enough to define the covered files, the work tree must be the project
  // root. Otherwise the file list and HEAD come from an enclosing repository, whose
  // ignore rules can hide real files and whose commits look like project drift.
  if (!filesystem) {
    const toplevel = git(root, ['rev-parse', '--show-toplevel'])?.trim() ?? null;
    if (!toplevel || !sameDirectory(toplevel, root)) {
      throw new Error(`Snapshot requires the Git work tree to be the project root (work tree: ${toplevel ?? 'unknown'}, project: ${root}); run git init in the project, or keep the scope inside a project whose files Git ignore rules do not hide`);
    }
  }
  function visit(relative = '') {
    const file = path.join(root, relative);
    if (!inside(root, file)) throw new Error(`Snapshot path escaped project: ${relative}`);
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink() || stat.isFile()) { files.add(relative); return; }
    if (!stat.isDirectory()) throw new Error(`Unsupported snapshot entry: ${relative}`);
    for (const entry of fs.readdirSync(file, { withFileTypes: true })) {
      if (!ignored.has(entry.name)) visit(path.join(relative, entry.name));
    }
  }
  // ponytail: honor Git for ordinary files, but never let ignore rules blind an explicit task scope.
  const scopeRoots = scopes.map(scope => prefixes.find(name => gitIgnored.has(name) && (scope === name || scope.startsWith(name + '/'))) ?? scope);
  const forced = [...new Set(scopeRoots)].filter(name => !scopeRoots.some(parent => name !== parent && name.startsWith(parent + '/')));
  if (filesystem) visit(); else for (const name of forced) visit(name);
  const contents = {};
  for (let name of [...files].sort()) {
    name = name.replaceAll('\\', '/');
    if (name.split('/').some(part => ignored.has(part))) continue;
    const file = path.resolve(root, name);
    if (!inside(root, file)) throw new Error(`Snapshot path escaped project: ${name}`);
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) contents[name] = `symlink:${fs.readlinkSync(file)}`;
    else if (stat.isFile()) contents[name] = hash(fs.readFileSync(file));
  }
  // A covered set with no readable file would record an empty baseline, and an empty
  // baseline makes every later drift comparison pass. Refuse it instead of writing one.
  if (files.size > 0 && Object.keys(contents).length === 0) {
    throw new Error(`Snapshot covered ${files.size} file(s) but recorded no readable content; refusing an empty baseline`);
  }
  const head = git(root, ['rev-parse', 'HEAD'])?.trim() ?? null;
  return { fingerprint: hash(JSON.stringify({ head, contents })), head, contents,
    coverage: { source: filesystem ? 'filesystem' : 'git+scope', file_count: Object.keys(contents).length, forced_roots: forced, excluded_directories: [...ignored] } };
}

export function changed(before, after) {
  return [...new Set([...Object.keys(before.contents), ...Object.keys(after.contents)])]
    .filter(file => before.contents[file] !== after.contents[file]);
}

function validateContract(task) {
  if (!task.goal?.trim() || !['audit', 'develop'].includes(task.mode)) throw new Error('Contract requires goal and mode: audit|develop');
  if (!Array.isArray(task.scope) || !task.scope.length) throw new Error('Contract requires nonempty scope');
  for (const item of task.scope) validateScope(item);
  if (!Array.isArray(task.acceptance) || !task.acceptance.length || task.acceptance.some(a => !a.id || !a.description)) throw new Error('Contract requires acceptance [{id,description}]');
  if (new Set(task.acceptance.map(a => a.id)).size !== task.acceptance.length) throw new Error('Duplicate acceptance id');
  if (!Array.isArray(task.checks) || !task.checks.length) throw new Error('Contract requires at least one real check; do not invent a passing placeholder');
  for (const check of task.checks) {
    if (!check.id || !check.command || !Array.isArray(check.args) || check.args.some(a => typeof a !== 'string')) throw new Error('Checks require id, command, string args[]');
    if (check.cwd && (path.isAbsolute(check.cwd) || check.cwd.split(/[\\/]/).includes('..'))) throw new Error('Check cwd must stay inside project');
  }
  if (new Set(task.checks.map(c => c.id)).size !== task.checks.length) throw new Error('Duplicate check id');
}

function configFor(root) {
  const config = read(path.join(root, '.pdw', 'config.json'));
  for (const key of ['max_cli_calls', 'call_timeout_seconds', 'task_timeout_seconds']) {
    if (!Number.isInteger(config.limits?.[key]) || config.limits[key] < 1) throw new Error(`Invalid limit ${key}`);
  }
  if (![0, 1].includes(config.limits.max_repairs)) throw new Error('max_repairs must be 0 or 1');
  return config;
}

function detectCheapModel() {
  const file = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.config', 'opencode', 'opencode.json');
  if (!fs.existsSync(file)) return null;
  try {
    const config = read(file);
    if (typeof config.model === 'string' && /deepseek.*flash/i.test(config.model)) return config.model;
    for (const provider of ['workbuddy', ...Object.keys(config.provider ?? {}).filter(p => p !== 'workbuddy')]) {
      const model = Object.keys(config.provider?.[provider]?.models ?? {}).find(m => /deepseek.*v4[.-]1.*flash/i.test(m));
      if (model) return `${provider}/${model}`;
    }
  } catch { /* JSONC/custom config: require an explicit project model instead. */ }
  return null;
}

export function withSavedOpenCodeVariant(model, file = path.join(process.env.XDG_STATE_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.local', 'state'), 'opencode', 'model.json')) {
  if (!model || model.includes('#')) return model;
  try {
    const variant = read(file).variant?.[model];
    if (typeof variant === 'string' && variant !== 'default' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(variant)) return `${model}#${variant}`;
  } catch { /* No saved TUI choice: leave the model unchanged; never invent an effort. */ }
  return model;
}

function initialize(project) {
  const { root, store } = managedRoot(project);
  const configFile = path.join(store, 'config.json');
  fs.mkdirSync(path.join(store, 'tasks'), { recursive: true });
  if (!fs.existsSync(configFile)) {
    const cheap = { backend: 'opencode', executable: findExecutable('opencode'), model: withSavedOpenCodeVariant(detectCheapModel()) };
    write(configFile, {
      schema_version: 1,
      roles: { scan: cheap, 'test-plan': cheap, implement: { backend: 'codex', executable: findExecutable('codex'), model: null }, review: cheap,
        planner: { backend: 'agy', executable: findExecutable('agy'), model: null } },
      limits: { max_cli_calls: 8, max_repairs: 1, call_timeout_seconds: 600, task_timeout_seconds: 3600 },
      cost: { status: 'unknown', hard_money_limit: false },
    });
  }
  const ignore = path.join(root, '.gitignore');
  const existing = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  if (!existing.split(/\r?\n/).some(line => ['.pdw', '.pdw/', '/.pdw/'].includes(line.trim()))) write(ignore, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}.pdw/\n`);
  return { project: root, config: configFile, next: 'doctor; new --from <contract.json>; plan <id>; run <id>' };
}

function taskFiles(root, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id ?? '')) throw new Error('Task id: lowercase letters, digits and hyphens, max 80');
  const dir = path.join(root, '.pdw', 'tasks', id);
  if (fs.existsSync(path.dirname(dir)) && fs.lstatSync(path.dirname(dir)).isSymbolicLink()) throw new Error('Task parent directory cannot be a symbolic link');
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Task directory cannot be a symbolic link');
  return { dir, contract: path.join(dir, 'contract.json'), state: path.join(dir, 'state.json'), cancel: path.join(dir, 'cancel.json') };
}

function createTask(root, from) {
  const task = read(path.resolve(from));
  validateContract(task);
  const id = `${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
  const files = taskFiles(root, id);
  const baseline = snapshot(root, task.scope);
  write(files.contract, task);
  write(path.join(files.dir, 'baseline.json'), baseline);
  write(files.state, { schema_version: 1, id, project: root, status: 'ready', phase: task.planner ? 'planner' : 'scan',
    contract_hash: hash(fs.readFileSync(files.contract)), calls_used: 0, repairs_used: 0, elapsed_ms: 0,
    limits: configFor(root).limits,
    artifact: baseline.fingerprint, roles: {}, attempts: [], checks: [], active: [], created_at: stamp(), failure: null });
  writeHandoff(root, id);
  return { id, directory: files.dir, next: `plan ${id}` };
}

function writeHandoff(root, id, observation) {
  const files = taskFiles(root, id), state = read(files.state), task = read(files.contract);
  if (!observation) {
    try { observation = { current: snapshot(root, task.scope), error: null }; }
    catch (error) { observation = { current: null, error: error.message }; }
  }
  const { current, error: snapshotError } = observation, baseline = read(path.join(files.dir, 'baseline.json'));
  const contractCurrent = hash(fs.readFileSync(files.contract)) === state.contract_hash;
  const evidenceCurrent = Boolean(current && current.fingerprint === state.artifact && contractCurrent);
  const review = Object.entries(state.roles).filter(([name]) => name.startsWith('review-')).at(-1)?.[1];
  const data = {
    id, generated_at: stamp(), project: root, goal: task.goal, scope: task.scope, acceptance: task.acceptance,
    status: state.status, phase: state.phase, contract_current: contractCurrent, evidence_current: evidenceCurrent,
    accepted_current: state.status === 'accepted_local' && evidenceCurrent,
    artifact: state.artifact, current_artifact: current?.fingerprint ?? null, head: current?.head ?? null,
    snapshot_coverage: current?.coverage ?? { source: 'unavailable', file_count: null }, snapshot_error: snapshotError,
    changes_known: Boolean(current), changed_files: current ? changed(baseline, current) : [], calls_used: state.calls_used,
    calls_remaining: Math.max(0, state.limits.max_cli_calls - state.calls_used),
    repairs_remaining: Math.max(0, state.limits.max_repairs - state.repairs_used),
    seconds_remaining: Math.max(0, Math.floor(state.limits.task_timeout_seconds - state.elapsed_ms / 1000)),
    active: state.active, failure: state.failure, cost: 'unknown',
    checks: state.checks.map(check => ({ id: check.id, exit_code: check.exit_code, reason: check.reason, stdout: check.stdout, stderr: check.stderr,
      current: evidenceCurrent && check.artifact === current?.fingerprint })),
    review: review ? { verdict: review.result.verdict, summary: review.result.summary, findings: review.result.findings,
      current: evidenceCurrent && review.fingerprint === current?.fingerprint, result_file: path.join(review.directory, 'result.json') } : null,
    role_results: Object.fromEntries(Object.entries(state.roles).map(([role, value]) => [role, path.join(value.directory, 'result.json')])),
    contract_file: files.contract, state_file: files.state, handoff_file: path.join(files.dir, 'HANDOFF.md'),
  };
  data.next_action = snapshotError ? `快照失败，覆盖未知：${snapshotError}；排查后再决定续跑，不能复用旧通过结论或重置预算。`
    : !evidenceCurrent ? '源码或契约已变化：回查差异，不沿用旧验收或直接续跑，不通过新任务规避原限额。'
    : state.status === 'running' || state.active.length ? '先核对 status、运行锁与活动进程；不要启动第二个协调者。'
    : data.accepted_current ? '本地验收已通过；无需继续实施，提交或发布另行确认。'
    : state.status === 'ready' ? `核对 plan ${id} 后 run ${id}。`
    : `先排查失败与剩余额度；条件满足再 resume ${id}，不重新扫描已完成且仍有效的阶段。`;
  const checks = data.checks.map(c => `- ${c.id}: exit ${c.exit_code}；current=${c.current}；${c.stdout}`).join('\n');
  write(data.handoff_file, `# ${id} 交接\n\n生成时间：${data.generated_at}。这是任务事实的派生视图；接手时运行 handoff ${id} 重新核对。\n\n目标：${data.goal}\n\n状态：${data.status}；阶段：${data.phase}；当前验收有效：${data.accepted_current}\n\n源码与契约证据仍有效：${data.evidence_current}；契约未漂移：${data.contract_current}\n\n下一步：${data.next_action}\n\n允许范围：${data.scope.join('、')}\n\n验收：\n${data.acceptance.map(a => `- ${a.id}: ${a.description}`).join('\n')}\n\n已变化文件：${data.changes_known ? data.changed_files.slice(0, 40).join('、') || '无' : '无法确定（快照失败）'}${data.changed_files.length > 40 ? '（完整列表见下方结构化快照）' : ''}\n\n检查：\n${checks || '- 尚未运行'}\n\n独立复核：${data.review ? `${data.review.verdict}；current=${data.review.current}；${data.review.result_file}` : '尚未完成'}\n\n问题：${data.failure ?? snapshotError ?? '无已记录阻断；未完成的阶段不算通过'}\n\n预算：已用 ${data.calls_used} 次 CLI；剩余 ${data.calls_remaining} 次、${data.repairs_remaining} 次修复、${data.seconds_remaining} 秒；费用 unknown。换对话不重置。\n\n活动进程：${data.active.length}（以最新 state/运行锁为准）。角色决策与原始证据从以下路径回查，不依赖聊天摘要。\n\n## 结构化快照\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`);
  return data;
}

function acquire(root, id) {
  const store = path.join(root, '.pdw');
  const lock = path.join(store, 'run.lock');
  fs.mkdirSync(lock); // atomic project-wide single coordinator, not a distributed lock
  write(path.join(lock, 'owner.json'), { pid: process.pid, id, started_at: stamp() });
  return () => {
    const destination = path.join(store, 'lock-history', `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
    if (!inside(store, path.resolve(lock)) || !inside(store, path.resolve(destination))) throw new Error('Lock archive escaped project');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(lock, destination); // retain the lock record; no permanent deletion
  };
}

function recoverLock(root) {
  const lock = path.join(root, '.pdw', 'run.lock');
  if (!fs.existsSync(lock)) return;
  if (fs.lstatSync(lock).isSymbolicLink()) throw new Error('Lock directory cannot be a symbolic link');
  const owner = read(path.join(lock, 'owner.json'));
  if (alive(owner.pid)) throw new Error(`Coordinator ${owner.pid} is still alive; use status/cancel, not resume`);
  const state = read(taskFiles(root, owner.id).state);
  if (state.active.some(child => alive(child.pid))) throw new Error('Coordinator stopped but recorded child processes are still alive. Inspect their PIDs before resuming; they were not silently reset.');
  const history = path.join(root, '.pdw', 'lock-history', `recovered-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(path.dirname(history), { recursive: true });
  fs.renameSync(lock, history);
}

function killTree(child) {
  if (child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0 && child.exitCode == null) child.kill('SIGKILL');
    return result;
  }
  else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}

async function execute(command, args, cwd, prefix, seconds, context, stdin) {
  if (process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(command)) throw new Error('Use a native executable or an explicit powershell.exe + -File args; no implicit shell interpolation');
  const stdout = fs.openSync(`${prefix}.stdout.log`, 'wx');
  const stderr = fs.openSync(`${prefix}.stderr.log`, 'wx');
  let child;
  try {
    child = spawn(command, args, { cwd, env: { ...process.env, ...(context.env ?? {}) },
      shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', stdout, stderr] });
  } finally { fs.closeSync(stdout); fs.closeSync(stderr); }
  if (!child.pid) return await new Promise((_, reject) => child.once('error', reject));
  const active = { pid: child.pid, command, started_at: stamp() };
  context.state.active.push(active); context.save();
  child.stdin.on('error', () => {});
  child.stdin.end(stdin ?? '');
  let reason = null;
  const abort = cause => {
    reason ??= cause;
    const stopped = killTree(child);
    if (stopped && stopped.status !== 0) fs.appendFileSync(`${prefix}.termination.log`, `${stamp()} ${stopped.status}: ${stopped.stderr ?? stopped.error ?? ''}\n`);
  };
  const timeout = setTimeout(() => abort('timeout'), seconds * 1000);
  const cancel = setInterval(() => { if (fs.existsSync(context.files.cancel)) abort('cancelled'); }, 250);
  try {
    const result = await new Promise(resolve => {
      child.once('error', error => {
        fs.appendFileSync(`${prefix}.termination.log`, `${stamp()} process error: ${error.message}\n`);
        abort('process_error'); // wait for close; do not orphan a live child on an error event
      });
      child.once('close', (code, signal) => resolve({ exit_code: code, signal }));
    });
    return { ...result, reason, stdout: `${prefix}.stdout.log`, stderr: `${prefix}.stderr.log`, command, args, cwd };
  } finally {
    clearTimeout(timeout); clearInterval(cancel);
    if (child.exitCode != null || child.signalCode != null || !alive(child.pid)) context.state.active = context.state.active.filter(entry => entry !== active);
    context.save();
  }
}

function promptFor(role, task, state, files, before, profile) {
  const purpose = {
    planner: 'Resolve architectural decisions and produce the smallest actionable plan. Do not implement.',
    scan: 'Read-only: locate existing implementation, callers and root causes. Cite files/lines. The test-plan worker owns verification discovery; do not duplicate a full scan.',
    'test-plan': 'Read-only: derive acceptance/negative scenarios, identify existing runnable checks and gaps. The scan worker owns implementation/caller discovery; do not repeat that scan.',
    implement: 'Implement only the stated goal within the allowed scope, reuse existing code, and self-check. Update affected usage/config/interface docs within scope; report a scope blocker if required docs are excluded. Do not change acceptance or this contract.',
    repair: 'Fix only the specific failed checks/review findings below, within the original scope. Do not suppress tests or alter acceptance.',
    review: 'Independently verify every acceptance criterion against the actual current artifact and raw check logs. Check affected docs against actual behavior; state why no doc changes are needed when applicable. Read implementation explanations only as claims. Do not modify source. Mark missing evidence not_run/fail. For audit tasks, findings are the deliverable: accurately reporting an existing defect may satisfy acceptance.',
  }[role];
  const prior = Object.fromEntries(Object.entries(state.roles).map(([name, value]) => [name, { result: value.result, evidence: value.directory }]));
  return `You are the ${role} for a bounded personal development task.\n${purpose}\n${modelPromptContext(profile)}\nProject: ${state.project}\nArtifact fingerprint: ${before.fingerprint}\nContract file: ${files.contract}\nContract:\n${JSON.stringify(task, null, 2)}\nPrior stage artifacts (consult original sources/logs; do not assume summaries prove success):\n${JSON.stringify(prior, null, 2)}\nActual check results:\n${JSON.stringify(state.checks, null, 2)}\nLast failure: ${state.failure ?? 'none'}\nRules: obey project instructions. No commit/push/merge/send/publish/deploy/deletion, credential reads, global config changes or nested agents. Never edit .pdw or this runner. Keep within scope. Do not claim a browser path was tested if it was not. Return exactly one final JSON object matching:\n${JSON.stringify(resultSchema)}\nFor review, acceptance must contain every contract criterion id, its status and concrete evidence. For other roles acceptance may be empty. verdict=pass means this role finished its assignment; it does not approve the whole task.\n`;
}

function verifyReview(task, result) {
  if (result.verdict !== 'pass' || (task.mode !== 'audit' && result.findings.some(f => ['high', 'blocker'].includes(f.severity)))) return false;
  const entries = new Map();
  for (const item of result.acceptance) {
    if (entries.has(item.id)) return false;
    entries.set(item.id, item);
  }
  return task.acceptance.every(item => entries.get(item.id)?.status === 'pass' && entries.get(item.id).evidence.trim());
}

function scopeCheck(task, baseline, current) {
  if (baseline.head !== current.head) throw new Error('Git HEAD changed: commits are not authorized by this task');
  const outside = changed(baseline, current).filter(file => !task.scope.some(scope => scope === '.' || file === scope || file.startsWith(scope.replace(/\/$/, '') + '/')));
  if (outside.length) throw new Error(`Out-of-scope changes: ${outside.join(', ')}`);
}

export async function runTask(root, id, resume = false) {
  const { store } = managedRoot(root);
  const files = taskFiles(root, id), config = configFor(root), task = read(files.contract), state = read(files.state);
  validateContract(task);
  config.limits = state.limits; // task-wide counters/limits survive route changes and resume
  if (state.status === 'accepted_local') throw new Error('Task already accepted; use status. New changes require a new task.');
  if (!resume && state.status !== 'ready') throw new Error('Task already started; use resume to retain its counters and evidence');
  if (resume) recoverLock(root);
  const release = acquire(root, id);
  const configHash = hash(fs.readFileSync(path.join(store, 'config.json')));
  const baseline = read(path.join(files.dir, 'baseline.json'));
  const context = { state, files, save: () => write(files.state, state) };
  let lastTick = Date.now();
  const tick = () => { const now = Date.now(); state.elapsed_ms += now - lastTick; lastTick = now; context.save(); };
  let heartbeat;
  function assertCurrent() {
    if (hash(fs.readFileSync(files.contract)) !== state.contract_hash || hash(fs.readFileSync(path.join(store, 'config.json'))) !== configHash) throw new Error('Contract/config changed; do not reuse this run to bypass limits');
    if (fs.existsSync(files.cancel)) throw new Error('Task cancelled');
    if (state.elapsed_ms >= config.limits.task_timeout_seconds * 1000) throw new Error('Task time budget exhausted');
    const current = snapshot(root, task.scope);
    if (current.fingerprint !== state.artifact) throw new Error('Source drift detected; old evidence cannot approve the changed artifact');
    return current;
  }
  async function call(role, name = role) {
    const before = assertCurrent();
    if (state.roles[name]) return;
    if (state.calls_used >= config.limits.max_cli_calls) throw new Error('CLI invocation budget exhausted');
    const profile = config.roles[role === 'repair' ? 'implement' : role];
    if (profile?.backend === 'opencode' && !profile.model) throw new Error(`Set an explicit cheap model for role ${role}; init could not identify your DeepSeek route`);
    const directory = path.join(files.dir, 'attempts', `${String(state.attempts.length + 1).padStart(2, '0')}-${name}-${crypto.randomBytes(2).toString('hex')}`);
    fs.mkdirSync(directory, { recursive: true });
    const inputs = { prompt: path.join(directory, 'prompt.md'), schema: path.join(directory, 'schema.json'), final: path.join(directory, 'final.json') };
    write(inputs.prompt, promptFor(role, task, state, files, before, profile)); write(inputs.schema, resultSchema);
    const native = invocation(profile, role, inputs);
    const attempt = { role, name, directory, started_at: stamp(), model: profile.model ?? 'host-default', backend: profile.backend, ...modelSettings(profile), prompt_guidance: profile.prompt_guidance ?? null, artifact_before: before.fingerprint, status: 'running' };
    state.calls_used++; state.attempts.push(attempt); context.save();
    console.log(`[${state.calls_used}/${config.limits.max_cli_calls}] ${name} -> ${profile.backend} (${attempt.model})`);
    const remaining = Math.max(1, Math.floor(config.limits.task_timeout_seconds - state.elapsed_ms / 1000));
    const result = await execute(native.executable, native.args, root, path.join(directory, 'process'), Math.min(config.limits.call_timeout_seconds, remaining), context, native.stdin);
    attempt.process = result; attempt.finished_at = stamp(); attempt.status = 'failed'; context.save();
    const after = snapshot(root, task.scope);
    if (!['implement', 'repair'].includes(role) && after.fingerprint !== before.fingerprint) throw new Error(`${role} changed source despite its read-only assignment`);
    scopeCheck(task, baseline, after);
    if (hash(fs.readFileSync(files.contract)) !== state.contract_hash || hash(fs.readFileSync(path.join(store, 'config.json'))) !== configHash) throw new Error('Agent modified contract/config');
    if (result.exit_code !== 0 || result.reason) throw new Error(`${role} process failed (${result.reason ?? result.exit_code}); ${result.stderr}`);
    const parsed = parseResult(fs.readFileSync(result.stdout, 'utf8'), inputs.final);
    write(path.join(directory, 'result.json'), parsed);
    if (parsed.verdict === 'blocked' || (role !== 'review' && parsed.verdict !== 'pass')) throw new Error(`${role} reported ${parsed.verdict}: ${parsed.summary}`);
    attempt.status = 'completed'; attempt.artifact_after = after.fingerprint;
    state.roles[name] = { result: parsed, directory, fingerprint: after.fingerprint };
    state.artifact = after.fingerprint; context.save();
  }
  async function checks() {
    const before = assertCurrent(); state.checks = [];
    const directory = path.join(files.dir, `checks-${state.repairs_used}-${crypto.randomBytes(3).toString('hex')}`);
    fs.mkdirSync(directory);
    for (let index = 0; index < task.checks.length; index++) {
      const check = task.checks[index];
      const cwd = fs.realpathSync(path.resolve(root, check.cwd ?? '.'));
      if (!inside(root, cwd)) throw new Error(`Check cwd escaped project: ${cwd}`);
      const seconds = Math.min(config.limits.call_timeout_seconds, Math.max(1, Math.floor(config.limits.task_timeout_seconds - state.elapsed_ms / 1000)));
      const result = await execute(check.command, check.args, cwd, path.join(directory, String(index + 1)), seconds, context);
      state.checks.push({ id: check.id, artifact: before.fingerprint, ...result }); context.save();
      assertCurrent(); // checks may generate ignored build output, never silently alter source
    }
    return state.checks.every(check => check.exit_code === 0 && !check.reason);
  }
  function repair(reason) {
    state.failure = reason;
    if (task.mode === 'audit' || state.repairs_used >= config.limits.max_repairs) throw new Error(reason + '; repair limit reached or read-only audit');
    state.repairs_used++; state.phase = 'repair'; context.save();
  }
  try {
    if (resume && fs.existsSync(files.cancel)) {
      fs.renameSync(files.cancel, path.join(files.dir, `cancel-history-${Date.now()}.json`));
    }
    assertCurrent(); state.status = 'running'; state.failure = null; context.save(); writeHandoff(root, id);
    heartbeat = setInterval(tick, 1000);
    while (state.status === 'running') {
      assertCurrent();
      if (state.phase === 'planner') { await call('planner'); state.phase = 'scan'; }
      else if (state.phase === 'scan') {
        // Parallel read-only roles share one source fingerprint; await both before releasing the coordinator.
        const results = await Promise.allSettled([call('scan'), call('test-plan')]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
        state.phase = task.mode === 'audit' ? 'checks' : 'implement';
      } else if (state.phase === 'implement') { await call('implement'); state.phase = 'checks'; }
      else if (state.phase === 'repair') { await call('repair', `repair-${state.repairs_used}`); state.phase = 'checks'; }
      else if (state.phase === 'checks') {
        if (await checks()) state.phase = 'review'; else repair('One or more actual verification commands failed');
      } else if (state.phase === 'review') {
        const name = `review-${state.repairs_used}`;
        await call('review', name);
        if (verifyReview(task, state.roles[name].result)) { assertCurrent(); state.status = 'accepted_local'; state.failure = null; }
        else repair('Independent review did not pass every acceptance criterion or has high/blocker findings');
      } else throw new Error(`Unknown phase: ${state.phase}`);
      context.save();
      writeHandoff(root, id);
    }
  } catch (error) {
    state.status = fs.existsSync(files.cancel) ? 'cancelled' : 'blocked'; state.failure = error.message;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    try {
      tick(); state.updated_at = stamp(); context.save();
      let observation;
      try { observation = { current: snapshot(root, task.scope), error: null }; }
      catch (error) { observation = { current: null, error: error.message }; }
      if (observation.error) {
        if (state.status !== 'cancelled') state.status = 'blocked';
        state.failure ??= observation.error; context.save();
      }
      const actualChanges = observation.current ? changed(baseline, observation.current) : null;
      const review = Object.entries(state.roles).filter(([name]) => name.startsWith('review-')).at(-1)?.[1];
      const checksText = state.checks.map(check => `- ${check.id}: exit ${check.exit_code}${check.reason ? ` (${check.reason})` : ''}；${check.stdout}`).join('\n');
      write(path.join(files.dir, 'REPORT.md'), `# ${id}\n\n状态：${state.status}\n\n目标：${task.goal}\n\n改动：${actualChanges ? actualChanges.slice(0, 20).join('、') || '无源码修改' : '无法确定（快照失败）'}${actualChanges?.length > 20 ? '（其余见差异清单）' : ''}\n\n检查：\n${checksText || '- 尚未运行'}\n\n独立复核：${review?.result.summary.slice(0, 600) ?? '尚未完成'}\n\nCLI 调用：${state.calls_used}/${config.limits.max_cli_calls}；修复：${state.repairs_used}/${config.limits.max_repairs}；活动进程：${state.active.length}\n\n费用：unknown（未声称金额硬限制）\n\n产物：${state.artifact}\n\n问题：${state.failure ?? '无阻断问题；本地验收通过不等于提交或发布'}\n\n下一步：${state.status === 'accepted_local' ? '用户验收；提交/发布另行确认' : `排查上述问题后 resume ${id}；源码变化则另建任务`}\n\n原始证据：attempts/、checks-*、state.json。\n`);
      write(path.join(files.dir, 'changed-files.json'), actualChanges);
      writeHandoff(root, id, observation);
    } finally { if (state.active.length === 0) release(); }
  }
  return state;
}

function doctor(root) {
  const config = configFor(root);
  const roles = Object.entries(config.roles).map(([role, profile]) => {
    let configurationError = null;
    try { validateProfile(profile); } catch (error) { configurationError = error.message; }
    const modelExplicit = typeof profile.model === 'string' && Boolean(profile.model.trim());
    const modelReady = modelExplicit || ['codex', 'agy'].includes(profile.backend);
    const binary = profile.executable && fs.existsSync(profile.executable) && (process.platform !== 'win32' || /\.exe$/i.test(profile.executable));
    const result = binary ? spawnSync(profile.executable, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true }) : null;
    return { role, backend: profile.backend, executable: profile.executable, model: modelExplicit ? profile.model : 'host-default',
      ...(!configurationError ? modelSettings(profile) : {}),
      available: Boolean(binary && result.status === 0), version: result?.stdout?.trim() ?? null,
      model_explicit: modelExplicit, model_source: modelExplicit ? 'explicit' : 'host-default',
      ready: Boolean(binary && result.status === 0 && modelReady && !configurationError), configuration_error: configurationError };
  });
  return { version, roles, authentication: 'not_checked', provider_routing: 'not_checked', money_limit: 'not enforced', permissions: 'host policy; no bypass flags',
    note: 'Binary/version discovery only. Authentication, model routing and output protocol require a real task.' };
}

async function main(argv) {
  const args = [...argv]; const command = args.shift();
  const flag = name => { const index = args.indexOf(name); if (index < 0) return null; const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`Missing value: ${name}`); args.splice(index, 2); return value; };
  const project = path.resolve(flag('--project') ?? process.cwd());
  if (command === 'init') { console.log(JSON.stringify(initialize(project), null, 2)); return; }
  if (command === 'install') {
    const target = path.join(fs.realpathSync(project), '.agents', 'skills', 'personal-dev-workflow');
    if (fs.existsSync(target)) throw new Error('Target skill already exists; inspect its version before replacing it');
    // Node's native cpSync crashed on this Windows installation; copy only the
    // small regular-file skill tree and refuse symlinks instead of following them.
    function copy(source, destination) {
      fs.mkdirSync(destination, { recursive: true });
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(`Skill packaging refuses symlinks: ${entry.name}`);
        const from = path.join(source, entry.name), to = path.join(destination, entry.name);
        if (entry.isDirectory()) copy(from, to); else fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      }
    }
    copy(skillRoot, target);
    const launcher = path.join(project, 'pdw.ps1');
    if (!fs.existsSync(launcher)) write(launcher, "$ErrorActionPreference = 'Stop'\n& node (Join-Path $PSScriptRoot '.agents\\skills\\personal-dev-workflow\\scripts\\pdw.mjs') @args\nexit $LASTEXITCODE\n");
    const entry = path.join(project, 'AGENTS.md');
    const previous = fs.existsSync(entry) ? fs.readFileSync(entry, 'utf8') : '';
    const marker = '<!-- pdw-entry -->';
    if (!previous.includes(marker)) write(entry, `${previous}${previous.endsWith('\n') || !previous ? '' : '\n'}\n${marker}\nFor substantial PDW/multi-agent tasks, read .agents/skills/personal-dev-workflow/SKILL.md. Prepare the executable contract for the user and use the runtime; do not ask the user to hand-copy role chats.\n<!-- /pdw-entry -->\n`);
    initialize(project);
    console.log(JSON.stringify({ installed: target, launcher, initialized: true, next: 'Ask your coding agent: use PDW to complete <goal>. Or run ./pdw.ps1 doctor' }, null, 2)); return;
  }
  if (command === 'help' || !command) {
    console.log(`PDW ${version}: init | doctor | demo | new --from <contract.json> | plan <id> | run <id> | resume <id> | status [id] | handoff <id> | cancel <id> | install --project <existing-dir>\nAll commands accept --project <dir>. demo invokes configured models for a read-only audit. No dependency installation, commit, publish or destructive cleanup.`); return;
  }
  const { root, store } = managedRoot(project);
  if (command === 'demo') {
    initialize(root);
    const created = createTask(root, path.join(skillRoot, 'assets', 'audit-task.json'));
    console.log(`Read-only live demo: ${created.id}`);
    const state = await runTask(root, created.id);
    console.log(JSON.stringify({ id: created.id, status: state.status, failure: state.failure, report: path.join(created.directory, 'REPORT.md') }, null, 2));
    process.exitCode = state.status === 'accepted_local' ? 0 : 1; return;
  }
  if (command === 'doctor') { const report = doctor(root); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.roles.filter(r => r.role !== 'planner').every(r => r.ready) ? 0 : 1; return; }
  if (command === 'new') { const from = flag('--from'); if (!from) throw new Error('new requires --from <contract.json>; the Skill prepares this contract for the user'); console.log(JSON.stringify(createTask(root, from), null, 2)); return; }
  const id = args.shift();
  if (command === 'status' && !id) {
    const tasks = fs.readdirSync(path.join(store, 'tasks')).map(name => read(taskFiles(root, name).state));
    console.log(JSON.stringify(tasks.map(s => ({ id: s.id, status: s.status, phase: s.phase, calls_used: s.calls_used, failure: s.failure })), null, 2)); return;
  }
  const files = taskFiles(root, id);
  if (command === 'handoff') { console.log(JSON.stringify(writeHandoff(root, id), null, 2)); return; }
  if (command === 'status') { const state = read(files.state), current = snapshot(root, read(files.contract).scope); console.log(JSON.stringify({ ...state, evidence_current: current.fingerprint === state.artifact, snapshot_coverage: current.coverage }, null, 2)); return; }
  if (command === 'plan') {
    const task = read(files.contract), config = configFor(root); validateContract(task);
    const roles = [...(task.planner ? ['planner'] : []), 'scan', 'test-plan', ...(task.mode === 'develop' ? ['implement'] : []), 'review'];
    console.log(JSON.stringify({ id, goal: task.goal, mode: task.mode, scope: task.scope, acceptance: task.acceptance, checks: task.checks,
      roles: Object.fromEntries(roles.map(role => [role, config.roles[role]])), limits: config.limits, cost: config.cost,
      next: `run ${id}`, launches_agents: false }, null, 2)); return;
  }
  if (command === 'cancel') { const state = read(files.state); if (state.status !== 'running') throw new Error('No running task to cancel; inspect status/resume'); write(files.cancel, { requested_at: stamp() }); console.log('Cancellation requested; wait for state.active=[] before resuming'); return; }
  if (command === 'run' || command === 'resume') {
    const state = await runTask(root, id, command === 'resume'); console.log(JSON.stringify({ id, status: state.status, failure: state.failure, report: path.join(files.dir, 'REPORT.md') }, null, 2)); process.exitCode = state.status === 'accepted_local' ? 0 : 1; return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`PDW: ${error.message}`); process.exitCode = 1; });
}
