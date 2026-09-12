import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry, createFsTools, createSearchTools, createShellTool } from './index.js';
import { Sandbox } from '@vessel/runtime';
import { globMatch } from './globmatch.js';

const FS_POLICY = { protected: ['.git', '.git/**', '.env'], denyRead: ['**/.ssh/**'], allow: [] };

describe('glob matcher', () => {
  it('matches ** and segment globs', () => {
    expect(globMatch('.git/**', '.git/config')).toBe(true);
    expect(globMatch('.git/**', '.git')).toBe(true);
    expect(globMatch('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
    expect(globMatch('**/.env', 'a/b/.env')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a.ts')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a/b.ts')).toBe(false);
  });
});

describe('6 builtin tools', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tools-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function registry(): ToolRegistry {
    const sandbox = new Sandbox();
    const tools = [
      ...createFsTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }),
      ...createSearchTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }),
      createShellTool({ workspaceRoot: dir, sandbox }),
    ];
    return new ToolRegistry(tools);
  }

  it('Read/Write/Edit/Glob/Grep/Shell are all registered and visible', () => {
    const r = registry();
    expect(r.listVisible().map((t) => t.name).sort()).toEqual(['Edit', 'Glob', 'Grep', 'Read', 'Shell', 'Write']);
  });

  it('Read returns file content; Write then Read round-trips', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'sub/hello.txt', content: 'hello world' } }, ctx);
    expect(w.error).toBeUndefined();
    const rd = await r.execute({ toolCallId: '2', toolName: 'Read', arguments: { path: 'sub/hello.txt' } }, ctx);
    expect(rd.content).toBe('hello world');
  });

  it('Edit replaces a literal substring once or all', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'f.txt', content: 'aXbXc' } }, ctx);
    const e1 = await r.execute({ toolCallId: '2', toolName: 'Edit', arguments: { path: 'f.txt', old_string: 'X', new_string: 'Y' } }, ctx);
    expect(e1.error).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8')).toBe('aYbXc');
    await r.execute({ toolCallId: '3', toolName: 'Edit', arguments: { path: 'f.txt', old_string: 'X', new_string: 'Z', replace_all: true } }, ctx);
    expect(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8')).toBe('aYbZc');
  });

  it('Glob finds files by pattern', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'src/a.ts', content: '' } }, ctx);
    await r.execute({ toolCallId: '2', toolName: 'Write', arguments: { path: 'src/deep/b.ts', content: '' } }, ctx);
    const g = await r.execute({ toolCallId: '3', toolName: 'Glob', arguments: { pattern: 'src/**/*.ts' } }, ctx);
    expect(g.content).toContain('src/a.ts');
    expect(g.content).toContain('src/deep/b.ts');
  });

  it('Grep returns file:line matches', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'x.js', content: 'const needle_abc = 1;\nconsole.log(needle_abc);' } }, ctx);
    const g = await r.execute({ toolCallId: '2', toolName: 'Grep', arguments: { pattern: 'needle_abc' } }, ctx);
    expect(g.content).toContain('x.js:1');
    expect(g.content).toContain('x.js:2');
  });

  // BRIEF ③ — this one drives the REAL job holder (default `createJobObject`,
  // 30 s budget, numerically equal to vitest's default `testTimeout: 30000`), so
  // it carries an explicit 4× timeout instead of racing the runner. The two
  // injected-factory tests below are unaffected (no PowerShell involved).
  it('Shell runs a real command (node -e) and returns output', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    const s = await r.execute({ toolCallId: '1', toolName: 'Shell', arguments: { command: 'node -e "console.log(40+2)"' } }, ctx);
    expect(s.error).toBeUndefined();
    expect(s.content).toContain('42');
  }, 120_000);

  it('write to protected path (.env) is DENIED by the tool-layer guard', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: '.env', content: 'SECRET=1' } }, ctx);
    expect(w.error?.errorClass).toBe('DENIED');
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(false);
  });

  it('path escape via ../ is rejected (canonical guard)', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    const rd = await r.execute({ toolCallId: '1', toolName: 'Read', arguments: { path: '../../windows/system32/win.ini' } }, ctx);
    expect(rd.error).toBeDefined();
  });

  it('denied tools are removed from the visible set and rejected at execution', async () => {
    const sandbox = new Sandbox();
    const r = new ToolRegistry(
      [...createFsTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }), createShellTool({ workspaceRoot: dir, sandbox })],
      { deniedTools: ['Shell'] },
    );
    expect(r.listVisible().map((t) => t.name)).not.toContain('Shell');
    const s = await r.execute({ toolCallId: '1', toolName: 'Shell', arguments: { command: 'ls' } }, { workspaceRoot: dir, cwd: dir, sandbox });
    expect(s.error?.errorClass).toBe('DENIED');
  });
});

describe('Shell — escape audit events are surfaced, not dropped in runtime memory (task 072)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-shell-audit-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const tmpIsolatedDir = async () => {
    const p = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-sb-'));
    return { path: p, dispose: async () => fs.rmSync(p, { recursive: true, force: true }) };
  };

  it('carries escape-detected into the tool result meta and the injected audit sink', async () => {
    const sink: Array<{ kind: string; pid?: number }> = [];
    const warnings: string[] = [];
    const sandbox = new Sandbox({
      platform: 'win32',
      warn: (m) => warnings.push(m),
      makeIsolatedDir: tmpIsolatedDir,
      // the confined root has a live descendant that never made it into the job
      enumerateDescendants: async () => [4242],
      attachPidsToJob: async () => 0,
      createJob: async (pid) => ({ jobName: `j_${pid}`, terminate: async () => {}, dispose: async () => {} }),
    });
    const tool = createShellTool({ workspaceRoot: dir, sandbox, audit: (e) => sink.push({ kind: e.kind, pid: e.pid }) });
    const res = await tool.execute({ command: 'node -e "process.exit(0)"' }, { workspaceRoot: dir, cwd: dir });

    // the escape conclusion is visible on the result (persisted by the AgentLoop)
    const sandboxMeta = res.meta.sandbox as { audit?: Array<{ kind: string; pid?: number }>; active?: boolean };
    expect(Array.isArray(sandboxMeta.audit)).toBe(true);
    expect(sandboxMeta.audit?.some((e) => e.kind === 'escape-detected' && e.pid === 4242)).toBe(true);
    // …and forwarded to the audit channel
    expect(sink.some((e) => e.kind === 'escape-detected' && e.pid === 4242)).toBe(true);
    // routine bookkeeping is NOT sprayed into the result (no noise)
    expect(sandboxMeta.audit?.some((e) => e.kind === 'spawn' || e.kind === 'exit' || e.kind === 'window-closed')).toBe(false);
    // the model-visible content carries no audit payload
    expect(res.content).not.toContain('escape-detected');
  });

  it('surfaces escape-terminate-failed (never a fake escape-terminated) for a kill that did not succeed', async () => {
    const sink: Array<{ kind: string; pid?: number }> = [];
    // The hard response is opt-in via the tool argument `terminateEscaped` — the
    // schema-declared name. (This test used to pass `limits: { … }`, which the
    // tool never reads, so `terminatePids` was never called and the assertion
    // held for an unrelated reason: audit-only detection also emits
    // `escape-terminate-failed`. Now the terminator really runs.)
    const terminateCalls: number[][] = [];
    const sandbox = new Sandbox({
      platform: 'win32',
      warn: () => {},
      makeIsolatedDir: tmpIsolatedDir,
      enumerateDescendants: async () => [4243],
      attachPidsToJob: async () => 0,
      terminatePids: async (pids) => {
        terminateCalls.push(pids);
        return []; // nothing verified dead
      },
      createJob: async (pid) => ({ jobName: `j_${pid}`, terminate: async () => {}, dispose: async () => {} }),
    });
    const tool = createShellTool({ workspaceRoot: dir, sandbox, audit: (e) => sink.push({ kind: e.kind, pid: e.pid }) });
    const res = await tool.execute(
      { command: 'node -e "process.exit(0)"', terminateEscaped: true },
      { workspaceRoot: dir, cwd: dir },
    );
    // the terminate path is genuinely on the causal chain of the assertions below
    expect(terminateCalls).toEqual([[4243]]);
    const audit = (res.meta.sandbox as { audit?: Array<{ kind: string }> }).audit ?? [];
    expect(audit.some((e) => e.kind === 'escape-terminate-failed')).toBe(true);
    expect(audit.some((e) => e.kind === 'escape-terminated')).toBe(false);
    expect(sink.some((e) => e.kind === 'escape-terminate-failed')).toBe(true);
  });
});

describe('Shell — meta.sandbox describes THIS round, never the previous one (BRIEF ①)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-shell-round-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const tmpIsolatedDir = async () => {
    const p = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-sb-'));
    return { path: p, dispose: async () => fs.rmSync(p, { recursive: true, force: true }) };
  };

  /**
   * A Sandbox with an INJECTED job factory (no PowerShell anywhere) but the REAL
   * round-scoped state machine. These tests are about *which round* the Shell
   * tool reports: `confine()` + `statusSnapshot()` used to be read BEFORE
   * `run()`, and `run()` opens a fresh round (`Sandbox.beginRound()` clears
   * `degraded`) — so the tool published the PREVIOUS round's facts. On the
   * durable `tool/result` record that reads as "confinement was in force" for a
   * round that was actually unconfined.
   */
  function roundScopedSandbox(warn: (m: string) => void, failOnRound: number): Sandbox {
    let round = 0;
    return new Sandbox({
      platform: 'win32',
      warn,
      makeIsolatedDir: tmpIsolatedDir,
      enumerateDescendants: async () => [], // no real CIM/PowerShell call
      createJob: async (pid) => {
        round += 1;
        if (round === failOnRound) throw new Error('AssignProcessToJobObject failed: 5 (access denied)');
        return { jobName: `j_${round}_${pid}`, terminate: async () => {}, dispose: async () => {} };
      },
    });
  }

  it('previous round ATTACHED + this round FAILED ⇒ active:false + the real reason (delete the fix ⇒ red)', async () => {
    const warnings: string[] = [];
    const sandbox = roundScopedSandbox((m) => warnings.push(m), 2);
    const tool = createShellTool({ workspaceRoot: dir, sandbox });

    const first = await tool.execute({ command: 'node -e "process.exit(0)"' }, { workspaceRoot: dir, cwd: dir });
    const firstMeta = first.meta.sandbox as { active?: boolean; degraded?: string; backend?: string };
    // round 1 really attached — the baseline the stale snapshot would replay
    expect(firstMeta.active).toBe(true);
    expect(firstMeta.backend).toBe('job-object');
    expect(firstMeta.degraded).toBeUndefined();

    const second = await tool.execute({ command: 'node -e "process.exit(0)"' }, { workspaceRoot: dir, cwd: dir });
    const meta = second.meta.sandbox as {
      active?: boolean;
      degraded?: string;
      backend?: string;
      reason?: string;
      preRoundEnforcement?: string;
    };
    // DISCRIMINATOR: reverting shellTool.ts to the pre-run snapshot makes this
    // `true` with `degraded` absent — i.e. "looks confined, was not".
    expect(meta.active).toBe(false);
    expect(meta.backend).toBe('none');
    expect(meta.degraded).toBe('job-object-attach-failed');
    expect(meta.reason).toContain('AssignProcessToJobObject failed: 5');
    // the pre-round capability prediction is reported under its OWN name…
    expect(meta.preRoundEnforcement).toBe('full');
    // …and is not smuggled back in under the old, ambiguous name.
    expect('enforcement' in (second.meta.sandbox as object)).toBe(false);
    // the real failure is still announced exactly once (not swallowed)
    expect(warnings.length).toBe(1);
  });

  it('first call reports THIS round — never the pre-round "not-attempted" placeholder', async () => {
    const warnings: string[] = [];
    const sandbox = roundScopedSandbox((m) => warnings.push(m), 1);
    const tool = createShellTool({ workspaceRoot: dir, sandbox });
    const res = await tool.execute({ command: 'node -e "process.exit(0)"' }, { workspaceRoot: dir, cwd: dir });
    const meta = res.meta.sandbox as { active?: boolean; degraded?: string };
    expect(meta.active).toBe(false);
    // DISCRIMINATOR: the pre-run snapshot is always `job-object-not-attempted`
    // on a first call, so this pins "the result carries this round's outcome".
    expect(meta.degraded).toBe('job-object-attach-failed');
    expect(meta.degraded).not.toBe('job-object-not-attempted');
    expect(warnings.length).toBe(1);
  });
});
