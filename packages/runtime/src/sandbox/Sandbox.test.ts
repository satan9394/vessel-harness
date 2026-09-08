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
  it('reports an ACTIVE windows-job-object backend on win32 with no passthrough claim', () => {
    const s = new Sandbox({ platform: 'win32', makeIsolatedDir: async () => ({ path: 'x', dispose: async () => {} }) });
    const st = s.statusSnapshot();
    expect(st.supported).toBe('windows-job-object');
    expect(st.enabled).toBe(true);
    expect(st.active).toBe(true);
    expect(st.backend).toBe('job-object');
  });

  it('falls back to a transparent passthrough backend on non-Windows platforms', () => {
    const s = new Sandbox({ platform: 'linux', makeIsolatedDir: async () => ({ path: 'x', dispose: async () => {} }) });
    const st = s.statusSnapshot();
    expect(st.active).toBe(false);
    expect(st.enabled).toBe(false);
    expect(st.backend).toBe('none');
    expect(st.fallbackReason).toBeTruthy();
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