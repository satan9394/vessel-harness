import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sandbox } from '@vessel/runtime';
import { createShellTool } from '../index.js';

/**
 * Card 276. Two things turned "full access" into a guaranteed denial:
 *
 * 1. `os.tmpdir()` was a write root, and the preflight requires *every* root to be ACL-provisioned.
 *    The OS temp directory never is, so the workspace never got a chance to matter.
 * 2. The resulting denial was a bare path complaint, so a model reading it concluded Shell was
 *    simply unavailable instead of "prepare this workspace once".
 */
describe('Shell native sandbox wiring', () => {
  let dir: string;
  const audits: Array<Record<string, unknown>> = [];
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-shell-wiring-')); audits.length = 0; });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const runner = (execute: () => Promise<unknown>) => ({ isAvailable: vi.fn(async () => true), execute: vi.fn(execute) }) as never;

  it('gives the sandbox only the workspace as a write root', async () => {
    const native = runner(async () => ({ stdout: 'ok', stderr: '', exitCode: 0, sandboxed: true, isolationTier: 'windows-job-restricted' }));
    const tool = createShellTool({ workspaceRoot: dir, sandbox: new Sandbox(), nativeSandbox: native, nativeAudit: event => { audits.push(event as unknown as Record<string, unknown>); } });
    await tool.execute({ command: 'echo ok' }, {} as never);
    const options = (native as unknown as { execute: { mock: { calls: Array<[unknown, unknown, { allowedWritePaths: string[] }]> } } }).execute.mock.calls[0]![2];
    expect(options.allowedWritePaths).toEqual([dir]);
    expect(audits[0]).toMatchObject({ sandboxed: true, outcome: 'enforced' });
  });

  it('tells the caller how to prepare an unprovisioned workspace', async () => {
    const native = runner(async () => { throw new Error('restricted sandbox denied: sandbox directory requires provisioned Low Integrity and restricted SID ACL: C:\\work'); });
    const tool = createShellTool({ workspaceRoot: dir, sandbox: new Sandbox(), nativeSandbox: native, nativeAudit: event => { audits.push(event as unknown as Record<string, unknown>); } });
    const result = await tool.execute({ command: 'echo ok' }, {} as never);
    expect(result.error?.errorClass).toBe('DENIED');
    expect(result.error?.message).toContain('provision-sandbox.ps1');
    expect(result.error?.message).toContain(dir);
    expect(audits[0]).toMatchObject({ sandboxed: false, outcome: 'denied' });
  });

  it('does not add the hint to unrelated sandbox failures', async () => {
    const native = runner(async () => { throw new Error('CreateJobObject failed'); });
    const tool = createShellTool({ workspaceRoot: dir, sandbox: new Sandbox(), nativeSandbox: native, nativeAudit: () => {} });
    const result = await tool.execute({ command: 'echo ok' }, {} as never);
    expect(result.error?.message).not.toContain('provision-sandbox.ps1');
  });
});
