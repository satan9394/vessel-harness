#!/usr/bin/env node
/**
 * PDW 单项目看板（只读）。
 *
 * 读取一个项目 `.pdw/tasks/` 下运行器已经写好的文件，起一个本地只读页面：
 * 任务列表、七步进度、动作记录、验收结果，以及 Codex 的剩余用量。
 * 不写盘、不起模型、不联网。
 *
 *   node viewer.mjs [--project <项目根>] [--port 8891] [--open]
 *
 * 也可以作为模块使用：`startViewer({ project, port, open })` 返回 http.Server。
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, '..', 'assets', 'viewer.html');
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SILENCE_WARN = 480;

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const inside = (base, target) => { const r = path.resolve(target); return r === base || r.startsWith(base + path.sep); };
const mtime = file => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };

export function startViewer({ project, port = 8891, open = false } = {}) {
  const root = path.resolve(project ?? process.cwd());
  const tasksRoot = path.join(root, '.pdw', 'tasks');
  if (!fs.existsSync(tasksRoot)) {
    throw new Error(`这里没有 PDW 任务目录：${tasksRoot}；在项目根运行，或用 --project 指定`);
  }
  const codexHome = path.resolve(process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.codex'));

  /** 角色路由：未跑过的角色也能显示模型与档位。 */
  function routing() {
    const cfg = readJson(path.join(root, '.pdw', 'config.json')) ?? {};
    const roles = {};
    for (const [name, r] of Object.entries(cfg.roles ?? {})) {
      const effort = r.reasoning_effort ?? (typeof r.model === 'string' && r.model.includes('#') ? r.model.split('#')[1] : null);
      roles[name] = { backend: r.backend ?? null, model: typeof r.model === 'string' ? r.model.split('#')[0] : null, effort };
    }
    return { roles, limits: cfg.limits ?? null };
  }

  /** 运行中的 attempt 最后写了多少字节：用来判断"在跑"还是"没动静"。 */
  function lastActivity(directory) {
    if (!directory) return null;
    let newest = 0;
    try {
      for (const e of fs.readdirSync(directory, { withFileTypes: true })) {
        if (e.isFile()) newest = Math.max(newest, mtime(path.join(directory, e.name)));
      }
    } catch { return null; }
    return newest || null;
  }

  function attemptsOf(state) {
    return (state.attempts ?? []).map(a => {
      const last = a.status === 'running' ? lastActivity(a.directory) : null;
      return {
        role: a.role, name: a.name, status: a.status, backend: a.backend,
        model: a.effective_model ? a.effective_model.split('#')[0] : a.model,
        effort: a.reasoning_effort && a.reasoning_effort !== 'host-default' ? a.reasoning_effort
              : (a.variant ?? (a.effective_model?.includes('#') ? a.effective_model.split('#')[1] : null)),
        started_at: a.started_at, finished_at: a.finished_at,
        exit_code: a.process?.exit_code ?? null,
        stdout: a.process?.stdout ?? null,
        prompt: a.directory ? path.join(a.directory, 'prompt.md') : null,
        command: a.process?.command ?? null, args: a.process?.args ?? [],
        silence_seconds: last ? Math.round((Date.now() - last) / 1000) : null,
      };
    });
  }

  function summaryOf(dir) {
    const state = readJson(path.join(tasksRoot, dir, 'state.json'));
    if (!state) return null;
    const contract = readJson(path.join(tasksRoot, dir, 'contract.json'));
    const changed = readJson(path.join(tasksRoot, dir, 'changed-files.json'));
    return {
      id: dir, status: state.status, phase: state.phase,
      created_at: state.created_at, updated_at: state.updated_at ?? state.created_at,
      calls_used: state.calls_used, repairs_used: state.repairs_used, elapsed_ms: state.elapsed_ms,
      artifact: state.artifact, failure: state.failure ?? null,
      goal: contract?.goal ?? null,
      changed: Array.isArray(changed) ? changed : [],
      attempts: attemptsOf(state),
      checks: (state.checks ?? []).map(c => ({ id: c.id, exit_code: c.exit_code, command: c.command, args: c.args ?? [], stdout: c.stdout, stderr: c.stderr })),
    };
  }

  /** 列表只要可扫的字段，不背 attempts。 */
  function listTasks() {
    const rank = s => s.status === 'blocked' ? 0 : s.status === 'running' ? 1 : 2;
    return fs.readdirSync(tasksRoot, { withFileTypes: true })
      .filter(e => e.isDirectory() && ID.test(e.name))
      .map(e => summaryOf(e.name))
      .filter(Boolean)
      .map(t => ({
        id: t.id, status: t.status, phase: t.phase, updated_at: t.updated_at, created_at: t.created_at,
        calls_used: t.calls_used, repairs_used: t.repairs_used, elapsed_ms: t.elapsed_ms,
        goal: t.goal, changed: t.changed.length,
      }))
      .sort((a, b) => rank(a) - rank(b) || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  }

  function tail(file, lines) {
    if (!file) return { error: '没有日志路径' };
    const resolved = path.resolve(file);
    if (!inside(tasksRoot, resolved)) return { error: '拒绝读取任务目录以外的文件' };
    if (!fs.existsSync(resolved)) return { error: '文件不存在' };
    const size = fs.statSync(resolved).size;
    const take = Math.min(size, 256 * 1024);
    const fd = fs.openSync(resolved, 'r');
    const buf = Buffer.alloc(take);
    fs.readSync(fd, buf, 0, take, size - take);
    fs.closeSync(fd);
    const text = buf.toString('utf8').split(/\r?\n/);
    return { bytes: size, text: text.slice(Math.max(0, text.length - lines)).join('\n') };
  }

  /** 最新 Codex 会话文件；只看 sessions/YYYY/MM/DD 三层。 */
  function newestCodexSession() {
    const base = path.join(codexHome, 'sessions');
    let best = null;
    const visit = (dir, depth) => {
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 3) visit(full, depth + 1); continue; }
        if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
        const m = mtime(full);
        if (m && (!best || m > best.m)) best = { file: full, m };
      }
    };
    visit(base, 0);
    return best;
  }

  let codexCache = { at: 0, file: null, m: 0, value: null };
  /** Codex 剩余用量只读自本地会话日志（最后一条 token_count 的 rate_limits）。 */
  function codexUsage() {
    const best = newestCodexSession();
    if (!best) return { available: false, reason: '没有找到 Codex 会话记录' };
    if (codexCache.value && codexCache.file === best.file && codexCache.m === best.m && Date.now() - codexCache.at < 20000) return codexCache.value;
    const size = fs.statSync(best.file).size;
    const take = Math.min(size, 512 * 1024);
    const fd = fs.openSync(best.file, 'r');
    const buf = Buffer.alloc(take);
    fs.readSync(fd, buf, 0, take, size - take);
    fs.closeSync(fd);
    let found = null;
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line.includes('"token_count"')) continue;
      try {
        const ev = JSON.parse(line);
        const p = ev.payload ?? {};
        if (p.type === 'token_count' && p.rate_limits) found = { at: ev.timestamp ?? null, info: p.info ?? {}, limits: p.rate_limits };
      } catch { /* 截断的半行，跳过 */ }
    }
    const value = !found
      ? { available: false, reason: '会话里还没有额度记录' }
      : {
          available: true, captured_at: found.at,
          primary: found.limits.primary ? { used_percent: found.limits.primary.used_percent, window_minutes: found.limits.primary.window_minutes, resets_at: found.limits.primary.resets_at } : null,
          secondary: found.limits.secondary ? { used_percent: found.limits.secondary.used_percent, window_minutes: found.limits.secondary.window_minutes, resets_at: found.limits.secondary.resets_at } : null,
          credits: found.limits.credits ?? null,
          context_window: found.info.model_context_window ?? null,
          total_tokens: found.info.total_token_usage?.total_tokens ?? null,
        };
    codexCache = { at: Date.now(), file: best.file, m: best.m, value };
    return value;
  }

  const send = (res, body, code = 200, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return send(res, fs.readFileSync(HTML, 'utf8'), 200, 'text/html; charset=utf-8');
      }
      if (url.pathname === '/api/project') return send(res, { project: root, name: path.basename(root), ...routing(), silence_warn_seconds: SILENCE_WARN });
      if (url.pathname === '/api/tasks') return send(res, { tasks: listTasks() });
      if (url.pathname === '/api/task') {
        const id = url.searchParams.get('id');
        if (!id || !ID.test(id)) return send(res, { error: '任务号不合法' }, 400);
        const state = readJson(path.join(tasksRoot, id, 'state.json'));
        const contract = readJson(path.join(tasksRoot, id, 'contract.json'));
        if (!state) return send(res, { error: '没有 state.json' }, 404);
        const { roles, limits } = routing();
        return send(res, {
          task: summaryOf(id), roles, limits,
          contract: contract ? {
            goal: contract.goal, mode: contract.mode, planner: contract.planner ?? false,
            scope: contract.scope ?? [], baseline_dirty: contract.baseline_dirty ?? [],
            acceptance: (contract.acceptance ?? []).map(a => ({ id: a.id, statement: a.statement ?? a.text ?? null })),
            checks: (contract.checks ?? []).map(c => ({ id: c.id, command: c.command, args: c.args ?? [] })),
          } : null,
        });
      }
      if (url.pathname === '/api/log') {
        const lines = Math.min(2000, Math.max(20, Number(url.searchParams.get('tail') ?? 200)));
        return send(res, tail(url.searchParams.get('path'), lines));
      }
      if (url.pathname === '/api/report') {
        const id = url.searchParams.get('id');
        if (!id || !ID.test(id)) return send(res, { error: '任务号不合法' }, 400);
        const file = path.join(tasksRoot, id, 'REPORT.md');
        if (!fs.existsSync(file)) return send(res, { error: '还没有报告' }, 404);
        return send(res, { text: fs.readFileSync(file, 'utf8') });
      }
      if (url.pathname === '/api/codex-usage') return send(res, codexUsage());
      send(res, { error: 'not found' }, 404);
    } catch (e) {
      send(res, { error: e.message }, 500);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = `http://127.0.0.1:${port}/`;
    console.log(`PDW 看板：${addr}`);
    console.log(`项目：${root}`);
    if (open) spawn('cmd', ['/c', 'start', '', addr], { detached: true, stdio: 'ignore' }).unref();
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const value = name => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1] ?? null; };
  try {
    startViewer({ project: value('--project') ?? process.cwd(), port: Number(value('--port') ?? 8891), open: argv.includes('--open') });
  } catch (error) {
    console.error(`PDW view: ${error.message}`);
    process.exitCode = 1;
  }
}
