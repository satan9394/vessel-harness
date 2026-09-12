import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Sandbox } from './Sandbox.js';
import { WindowsJobObject, createJobObject } from './backend/windows-job-object.js';
import { createIsolatedDirectory } from './backend/isolated-directory.js';
import { runCommand } from '../process/Process.js';

// Clean up our own os.tmpdir sandbox artifacts created during tests.
const tmpAreas: string[] = [];
afterEach(() => {
  for (const p of tmpAreas.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      /* our own ephemeral os.tmpdir area */
    }
  }
});

/**
 * A long-running Node root that waits for a trigger file, then forks a
 * grandchild (which sleeps). Used to prove job confinement: once the ROOT is
 * attached to the Job Object, a grandchild spawned afterwards inherits the job,
 * so terminating the job kills the whole tree.
 */
function spawnSleepingTree(triggerFile: string, grandchildPidFile: string): {
  root: import('node:child_process').ChildProcessWithoutNullStreams;
} {
  const root = spawn(
    process.execPath,
    ['-e', `
      const { spawn } = require('node:child_process');
      const { writeFileSync, existsSync } = require('node:fs');
      // wait for the trigger, THEN fork the grandchild (so it inherits the job)
      const waitFor = () => {
        if (existsSync(process.env.TRIGGER)) {
          const gc = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { windowsHide: true });
          writeFileSync(process.env.GCPID_FILE, String(gc.pid));
        } else {
          setTimeout(waitFor, 100);
        }
      };
      waitFor();
      setTimeout(()=>{}, 30000);
    `],
    {
      env: { ...process.env, TRIGGER: triggerFile, GCPID_FILE: grandchildPidFile },
      windowsHide: true,
      stdio: 'pipe',
    },
  );
  root.stdout?.resume();
  root.stderr?.resume();
  return { root };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('Sandbox — backend selection & honest status (task 071)', () => {
  it('does NOT claim an active backend on win32 until the job object really attached', () => {
    const s = new Sandbox({ platform: 'win32', makeIsolatedDir: async () => ({ path: 'x', dispose: async () => {} }) });
    const st = s.statusSnapshot();
    expect(st.supported).toBe('windows-job-object');
    // honesty (task 071/072 fix): the platform gate is NOT evidence of confinement.
    expect(st.active).toBe(false);
    expect(st.enabled).toBe(false);
    expect(st.backend).toBe('none');
    expect(st.degraded).toBe('job-object-not-attempted');
    expect(st.fallbackReason).toBeTruthy();
  });

  it('reports active ONLY after a real attach succeeded (honest round-scoped upgrade)', async () => {
    const warnings: string[] = [];
    const makeIsolatedDir = async () => {
      const p = mkdtempSync(join(tmpdir(), 'vessel-sb-'));
      tmpAreas.push(p);
      return { path: p, dispose: async () => {} };
    };
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: (m) => warnings.push(m),
      createJob: async (pid) => ({ jobName: `j_${pid}`, terminate: async () => {}, dispose: async () => {} }),
    });
    expect(s.statusSnapshot().active).toBe(false);
    await s.run(process.execPath, ['-e', 'console.log("ok")'], { maxOutputBytes: 4096 });
    const st = s.statusSnapshot();
    expect(st.active).toBe(true);
    expect(st.backend).toBe('job-object');
    expect(st.degraded).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('falls back to a transparent passthrough backend on non-Windows platforms', () => {
    const s = new Sandbox({ platform: 'linux', makeIsolatedDir: async () => ({ path: 'x', dispose: async () => {} }) });
    const st = s.statusSnapshot();
    expect(st.active).toBe(false);
    expect(st.enabled).toBe(false);
    expect(st.backend).toBe('none');
    expect(st.degraded).toBe('job-object-unavailable');
    expect(st.fallbackReason).toBeTruthy();
  });
});

describe('Sandbox — degradation is visible, never silent (confine audit truthfulness)', () => {
  const makeIsolatedDir = async () => {
    const p = mkdtempSync(join(tmpdir(), 'vessel-sb-'));
    tmpAreas.push(p);
    return { path: p, dispose: async () => {} };
  };

  it('job creation failure ⇒ status is NOT active, carries the reason, and warns (run path)', async () => {
    const warnings: string[] = [];
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: (m) => warnings.push(m),
      createJob: async () => {
        throw new Error('holder exploded');
      },
    });
    // the command still RUNS (degradation stays available — no new hard failure)
    const r = await s.run(process.execPath, ['-e', 'console.log("ran")'], { maxOutputBytes: 4096 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('ran');
    // …but the status no longer pretends the sandbox is in force.
    const st = s.statusSnapshot();
    expect(st.active).toBe(false);
    expect(st.enabled).toBe(false);
    expect(st.backend).toBe('none');
    expect(st.degraded).toBe('job-object-attach-failed');
    expect(st.fallbackReason).toContain('holder exploded');
    expect(warnings.some((w) => w.includes('sandbox degraded') && w.includes('holder exploded'))).toBe(true);
  });

  it('job creation failure in openConfinement().attach ⇒ status degraded + warn', async () => {
    const warnings: string[] = [];
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: (m) => warnings.push(m),
      createJob: async () => {
        throw new Error('no job for you');
      },
    });
    const session = await s.openConfinement({ maxActiveProcesses: 2 });
    await session.attach(4242); // degrades instead of throwing outward
    const st = s.statusSnapshot();
    expect(st.active).toBe(false);
    expect(st.degraded).toBe('job-object-attach-failed');
    expect(warnings.some((w) => w.includes('no job for you'))).toBe(true);
    await session.dispose();
  });

  it('confine() stops claiming "full" once a real attach failed', async () => {
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: () => {},
      createJob: async () => {
        throw new Error('boom');
      },
    });
    expect((await s.confine(['node', 'x.js'])).enforcement).toBe('full');
    await s.run(process.execPath, ['-e', 'process.exit(0)'], { maxOutputBytes: 1024 });
    const after = await s.confine(['node', 'x.js']);
    expect(after.enforcement).toBe('partial');
    expect(after.reason).toContain('attach FAILED');
  });
});

describe('Sandbox — "target already exited" ≠ "attach failed" (BRIEF ①/③)', () => {
  const makeIsolatedDir = async () => {
    const p = mkdtempSync(join(tmpdir(), 'vessel-sb-'));
    tmpAreas.push(p);
    return { path: p, dispose: async () => {} };
  };
  const targetExitedJob = async (pid: number) => ({
    jobName: `tx_${pid}`,
    attached: false,
    reason: 'target-exited' as const,
    terminate: async () => {},
    dispose: async () => {},
  });

  it('run(): a short command reports its OWN reason and does NOT warn', async () => {
    const warnings: string[] = [];
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: (m) => warnings.push(m),
      createJob: targetExitedJob,
    });
    const r = await s.run(process.execPath, ['-e', 'process.exit(0)'], { maxOutputBytes: 4096 });
    expect(r.exitCode).toBe(0);
    // honest status: nothing was confined, and the reason is its own
    expect(r.sandbox.active).toBe(false);
    expect(r.sandbox.enabled).toBe(false);
    expect(r.sandbox.backend).toBe('none');
    expect(r.sandbox.degraded).toBe('job-object-target-exited');
    expect(r.sandbox.fallbackReason).toContain('already exited');
    // …and zero stderr noise: a 3 ms command must not look like a broken sandbox
    expect(warnings).toEqual([]);
  });

  it('openConfinement().attach(): target-exited ⇒ own reason, no warn, no job held', async () => {
    const warnings: string[] = [];
    const terminated: number[] = [];
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: (m) => warnings.push(m),
      createJob: async (pid) => ({
        ...(await targetExitedJob(pid)),
        terminate: async () => {
          terminated.push(pid);
        },
      }),
    });
    const session = await s.openConfinement();
    await session.attach(4242);
    const st = s.statusSnapshot();
    expect(st.active).toBe(false);
    expect(st.degraded).toBe('job-object-target-exited');
    expect(warnings).toEqual([]);
    await session.dispose();
    expect(terminated).toEqual([]); // nothing was ever confined ⇒ nothing to kill
  });

  it('target-exited never masks a LATER real failure (real failures stay loud)', async () => {
    const warnings: string[] = [];
    let n = 0;
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: (m) => warnings.push(m),
      createJob: async (pid) => {
        n += 1;
        if (n === 1) return targetExitedJob(pid);
        throw new Error('OpenProcess failed: 5 (access denied)');
      },
    });
    const first = await s.run(process.execPath, ['-e', 'process.exit(0)'], { maxOutputBytes: 1024 });
    expect(first.sandbox.degraded).toBe('job-object-target-exited');
    expect(warnings).toEqual([]);
    // the NEXT round really fails → that must still degrade + warn (安全方向)
    const second = await s.run(process.execPath, ['-e', 'process.exit(0)'], { maxOutputBytes: 1024 });
    expect(second.sandbox.active).toBe(false);
    expect(second.sandbox.degraded).toBe('job-object-attach-failed');
    expect(second.sandbox.fallbackReason).toContain('OpenProcess failed: 5');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('OpenProcess failed: 5');
  });

  it('attached:false with an UNRECOGNISED reason is degraded loudly (never read as attached)', async () => {
    const warnings: string[] = [];
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: (m) => warnings.push(m),
      createJob: async (pid) => ({
        jobName: `u_${pid}`,
        attached: false,
        terminate: async () => {},
        dispose: async () => {},
      }),
    });
    const r = await s.run(process.execPath, ['-e', 'process.exit(0)'], { maxOutputBytes: 1024 });
    expect(r.sandbox.active).toBe(false);
    expect(r.sandbox.degraded).toBe('job-object-attach-failed');
    expect(warnings.length).toBe(1);
  });

  it('repeated real failures warn ONCE per session, while the LATEST detail stays visible', async () => {
    const warnings: string[] = [];
    let n = 0;
    const s = new Sandbox({
      platform: 'win32',
      makeIsolatedDir,
      warn: (m) => warnings.push(m),
      createJob: async () => {
        n += 1;
        throw new Error(`holder exploded #${n}`);
      },
    });
    await s.run(process.execPath, ['-e', 'process.exit(0)'], { maxOutputBytes: 1024 });
    await s.run(process.execPath, ['-e', 'process.exit(0)'], { maxOutputBytes: 1024 });
    await s.run(process.execPath, ['-e', 'process.exit(0)'], { maxOutputBytes: 1024 });
    // ③ no per-command stderr flood: three failures ⇒ ONE warning
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('holder exploded #1');
    // …and de-duplication must not hide the newest cause: status carries #3
    const st = s.statusSnapshot();
    expect(st.degraded).toBe('job-object-attach-failed');
    expect(st.fallbackReason).toContain('holder exploded #3');
  });
});

describe('Sandbox — confine seam reports real enforcement (task 071)', () => {
  it('confine() returns enforcement full on the active Windows backend', async () => {
    const s = new Sandbox({ platform: 'win32', makeIsolatedDir: async () => ({ path: 'x', dispose: async () => {} }) });
    const c = await s.confine(['node', 'x.js']);
    expect(c.enforcement).toBe('full');
    expect(c.argv).toEqual(['node', 'x.js']);
  });

  it('confine() returns enforcement partial/passthrough when backend is not active', async () => {
    const s = new Sandbox({ platform: 'linux' });
    const c = await s.confine(['ls']);
    expect(c.enforcement).toBe('partial');
  });
});

describe('Sandbox — WindowsJobObject backend primitives (requires win32 + PowerShell)', () => {
  const onWindows = process.platform === 'win32';

  it.skipIf(onWindows)('createJobObject throws (clearly) when the backend is not supported', async () => {
    await expect(createJobObject(42)).rejects.toThrow(/requires win32/);
  });

  it.skipIf(!onWindows)('terminate() kills the WHOLE process tree (grandchildren included)', async () => {
    const base = join(tmpdir(), `vessel-killtree-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tmpAreas.push(base);
    const trigger = `${base}.trigger`;
    const gcpFile = `${base}.gcpid`;
    const { root } = spawnSleepingTree(trigger, gcpFile);
    expect(root.pid).toBeTruthy();
    // Attach the ROOT to a Job Object first (waits for holder readiness).
    const conf = await createJobObject(root.pid!, { maxActiveProcesses: 4 });
    // Now trigger the root to fork its grandchild — it inherits the job.
    writeFileSync(trigger, 'go');
    let grandchildPid = 0;
    for (let i = 0; i < 30; i += 1) {
      try {
        grandchildPid = Number(readFileSync(gcpFile, 'utf8'));
        if (grandchildPid > 0) break;
      } catch {
        /* not written yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(grandchildPid).toBeGreaterThan(0);
    expect(pidAlive(grandchildPid)).toBe(true);
    // Terminating the job must kill root AND grandchild (whole tree).
    await conf.dispose();
    await new Promise((r) => setTimeout(r, 500));
    expect(pidAlive(root.pid!)).toBe(false);
    expect(pidAlive(grandchildPid)).toBe(false);
  });
});

describe('Sandbox — run() confined spawn (isolation dir + resource wiring)', () => {
  it('runs a command in a fresh isolation directory used as cwd', async () => {
    const s = new Sandbox();
    const r = await s.run(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], {
      maxOutputBytes: 4096,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('vessel-sandbox');
  });

  it('passes limits to the job factory and attaches the child PID (unit: injected factory)', async () => {
    const attachPid: number[] = [];
    const makeIsolatedDir = async () => {
      const p = mkdtempSync(join(tmpdir(), 'vessel-sb-'));
      tmpAreas.push(p);
      return { path: p, dispose: async () => {} };
    };
    const createJob = vi.fn(async (pid: number) => {
      attachPid.push(pid);
      return {
        jobName: `t_${pid}`,
        terminate: async () => {},
        dispose: async () => {},
      };
    });
    const s = new Sandbox({ platform: 'win32', createJob, makeIsolatedDir });
    await s.run(process.execPath, ['-e', 'console.log("ok")'], { limits: { maxActiveProcesses: 3 } });
    expect(attachPid.length).toBeGreaterThan(0);
    expect(createJob).toHaveBeenCalledWith(expect.any(Number), { maxActiveProcesses: 3 });
  });

  it('attaches a job handle when openConfinement() is used (unit: injected factory)', async () => {
    const attached: Array<{ pid: number; limits: unknown }> = [];
    const s = new Sandbox({
      platform: 'win32',
      createJob: async (pid, limits) => {
        attached.push({ pid, limits });
        return { jobName: `j_${pid}`, terminate: async () => {}, dispose: async () => {} };
      },
      makeIsolatedDir: async () => {
        const p = mkdtempSync(join(tmpdir(), 'vessel-sb-'));
        tmpAreas.push(p);
        return { path: p, dispose: async () => {} };
      },
    });
    const session = await s.openConfinement({ maxActiveProcesses: 2 });
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},1000)'], { windowsHide: true });
    child.stdout?.resume();
    await session.attach(child.pid!);
    expect(attached.length).toBe(1);
    expect(attached[0]!.pid).toBe(child.pid!);
    expect((attached[0]!.limits as { maxActiveProcesses: number }).maxActiveProcesses).toBe(2);
    await session.dispose();
    child.kill();
  });
});

describe('Sandbox — isolated-directory backend (task 071)', () => {
  it('createIsolatedDirectory() makes a dir under os.tmpdir and dispose recycles it', async () => {
    const iso = await createIsolatedDirectory();
    tmpAreas.push(iso.path);
    expect(iso.path).toContain('vessel-sandbox');
    expect(iso.path.startsWith(tmpdir())).toBe(true);
    expect(existsSync(iso.path)).toBe(true);
    // writing a sentinel inside works and stays confined
    writeFileSync(join(iso.path, 'sentinel.txt'), 'hi');
    await iso.dispose();
  });

  it('run() surfaces a clear error for an unavailable command', async () => {
    const s = new Sandbox();
    const r = await s.run(process.execPath, ['-e', 'process.exit(7)'], { maxOutputBytes: 1024 });
    expect(r.exitCode).toBe(7);
    expect(r.stdout).toBe('');
  });
});

describe('Process — 050 interrupt / runCommand + confinement integration (task 071)', () => {
  it('aborting the signal triggers the confinement terminate() (kill-tree path)', async () => {
    const ac = new AbortController();
    const terminated: string[] = [];
    const conf = {
      terminate: async () => {
        terminated.push('terminated');
      },
    };
    const run = runCommand(process.execPath, ['-e', 'setTimeout(()=>{}, 20000)'], {
      cwd: process.cwd(),
      signal: ac.signal,
      confinement: conf,
    });
    setTimeout(() => ac.abort(), 60);
    const r = await run;
    expect(r.killed).toBe(true);
    // the confinement terminate() must have been requested (whole-tree kill hook)
    expect(terminated.length).toBeGreaterThan(0);
  });
});

describe('Sandbox — backends are win32-gated (no accidental cross-platform execution)', () => {
  it('WindowsJobObject.isSupported is true only on win32', () => {
    expect(WindowsJobObject.isSupported('win32')).toBe(true);
    expect(WindowsJobObject.isSupported('linux')).toBe(false);
    expect(WindowsJobObject.isSupported('darwin')).toBe(false);
  });
});