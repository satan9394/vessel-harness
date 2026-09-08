import { describe, it, expect } from 'vitest';
import { runCommand } from './Process.js';

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
