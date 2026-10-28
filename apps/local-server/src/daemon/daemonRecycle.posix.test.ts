import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recyclePath, type RecycleRun } from '@vessel/shared';

let base: string;
let target: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-recycle-posix-command-'));
  target = path.join(base, "fixture's $file.txt");
  fs.writeFileSync(target, 'keep bytes');
});
afterEach(() => {
  // Test-owned os.tmpdir fixture only. The injected runner never executes an OS command.
  fs.rmSync(base, { recursive: true, force: true });
});

describe('POSIX recycling command branches (mocked; no native platform integration)', () => {
  it('uses gio trash when Linux gio is available', async () => {
    const run = vi.fn<RecycleRun>().mockResolvedValue({ code: 0 });
    await expect(recyclePath(target, { platform: 'linux', run })).resolves.toEqual({ ok: true, target });
    expect(run).toHaveBeenCalledExactlyOnceWith('gio', ['trash', '--', target]);
    expect(fs.readFileSync(target, 'utf8')).toBe('keep bytes');
  });

  it('fails closed without a permanent-delete fallback when Linux gio is absent', async () => {
    const run = vi.fn<RecycleRun>().mockResolvedValue({ code: null, error: 'spawn gio ENOENT' });
    await expect(recyclePath(target, { platform: 'linux', run })).resolves.toEqual({
      ok: false, reason: 'failed', detail: 'spawn gio ENOENT',
    });
    expect(run).toHaveBeenCalledExactlyOnceWith('gio', ['trash', '--', target]);
    expect(fs.readFileSync(target, 'utf8')).toBe('keep bytes');
  });

  it('forms the macOS osascript Finder command without executing it', async () => {
    const run = vi.fn<RecycleRun>().mockResolvedValue({ code: 0 });
    await expect(recyclePath(target, { platform: 'darwin', run })).resolves.toEqual({ ok: true, target });
    const escaped = target.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
    expect(run).toHaveBeenCalledExactlyOnceWith('osascript', [
      '-e', `tell application "Finder" to delete POSIX file "${escaped}"`,
    ]);
    expect(fs.readFileSync(target, 'utf8')).toBe('keep bytes');
  });
});
