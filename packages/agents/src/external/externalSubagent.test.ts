import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '@vessel/core';
import { ExternalAgentRuntime, type ExternalAgentConfig } from './ExternalAgentRuntime.js';
import { createSubagentTool, type SubagentManager } from '../index.js';
import type { VirtualProxyDependencies } from '@vessel/runtime';

let testCleanupRoot = '';

describe('ExternalAgentRuntime', () => {
  let testRoot: string;
  let repoRoot: string;
  let tempRoot: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-external-test-'));
    testCleanupRoot = testRoot;
    repoRoot = path.join(testRoot, 'repo');
    tempRoot = path.join(testRoot, 'leases');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    git(['init', '--quiet'], repoRoot);
    git(['config', 'user.email', 'test@example.invalid'], repoRoot);
    git(['config', 'user.name', 'Vessel Test'], repoRoot);
    fs.writeFileSync(path.join(repoRoot, 'original.txt'), 'baseline\n');
    git(['add', 'original.txt'], repoRoot);
    git(['commit', '--quiet', '-m', 'baseline'], repoRoot);
  });

  afterEach(() => {
    if (testRoot) fs.rmSync(testRoot, { recursive: true, force: true });
    testCleanupRoot = '';
  });

  it('runs an external CLI in a detached temp worktree, returns its unified diff, and mirrors bounded events', async () => {
    const bus = new EventBus();
    const events: string[] = [];
    const deltas: string[] = [];
    bus.on('subagent_start', () => { events.push('start'); });
    bus.on('model_stream_delta', (payload) => {
      events.push('delta');
      const chunk = (payload as { chunk?: { text?: string } }).chunk;
      if (chunk?.text) deltas.push(chunk.text);
    });
    bus.on('subagent_stop', () => { events.push('stop'); });
    bus.on('after_delegate', () => { events.push('after'); });

    const agent = nodeAgent(
      "const fs=require('node:fs'); const prompt=process.argv[1]||''; fs.writeFileSync('new-file.txt', prompt+'\\n'); console.log('mock-agent: '+prompt);",
    );
    const runtime = createTestRuntime({ agents: [agent], bus, tempRoot, proxyDependencies: proxyDeps() });
    const result = await runtime.execute({ agentId: agent.id, prompt: 'keep the result compact', parentWorkspaceRoot: repoRoot });

    expect(result.stopReason, result.diagnostic).toBe('completed');
    expect(result.structured?.diff).toContain('diff --git a/new-file.txt b/new-file.txt');
    expect(result.structured?.diff).toContain('+keep the result compact');
    expect(result.structured?.changedFiles).toBe(1);
    expect(fs.existsSync(path.join(repoRoot, 'new-file.txt'))).toBe(false);
    expect(events[0]).toBe('start');
    expect(events).toContain('delta');
    expect(events.slice(-2)).toEqual(['stop', 'after']);
    expect(deltas.join('')).toContain('mock-agent: keep the result compact');
    expect(git(['worktree', 'list', '--porcelain'], repoRoot).split(/\r?\n/u).filter((line) => line.startsWith('worktree '))).toHaveLength(1);
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('reuses a managed worktree after confirming stale lease PIDs are dead, then recovers its index.lock', async () => {
    const agentId = 'mock-stale';
    const leaseDirectory = leaseDir(tempRoot, repoRoot, agentId);
    const worktreePath = path.join(leaseDirectory, 'wt');
    fs.mkdirSync(leaseDirectory, { recursive: true });
    fs.writeFileSync(path.join(leaseDirectory, 'identity.json'), JSON.stringify({ version: 1, repoRoot, agentId }));
    git(['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoRoot);

    const lockRelative = git(['rev-parse', '--git-path', 'index.lock'], worktreePath).trim();
    const lockPath = path.resolve(worktreePath, lockRelative);
    fs.writeFileSync(lockPath, 'stale index lock');
    const stalePids = [2_000_001, 2_000_002, 2_000_003];
    fs.writeFileSync(path.join(leaseDirectory, 'lease.json'), JSON.stringify({
      version: 1,
      repoRoot,
      agentId,
      ownerPid: stalePids[0],
      agentPid: stalePids[1],
      agentProcessGroupId: 2_000_004,
      agentJobName: 'stale-agent-job',
      gitPid: stalePids[2],
    }));
    const canonicalWorktreePath = fs.realpathSync.native(worktreePath);
    const probed: number[] = [];
    const agent = nodeAgent("const fs=require('node:fs'); fs.writeFileSync('recovered.txt','reused'); console.log(process.cwd());", agentId);
    const runtime = createTestRuntime({
      agents: [agent],
      tempRoot,
      proxyDependencies: proxyDeps(),
      isPidAlive(pid) { probed.push(pid); return false; },
      isProcessGroupAlive() { return false; },
      isWindowsJobActive: async () => false,
    });

    const result = await runtime.execute({ agentId, prompt: 'recover safely', parentWorkspaceRoot: repoRoot });

    expect(result.stopReason, result.diagnostic).toBe('completed');
    expect(path.resolve(result.output.trim()).toLocaleLowerCase()).toBe(path.resolve(canonicalWorktreePath).toLocaleLowerCase());
    expect(result.structured?.diff).toContain('recovered.txt');
    expect(stalePids.every((pid) => probed.includes(pid))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'recovered.txt'))).toBe(false);
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('refuses a managed worktree path redirected through a symlink', async () => {
    const agentId = 'mock-symlink';
    const leaseDirectory = leaseDir(tempRoot, repoRoot, agentId);
    const worktreePath = path.join(leaseDirectory, 'wt');
    const redirectedPath = path.join(testRoot, 'redirected-worktree');
    fs.mkdirSync(leaseDirectory, { recursive: true });
    fs.writeFileSync(path.join(leaseDirectory, 'identity.json'), JSON.stringify({ version: 1, repoRoot, agentId }));
    git(['worktree', 'add', '--detach', redirectedPath, 'HEAD'], repoRoot);
    fs.writeFileSync(path.join(redirectedPath, 'sentinel.txt'), 'preserve');
    fs.symlinkSync(redirectedPath, worktreePath, process.platform === 'win32' ? 'junction' : 'dir');

    const agent = nodeAgent("process.stdout.write('must not execute');", agentId);
    const runtime = createTestRuntime({ agents: [agent], tempRoot, proxyDependencies: proxyDeps() });
    const result = await runtime.execute({ agentId, prompt: 'reject the linked path', parentWorkspaceRoot: repoRoot });

    expect(result.stopReason).toBe('error');
    expect(result.diagnostic).toMatch(/symlink|canonical path/u);
    expect(fs.readFileSync(path.join(redirectedPath, 'sentinel.txt'), 'utf8')).toBe('preserve');
    expect(fs.existsSync(redirectedPath)).toBe(true);
  });

  it('refuses direct parent-workspace execution even for read-only policy profiles', async () => {
    const target = path.join(repoRoot, 'must-not-exist.txt');
    const agent = { ...nodeAgent("require('node:fs').writeFileSync('must-not-exist.txt','written');", 'no-isolation'), isolateWorkspace: false };
    const runtime = createTestRuntime({ agents: [agent], tempRoot, proxyDependencies: proxyDeps() });
    const result = await runtime.execute({ agentId: agent.id, prompt: 'do not escape the worktree', parentWorkspaceRoot: repoRoot, policyProfile: 'read-only' });

    expect(result.stopReason).toBe('error');
    expect(result.diagnostic).toMatch(/direct parent-workspace execution is disabled/u);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('keeps a stale index lock when the recorded external process group is still alive', async () => {
    const agentId = 'mock-live-group';
    const leaseDirectory = leaseDir(tempRoot, repoRoot, agentId);
    const worktreePath = path.join(leaseDirectory, 'wt');
    fs.mkdirSync(leaseDirectory, { recursive: true });
    fs.writeFileSync(path.join(leaseDirectory, 'identity.json'), JSON.stringify({ version: 1, repoRoot, agentId }));
    git(['worktree', 'add', '--detach', worktreePath, 'HEAD'], repoRoot);
    const lockPath = path.resolve(worktreePath, git(['rev-parse', '--git-path', 'index.lock'], worktreePath).trim());
    fs.writeFileSync(lockPath, 'must be preserved');
    fs.writeFileSync(path.join(leaseDirectory, 'lease.json'), JSON.stringify({
      version: 1,
      repoRoot,
      agentId,
      ownerPid: 2_100_001,
      agentPid: 2_100_002,
      agentProcessGroupId: 2_100_003,
      gitPid: 2_100_004,
      agentJobName: 'live-agent-job',
    }));
    const agent = nodeAgent("process.stdout.write('must not execute');", agentId);
    const runtime = createTestRuntime({
      agents: [agent], tempRoot, proxyDependencies: proxyDeps(),
      isPidAlive: () => false,
      isProcessGroupAlive: () => true,
      isWindowsJobActive: async () => true,
    });
    const result = await runtime.execute({ agentId, prompt: 'do not break an active lock', parentWorkspaceRoot: repoRoot });

    expect(result.stopReason).toBe('error');
    expect(result.diagnostic).toMatch(/still has live processes/u);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe('must be preserved');
  });

  it('cleans the temp worktree on external command failure', async () => {
    const agent = nodeAgent("process.stdout.write('controlled failure'); process.exit(17);");
    const runtime = createTestRuntime({ agents: [agent], tempRoot, proxyDependencies: proxyDeps() });
    const result = await runtime.execute({ agentId: agent.id, prompt: 'fail predictably', parentWorkspaceRoot: repoRoot });

    expect(result.stopReason).toBe('error');
    expect(result.output).toContain('controlled failure');
    expect(git(['worktree', 'list', '--porcelain'], repoRoot).split(/\r?\n/u).filter((line) => line.startsWith('worktree '))).toHaveLength(1);
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('routes an explicit external_agent_id through the existing Subagent tool', async () => {
    const agent = nodeAgent("const fs=require('node:fs'); fs.writeFileSync('routed.txt','through-tool'); console.log('routed');", 'tool-route');
    const runtime = createTestRuntime({ agents: [agent], tempRoot, proxyDependencies: proxyDeps() });
    const tool = createSubagentTool({} as SubagentManager, { externalRuntime: runtime });
    const result = await tool.execute(
      { prompt: 'route this task', external_agent_id: agent.id },
      { workspaceRoot: repoRoot, cwd: repoRoot },
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Unified diff:');
    expect(result.content).toContain('diff --git a/routed.txt b/routed.txt');
    expect((result.meta.subagent as { externalAgentId?: string }).externalAgentId).toBe(agent.id);
    expect(fs.existsSync(path.join(repoRoot, 'routed.txt'))).toBe(false);
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('denies an interactive write prompt outside the isolated workspace', async () => {
    const agent = nodeAgent([
      "const target=require('node:path').join(process.env.OUTSIDE_ROOT,'outside.txt');",
      "process.stdout.write('Overwrite '+target+'? [y/N]');",
      "process.stdin.once('data', value=>{ process.stdout.write(String(value).trim()==='n'?'DENIED':'APPROVED'); process.exit(0); });",
    ].join('\n'), 'mock-deny', { OUTSIDE_ROOT: testRoot });
    const runtime = createTestRuntime({ agents: [agent], tempRoot, proxyDependencies: proxyDeps() });
    const result = await runtime.execute({ agentId: agent.id, prompt: 'do not write outside', parentWorkspaceRoot: repoRoot });

    expect(result.stopReason).toBe('denied');
    expect(result.diagnostic).toMatch(/denied 1 interactive request/);
    expect(fs.existsSync(path.join(testRoot, 'outside.txt'))).toBe(false);
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });
});

function nodeAgent(script: string, id = 'mock-cli', env?: Record<string, string>): ExternalAgentConfig {
  return { id, command: process.execPath, argsTemplate: ['-e', script], env, isolateWorkspace: true };
}

function proxyDeps(): VirtualProxyDependencies {
  if (process.platform !== 'win32') return {};
  return {
    enumerateDescendants: async () => [],
    createJob: async (pid) => ({ jobName: 'external-test', rootPid: pid, attached: true, async terminate() {}, async dispose() {} }),
  };
}

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + (result.stderr || result.stdout));
  return result.stdout;
}

function leaseDir(tempRoot: string, repoRoot: string, agentId: string): string {
  const key = crypto.createHash('sha256').update(path.resolve(repoRoot) + '\0' + agentId).digest('hex').slice(0, 16);
  return path.join(tempRoot, 'vessel-ext-' + key);
}

function createTestRuntime(options: ConstructorParameters<typeof ExternalAgentRuntime>[0]): ExternalAgentRuntime {
  return new ExternalAgentRuntime({
    ...options,
    moveToTrash: async (candidate) => {
      const root = fs.realpathSync.native(testCleanupRoot);
      const target = fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.resolve(candidate);
      const relative = path.relative(root, target);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error(`test cleanup refused path ${target} outside temporary root ${root}`);
      }
      fs.rmSync(target, { recursive: true, force: true });
    },
  });
}
