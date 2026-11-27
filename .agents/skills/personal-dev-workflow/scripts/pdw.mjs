#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findExecutable, invocation, parseResult, resultSchema, modelPromptContext, validateProfile, modelSettings } from './drivers.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '1.5.0-local';
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

/**
 * Resolve the code root (the checkout the agent may read and write) and the state root.
 * A linked worktree shares <main>/.git, so PDW keeps its task state in the main checkout
 * while every snapshot, check and role process runs inside the worktree.
 */
export function workspace(project) {
  const work = fs.realpathSync(project);
  let main = work, mode = 'plain';
  const common = git(work, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ?? git(work, ['rev-parse', '--git-common-dir']);
  const value = common?.trim();
  if (value) {
    const absolute = path.isAbsolute(value) ? value : path.resolve(work, value);
    let resolved = absolute;
    try { resolved = fs.realpathSync(absolute); } catch { /* Keep the readable path when realpath is unavailable. */ }
    // A plain subdirectory of a repository also reports the enclosing .git; only a root
    // whose own --show-toplevel equals itself is a checkout, and only a shared .git then
    // means a linked worktree. Submodules keep their git dir under .git/modules.
    const topRaw = git(work, ['rev-parse', '--show-toplevel'])?.trim() ?? null;
    let top = topRaw;
    try { if (topRaw) top = fs.realpathSync(topRaw); } catch { /* Keep the reported path. */ }
    if (top && sameDirectory(top, work) && path.basename(resolved) === '.git' && !sameDirectory(path.dirname(resolved), work)) {
      main = path.dirname(resolved); mode = 'worktree';
    }
  }
  const store = path.join(main, '.pdw');
  if (fs.existsSync(store) && fs.lstatSync(store).isSymbolicLink()) throw new Error('.pdw cannot be a symbolic link');
  return { work, main, store, mode };
}

/** Refuse the two ways a linked worktree silently forks or loses task state. */
function assertManaged(ws) {
  if (ws.mode !== 'worktree') return ws;
  const stray = path.join(ws.work, '.pdw');
  if (fs.existsSync(stray)) throw new Error(`This linked worktree has its own .pdw (${stray}); PDW state must stay in ${ws.main}. Inspect that directory, then move it out before continuing.`);
  if (!fs.existsSync(path.join(ws.store, 'config.json'))) throw new Error(`PDW is not initialized in the main checkout (${ws.main}); run init there, not in the worktree.`);
  return ws;
}

/** Branch facts a task worktree must satisfy before it can own a run. */
function branchOf(work) {
  const branch = git(work, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim() ?? null;
  const head = git(work, ['rev-parse', 'HEAD'])?.trim() ?? null;
  return { branch, head };
}

function assertTaskBranch(work, expected) {
  const { branch } = branchOf(work);
  if (!branch || branch === 'HEAD') throw new Error('Task worktree is on a detached HEAD; check out a task branch before continuing');
  if (['main', 'master'].includes(branch)) throw new Error(`Refusing to run a task on ${branch}; create a task branch in the worktree`);
  if (expected && branch !== expected) throw new Error(`Task branch changed: expected ${expected}, found ${branch}`);
  return branch;
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
  const content = hash(JSON.stringify(contents));
  return { fingerprint: hash(JSON.stringify({ head, contents })), content, head, contents,
    coverage: { source: filesystem ? 'filesystem' : 'git+scope', file_count: Object.keys(contents).length, forced_roots: forced, excluded_directories: [...ignored] } };
}

export function changed(before, after) {
  return [...new Set([...Object.keys(before.contents), ...Object.keys(after.contents)])]
    .filter(file => before.contents[file] !== after.contents[file]);
}

/**
 * schema 1 bound the artifact to HEAD, so any commit invalidated old evidence.
 * schema 2 compares contents only; the branch policy below owns HEAD movement.
 */
function observed(snapshot, schema) {
  return Number(schema ?? 1) >= 2 ? snapshot.content : snapshot.fingerprint;
}

function inScope(task, file) {
  return task.scope.some(scope => scope === '.' || file === scope || file.startsWith(scope.replace(/\/$/, '') + '/'));
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

const configSchemaVersion = 1;
const configKeys = ['schema_version', 'roles', 'limits', 'cost', 'host'];
const configHosts = ['auto', 'local', 'multica'];
/** `repair` is not a config role: `runTask` maps it to `implement`. */
const configRoles = ['scan', 'test-plan', 'implement', 'review', 'planner'];
const profileKeys = ['backend', 'executable', 'model', 'args', 'standalone', 'reasoning_effort', 'prompt_guidance'];
const limitKeys = ['max_cli_calls', 'max_repairs', 'call_timeout_seconds', 'task_timeout_seconds'];
const costKeys = ['status', 'hard_money_limit'];

/**
 * Unknown keys are rejected, never ignored: a copied project carrying a retired or mistyped key would
 * otherwise run on defaults while its config reads as if it were in effect.
 */
function assertKnownKeys(value, supported, where = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const unknown = Object.keys(value).find(key => !supported.includes(key));
  if (unknown !== undefined) throw new Error(`Unsupported config key ${where ? `${where}.${unknown}` : unknown}; supported: ${supported.join(', ')}`);
}

function configFor(store) {
  const config = read(path.join(store, 'config.json'));
  // A config written before schema_version existed is schema 1; read it as 1 without rewriting the file.
  const schema = config.schema_version ?? configSchemaVersion;
  if (schema !== configSchemaVersion) throw new Error(`Unsupported config schema_version ${JSON.stringify(schema)}; supported: ${configSchemaVersion}`);
  assertKnownKeys(config, configKeys);
  assertKnownKeys(config.roles, configRoles, 'roles');
  for (const [role, profile] of Object.entries(config.roles ?? {})) assertKnownKeys(profile, profileKeys, `roles.${role}`);
  assertKnownKeys(config.limits, limitKeys, 'limits');
  for (const key of ['max_cli_calls', 'call_timeout_seconds', 'task_timeout_seconds']) {
    if (!Number.isInteger(config.limits?.[key]) || config.limits[key] < 1) throw new Error(`Invalid limit ${key}`);
  }
  if (![0, 1].includes(config.limits.max_repairs)) throw new Error('max_repairs must be 0 or 1');
  assertKnownKeys(config.cost, costKeys, 'cost');
  if (config.host !== undefined && !configHosts.includes(config.host)) throw new Error(`Unsupported host ${JSON.stringify(config.host)}; supported: ${configHosts.join(', ')}`);
  return config;
}

/**
 * Multica runs every agent under environment keys beginning with MULTICA_. A task started there
 * must not also start PDW's own relay: two dispatchers on one task fight over the same scope.
 */
function multicaContext() {
  return Object.keys(process.env).find(key => key.startsWith('MULTICA_') && process.env[key]) ?? null;
}

function assertRunHost(store) {
  const host = configFor(store).host ?? 'auto';
  if (host === 'multica') throw new Error('PDW run is disabled in a Multica workspace (config host=multica): the squad owns dispatch. Use check/verify, or set host=local on a standalone machine.');
  const detected = host === 'auto' ? multicaContext() : null;
  if (detected) throw new Error(`PDW run is disabled under Multica (detected ${detected}): the squad owns dispatch. Use check/verify, or set host=local only on a standalone machine.`);
}

/** Read-only contract gate: same rules as new/plan, plus warnings a person can judge before dispatch. */
function checkContract(from) {
  const file = path.resolve(from);
  const errors = [], warnings = [];
  let task;
  try { task = read(file); } catch (error) { return { valid: false, file, errors: [`Contract is not readable JSON: ${error.message}`], warnings, summary: null }; }
  try { validateContract(task); } catch (error) { errors.push(error.message); }
  if (task && typeof task === 'object' && !Array.isArray(task)) {
    const known = ['goal', 'mode', 'scope', 'acceptance', 'checks', 'planner', 'kind', 'budget', 'notes'];
    for (const key of Object.keys(task)) if (!known.includes(key)) warnings.push(`Unknown contract key is ignored by the runtime: ${key}`);
  }
  for (const item of task?.scope ?? []) {
    if (typeof item === 'string' && (path.isAbsolute(item) || item.split(/[\\/]/).includes('..'))) errors.push(`Scope must stay inside the project: ${item}`);
  }
  for (const check of task?.checks ?? []) {
    if (typeof check.command === 'string' && /[<>|&;]/.test(check.command)) warnings.push(`Check ${check.id}: command looks like a shell string; pass a bare executable and put the rest in args`);
  }
  for (const item of task?.acceptance ?? []) {
    if (typeof item.description === 'string' && item.description.trim().length < 8) warnings.push(`Acceptance ${item.id}: description is too short to be judged later`);
  }
  return {
    valid: errors.length === 0, file, errors, warnings,
    summary: task ? { goal: task.goal, mode: task.mode, scope: (task.scope ?? []).length, acceptance: (task.acceptance ?? []).length, checks: (task.checks ?? []).length } : null,
    next: errors.length ? 'Fix the listed errors before new/plan/run.' : 'node pdw.mjs new --from <contract.json>',
  };
}

/** Read-only evidence gate: can the recorded pass still be trusted against the current tree? */
function verifyTask(ws, id) {
  const files = taskFiles(ws.store, id);
  const state = read(files.state);
  const task = read(files.contract);
  const schema = Number(state.schema_version ?? 1);
  const current = snapshot(state.project ?? ws.work, task.scope);
  const contractCurrent = hash(fs.readFileSync(files.contract)) === state.contract_hash;
  const evidenceCurrent = observed(current, schema) === state.artifact && contractCurrent;
  const coverage = current.coverage ?? { source: 'unavailable', file_count: null };
  const failedChecks = (state.checks ?? []).filter(check => check.exit_code !== 0).map(check => ({ id: check.id, exit_code: check.exit_code }));
  const reviewEntry = Object.entries(state.roles ?? {}).filter(([name]) => name.startsWith('review-')).at(-1)?.[1];
  const reviewCovers = reviewEntry?.result ? verifyReview(task, reviewEntry.result) : false;
  const reasons = [];
  if (state.status !== 'accepted_local') reasons.push(`status is ${state.status}, not accepted_local`);
  if (!contractCurrent) reasons.push('contract changed after the run');
  if (!evidenceCurrent) reasons.push('source changed since the evidence was produced');
  if (!coverage || coverage.source === 'unavailable' || coverage.file_count === 0) reasons.push('snapshot coverage is empty; the evidence cannot be trusted');
  if (failedChecks.length) reasons.push('checks failed: ' + failedChecks.map(check => check.id).join(', '));
  if (!reviewCovers) reasons.push('the last review did not cover every acceptance id with concrete evidence');
  return {
    id, status: state.status, verdict: reasons.length ? 'fail' : 'pass', reasons,
    contract_current: contractCurrent, evidence_current: evidenceCurrent, snapshot_coverage: coverage,
    checks: (state.checks ?? []).map(check => ({ id: check.id, exit_code: check.exit_code })),
    review_covers_acceptance: reviewCovers,
  };
}

/** The host OpenCode config, or null when the file is missing or unreadable (JSONC included). */
function hostOpenCodeConfig() {
  const file = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.config', 'opencode', 'opencode.json');
  if (!fs.existsSync(file)) return null;
  try { return read(file); } catch { return null; }
}

/** Provider table of an OpenCode config, or null when it declares none. */
function hostProviderMap(config) {
  // OpenCode v2 writes `providers` (plural); v1 wrote `provider`. Read both, never silently skip v2.
  const providers = config?.providers ?? config?.provider;
  return providers && typeof providers === 'object' && !Array.isArray(providers) ? providers : null;
}

/** Provider ids the host OpenCode config declares, or null when that config cannot be read. */
export function hostProviderIds() {
  const providers = hostProviderMap(hostOpenCodeConfig());
  return providers ? Object.keys(providers) : null;
}

export function detectCheapModel() {
  const config = hostOpenCodeConfig();
  if (!config) return null;
  if (typeof config.model === 'string' && /deepseek.*flash/i.test(config.model)) return config.model;
  const providers = hostProviderMap(config);
  if (!providers) return null; // JSONC/custom config: require an explicit project model instead.
  for (const provider of ['workbuddy', ...Object.keys(providers).filter(p => p !== 'workbuddy')]) {
    const model = Object.keys(providers[provider]?.models ?? {}).find(m => /deepseek.*v4[.-]1.*flash/i.test(m));
    if (model) return `${provider}/${model}`;
  }
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

/** OpenCode routes `provider/model-id[#variant]`; the model id may itself contain `/`. */
const openCodeModelShape = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[^\s#]+(#[\w.-]+)?$/;
/** Codex and AGY take a bare, host-resolved model id: no provider segment, no variant suffix. */
const bareModelShape = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Shape check per backend: only OpenCode carries a provider prefix, so a bare id is valid there alone. */
function modelShapeOf(backend, model) {
  return (['codex', 'agy'].includes(backend) ? bareModelShape : openCodeModelShape).test(model);
}

/**
 * Resolve a role's model string into provider/model/variant and name where the variant came from.
 * `#variant` and `reasoning_effort` are explicit; a bare provider/model inherits the variant the host
 * saved for that model, so plan shows it instead of hiding which effort the request will carry.
 */
export function modelRoute(profile) {
  const backend = profile?.backend ?? null;
  const raw = typeof profile?.model === 'string' ? profile.model.trim() : '';
  if (!raw) return { backend, provider: null, model: null, variant: null, source: 'host-default' };
  const sharp = raw.indexOf('#');
  const base = sharp < 0 ? raw : raw.slice(0, sharp);
  const inline = sharp < 0 ? null : raw.slice(sharp + 1) || null;
  const effort = typeof profile?.reasoning_effort === 'string' && profile.reasoning_effort ? profile.reasoning_effort : null;
  // `variant` follows modelSettings(): it is an OpenCode setting, so Codex/AGY never report one.
  const pinned = backend === 'opencode' ? inline ?? effort : null;
  const saved = pinned || backend !== 'opencode' ? null : withSavedOpenCodeVariant(base);
  const slash = base.indexOf('/');
  return {
    backend,
    provider: slash < 0 ? null : base.slice(0, slash),
    model: slash < 0 ? base : base.slice(slash + 1),
    variant: pinned ?? (saved?.includes('#') ? saved.slice(saved.indexOf('#') + 1) : null),
    source: pinned ? 'explicit' : saved?.includes('#') ? 'saved-variant' : 'explicit',
  };
}

function initialize(project) {
  const ws = workspace(project);
  if (ws.mode === 'worktree') {
    assertManaged(ws);
    // Initializing inside a worktree would fork state and rewrite a tracked .gitignore.
    return { project: ws.work, main: ws.main, store: ws.store, worktree: true,
      next: 'State stays in the main checkout; create and run tasks from this worktree.' };
  }
  const { work: root, store } = ws;
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

function taskFiles(store, id) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id ?? '')) throw new Error('Task id: lowercase letters, digits and hyphens, max 80');
  const dir = path.join(store, 'tasks', id);
  if (fs.existsSync(path.dirname(dir)) && fs.lstatSync(path.dirname(dir)).isSymbolicLink()) throw new Error('Task parent directory cannot be a symbolic link');
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Task directory cannot be a symbolic link');
  return { dir, contract: path.join(dir, 'contract.json'), state: path.join(dir, 'state.json'), cancel: path.join(dir, 'cancel.json') };
}

function createTask(ws, from) {
  assertManaged(ws);
  const task = read(path.resolve(from));
  validateContract(task);
  // Fail before any write: a refused config must not leave a task directory without state.json
  // (`status` cannot read such a directory and exits 1 for the whole project).
  const config = configFor(ws.store);
  const id = `${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
  const files = taskFiles(ws.store, id);
  const branch = ws.mode === 'worktree' ? assertTaskBranch(ws.work) : null;
  const baseline = snapshot(ws.work, task.scope);
  write(files.contract, task);
  write(path.join(files.dir, 'baseline.json'), { schema_version: 2, ...baseline });
  write(files.state, { schema_version: 2, id, project: ws.work, store: ws.store,
    worktree: branch ? { mode: 'attach', main: ws.main, branch, base_head: baseline.head } : null,
    status: 'ready', phase: task.planner ? 'planner' : 'scan',
    contract_hash: hash(fs.readFileSync(files.contract)), calls_used: 0, repairs_used: 0, elapsed_ms: 0,
    limits: config.limits,
    artifact: baseline.content, roles: {}, attempts: [], checks: [], active: [], created_at: stamp(), failure: null });
  writeHandoff(ws, id);
  return { id, directory: files.dir, next: `plan ${id}` };
}

function writeHandoff(ws, id, observation) {
  const files = taskFiles(ws.store, id), state = read(files.state), task = read(files.contract);
  const taskSchema = Number(state.schema_version ?? 1);
  if (!observation) {
    try { observation = { current: snapshot(state.project ?? ws.work, task.scope), error: null }; }
    catch (error) { observation = { current: null, error: error.message }; }
  }
  const { current, error: snapshotError } = observation, baseline = read(path.join(files.dir, 'baseline.json'));
  const contractCurrent = hash(fs.readFileSync(files.contract)) === state.contract_hash;
  const currentKey = current ? observed(current, taskSchema) : null;
  const evidenceCurrent = Boolean(current && currentKey === state.artifact && contractCurrent);
  const review = Object.entries(state.roles).filter(([name]) => name.startsWith('review-')).at(-1)?.[1];
  const data = {
    id, generated_at: stamp(), project: ws.work, store: ws.store, worktree: state.worktree ?? null,
    branch: state.worktree?.branch ?? null,
    goal: task.goal, scope: task.scope, acceptance: task.acceptance,
    status: state.status, phase: state.phase, contract_current: contractCurrent, evidence_current: evidenceCurrent,
    accepted_current: state.status === 'accepted_local' && evidenceCurrent,
    artifact: state.artifact, current_artifact: currentKey, head: current?.head ?? null, base_head: baseline.head ?? null,
    snapshot_coverage: current?.coverage ?? { source: 'unavailable', file_count: null }, snapshot_error: snapshotError,
    changes_known: Boolean(current), changed_files: current ? changed(baseline, current) : [], calls_used: state.calls_used,
    calls_remaining: Math.max(0, state.limits.max_cli_calls - state.calls_used),
    repairs_remaining: Math.max(0, state.limits.max_repairs - state.repairs_used),
    seconds_remaining: Math.max(0, Math.floor(state.limits.task_timeout_seconds - state.elapsed_ms / 1000)),
    active: state.active, failure: state.failure, cost: 'unknown',
    checks: state.checks.map(check => ({ id: check.id, exit_code: check.exit_code, reason: check.reason, stdout: check.stdout, stderr: check.stderr,
      current: evidenceCurrent && check.artifact === currentKey })),
    review: review ? { verdict: review.result.verdict, summary: review.result.summary, findings: review.result.findings,
      current: evidenceCurrent && review.fingerprint === currentKey, result_file: path.join(review.directory, 'result.json') } : null,
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

function acquire(store, id) {
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

function recoverLock(store) {
  const lock = path.join(store, 'run.lock');
  if (!fs.existsSync(lock)) return;
  if (fs.lstatSync(lock).isSymbolicLink()) throw new Error('Lock directory cannot be a symbolic link');
  const owner = read(path.join(lock, 'owner.json'));
  if (alive(owner.pid)) throw new Error(`Coordinator ${owner.pid} is still alive; use status/cancel, not resume`);
  const state = read(taskFiles(store, owner.id).state);
  if (state.active.some(child => alive(child.pid))) throw new Error('Coordinator stopped but recorded child processes are still alive. Inspect their PIDs before resuming; they were not silently reset.');
  const history = path.join(store, 'lock-history', `recovered-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
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

function promptFor(role, task, state, files, key, profile) {
  const purpose = {
    planner: 'Resolve architectural decisions and produce the smallest actionable plan. Do not implement.',
    scan: 'Read-only: locate existing implementation, callers and root causes. Cite files/lines. The test-plan worker owns verification discovery; do not duplicate a full scan.',
    'test-plan': 'Read-only: derive acceptance/negative scenarios, identify existing runnable checks and gaps. The scan worker owns implementation/caller discovery; do not repeat that scan.',
    implement: 'Implement only the stated goal within the allowed scope, reuse existing code, and self-check. Update affected usage/config/interface docs within scope; report a scope blocker if required docs are excluded. Do not change acceptance or this contract.',
    repair: 'Fix only the specific failed checks/review findings below, within the original scope. Do not suppress tests or alter acceptance.',
    review: 'Independently verify every acceptance criterion against the actual current artifact and raw check logs. Check affected docs against actual behavior; state why no doc changes are needed when applicable. Read implementation explanations only as claims. Do not modify source. Mark missing evidence not_run/fail. For audit tasks, findings are the deliverable: accurately reporting an existing defect may satisfy acceptance.',
  }[role];
  const prior = Object.fromEntries(Object.entries(state.roles).map(([name, value]) => [name, { result: value.result, evidence: value.directory }]));
  const commitRule = state.worktree?.mode === 'attach'
    ? `You work inside the task worktree on branch ${state.worktree.branch} and may commit there; never push, merge, rebase, switch branches, or commit paths outside scope.`
    : 'No commit/push/merge/send/publish/deploy/deletion, credential reads, global config changes or nested agents.';
  return `You are the ${role} for a bounded personal development task.\n${purpose}\n${modelPromptContext(profile)}\nProject (work root): ${state.project}\nState directory (read-only for you): ${state.store ?? path.dirname(files.dir)}\nArtifact fingerprint: ${key}\nContract file: ${files.contract}\nContract:\n${JSON.stringify(task, null, 2)}\nPrior stage artifacts (consult original sources/logs; do not assume summaries prove success):\n${JSON.stringify(prior, null, 2)}\nActual check results:\n${JSON.stringify(state.checks, null, 2)}\nLast failure: ${state.failure ?? 'none'}\nRules: obey project instructions. ${commitRule} Never edit .pdw or this runner. Keep within scope. Do not claim a browser path was tested if it was not. Return exactly one final JSON object matching:\n${JSON.stringify(resultSchema)}\nFor review, acceptance must contain every contract criterion id, its status and concrete evidence. For other roles acceptance may be empty. verdict=pass means this role finished its assignment; it does not approve the whole task.\n`;
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

function scopeCheck(task, baseline, current, state) {
  if (state.worktree?.mode === 'attach') {
    assertTaskBranch(state.project, state.worktree.branch);
    if (baseline.head && current.head !== baseline.head) {
      if (git(state.project, ['merge-base', '--is-ancestor', baseline.head, 'HEAD']) === null) {
        throw new Error('Task branch does not descend from the frozen base commit');
      }
      const committed = git(state.project, ['diff', '--name-only', '-z', `${baseline.head}..HEAD`]);
      if (committed === null) throw new Error('Cannot read committed changes for scope enforcement');
      const outsideCommits = committed.split('\0').filter(Boolean).filter(file => !inScope(task, file));
      if (outsideCommits.length) throw new Error(`Out-of-scope commits: ${outsideCommits.join(', ')}`);
    }
  } else if (baseline.head !== current.head) {
    throw new Error('Git HEAD changed: commits are not authorized by this task');
  }
  const outside = changed(baseline, current).filter(file => !inScope(task, file));
  if (outside.length) throw new Error(`Out-of-scope changes: ${outside.join(', ')}`);
}

export async function runTask(ws, id, resume = false) {
  assertManaged(ws);
  const store = ws.store, workRoot = ws.work;
  const files = taskFiles(store, id), config = configFor(store), task = read(files.contract), state = read(files.state);
  const taskSchema = Number(state.schema_version ?? 1);
  const keyOf = value => observed(value, taskSchema);
  if (state.worktree?.mode === 'attach' && (ws.mode !== 'worktree' || !sameDirectory(ws.work, state.project))) {
    throw new Error(`Task ${id} belongs to the linked worktree at ${state.project}; run it there, not from the main checkout or another worktree`);
  }
  validateContract(task);
  config.limits = state.limits; // task-wide counters/limits survive route changes and resume
  if (state.status === 'accepted_local') throw new Error('Task already accepted; use status. New changes require a new task.');
  if (!resume && state.status !== 'ready') throw new Error('Task already started; use resume to retain its counters and evidence');
  if (resume) recoverLock(store);
  const release = acquire(store, id);
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
    const current = snapshot(workRoot, task.scope);
    if (keyOf(current) !== state.artifact) throw new Error('Source drift detected; old evidence cannot approve the changed artifact');
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
    write(inputs.prompt, promptFor(role, task, state, files, keyOf(before), profile)); write(inputs.schema, resultSchema);
    const native = invocation(profile, role, inputs);
    const attempt = { role, name, directory, started_at: stamp(), model: profile.model ?? 'host-default', backend: profile.backend, ...modelSettings(profile), prompt_guidance: profile.prompt_guidance ?? null, artifact_before: keyOf(before), status: 'running' };
    state.calls_used++; state.attempts.push(attempt); context.save();
    console.log(`[${state.calls_used}/${config.limits.max_cli_calls}] ${name} -> ${profile.backend} (${attempt.model})`);
    const remaining = Math.max(1, Math.floor(config.limits.task_timeout_seconds - state.elapsed_ms / 1000));
    const result = await execute(native.executable, native.args, workRoot, path.join(directory, 'process'), Math.min(config.limits.call_timeout_seconds, remaining), context, native.stdin);
    attempt.process = result; attempt.finished_at = stamp(); attempt.status = 'failed'; context.save();
    const after = snapshot(workRoot, task.scope);
    if (!['implement', 'repair'].includes(role) && keyOf(after) !== keyOf(before)) throw new Error(`${role} changed source despite its read-only assignment`);
    scopeCheck(task, baseline, after, state);
    if (hash(fs.readFileSync(files.contract)) !== state.contract_hash || hash(fs.readFileSync(path.join(store, 'config.json'))) !== configHash) throw new Error('Agent modified contract/config');
    if (result.exit_code !== 0 || result.reason) throw new Error(`${role} process failed (${result.reason ?? result.exit_code}); ${result.stderr}`);
    const parsed = parseResult(fs.readFileSync(result.stdout, 'utf8'), inputs.final);
    write(path.join(directory, 'result.json'), parsed);
    if (parsed.verdict === 'blocked' || (role !== 'review' && parsed.verdict !== 'pass')) throw new Error(`${role} reported ${parsed.verdict}: ${parsed.summary}`);
    attempt.status = 'completed'; attempt.artifact_after = keyOf(after);
    state.roles[name] = { result: parsed, directory, fingerprint: keyOf(after) };
    state.artifact = keyOf(after); context.save();
  }
  async function checks() {
    const before = assertCurrent(); state.checks = [];
    const directory = path.join(files.dir, `checks-${state.repairs_used}-${crypto.randomBytes(3).toString('hex')}`);
    fs.mkdirSync(directory);
    for (let index = 0; index < task.checks.length; index++) {
      const check = task.checks[index];
      const cwd = fs.realpathSync(path.resolve(workRoot, check.cwd ?? '.'));
      if (!inside(workRoot, cwd)) throw new Error(`Check cwd escaped project: ${cwd}`);
      const seconds = Math.min(config.limits.call_timeout_seconds, Math.max(1, Math.floor(config.limits.task_timeout_seconds - state.elapsed_ms / 1000)));
      const result = await execute(check.command, check.args, cwd, path.join(directory, String(index + 1)), seconds, context);
      state.checks.push({ id: check.id, artifact: keyOf(before), ...result }); context.save();
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
    assertCurrent(); state.status = 'running'; state.failure = null; context.save(); writeHandoff(ws, id);
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
      writeHandoff(ws, id);
    }
  } catch (error) {
    state.status = fs.existsSync(files.cancel) ? 'cancelled' : 'blocked'; state.failure = error.message;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    try {
      tick(); state.updated_at = stamp(); context.save();
      let observation;
      try { observation = { current: snapshot(workRoot, task.scope), error: null }; }
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
      writeHandoff(ws, id, observation);
    } finally { if (state.active.length === 0) release(); }
  }
  return state;
}

function doctor(ws) {
  const config = configFor(ws.store);
  const branch = branchOf(ws.work);
  const hostProviders = hostProviderIds();
  const routeWarnings = [];
  const roles = Object.entries(config.roles).map(([role, profile]) => {
    let configurationError = null;
    try { validateProfile(profile); } catch (error) { configurationError = error.message; }
    const modelExplicit = typeof profile.model === 'string' && Boolean(profile.model.trim());
    const modelReady = modelExplicit || ['codex', 'agy'].includes(profile.backend);
    const binary = profile.executable && fs.existsSync(profile.executable) && (process.platform !== 'win32' || /\.exe$/i.test(profile.executable));
    const result = binary ? spawnSync(profile.executable, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true }) : null;
    const route = modelRoute(profile);
    const shape = !modelExplicit || modelShapeOf(profile.backend, profile.model.trim()) ? 'ok' : 'invalid';
    // Only OpenCode resolves a provider segment; Codex/AGY ids are host-resolved, so nothing to compare.
    const providerKnown = profile.backend !== 'opencode' ? 'unknown'
      : route.provider && hostProviders ? hostProviders.includes(route.provider) : 'unknown';
    // Routing facts are reported, never enforced: they describe the host environment, not the contract.
    if (shape === 'invalid') routeWarnings.push(`角色 ${role} 的 model 形态非法：${profile.model}；${profile.backend === 'opencode' ? '期望 <provider>/<model-id>[#variant]' : '期望裸模型 id，不带 provider 前缀或 #variant'}，这段串仍会原样传给宿主，先修写法再跑`);
    if (providerKnown === false) routeWarnings.push(`角色 ${role} 的 provider ${route.provider} 不在宿主 OpenCode providers/provider 键里（${hostProviders.join('、')}）；核对是否把上一层网关或内置 provider 名写错`);
    return { role, backend: profile.backend, executable: profile.executable, model: modelExplicit ? profile.model : 'host-default',
      ...(!configurationError ? modelSettings(profile) : {}),
      available: Boolean(binary && result.status === 0), version: result?.stdout?.trim() ?? null,
      model_explicit: modelExplicit, model_source: modelExplicit ? 'explicit' : 'host-default',
      model_shape: shape, provider_known: providerKnown,
      ready: Boolean(binary && result.status === 0 && modelReady && !configurationError), configuration_error: configurationError };
  });
  return { version, workspace: { mode: ws.mode, work: ws.work, main: ws.main, store: ws.store, branch: branch.branch, head: branch.head },
    roles, route_warnings: routeWarnings, authentication: 'not_checked', provider_routing: 'not_checked', money_limit: 'not enforced', permissions: 'host policy; no bypass flags',
    note: 'Binary/version discovery only. Authentication, model routing and output protocol require a real task.' };
}

async function main(argv) {
  const args = [...argv]; const command = args.shift();
  const flag = name => { const index = args.indexOf(name); if (index < 0) return null; const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`Missing value: ${name}`); args.splice(index, 2); return value; };
  const project = path.resolve(flag('--project') ?? process.cwd());
  if (command === 'init') { console.log(JSON.stringify(initialize(project), null, 2)); return; }
  if (command === 'install') {
    const ws = workspace(project);
    if (ws.mode === 'worktree') throw new Error(`Install the skill in the main checkout (${ws.main}), not in a worktree`);
    const target = path.join(ws.work, '.agents', 'skills', 'personal-dev-workflow');
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
    const launcher = path.join(ws.work, 'pdw.ps1');
    if (!fs.existsSync(launcher)) write(launcher, "$ErrorActionPreference = 'Stop'\n& node (Join-Path $PSScriptRoot '.agents\\skills\\personal-dev-workflow\\scripts\\pdw.mjs') @args\nexit $LASTEXITCODE\n");
    const entry = path.join(ws.work, 'AGENTS.md');
    const previous = fs.existsSync(entry) ? fs.readFileSync(entry, 'utf8') : '';
    const marker = '<!-- pdw-entry -->';
    if (!previous.includes(marker)) write(entry, `${previous}${previous.endsWith('\n') || !previous ? '' : '\n'}\n${marker}\nFor substantial PDW/multi-agent tasks, read .agents/skills/personal-dev-workflow/SKILL.md. Prepare the executable contract for the user and use the runtime; do not ask the user to hand-copy role chats.\n<!-- /pdw-entry -->\n`);
    initialize(ws.work);
    console.log(JSON.stringify({ installed: target, launcher, initialized: true, next: 'Ask your coding agent: use PDW to complete <goal>. Or run ./pdw.ps1 doctor' }, null, 2)); return;
  }
  if (command === 'help' || !command) {
    console.log(`PDW ${version}: init | doctor | demo | check --from <contract.json> | new --from <contract.json> | plan <id> | run <id> | resume <id> | verify <id> | status [id] | handoff <id> | cancel <id> | view [--port <n>] [--open] | install --project <existing-dir>\nAll commands accept --project <dir>. check validates a contract without creating anything; verify re-checks a finished task's evidence against the current tree. In a linked worktree the code root is that worktree while state stays in the main checkout; commits are allowed on the task branch only. run refuses under Multica (the squad owns dispatch); set host=local only on a standalone machine. demo invokes configured models for a read-only audit. view serves a read-only local dashboard. No dependency installation, push, publish or destructive cleanup.`); return;
  }
  if (command === 'view') {
    // 只读看板：读取 .pdw/tasks 与本机 Codex 用量，不写盘、不起模型。
    const port = Number(flag('--port') ?? 8891);
    const ws = workspace(project);
    const { startViewer } = await import('./viewer.mjs');
    startViewer({ project: ws.work, store: ws.store, port, open: args.includes('--open') });
    return;
  }
  const ws = workspace(project);
  const { work: root, store } = ws;
  if (command === 'demo') {
    assertRunHost(store);
    initialize(root);
    const created = createTask(ws, path.join(skillRoot, 'assets', 'audit-task.json'));
    console.log(`Read-only live demo: ${created.id}`);
    const state = await runTask(ws, created.id);
    console.log(JSON.stringify({ id: created.id, status: state.status, failure: state.failure, report: path.join(created.directory, 'REPORT.md') }, null, 2));
    process.exitCode = state.status === 'accepted_local' ? 0 : 1; return;
  }
  if (command === 'doctor') { const report = doctor(ws); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.roles.filter(r => r.role !== 'planner').every(r => r.ready) ? 0 : 1; return; }
  if (command === 'new') { const from = flag('--from'); if (!from) throw new Error('new requires --from <contract.json>; the Skill prepares this contract for the user'); console.log(JSON.stringify(createTask(ws, from), null, 2)); return; }
  if (command === 'check') {
    const from = flag('--from');
    if (!from) throw new Error('check requires --from <contract.json>');
    const report = checkContract(from);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.valid ? 0 : 1;
    return;
  }
  const id = args.shift();
  if (command === 'verify' && !id) throw new Error('verify requires a task id; run status to list tasks');
  if (command === 'status' && !id) {
    const tasksDir = path.join(store, 'tasks');
    const names = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : [];
    // One half-created or corrupt task directory must not hide every other task.
    const tasks = names.map(name => {
      try {
        const state = read(taskFiles(store, name).state);
        return { id: state.id ?? name, status: state.status, phase: state.phase, calls_used: state.calls_used, failure: state.failure };
      } catch (error) {
        return { id: name, status: 'broken', phase: null, calls_used: null, failure: 'state.json unreadable: ' + (error.code ?? error.message) };
      }
    });
    console.log(JSON.stringify(tasks, null, 2)); return;
  }
  const files = taskFiles(store, id);
  if (command === 'verify') { const report = verifyTask(ws, id); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.verdict === 'pass' ? 0 : 1; return; }
  if (command === 'handoff') { console.log(JSON.stringify(writeHandoff(ws, id), null, 2)); return; }
  if (command === 'status') { const state = read(files.state), current = snapshot(state.project ?? root, read(files.contract).scope); console.log(JSON.stringify({ ...state, evidence_current: observed(current, state.schema_version) === state.artifact, snapshot_coverage: current.coverage }, null, 2)); return; }
  if (command === 'plan') {
    const task = read(files.contract), config = configFor(store); validateContract(task);
    const roles = [...(task.planner ? ['planner'] : []), 'scan', 'test-plan', ...(task.mode === 'develop' ? ['implement'] : []), 'review'];
    const selected = Object.fromEntries(roles.map(role => [role, config.roles[role]]));
    console.log(JSON.stringify({ id, goal: task.goal, mode: task.mode, scope: task.scope, acceptance: task.acceptance, checks: task.checks,
      roles: selected, routes: Object.fromEntries(Object.entries(selected).map(([role, profile]) => [role, modelRoute(profile)])),
      limits: config.limits, cost: config.cost,
      next: `run ${id}`, launches_agents: false }, null, 2)); return;
  }
  if (command === 'cancel') { const state = read(files.state); if (state.status !== 'running') throw new Error('No running task to cancel; inspect status/resume'); write(files.cancel, { requested_at: stamp() }); console.log('Cancellation requested; wait for state.active=[] before resuming'); return; }
  if (command === 'run' || command === 'resume') {
    assertRunHost(store);
    const state = await runTask(ws, id, command === 'resume'); console.log(JSON.stringify({ id, status: state.status, failure: state.failure, report: path.join(files.dir, 'REPORT.md') }, null, 2)); process.exitCode = state.status === 'accepted_local' ? 0 : 1; return;
  }
  throw new Error(`Unknown command: ${command}`);
}

/** Compare real paths: Node resolves the ESM entry to its realpath, so a junction invocation never matches a plain resolve. */
function invokedAsScript() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try { return fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(self); }
  catch { return path.resolve(process.argv[1]) === self; }
}

if (invokedAsScript()) {
  main(process.argv.slice(2)).catch(error => { console.error(`PDW: ${error.message}`); process.exitCode = 1; });
} else if (process.argv[1] && path.basename(process.argv[1]) === 'pdw.mjs') {
  // Invoked as a script but not recognised as this file (an old copy, another resolver): fail loudly, never exit 0 doing nothing.
  console.error('PDW: entry point not recognised; this copy cannot run as a script (junction or stale duplicate)');
  process.exitCode = 1;
}
