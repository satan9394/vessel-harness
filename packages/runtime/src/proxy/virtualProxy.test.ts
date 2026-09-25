import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { buildHolderScript } from '../sandbox/backend/windows-job-object.js';
import { spawnWithVirtualProxy, type VirtualProxyDependencies } from './virtualProxy.js';

describe('spawnWithVirtualProxy', () => {
  let root: string | undefined;
  const spawnedPids = new Set<number>();

  afterEach(() => {
    for (const pid of spawnedPids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    spawnedPids.clear();
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('recognizes a whitelisted [y/N] prompt and replies yes through stdin', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-proxy-allow-'));
    const target = path.join(root, 'safe.txt');
    const script = [
      `process.stdout.write(${JSON.stringify(`Overwrite ${target}? [y/N]`)});`,
      `process.stdin.once('data', value => { process.stdout.write(String(value).trim() === 'y' ? 'APPROVED' : 'DENIED'); process.exit(0); });`,
    ].join('\n');
    const result = await spawnWithVirtualProxy({
      command: process.execPath,
      args: ['-e', script],
      cwd: root,
      timeoutMs: 5_000,
      autoApproveRules: { allowPaths: [root] },
    }, { ...testTreeDeps(), quietWindowMs: 20 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('APPROVED');
    expect(result.interceptionsCount).toBe(1);
    expect(result.deniedPromptsCount).toBe(0);
  });

  it('denies a prompt whose target is outside the policy allow-list', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-proxy-deny-'));
    const target = path.join(os.tmpdir(), 'vessel-proxy-untrusted.txt');
    const script = [
      `process.stdout.write(${JSON.stringify(`Overwrite ${target}? [y/N]`)});`,
      `process.stdin.once('data', value => { process.stdout.write(String(value).trim() === 'n' ? 'DENIED' : 'APPROVED'); process.exit(0); });`,
    ].join('\n');
    const result = await spawnWithVirtualProxy({
      command: process.execPath,
      args: ['-e', script],
      cwd: root,
      timeoutMs: 5_000,
      autoApproveRules: { allowPaths: [root] },
    }, { ...testTreeDeps(), quietWindowMs: 20 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('DENIED');
    expect(result.interceptionsCount).toBe(1);
    expect(result.deniedPromptsCount).toBe(1);
  });

  it('denies a prompt containing both allowlisted and out-of-scope paths', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-proxy-mixed-'));
    const safe = path.join(root, 'safe.txt');
    const outside = path.join(os.tmpdir(), 'vessel-proxy-outside.txt');
    const prompt = `Overwrite ${safe} and ${outside}? [y/N]`;
    const script = [
      `process.stdout.write(${JSON.stringify(prompt)});`,
      `process.stdin.once('data', value => { process.stdout.write(String(value).trim() === 'n' ? 'DENIED' : 'APPROVED'); process.exit(0); });`,
    ].join('\n');
    const result = await spawnWithVirtualProxy({
      command: process.execPath,
      args: ['-e', script],
      cwd: root,
      timeoutMs: 5_000,
      autoApproveRules: { allowPaths: [root] },
    }, { ...testTreeDeps(), quietWindowMs: 20 });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('DENIED');
    expect(result.deniedPromptsCount).toBe(1);
  });

  it('adds configured native non-interactive flags before falling back to prompts', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-proxy-native-'));
    const script = `process.stdout.write(process.argv.includes('HEADLESS-TOKEN') ? 'HEADLESS' : 'INTERACTIVE');`;
    const result = await spawnWithVirtualProxy({
      command: process.execPath,
      args: ['-e', script],
      cwd: root,
      nonInteractiveArgs: ['HEADLESS-TOKEN', 'HEADLESS-TOKEN'],
    }, testTreeDeps());

    expect(result.stdout).toBe('HEADLESS');
    expect(result.interceptionsCount).toBe(0);
  });

  it('kills the child tree when Windows Job Object attachment fails', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-proxy-job-attach-failure-'));
    let killPid: number | undefined;
    const running = spawnWithVirtualProxy({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      timeoutMs: 5_000,
    }, {
      platform: 'win32',
      createJob: async (pid) => ({
        jobName: 'unattached-test-job',
        rootPid: pid,
        attached: false,
        async terminate() { throw new Error('unattached Job Object must not be used'); },
        async dispose() {},
      }),
      killWindowsTree: async (pid) => {
        killPid = pid;
        try { process.kill(pid, 'SIGKILL'); } catch { /* child may already be gone */ }
      },
    });

    await expect(running).rejects.toThrow(/did not attach/u);
    expect(killPid).toBeGreaterThan(0);
  });

  it('waits for 200ms of silence before treating prompt-like output as interactive', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-proxy-silence-'));
    const script = [
      `process.stdout.write('Example string [y/N]');`,
      `setTimeout(() => { process.stdout.write(' continued'); process.exit(0); }, 80);`,
    ].join('\n');
    const result = await spawnWithVirtualProxy({ command: process.execPath, args: ['-e', script], cwd: root }, testTreeDeps());

    expect(result.exitCode).toBe(0);
    expect(result.interceptionsCount).toBe(0);
    expect(result.stdout).toContain('continued');
  });

  it('kills the descendant process tree on timeout and closes Windows Job Objects on exit', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-proxy-timeout-'));
    const script = [
      `const { spawn } = require('node:child_process');`,
      `const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });`,
      `process.stdout.write('GRANDCHILD:' + grandchild.pid + '\\n');`,
      `setInterval(() => {}, 1000);`,
    ].join('\n');
    const deps: VirtualProxyDependencies = process.platform === 'win32'
      ? { enumerateDescendants: async () => [], createJob: async (pid) => ({
          jobName: 'test-job', rootPid: pid, attached: true,
          async terminate() { await taskkillTree(pid); },
          async dispose() {},
        }) }
      : {};
    const result = await spawnWithVirtualProxy({
      command: process.execPath,
      args: ['-e', script],
      cwd: root,
      timeoutMs: 600,
    }, deps);
    const grandchildPid = Number(result.stdout.match(/GRANDCHILD:(\d+)/u)?.[1]);
    if (Number.isInteger(grandchildPid) && grandchildPid > 0) spawnedPids.add(grandchildPid);

    expect(result.killedByTimeout).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(Number.isInteger(grandchildPid) && grandchildPid > 0).toBe(true);
    await expectProcessGone(grandchildPid);
  });

  it('uses JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE in the Windows confinement holder', () => {
    const script = buildHolderScript({
      jobName: 'vessel-proxy-test',
      targetPid: 1234,
      limits: {},
      readyFile: 'ready',
      errorFile: 'error',
    });
    expect(script).toContain('$flags=0x2000');
    expect(script).toContain('$lim.Flags=$flags');
  });
});

function taskkillTree(pid: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
    if (result.status === 0) resolve();
    else reject(new Error(result.stderr || `taskkill exit ${result.status}`));
  });
}

function testTreeDeps(): VirtualProxyDependencies {
  if (process.platform !== 'win32') return {};
  return {
    enumerateDescendants: async () => [],
    createJob: async (pid) => ({
      jobName: 'test-job',
      rootPid: pid,
      attached: true,
      async terminate() { await taskkillTree(pid); },
      async dispose() {},
    }),
  };
}

async function expectProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 25));
    } catch {
      return;
    }
  }
  throw new Error(`process ${pid} remained alive after tree termination`);
}
