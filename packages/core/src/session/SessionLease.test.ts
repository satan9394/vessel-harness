import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from './Session.js';

/**
 * Session single-writer lease — fail-closed + stale reclaim
 * (G-10 / BRIEF-09 acceptance criterion 2).
 *
 * Contract under test (Session.ts acquireLease/readLeaseOwner/isProcessAlive):
 * - `.lease` holds `<pid>\n<ISO timestamp>\n`.
 * - owner pid gone (ESRCH) or unparsable content -> stale, reclaim and take over.
 * - owner pid alive, or EPERM -> stay fail-closed, throw, never steal the lease.
 *
 * Isolation: every case works in its own mkdtemp dir and passes `sessionDir`
 * explicitly, so nothing touches the real `~/.vessel` or a workspace `.harness`.
 * Liveness semantics are exercised only with `process.pid`; no real process is
 * ever killed (only `process.kill(pid, 0)` probes, which deliver no signal).
 */
describe('Session lease (fail-closed + stale reclaim)', () => {
  let tmpRoot: string;
  let sessionDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-lease-'));
    sessionDir = path.join(tmpRoot, 'session');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const leasePath = (): string => path.join(sessionDir, '.lease');

  /** write a lease file by hand, before any Session.open has run */
  const writeLease = (content: string): void => {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(leasePath(), content);
  };

  /** first line of the lease file = the pid the implementation parsed back */
  const leaseOwnerLine = (): string =>
    (fs.readFileSync(leasePath(), 'utf8').split('\n')[0] ?? '').trim();

  const openLease = (
    sessionId: string,
  ): Promise<{ session: Session | null; err: Error | null }> =>
    Session.open({ workspaceRoot: tmpRoot, sessionId, sessionDir }).then(
      (session) => ({ session, err: null }),
      (e: unknown) => ({ session: null, err: e as Error }),
    );

  /** minimal liveness probe, same ESRCH/EPERM semantics as the implementation */
  const pidAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  };

  /**
   * A pid that is (almost certainly) dead: start at the conventional 999999 and
   * walk down until a pid is confirmed unused. Probing only — nothing is killed.
   */
  const pickDeadPid = (): number => {
    let pid = 999999;
    for (let i = 0; i < 1000; i += 1, pid -= 1) {
      if (pid !== process.pid && !pidAlive(pid)) return pid;
    }
    throw new Error('no free pid found to fabricate a stale lease');
  };

  it('rejects a second concurrent open on the same sessionDir (fail-closed intact)', async () => {
    const first = await Session.open({ workspaceRoot: tmpRoot, sessionId: 'lease-1', sessionDir });
    expect(leaseOwnerLine()).toBe(String(process.pid));

    const { session, err } = await openLease('lease-1');
    expect(session).toBeNull();
    expect(err).toBeInstanceOf(Error);
    // Actual wording is implementation-defined, so accept either text:
    // a live owner pid yields the fail-closed "正在被进程 <pid> 使用" error
    // (Session.ts:89); "already open" is only the retry-loop fallback
    // (Session.ts:85), reached when a reclaim fails to remove the file.
    expect(err?.message).toMatch(/already open|正在被进程 \d+ 使用/);
    expect(err?.message).toContain(sessionDir);

    // sessionDir was honoured: no implicit <workspaceRoot>/.harness was created
    expect(fs.existsSync(path.join(tmpRoot, '.harness'))).toBe(false);
    // the loser must not have touched the winner's lease
    expect(leaseOwnerLine()).toBe(String(process.pid));

    await first.close();
  });

  it('reclaims a stale lease whose recorded pid no longer exists', async () => {
    const deadPid = pickDeadPid();
    expect(pidAlive(deadPid)).toBe(false);
    writeLease(`${deadPid}\n${new Date().toISOString()}\n`);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const session = await Session.open({
        workspaceRoot: tmpRoot,
        sessionId: 'lease-2',
        sessionDir,
      });
      expect(session.sessionId).toBe('lease-2');
      // the stale lease was actually reclaimed by this process, not just ignored
      expect(leaseOwnerLine()).toBe(String(process.pid));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('回收陈旧租约');
      expect(String(warn.mock.calls[0]?.[0])).toContain(String(deadPid));
      await session.close();
    } finally {
      warn.mockRestore();
    }
  });

  it('stays fail-closed when the recorded pid is alive (current process)', async () => {
    writeLease(`${process.pid}\n${new Date().toISOString()}\n`);

    const { session, err } = await openLease('lease-3');
    expect(session).toBeNull();
    expect(err).toBeInstanceOf(Error);
    // must name the live owner pid, or at least the fail-closed wording
    expect(
      err!.message.includes(String(process.pid)) || /正在被进程|already open/.test(err!.message),
    ).toBe(true);

    // a live lease is never reclaimed, and no log was opened behind it
    expect(leaseOwnerLine()).toBe(String(process.pid));
    expect(fs.existsSync(path.join(sessionDir, 'session.jsonl'))).toBe(false);
  });

  it('treats an unparsable / non-positive lease as stale and reclaims it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const garbage of ['not-a-pid', '', '   \n', '0\n', '-5\n', 'NaN\n0\n']) {
        writeLease(garbage);
        const session = await Session.open({
          workspaceRoot: tmpRoot,
          sessionId: 'lease-4',
          sessionDir,
        });
        expect(session.sessionId).toBe('lease-4');
        expect(leaseOwnerLine()).toBe(String(process.pid));
        await session.close();
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('allows reopening the same sessionDir after close releases the lease', async () => {
    const first = await Session.open({ workspaceRoot: tmpRoot, sessionId: 'lease-5', sessionDir });
    await first.close();
    expect(fs.existsSync(leasePath())).toBe(false);

    const second = await Session.open({ workspaceRoot: tmpRoot, sessionId: 'lease-5', sessionDir });
    expect(second.sessionId).toBe('lease-5');
    expect(leaseOwnerLine()).toBe(String(process.pid));
    await second.close();
  });
});
