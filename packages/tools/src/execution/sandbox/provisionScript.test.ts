import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restrictedWriteSid } from './windowsRestricted.js';

/**
 * Card 276: the sandbox refuses a workspace whose ACL has not been provisioned, so the explicit
 * preparation script is the only way a user can get Shell working. Two implementations derive the
 * same SID from the same path (TypeScript runner + PowerShell script) — if they drift, every
 * command silently turns into `sandbox directory requires provisioned ... ACL`. This pins them
 * together and proves the script's own verification (grant + Low label) actually passes.
 */
const WINDOWS = process.platform === 'win32';
const script = path.resolve(import.meta.dirname, '../../../../../scripts/provision-sandbox.ps1');

describe.skipIf(!WINDOWS)('provision-sandbox.ps1', () => {
  let dir: string;
  let real: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-provision-'));
    real = execFileSync('powershell', ['-NoProfile', '-Command', `(Resolve-Path '${dir}').Path`], { encoding: 'utf8' }).trim();
  });
  afterEach(() => {
    // Undo the ACL change before removing the directory, otherwise the extra ACE leaks into the
    // reuse pool. Cleanup of *this test's own* temp dir stays within the documented exception.
    try { run('-Revoke'); } catch { /* already revoked or never provisioned */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (...extra: string[]) => execFileSync('powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', real, ...extra],
    { encoding: 'utf8' });

  it('grants exactly the SID the runner computes and reports verified Low Integrity', () => {
    const output = run();
    expect(output).toMatch(/granted=True/);
    expect(output).toMatch(/low label\s*: True/);
    const reported = /sandbox SID: (\S+)/.exec(output)?.[1];
    expect(reported).toBe(restrictedWriteSid(real));
  });

  it('revoke removes the grant and restores the Medium label', () => {
    run();
    const output = run('-Revoke');
    expect(output).toMatch(/revoked/);
    const sddl = execFileSync('powershell',
      ['-NoProfile', '-Command', `(New-Object System.IO.DirectoryInfo '${real}').GetAccessControl().Sddl`],
      { encoding: 'utf8' });
    expect(sddl).not.toContain(`;;;${restrictedWriteSid(real)}`);
    const labels = execFileSync('icacls', [real], { encoding: 'utf8' });
    expect(labels).not.toMatch(/Low Mandatory Level/);
    expect(labels).toMatch(/Medium Mandatory Level/);
  });
});
