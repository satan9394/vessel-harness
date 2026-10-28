import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { protectDaemonPath } from './daemonLifecycle.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function acl(target: string): string {
  return execFileSync('icacls', [target], { encoding: 'utf8', windowsHide: true });
}

it.runIf(process.platform === 'win32')('re-protects a file and a directory idempotently and drops inherited access', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-daemon-acl-'));
  roots.push(root);
  const file = path.join(root, 'daemon.token');
  const dir = path.join(root, 'daemon-root');
  fs.writeFileSync(file, 'x'.repeat(48));
  fs.mkdirSync(dir);

  // Regression: `writeDaemonFile` re-protects an existing file on every write, and a second
  // Set-Acl on an already protected object failed with SeSecurityPrivilege, so every daemon
  // start against an existing root died. Re-applying must be a no-op, not a throw.
  for (let i = 0; i < 3; i++) protectDaemonPath(file, false);
  for (let i = 0; i < 2; i++) protectDaemonPath(dir, true);

  expect(acl(file)).not.toContain('(I)');
  expect(acl(dir)).not.toContain('(I)');
  expect(fs.readFileSync(file, 'utf8')).toBe('x'.repeat(48));
});
