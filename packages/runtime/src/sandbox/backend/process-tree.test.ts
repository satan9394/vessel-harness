import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { ProcessTreeTracker, detectEscapes } from './process-tree.js';
import { Sandbox, type ProcessTreeAuditEvent } from '../Sandbox.js';

const makeIsolatedDir = async () => {
  const p = mkdtempSync(join(tmpdir(), 'vessel-sb-'));
  return { path: p, dispose: async () => {} };
};

/** A controllable OS descendant enumerator + attach fake for unit tests. */
function makeFakeBackend(rootPid: number, live: () => number[]) {
  const attached: number[] = [];
  const attachPidsToJob = vi.fn(async (job: string, pids: number[]) => {
    attached.push(...pids);
    return pids.length;
  });
  const enumerateDescendants = vi.fn(async () => live());
  return { attached, attachPidsToJob, enumerateDescendants, rootPid };
}

describe('process-tree — tree enumeration & audit (task 072)', () => {
  it('registers a root/grandchild tree and enumerates it with alive/exit status', () => {
    const t = new ProcessTreeTracker();
    t.registerNode(100, undefined, 'node root.js');
    t.registerNode(101, 100, 'node child.js');
    t.registerNode(102, 101, 'node grandchild.js');
    expect(t.root).toBe(100);
    expect(t.childrenOf(100).map((n) => n.pid)).toEqual([101]);
    expect(t.childrenOf(101).map((n) => n.pid)).toEqual([102]);
    expect(t.isDescendantOf(102, 100)).toBe(true);
    expect(t.isDescendantOf(101, 102)).toBe(false);
    // alive until markExit
    const before = t.snapshot();
    expect(before.aliveCount).toBe(3);
    expect(before.nodes.find((n) => n.pid === 101)?.alive).toBe(true);
    t.markExit(101, 0);
    const after = t.snapshot();
    expect(after.aliveCount).toBe(2);
    expect(after.exitedCount).toBe(1);
    expect(after.nodes.find((n) => n.pid === 101)).toMatchObject({ alive: false, exitCode: 0 });
  });

  it('keeps an append-only audit trail of spawn/exit events', () => {
    const t = new ProcessTreeTracker();
    t.registerNode(100, undefined, 'root');
    t.registerNode(101, 100, 'child');
    t.markExit(101, 3);
    const audit: ProcessTreeAuditEvent[] = t.auditLog();
    expect(audit.filter((e) => e.kind === 'spawn').length).toBe(2);
    const exit = audit.find((e) => e.kind === 'exit' && e.pid === 101);
    expect(exit).toBeTruthy();
    expect(exit?.detail).toContain('code=3');
  });

  it('observably detects a live descendant outside the confined set (escape)', async () => {
    const t = new ProcessTreeTracker();
    t.registerNode(500, undefined, 'root');
    const confined = new Set<number>([500]);
    const report = await detectEscapes(500, [500, 501], confined, {
      terminateEscaped: false,
      audit: true,
    });
    expect(report.escapedPids).toEqual([501]);
    expect(report.confinedPids).toContain(500);
  });

  it('hard-terminates escaped pids when terminateEscaped is set', async () => {
    const t = new ProcessTreeTracker();
    t.registerNode(500);
    const confined = new Set<number>([500]);
    const terminated: number[] = [];
    const report = await detectEscapes(500, [501], confined, {
      terminateEscaped: true,
      terminate: async (pids) => {
        terminated.push(...pids);
        return pids; // verified-success set
      },
    });
    expect(report.terminatedPids).toEqual([501]);
    expect(report.failedTerminatePids).toEqual([]);
    expect(terminated).toEqual([501]);
  });

  it('records NOTHING as terminated when the terminator cannot confirm success', async () => {
    const t = new ProcessTreeTracker();
    t.registerNode(500);
    const confined = new Set<number>([500]);
    const report = await detectEscapes(500, [501, 502], confined, {
      terminateEscaped: true,
      // no verifiable answer (undefined) ⇒ nothing may be counted as dead
      terminate: async () => undefined,
    });
    expect(report.escapedPids).toEqual([501, 502]);
    expect(report.terminatedPids).toEqual([]);
    expect(report.failedTerminatePids).toEqual([501, 502]);
  });

  it('partially successful termination reports exactly the verified pids', async () => {
    const t = new ProcessTreeTracker();
    t.registerNode(500);
    const confined = new Set<number>([500]);
    const report = await detectEscapes(500, [501, 502, 503], confined, {
      terminateEscaped: true,
      terminate: async () => [502], // only 502 verified
    });
    expect(report.terminatedPids).toEqual([502]);
    expect(report.failedTerminatePids).toEqual([501, 503]);
  });
});

describe('Sandbox — timing-window closure & tree audit (task 072)', () => {
  it('attaches pre-spawned descendants into the job (closes the 071 timing window)', async () => {
    const rootPid = 700;
    const fake = makeFakeBackend(rootPid, () => [701, 702]); // two pre-existing grandchildren
    const s = new Sandbox({
      platform: 'win32',
      enumerateDescendants: fake.enumerateDescendants,
      attachPidsToJob: fake.attachPidsToJob,
      makeIsolatedDir,
      createJob: async (pid) => ({
        jobName: `j_${pid}`,
        rootPid: pid,
        attachDescendants: async (pids) => {
          fake.attached.push(...pids);
          return pids.length;
        },
        terminate: async () => {},
        dispose: async () => {},
      }),
    });
    const session = await s.openConfinement({ maxActiveProcesses: 4 });
    await session.attach(rootPid);
    // timing window: the two descendants must have been registered + attached
    expect(session.tree().nodes.map((n) => n.pid)).toEqual([700, 701, 702]);
    expect(session.audit().some((e) => e.kind === 'window-closed')).toBe(true);
    expect(fake.attached).toContain(701);
    expect(fake.attached).toContain(702);
    await session.dispose();
  });

  it('run() surfaces the process tree + audit and escape detection', async () => {
    const fake = makeFakeBackend(0, () => []);
    const s = new Sandbox({
      platform: 'win32',
      enumerateDescendants: fake.enumerateDescendants,
      attachPidsToJob: fake.attachPidsToJob,
      makeIsolatedDir,
      createJob: async (pid) => ({
        jobName: `j_${pid}`,
        rootPid: pid,
        attachDescendants: async (p) => p.length,
        terminate: async () => {},
        dispose: async () => {},
      }),
    });
    const r = await s.run(process.execPath, ['-e', 'console.log("ok")'], {
      maxOutputBytes: 4096,
      limits: { maxProcessTimeMs: 5000, maxWorkingSetBytes: 128 * 1024 * 1024 },
    });
    expect(r.exitCode).toBe(0);
    // a real child was spawned: the tree must be non-empty and auditable
    expect(r.processTree.nodes.length).toBeGreaterThan(0);
    expect(Array.isArray(r.audit)).toBe(true);
  });
});

describe('Sandbox — resource caps & exception (task 072)', () => {
  it('forwards CPU(mem) and active-process limits to the job factory', async () => {
    let received: unknown;
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      createJob: async (pid, limits) => {
        received = limits;
        return { jobName: `j_${pid}`, rootPid: pid, attachDescendants: async () => 0, terminate: async () => {}, dispose: async () => {} };
      },
    });
    const session = await s.openConfinement({
      maxActiveProcesses: 3,
      maxProcessTimeMs: 9000,
      maxWorkingSetBytes: 64 * 1024 * 1024,
    });
    await session.attach(800);
    expect(received).toEqual({ maxActiveProcesses: 3, maxProcessTimeMs: 9000, maxWorkingSetBytes: 64 * 1024 * 1024 });
    await session.dispose();
  });

  it('holds back the audit/tree when the job factory throws (graceful degrade)', async () => {
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      createJob: async () => {
        throw new Error('boom');
      },
    });
    const session = await s.openConfinement({ maxActiveProcesses: 2 });
    // attach degrades (job null) rather than throwing outward
    await expect(session.attach(900)).resolves.toBeUndefined();
    expect(session.tree().nodes.length).toBe(1); // root still registered
    await session.dispose();
  });

  it('createJobObject surfaces a loud error off-win32 (mechanism gate)', async () => {
    // Re-verify the 071 gate is intact: real backend refuses non-win32.
    const { createJobObject } = await import('./windows-job-object.js');
    const onWindows = process.platform === 'win32';
    if (!onWindows) {
      await expect(createJobObject(42)).rejects.toThrow(/requires win32/);
    } else {
      expect(createJobObject).toBeTypeOf('function');
    }
  });
});

describe('Sandbox — escape detection at dispose kills escaped descendants (task 072)', () => {
  it('records escape-detected and escape-terminated when termination is VERIFIED', async () => {
    // A descendant never attached (escaped) is detected at dispose and, when
    // terminateEscaped is on, handed to the injected terminator — which reports
    // the pid back as verified terminated.
    const fakeLive = [901]; // live descendant outside the confined set
    const terminated: number[] = [];
    const s = new Sandbox({
      platform: 'win32',
      enumerateDescendants: async () => fakeLive,
      attachPidsToJob: async () => 0,
      terminatePids: async (pids) => {
        terminated.push(...pids);
        return pids; // verified-success set
      },
      makeIsolatedDir,
      createJob: async (pid) => ({
        jobName: `j_${pid}`,
        rootPid: pid,
        attachDescendants: async () => 0, // nothing actually attached -> 901 escapes
        terminate: async () => {},
        dispose: async () => {},
      }),
    });
    const session = await s.openConfinement({ terminateEscaped: true });
    await session.attach(900);
    await session.dispose();
    const audit = session.audit();
    // The root is confined; the live descendant 901 is not -> escape-detected.
    expect(audit.some((e) => e.kind === 'escape-detected')).toBe(true);
    expect(audit.some((e) => e.kind === 'escape-terminated' && e.pid === 901)).toBe(true);
    expect(audit.some((e) => e.kind === 'escape-terminate-failed')).toBe(false);
    expect(terminated).toContain(901);
  });

  it('records escape-terminate-failed (NOT escape-terminated) when the kill did not succeed', async () => {
    // The terminator reports an empty verified set: the escaped pid may still be
    // alive, so the audit must say so instead of claiming "escape-terminated".
    const s = new Sandbox({
      platform: 'win32',
      enumerateDescendants: async () => [901, 902],
      attachPidsToJob: async () => 0,
      terminatePids: async () => [902], // only 902 verified; 901 survived
      makeIsolatedDir,
      createJob: async (pid) => ({
        jobName: `j_${pid}`,
        rootPid: pid,
        attachDescendants: async () => 0,
        terminate: async () => {},
        dispose: async () => {},
      }),
    });
    const session = await s.openConfinement({ terminateEscaped: true });
    await session.attach(900);
    await session.dispose();
    const audit = session.audit();
    const terminatedPids = audit.filter((e) => e.kind === 'escape-terminated').map((e) => e.pid);
    const failedPids = audit.filter((e) => e.kind === 'escape-terminate-failed').map((e) => e.pid);
    // only the VERIFIED pid is recorded as terminated — never the whole escape set
    expect(terminatedPids).toEqual([902]);
    expect(terminatedPids).not.toContain(901);
    expect(failedPids).toEqual([901]);
  });

  it('records escape-terminate-failed for every escaped pid when the terminator returns nothing', async () => {
    const s = new Sandbox({
      platform: 'win32',
      enumerateDescendants: async () => [901],
      attachPidsToJob: async () => 0,
      terminatePids: async () => [], // PowerShell path failed / could not verify
      makeIsolatedDir,
      createJob: async (pid) => ({
        jobName: `j_${pid}`,
        rootPid: pid,
        attachDescendants: async () => 0,
        terminate: async () => {},
        dispose: async () => {},
      }),
    });
    const session = await s.openConfinement({ terminateEscaped: true });
    await session.attach(900);
    await session.dispose();
    const audit = session.audit();
    expect(audit.some((e) => e.kind === 'escape-terminated')).toBe(false);
    const failed = audit.find((e) => e.kind === 'escape-terminate-failed');
    expect(failed?.pid).toBe(901);
    expect(failed?.detail).toContain('NOT verified terminated');
  });
});

describe('Sandbox — real Windows timing-window enumeration (task 072, win32 only)', () => {
  const onWindows = process.platform === 'win32';

  // task 106：本用例是真的 spawn/枚举/杀进程，单跑就要 29–39 s（实测），贴着全局
  // testTimeout=30000ms，全量并发（多文件同时跑 + 杀软扫描）下偶发超时。修法是把**这条
  // 用例**的超时放宽到 120 s（4× 余量），**不跳过、不放松断言**——断言仍要求
  // 「预生成的孙进程被枚举进 tree + dispose 后 root/孙进程都死了」，跳过它就等于放弃
  // 072 在 Windows 上的唯一真机验证。
  it.skipIf(!onWindows)('attaches a pre-spawned grandchild into the job and enumerates it', async () => {
    // A root that forks its grandchild IMMEDIATELY on spawn — so by the time we
    // attach, the grandchild already exists (the exact 071 timing-window gap).
    const gcpFile = join(tmpdir(), `vessel-window-${Date.now()}-${Math.random().toString(36).slice(2)}.pid`);
    const root = spawn(
      process.execPath,
      ['-e', `
        const { spawn } = require('node:child_process');
        const { writeFileSync } = require('node:fs');
        const gc = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], { windowsHide: true });
        writeFileSync(process.env.GCPID_FILE, String(gc.pid));
        setTimeout(()=>{}, 20000);
      `],
      { env: { ...process.env, GCPID_FILE: gcpFile }, windowsHide: true, stdio: 'ignore' },
    );
    // give the root a beat to fork the grandchild before we attach
    let grandchild = 0;
    for (let i = 0; i < 40; i += 1) {
      try {
        grandchild = Number(readFileSync(gcpFile, 'utf8'));
        if (grandchild > 0) break;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(grandchild).toBeGreaterThan(0);

    const s = new Sandbox({ platform: 'win32' }); // real backend: enumerate + attach
    const session = await s.openConfinement();
    await session.attach(root.pid!);
    // The pre-attach grandchild must have been enumerated into the tree.
    const tree = session.tree();
    expect(tree.nodes.some((n) => n.pid === grandchild)).toBe(true);
    expect(session.audit().some((e) => e.kind === 'window-closed')).toBe(true);
    // dispose kills BOTH root and the enumerated grandchild (job-wide terminate).
    await session.dispose();
    await new Promise((r) => setTimeout(r, 700));
    const pidAlive = (p: number): boolean => {
      try {
        process.kill(p, 0);
        return true;
      } catch {
        return false;
      }
    };
    expect(pidAlive(root.pid!)).toBe(false);
    expect(pidAlive(grandchild)).toBe(false);
  }, 120_000);
});