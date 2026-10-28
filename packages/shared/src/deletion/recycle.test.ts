import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  appleScriptLiteral,
  powershellLiteral,
  recyclePath,
  type RecycleRun,
} from './recycle.js';

/** Test-owned fixtures under the OS temp root (the repo's only delete exception). */
const ROOT = mkdtempSync(path.join(tmpdir(), 'vessel-recycle-'));
const DIR = path.join(ROOT, 'some-dir');
const FILE = path.join(ROOT, 'some-file.txt');
mkdirSync(DIR);
writeFileSync(FILE, 'x');

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true }); // 本用例自建、位于 os.tmpdir() 之下
});

function recorder(): { calls: Array<{ command: string; args: string[] }>; run: RecycleRun } {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    run: async (command, args) => {
      calls.push({ command, args });
      return { code: 0 };
    },
  };
}

function firstCall(calls: Array<{ command: string; args: string[] }>): { command: string; args: string[] } {
  const call = calls[0];
  if (!call) throw new Error('expected one spawn call');
  return call;
}

describe('recyclePath', () => {
  it('uses DeleteDirectory for a directory on win32', async () => {
    const { calls, run } = recorder();
    const result = await recyclePath(DIR, { run, platform: 'win32' });
    expect(result).toEqual({ ok: true, target: path.resolve(DIR) });
    expect(calls).toHaveLength(1);
    const call = firstCall(calls);
    expect(call.command).toBe('powershell.exe');
    expect(call.args).toContain('-NonInteractive');
    expect(call.args.join(' ')).toContain('DeleteDirectory(');
    expect(call.args.join(' ')).toContain("'SendToRecycleBin'");
  });

  it('uses DeleteFile for a file on win32', async () => {
    const { calls, run } = recorder();
    const result = await recyclePath(FILE, { run, platform: 'win32' });
    expect(result.ok).toBe(true);
    expect(firstCall(calls).args.join(' ')).toContain('DeleteFile(');
  });

  it('uses Finder on darwin', async () => {
    const { calls, run } = recorder();
    const result = await recyclePath(DIR, { run, platform: 'darwin' });
    expect(result.ok).toBe(true);
    const call = firstCall(calls);
    expect(call.command).toBe('osascript');
    expect(call.args.join(' ')).toContain('tell application "Finder" to delete POSIX file "');
  });

  it('uses gio trash on linux', async () => {
    const { calls, run } = recorder();
    const result = await recyclePath(FILE, { run, platform: 'linux' });
    expect(result.ok).toBe(true);
    expect(firstCall(calls)).toEqual({ command: 'gio', args: ['trash', '--', path.resolve(FILE)] });
  });

  it('reports not-found without spawning anything', async () => {
    const { calls, run } = recorder();
    const result = await recyclePath(path.join(ROOT, 'missing'), { run, platform: 'win32' });
    expect(result).toEqual({ ok: false, reason: 'not-found', detail: path.resolve(ROOT, 'missing') });
    expect(calls).toHaveLength(0);
  });

  it('reports failed on a non-zero exit', async () => {
    const result = await recyclePath(DIR, {
      platform: 'linux',
      run: async () => ({ code: 3, error: 'exit 3' }),
    });
    expect(result).toEqual({ ok: false, reason: 'failed', detail: 'exit 3' });
  });

  it('reports failed when the runner throws', async () => {
    const result = await recyclePath(DIR, {
      platform: 'linux',
      run: async () => { throw new Error('spawn ENOENT'); },
    });
    expect(result).toEqual({ ok: false, reason: 'failed', detail: 'spawn ENOENT' });
  });

  it('reports unsupported-platform for a non-unix, non-supported host', async () => {
    const result = await recyclePath(FILE, { platform: 'plan9' as NodeJS.Platform, run: async () => ({ code: 0 }) });
    expect(result).toEqual({ ok: false, reason: 'unsupported-platform', detail: 'plan9' });
  });

  it.skipIf(process.platform === 'win32')('refuses to recycle a symbolic link', async () => {
    const link = path.join(ROOT, 'link');
    symlinkSync(DIR, link);
    const { calls, run } = recorder();
    const result = await recyclePath(link, { run, platform: 'linux' });
    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    expect(calls).toHaveLength(0);
    expect(existsSync(link)).toBe(true);
  });
});

describe('platform literals', () => {
  it('doubles single quotes and keeps $ and backticks literal for PowerShell', () => {
    expect(powershellLiteral(`C:\\a'b$c\`d`)).toBe(`'C:\\a''b$c\`d'`);
  });

  it('escapes backslash and double quote for AppleScript', () => {
    expect(appleScriptLiteral('C:\\a"b')).toBe('"C:\\\\a\\"b"');
  });
});
