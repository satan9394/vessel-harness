import { describe, it, expect } from 'vitest';
import { runCommand, runDirectedCommand, runShellCommand } from './Process.js';

describe('process command boundaries', () => {
  it('rejects shell mode on the argv entry point with a migration hint', async () => {
    await expect(runCommand(process.execPath, ['-e', '0'], {
      cwd: process.cwd(), shell: true,
    })).rejects.toThrow(/runShellCommand/);
  });

  it('rejects shell mode on the caller-directed argv entry point as well', async () => {
    await expect(runDirectedCommand(process.execPath, ['-e', '0'], {
      cwd: process.cwd(), shell: true,
    })).rejects.toThrow(/runShellCommand/);
  });

  it('runs caller-directed argv without a shell, like the internal argv entry point', async () => {
    const value = 'alpha & beta | gamma';
    const result = await runDirectedCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value], {
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(value);
  });

  it('preserves shell metacharacters as literal argv', async () => {
    const value = 'one & echo two | three > four';
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value], {
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(value);
  });

  it('runs a whole command line through the explicit shell entry point', async () => {
    const result = await runShellCommand('echo vessel-shell-boundary', { cwd: process.cwd() });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('vessel-shell-boundary');
  });
});

describe('runCommand — abort signal (task 050)', () => {
  it('an already-aborted signal kills the child and resolves with killed=true', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      cwd: process.cwd(),
      signal: ac.signal,
    });
    expect(r.killed).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  it('aborting the signal mid-run kills the child and resolves with killed=true', async () => {
    const ac = new AbortController();
    const run = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      cwd: process.cwd(),
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 50);
    const r = await run;
    expect(r.killed).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  it('without an abort the command runs to completion unaffected', async () => {
    const r = await runCommand(process.execPath, ['-e', 'console.log("ok050")'], {
      cwd: process.cwd(),
      maxOutputBytes: 1024,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('ok050');
    expect(r.killed).toBe(false);
  });
});
