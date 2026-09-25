import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { EventBus } from '@vessel/core';
import type { ChatToolCall, ChatUsage, StreamChunk, SubagentResultContract } from '@vessel/shared';
import {
  createWorktree,
  type GitRunner,
  type WorktreeHandle,
} from '@vessel/tools';
import {
  spawnWithVirtualProxy,
  WindowsJobObject,
  type CliInteractionEvent,
  type VirtualProxyDependencies,
} from '@vessel/runtime';

const LEASE_VERSION = 1;
const MAX_STREAM_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 16 * 1024;
const MAX_DIFF_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export interface ExternalAgentConfig {
  id: string;
  command: string;
  /** Argument array; {prompt}, {workspace}, and {agent_id} are substituted without a shell. */
  argsTemplate: string[];
  env?: Record<string, string>;
  /** Defaults to true; workspace-write agents are never run against the parent checkout. */
  isolateWorkspace?: boolean;
  /** Native non-interactive flags for this CLI adapter. */
  nonInteractiveArgs?: string[];
  deniedCommands?: string[];
}

export interface ExternalSubagentDelegateOptions {
  agentId: string;
  prompt: string;
  parentWorkspaceRoot: string;
  timeoutMs?: number;
  policyProfile?: 'read-only' | 'workspace-write';
  signal?: AbortSignal;
}

export interface ExternalAgentRuntimeOptions {
  agents: ExternalAgentConfig[];
  bus?: EventBus;
  /** A test-owned directory below os.tmpdir(); production defaults to os.tmpdir(). */
  tempRoot?: string;
  gitRunner?: GitRunner;
  proxyDependencies?: VirtualProxyDependencies;
  isPidAlive?: (pid: number) => boolean;
  isProcessGroupAlive?: (processGroupId: number) => boolean;
  isWindowsJobActive?: (jobName: string) => Promise<boolean>;
  moveToTrash?: (path: string) => Promise<void>;
}

interface LeaseRecord {
  version: number;
  repoRoot: string;
  agentId: string;
  ownerPid: number | null;
  agentPid?: number;
  agentProcessGroupId?: number;
  agentJobName?: string;
  gitPid?: number;
}

interface WorkspaceLease {
  directory: string;
  worktreePath: string;
  leasePath: string;
  adminPath?: string;
  record: LeaseRecord;
  handle?: WorktreeHandle;
}

/**
 * Runs configured external CLIs in private, detached Git worktrees. A stable
 * temp path lets a later process recover only a lease whose recorded PIDs are
 * all gone; ambiguous or live leases fail closed.
 */
export class ExternalAgentRuntime {
  private readonly agents: Map<string, ExternalAgentConfig>;
  private readonly tempRoot: string;
  private readonly isPidAlive: (pid: number) => boolean;
  private readonly isProcessGroupAlive: (processGroupId: number) => boolean;
  private readonly isWindowsJobActive: (jobName: string) => Promise<boolean>;
  private readonly moveToTrash: (targetPath: string) => Promise<void>;

  constructor(private readonly options: ExternalAgentRuntimeOptions) {
    this.agents = new Map(options.agents.map((agent) => [agent.id, agent]));
    if (this.agents.size !== options.agents.length) throw new Error('external agent ids must be unique');
    this.tempRoot = assertTempRoot(options.tempRoot ?? tmpdir());
    this.isPidAlive = options.isPidAlive ?? pidIsAlive;
    this.isProcessGroupAlive = options.isProcessGroupAlive ?? processGroupIsAlive;
    this.isWindowsJobActive = options.isWindowsJobActive ?? (async (jobName) => {
      const active = await WindowsJobObject.activeProcessCount(jobName);
      return active !== null && active > 0;
    });
    this.moveToTrash = options.moveToTrash ?? moveToSystemTrash;
  }

  async execute(opts: ExternalSubagentDelegateOptions): Promise<SubagentResultContract> {
    const startedAt = Date.now();
    const config = this.agents.get(opts.agentId);
    const delegateId = 'external_' + crypto.randomBytes(8).toString('hex');
    const childAgentId = 'external_agent_' + (config?.id ?? opts.agentId);
    const childSessionId = 'session_' + delegateId;
    const bus = this.options.bus;
    const stream = { turnId: delegateId, step: 0, requestId: delegateId };
    let result: SubagentResultContract = { output: '', stopReason: 'error' };
    let lease: WorkspaceLease | undefined;
    let workspace = path.resolve(opts.parentWorkspaceRoot);
    let streamText = '';
    let streamCarry = '';
    let streamBytes = 0;
    let eventTail: Promise<void> = Promise.resolve();
    let streamStarted = false;
    const toolCallParts = new Map<string, { id: string; name: string; arguments: string }>();
    const toolCalls: ChatToolCall[] = [];
    const usage: ChatUsage = { inputTokens: 0, outputTokens: 0 };

    const emitChunk = (chunk: StreamChunk): void => {
      if (chunk.type === 'text_delta') {
        const remaining = MAX_STREAM_BYTES - streamBytes;
        const text = chunk.text.slice(0, Math.max(0, remaining));
        if (!text) return;
        streamBytes += text.length;
        streamText += text;
        chunk = { ...chunk, text };
      } else if (chunk.type === 'reasoning_delta') {
        const remaining = MAX_STREAM_BYTES - streamBytes;
        const text = chunk.text.slice(0, Math.max(0, remaining));
        if (!text) return;
        streamBytes += text.length;
        chunk = { ...chunk, text };
      } else if (chunk.type === 'usage') {
        if (chunk.inputTokens !== undefined) usage.inputTokens = chunk.inputTokens;
        if (chunk.outputTokens !== undefined) usage.outputTokens = chunk.outputTokens;
        if (chunk.costEstimate !== undefined) usage.costEstimate = chunk.costEstimate;
        if (chunk.cacheReadTokens !== undefined) usage.cacheReadTokens = chunk.cacheReadTokens;
        if (chunk.cacheCreationTokens !== undefined) usage.cacheCreationTokens = chunk.cacheCreationTokens;
        return;
      } else if (chunk.type === 'message_start' || chunk.type === 'message_end') {
        return;
      } else if (chunk.type === 'tool_call_start') {
        toolCallParts.set(chunk.id, { id: chunk.id, name: chunk.name, arguments: chunk.arguments });
      } else if (chunk.type === 'tool_call_delta') {
        const part = toolCallParts.get(chunk.id);
        if (part) part.arguments += chunk.argumentsDelta;
      } else if (chunk.type === 'tool_call_end') {
        const part = toolCallParts.get(chunk.id);
        if (part) {
          let args: Record<string, unknown> = {};
          try {
            const parsed: unknown = JSON.parse(part.arguments || '{}');
            if (isRecord(parsed)) args = parsed;
          } catch { /* malformed arguments stay bounded and become an empty object */ }
          toolCalls.push({ id: part.id, name: part.name, arguments: args });
          toolCallParts.delete(chunk.id);
        }
      }
      if (bus) eventTail = eventTail.then(() => bus.emit('model_stream_delta', { ...stream, chunk }));
    };

    if (bus) {
      await bus.emit('subagent_start', {
        delegateId,
        childAgentId,
        childSessionId,
        preset: config?.id,
        isContinuable: false,
      });
      await bus.emit('model_stream_start', { ...stream, model: 'external:' + (config?.id ?? opts.agentId) });
      streamStarted = true;
    }

    const emitDelta = (text: string): void => {
      if (!text || streamBytes >= MAX_STREAM_BYTES) return;
      emitChunk({ type: 'text_delta', text });
    };
    const processStreamLine = (line: string): void => {
      const chunks = decodeExternalStreamLine(line);
      if (chunks === null) emitDelta(line + '\n');
      else for (const chunk of chunks) emitChunk(chunk);
    };
    const onEvent = (event: CliInteractionEvent): void => {
      if (event.kind !== 'stdout_chunk' || !event.data || streamBytes >= MAX_STREAM_BYTES) return;
      streamCarry += event.data;
      const lines = streamCarry.split(/\r?\n/u);
      streamCarry = lines.pop() ?? '';
      for (const line of lines) processStreamLine(line);
    };

    try {
      if (!config) throw new Error('unknown external agent: ' + opts.agentId);
      if (!config.command.trim()) throw new Error('external agent command is empty');
      if (!opts.prompt.trim()) throw new Error('external agent prompt is empty');

      const isolate = config.isolateWorkspace !== false;
      const profile = opts.policyProfile ?? 'workspace-write';
      if (!isolate) {
        throw new Error(`${profile} external agents require an isolated worktree; direct parent-workspace execution is disabled`);
      }
      if (isolate) {
        lease = await this.acquireWorkspace(path.resolve(opts.parentWorkspaceRoot), config.id);
        workspace = lease.worktreePath;
        lease.handle = await this.ensureWorktree(lease, path.resolve(opts.parentWorkspaceRoot));
      }

      const args = renderArgs(config, opts.prompt, workspace);
      const proxyResult = await spawnWithVirtualProxy({
        command: config.command,
        args,
        cwd: workspace,
        env: config.env,
        timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: opts.signal,
        nonInteractiveArgs: config.nonInteractiveArgs,
        autoApproveRules: profile === 'workspace-write'
          ? { allowPaths: [workspace], deniedCommands: config.deniedCommands ?? [] }
          : { allowPaths: [], deniedCommands: config.deniedCommands ?? [] },
        onSpawn: (pid, processGroupId) => {
          if (lease) {
            lease.record.agentPid = pid;
            if (processGroupId) lease.record.agentProcessGroupId = processGroupId;
            writeLease(lease);
          }
        },
        onJobAttached: (jobName) => {
          if (!lease) return;
          lease.record.agentJobName = jobName;
          writeLease(lease);
        },
        onEvent,
      }, this.options.proxyDependencies);

      if (streamCarry) processStreamLine(streamCarry);
      streamCarry = '';
      for (const part of toolCallParts.values()) {
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(part.arguments || '{}');
          if (isRecord(parsed)) args = parsed;
        } catch { /* malformed arguments stay bounded and become an empty object */ }
        toolCalls.push({ id: part.id, name: part.name, arguments: args });
      }
      toolCallParts.clear();
      await eventTail;

      if (opts.signal?.aborted) {
        result = { output: proxyResult.stdout.slice(-MAX_RESULT_BYTES), stopReason: 'aborted', diagnostic: 'external subagent was cancelled' };
      } else if (proxyResult.killedByTimeout) {
        result = { output: proxyResult.stdout.slice(-MAX_RESULT_BYTES), stopReason: 'error', diagnostic: 'external subagent timed out' };
      } else if (proxyResult.deniedPromptsCount > 0) {
        result = { output: proxyResult.stdout.slice(-MAX_RESULT_BYTES), stopReason: 'denied', diagnostic: 'virtual proxy denied ' + proxyResult.deniedPromptsCount + ' interactive request(s)' };
      } else if (proxyResult.exitCode !== 0) {
        result = {
          output: proxyResult.stdout.slice(-MAX_RESULT_BYTES),
          stopReason: 'error',
          diagnostic: ('external CLI exited with code ' + String(proxyResult.exitCode) + (proxyResult.stderr ? ': ' + proxyResult.stderr : '')).slice(0, MAX_RESULT_BYTES),
        };
      } else {
        const structured: Record<string, unknown> = {};
        if (lease) {
          const diff = await this.collectDiff(lease);
          if (diff) {
            structured.diff = diff.slice(0, MAX_DIFF_BYTES);
            structured.diffTruncated = diff.length > MAX_DIFF_BYTES;
            structured.changedFiles = (diff.match(/^diff --git /gmu) ?? []).length;
          }
        }
        result = {
          output: proxyResult.stdout.slice(-MAX_RESULT_BYTES),
          stopReason: 'completed',
          ...(Object.keys(structured).length ? { structured } : {}),
        };
      }
    } catch (error) {
      result = {
        output: streamText.slice(-MAX_RESULT_BYTES),
        stopReason: opts.signal?.aborted ? 'aborted' : 'error',
        diagnostic: (error instanceof Error ? error.message : String(error)).slice(0, MAX_RESULT_BYTES),
      };
    }

    if (lease) {
      try {
        await this.disposeWorkspace(lease);
      } catch (error) {
        result = {
          output: result.output,
          stopReason: 'error',
          diagnostic: 'external worktree cleanup failed: ' + (error instanceof Error ? error.message : String(error)),
          ...(result.structured ? { structured: result.structured } : {}),
        };
        // Keep the ownership record for a later PID-checked recovery attempt.
        lease.record.ownerPid = null;
        try { writeLease(lease); } catch { /* preserve the original cleanup error */ }
      }
    }

    if (bus) {
      await eventTail;
      if (streamStarted) {
        await bus.emit('model_stream_end', {
          ...stream,
          finishReason: result.stopReason === 'completed' ? 'stop' : 'error',
          text: streamText.slice(-MAX_STREAM_BYTES),
          toolCalls,
          usage,
        });
      }
      const durationMs = Date.now() - startedAt;
      await bus.emit('subagent_stop', {
        delegateId,
        childAgentId,
        childSessionId,
        result,
        isError: result.stopReason !== 'completed',
        durationMs,
        delegationDepth: 1,
      });
      await bus.serial('after_delegate', {
        delegateId,
        result,
        followUp: { continuable: false, canSendMessage: false },
      });
    }
    return result;
  }

  private async acquireWorkspace(repoRoot: string, agentId: string): Promise<WorkspaceLease> {
    if (!fs.existsSync(path.join(repoRoot, '.git'))) throw new Error('workspace is not a Git repository: ' + repoRoot);
    const key = crypto.createHash('sha256').update(repoRoot + '\0' + agentId).digest('hex').slice(0, 16);
    const directory = path.join(this.tempRoot, 'vessel-ext-' + key);
    const worktreePath = path.join(directory, 'wt');
    fs.mkdirSync(directory, { recursive: true });
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('external worktree lease directory cannot be a symlink');

    const identityPath = path.join(directory, 'identity.json');
    const identity = JSON.stringify({ version: LEASE_VERSION, repoRoot, agentId });
    if (fs.existsSync(identityPath)) {
      if (!fs.lstatSync(identityPath).isFile() || fs.readFileSync(identityPath, 'utf8') !== identity) {
        throw new Error('external worktree lease identity mismatch');
      }
    } else {
      const entries = fs.readdirSync(directory);
      if (entries.length > 0) throw new Error('refusing to adopt an unmarked external worktree directory');
      fs.writeFileSync(identityPath, identity, { flag: 'wx' });
    }

    const lease: WorkspaceLease = {
      directory,
      worktreePath,
      leasePath: path.join(directory, 'lease.json'),
      record: { version: LEASE_VERSION, repoRoot, agentId, ownerPid: process.pid },
    };
    try {
      writeNewLease(lease);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await this.recoverWorkspace(lease);
    }
    return lease;
  }

  private async recoverWorkspace(lease: WorkspaceLease): Promise<void> {
    const recoveryPath = path.join(lease.directory, 'recovery.lock');
    const fd = await acquireRecoveryLock(recoveryPath, this.isPidAlive, this.moveToTrash);
    try {
      const previous = readLease(lease);
      if (previous.repoRoot !== lease.record.repoRoot || previous.agentId !== lease.record.agentId) {
        throw new Error('stale external worktree lease identity mismatch');
      }
      const pids = [previous.ownerPid, previous.agentPid, previous.gitPid].filter(isPositivePid);
      if (pids.some((pid) => this.isPidAlive(pid))) throw new Error('external worktree lease still has a live process');
      if (process.platform === 'win32' && previous.agentPid) {
        if (!previous.agentJobName) throw new Error('external worktree lease lacks a Windows process-tree proof');
        if (await this.isWindowsJobActive(previous.agentJobName)) throw new Error('external agent Job Object still has live processes');
      } else if (previous.agentPid) {
        if (!previous.agentProcessGroupId) throw new Error('external worktree lease lacks a process-group proof');
        if (this.isProcessGroupAlive(previous.agentProcessGroupId)) throw new Error('external agent process group still has live processes');
      }
      lease.record.agentPid = previous.agentPid;
      lease.record.agentProcessGroupId = previous.agentProcessGroupId;
      lease.record.agentJobName = previous.agentJobName;
      lease.record.gitPid = previous.gitPid;
      writeLease(lease);
      if (fs.existsSync(lease.worktreePath)) await this.repairIndexLock(lease);
    } finally {
      fs.closeSync(fd);
      if (fs.existsSync(recoveryPath)) await this.moveToTrash(recoveryPath);
    }
  }

  private gitRunner(lease: WorkspaceLease): GitRunner {
    return (args, opts) => this.runGit(args, opts.cwd, lease);
  }

  private async runGit(args: string[], cwd: string, lease?: WorkspaceLease): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (this.options.gitRunner) return this.options.gitRunner(args, { cwd });
    return runTrackedGit(args, cwd, (pid) => {
      if (!lease) return;
      lease.record.gitPid = pid;
      writeLease(lease);
    });
  }

  private async ensureWorktree(lease: WorkspaceLease, repoRoot: string): Promise<WorktreeHandle> {
    const listed = await this.runGit(['worktree', 'list', '--porcelain'], repoRoot, lease);
    if (listed.exitCode !== 0) throw gitError('worktree list', listed);
    const registered = listed.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => path.resolve(line.slice('worktree '.length).trim()));
    const found = registered.some((candidate) => samePath(candidate, lease.worktreePath));

    if (found && fs.existsSync(lease.worktreePath)) {
      verifyManagedWorktree(lease, this.tempRoot);
      lease.adminPath = await this.findWorktreeAdminPath(repoRoot, lease.worktreePath);
      await this.repairIndexLock(lease);
      const reset = await this.runGit(['reset', '--hard', 'HEAD'], lease.worktreePath, lease);
      if (reset.exitCode !== 0) throw gitError('worktree reset', reset);
      const clean = await this.runGit(['clean', '-fdx'], lease.worktreePath, lease);
      if (clean.exitCode !== 0) throw gitError('worktree clean', clean);
      return { repoRoot, path: lease.worktreePath };
    }
    if (fs.existsSync(lease.worktreePath)) throw new Error('unregistered files exist at the managed worktree path');
    if (found) {
      const staleAdminPath = await this.findWorktreeAdminPath(repoRoot, lease.worktreePath);
      await this.moveToTrash(staleAdminPath);
    }
    const handle = await createWorktree(repoRoot, {
      path: lease.worktreePath,
      baseDir: lease.directory,
      detached: true,
      run: this.gitRunner(lease),
    });
    verifyManagedWorktree(lease, this.tempRoot);
    lease.adminPath = await this.findWorktreeAdminPath(repoRoot, lease.worktreePath);
    return handle;
  }

  private async findWorktreeAdminPath(repoRoot: string, worktreePath: string): Promise<string> {
    const common = await this.runGit(['rev-parse', '--git-common-dir'], repoRoot);
    if (common.exitCode !== 0 || !common.stdout.trim()) throw gitError('common directory lookup', common);
    const commonDirectory = path.resolve(repoRoot, common.stdout.trim());
    const adminRoot = path.join(commonDirectory, 'worktrees');
    const expectedGitFile = path.join(path.resolve(worktreePath), '.git');
    if (fs.existsSync(expectedGitFile)) {
      const pointerStat = fs.lstatSync(expectedGitFile);
      if (pointerStat.isSymbolicLink() || !pointerStat.isFile()) throw new Error('managed worktree .git pointer must be a regular file');
      const pointer = fs.readFileSync(expectedGitFile, 'utf8').match(/^gitdir:\s*(.+)\s*$/imu);
      if (!pointer) throw new Error('managed worktree .git pointer is invalid');
      const adminPath = path.resolve(path.dirname(expectedGitFile), pointer[1]!);
      assertPathInside(adminRoot, adminPath, 'worktree Git metadata');
      if (fs.lstatSync(adminPath).isSymbolicLink() || !fs.statSync(adminPath).isDirectory()) throw new Error('worktree Git metadata directory is unsafe');
      return fs.realpathSync.native(adminPath);
    }

    if (!fs.existsSync(adminRoot)) throw new Error('registered worktree Git metadata directory is missing');
    const matches: string[] = [];
    for (const entry of fs.readdirSync(adminRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const candidate = path.join(adminRoot, entry.name);
      const gitdirFile = path.join(candidate, 'gitdir');
      if (!fs.existsSync(gitdirFile) || fs.lstatSync(gitdirFile).isSymbolicLink() || !fs.lstatSync(gitdirFile).isFile()) continue;
      const recorded = fs.readFileSync(gitdirFile, 'utf8').trim();
      if (samePath(path.resolve(path.dirname(gitdirFile), recorded), expectedGitFile)) matches.push(candidate);
    }
    if (matches.length !== 1) throw new Error('could not uniquely identify registered worktree Git metadata');
    const adminPath = matches[0]!;
    assertPathInside(adminRoot, adminPath, 'worktree Git metadata');
    return fs.realpathSync.native(adminPath);
  }

  private async repairIndexLock(lease: WorkspaceLease): Promise<void> {
    verifyManagedWorktree(lease, this.tempRoot);
    const found = await this.runGit(['rev-parse', '--git-path', 'index.lock'], lease.worktreePath, lease);
    if (found.exitCode !== 0) throw gitError('index lock path lookup', found);
    const rawPath = found.stdout.trim();
    if (!rawPath) throw new Error('Git returned an empty index.lock path');
    const lockPath = path.resolve(lease.worktreePath, rawPath);
    const common = await this.runGit(['rev-parse', '--git-common-dir'], lease.worktreePath, lease);
    if (common.exitCode !== 0 || !common.stdout.trim()) throw gitError('common directory lookup', common);
    const commonDirectory = path.resolve(lease.worktreePath, common.stdout.trim());
    const lockRelative = path.relative(commonDirectory, lockPath);
    if (lockRelative === '..' || lockRelative.startsWith('..' + path.sep) || path.isAbsolute(lockRelative)) {
      throw new Error('refusing to inspect an index.lock outside this repository metadata');
    }
    if (!fs.existsSync(lockPath)) return;
    const lockStat = fs.lstatSync(lockPath);
    if (!lockStat.isFile() || lockStat.isSymbolicLink()) throw new Error('refusing to recover a non-regular index.lock');
    await this.assertRecordedAgentTreeStopped(lease.record);
    if (!isPositivePid(lease.record.agentPid) && !isPositivePid(lease.record.gitPid)) {
      throw new Error('index.lock exists but has no recorded process-tree owner');
    }

    // Claim the exact lock inode with an atomic same-directory rename. A lock
    // created after the claim remains at index.lock and is never unlinked.
    const claimPath = path.join(path.dirname(lockPath), 'index.lock.vessel-stale-' + crypto.randomBytes(8).toString('hex'));
    fs.renameSync(lockPath, claimPath);
    try {
      const claimed = fs.lstatSync(claimPath);
      if (!sameFileIdentity(lockStat, claimed)) throw new Error('index.lock identity changed during stale-lock claim');
      await this.assertRecordedAgentTreeStopped(lease.record);
      if (fs.existsSync(lockPath)) throw new Error('index.lock was replaced during stale-lock recovery');
      await this.moveToTrash(claimPath);
    } catch (error) {
      if (fs.existsSync(claimPath)) {
        try { await this.moveToTrash(claimPath); } catch { /* preserve the original recovery failure */ }
      }
      throw error;
    }
  }

  private async assertRecordedAgentTreeStopped(record: LeaseRecord): Promise<void> {
    if (isPositivePid(record.agentPid) && this.isPidAlive(record.agentPid)) throw new Error('external CLI root process is still alive');
    if (isPositivePid(record.gitPid) && this.isPidAlive(record.gitPid)) throw new Error('external Git process is still alive');
    if (!isPositivePid(record.agentPid)) return;
    if (process.platform === 'win32') {
      if (!record.agentJobName) throw new Error('external worktree lease lacks a Windows process-tree proof');
      if (await this.isWindowsJobActive(record.agentJobName)) throw new Error('external agent Job Object still has live processes');
      return;
    }
    if (!isPositivePid(record.agentProcessGroupId)) throw new Error('external worktree lease lacks a process-group proof');
    if (this.isProcessGroupAlive(record.agentProcessGroupId)) throw new Error('external agent process group still has live processes');
  }

  private async collectDiff(lease: WorkspaceLease): Promise<string> {
    verifyManagedWorktree(lease, this.tempRoot);
    await this.repairIndexLock(lease);
    let added = await this.runGit(['add', '-A'], lease.worktreePath, lease);
    if (added.exitCode !== 0) {
      await this.repairIndexLock(lease);
      added = await this.runGit(['add', '-A'], lease.worktreePath, lease);
    }
    if (added.exitCode !== 0) throw gitError('stage worktree changes', added);
    const diff = await this.runGit(['diff', '--cached', '--binary', '--no-ext-diff', 'HEAD'], lease.worktreePath, lease);
    if (diff.exitCode !== 0) throw gitError('collect worktree diff', diff);
    return diff.stdout;
  }

  private async disposeWorkspace(lease: WorkspaceLease): Promise<void> {
    assertManagedLeaseDirectory(lease, this.tempRoot);
    if (fs.existsSync(lease.worktreePath)) {
      verifyManagedWorktree(lease, this.tempRoot);
      await this.repairIndexLock(lease);
      lease.adminPath ??= await this.findWorktreeAdminPath(lease.record.repoRoot, lease.worktreePath);
      await this.moveToTrash(lease.worktreePath);
    } else if (!lease.adminPath && await this.isWorktreeRegistered(lease.record.repoRoot, lease.worktreePath)) {
      lease.adminPath = await this.findWorktreeAdminPath(lease.record.repoRoot, lease.worktreePath);
    }
    if (lease.adminPath && fs.existsSync(lease.adminPath)) {
      assertPathInside(await this.gitWorktreesRoot(lease.record.repoRoot), lease.adminPath, 'worktree Git metadata');
      if (fs.lstatSync(lease.adminPath).isSymbolicLink()) throw new Error('refusing to recycle symlinked worktree Git metadata');
      await this.moveToTrash(lease.adminPath);
    }
    await this.moveToTrash(lease.directory);
  }

  private async isWorktreeRegistered(repoRoot: string, worktreePath: string): Promise<boolean> {
    const listed = await this.runGit(['worktree', 'list', '--porcelain'], repoRoot);
    if (listed.exitCode !== 0) throw gitError('worktree list', listed);
    return listed.stdout.split(/\r?\n/u)
      .filter((line) => line.startsWith('worktree '))
      .some((line) => samePath(path.resolve(line.slice('worktree '.length).trim()), worktreePath));
  }

  private async gitWorktreesRoot(repoRoot: string): Promise<string> {
    const common = await this.runGit(['rev-parse', '--git-common-dir'], repoRoot);
    if (common.exitCode !== 0 || !common.stdout.trim()) throw gitError('common directory lookup', common);
    return path.join(path.resolve(repoRoot, common.stdout.trim()), 'worktrees');
  }
}

/** Convenience one-shot entry point matching the task-card contract. */
export async function executeExternalSubagent(
  opts: ExternalSubagentDelegateOptions & { agentConfig: ExternalAgentConfig; bus?: EventBus },
): Promise<SubagentResultContract> {
  const runtime = new ExternalAgentRuntime({ agents: [opts.agentConfig], bus: opts.bus });
  return runtime.execute({
    agentId: opts.agentConfig.id,
    prompt: opts.prompt,
    parentWorkspaceRoot: opts.parentWorkspaceRoot,
    timeoutMs: opts.timeoutMs,
    policyProfile: opts.policyProfile,
    signal: opts.signal,
  });
}

function renderArgs(config: ExternalAgentConfig, prompt: string, workspace: string): string[] {
  const promptToken = '{prompt}';
  const args = config.argsTemplate.map((arg) => arg
    .replace(/\{\{(prompt|workspace|agent_id)\}\}|\{(prompt|workspace|agent_id)\}/gu, (_match, doubled: string | undefined, single: string | undefined) => {
      const name = doubled ?? single;
      return name === 'prompt' ? prompt : name === 'workspace' ? workspace : config.id;
    }));
  if (!config.argsTemplate.some((arg) => arg.includes(promptToken) || arg.includes('{{prompt}}'))) args.push(prompt);
  return args;
}

function assertTempRoot(candidate: string): string {
  const systemTemp = fs.realpathSync.native(tmpdir());
  const resolved = path.resolve(candidate);
  assertPathInside(systemTemp, resolved, 'external worktree temp root');
  fs.mkdirSync(resolved, { recursive: true });
  if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error('external worktree temp root cannot be a symlink');
  const canonical = fs.realpathSync.native(resolved);
  if (!isPathInside(systemTemp, canonical)) {
    throw new Error('external worktree temp root must remain under os.tmpdir()');
  }
  return canonical;
}

function assertManagedLeaseDirectory(lease: WorkspaceLease, tempRoot: string): void {
  if (!fs.existsSync(lease.directory)) throw new Error('external worktree lease directory is missing');
  const stat = fs.lstatSync(lease.directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('external worktree lease directory is not a regular directory');
  const canonical = fs.realpathSync.native(lease.directory);
  assertPathInside(tempRoot, canonical, 'external worktree lease directory');
  if (!samePath(canonical, lease.directory)) throw new Error('external worktree lease directory canonical path changed');
}

function verifyManagedWorktree(lease: WorkspaceLease, tempRoot: string): void {
  assertManagedLeaseDirectory(lease, tempRoot);
  if (!fs.existsSync(lease.worktreePath)) throw new Error('managed external worktree is missing');
  const stat = fs.lstatSync(lease.worktreePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('managed external worktree cannot be a symlink or reparse point');
  const canonicalLease = fs.realpathSync.native(lease.directory);
  const canonicalWorktree = fs.realpathSync.native(lease.worktreePath);
  const expected = path.join(canonicalLease, 'wt');
  if (!samePath(canonicalWorktree, expected) || !isPathInside(tempRoot, canonicalWorktree)) {
    throw new Error('managed external worktree canonical path escaped its lease directory');
  }
  const gitPointer = path.join(canonicalWorktree, '.git');
  const gitStat = fs.lstatSync(gitPointer);
  if (!gitStat.isFile() || gitStat.isSymbolicLink()) throw new Error('managed external worktree must use a regular .git pointer file');
}

function assertPathInside(root: string, target: string, label: string): void {
  if (!isPathInside(root, target)) throw new Error(`${label} escaped its managed root`);
}

function isPathInside(root: string, target: string): boolean {
  const canonical = (candidate: string): string => {
    try { return fs.realpathSync.native(candidate); }
    catch { return path.resolve(candidate); }
  };
  const relative = path.relative(canonical(root), canonical(target));
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino !== 0 && left.ino === right.ino;
}

function processGroupIsAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function moveToSystemTrash(targetPath: string): Promise<void> {
  const target = path.resolve(targetPath);
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error('refusing to recycle a symlinked managed path');
  if (process.platform === 'win32') {
    const quoted = `'${target.replace(/'/gu, "''")}'`;
    const operation = stat.isDirectory() ? 'DeleteDirectory' : 'DeleteFile';
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${operation}(${quoted}, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)`;
    await runExecutable('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script]);
    return;
  }
  if (process.platform === 'darwin') {
    const appleLiteral = JSON.stringify(target).replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
    await runExecutable('osascript', ['-e', `tell application "Finder" to delete POSIX file ${appleLiteral}`]);
    return;
  }
  try {
    await runExecutable('gio', ['trash', '--', target]);
  } catch (error) {
    if (process.platform !== 'linux' || !moveToXdgTrash(target, stat.dev)) throw error;
  }
}

function moveToXdgTrash(target: string, sourceDevice: number): boolean {
  const home = process.env.HOME;
  const dataHome = process.env.XDG_DATA_HOME?.startsWith(path.sep)
    ? process.env.XDG_DATA_HOME
    : home ? path.join(home, '.local', 'share') : undefined;
  if (!dataHome) return false;
  const trashRoot = path.join(dataHome, 'Trash');
  const filesRoot = path.join(trashRoot, 'files');
  const infoRoot = path.join(trashRoot, 'info');
  fs.mkdirSync(filesRoot, { recursive: true, mode: 0o700 });
  fs.mkdirSync(infoRoot, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(trashRoot).isSymbolicLink() || fs.lstatSync(filesRoot).isSymbolicLink() || fs.lstatSync(infoRoot).isSymbolicLink()) {
    throw new Error('XDG Trash directories cannot be symlinks');
  }
  if (fs.statSync(filesRoot).dev !== sourceDevice) return false;
  const stamp = crypto.randomUUID();
  const name = path.basename(target) + '.' + stamp;
  const destination = path.join(filesRoot, name);
  fs.renameSync(target, destination);
  const encodedPath = encodeURI(target).replace(/#/gu, '%23').replace(/\?/gu, '%3F');
  const deletionDate = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
  fs.writeFileSync(path.join(infoRoot, name + '.trashinfo'), `[Trash Info]\nPath=${encodedPath}\nDeletionDate=${deletionDate}\n`, { flag: 'wx', mode: 0o600 });
  return true;
}

function runExecutable(command: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

function writeNewLease(lease: WorkspaceLease): void {
  const fd = fs.openSync(lease.leasePath, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(lease.record), 'utf8'); }
  finally { fs.closeSync(fd); }
}

function writeLease(lease: WorkspaceLease): void {
  fs.writeFileSync(lease.leasePath, JSON.stringify(lease.record), 'utf8');
}

async function acquireRecoveryLock(
  lockPath: string,
  isPidAlive: (pid: number) => boolean,
  moveToTrash: (path: string) => Promise<void>,
): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, String(process.pid), 'utf8');
      return fd;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      let recordedPid: number;
      let before: fs.Stats;
      try {
        const text = fs.readFileSync(lockPath, 'utf8').trim();
        recordedPid = Number(text);
        before = fs.lstatSync(lockPath);
      } catch {
        throw new Error('external worktree recovery lock cannot be read safely');
      }
      if (!isPositivePid(recordedPid) || isPidAlive(recordedPid)) {
        throw new Error('external worktree is already leased or being recovered');
      }
      const claim = lockPath + '.stale-' + crypto.randomBytes(8).toString('hex');
      try { fs.renameSync(lockPath, claim); }
      catch (claimError) {
        if ((claimError as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw claimError;
      }
      const after = fs.lstatSync(claim);
      const claimedPid = Number(fs.readFileSync(claim, 'utf8').trim());
      if (!sameFileIdentity(before, after) || claimedPid !== recordedPid || isPidAlive(claimedPid)) {
        if (!fs.existsSync(lockPath)) fs.renameSync(claim, lockPath);
        else await moveToTrash(claim);
        throw new Error('recovery lock changed while claiming its stale owner');
      }
      try { await moveToTrash(claim); }
      catch (trashError) {
        if (!fs.existsSync(lockPath)) fs.renameSync(claim, lockPath);
        throw trashError;
      }
    }
  }
  throw new Error('external worktree recovery lock could not be acquired');
}

function readLease(lease: WorkspaceLease): LeaseRecord {
  if (!fs.lstatSync(lease.leasePath).isFile()) throw new Error('external worktree lease is not a regular file');
  const value = JSON.parse(fs.readFileSync(lease.leasePath, 'utf8')) as Partial<LeaseRecord>;
  if (value.version !== LEASE_VERSION || typeof value.repoRoot !== 'string' || typeof value.agentId !== 'string') {
    throw new Error('external worktree lease metadata is invalid');
  }
  return {
    version: value.version,
    repoRoot: value.repoRoot,
    agentId: value.agentId,
    ownerPid: isPositivePid(value.ownerPid) ? value.ownerPid : null,
    ...(isPositivePid(value.agentPid) ? { agentPid: value.agentPid } : {}),
    ...(isPositivePid(value.agentProcessGroupId) ? { agentProcessGroupId: value.agentProcessGroupId } : {}),
    ...(typeof value.agentJobName === 'string' && value.agentJobName.length > 0 ? { agentJobName: value.agentJobName } : {}),
    ...(isPositivePid(value.gitPid) ? { gitPid: value.gitPid } : {}),
  };
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function isPositivePid(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function samePath(left: string, right: string): boolean {
  const canonical = (value: string): string => {
    const resolved = path.resolve(value);
    try { return fs.realpathSync.native(resolved); }
    catch { return resolved; }
  };
  const a = canonical(left);
  const b = canonical(right);
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}

function gitError(operation: string, result: { stdout: string; stderr: string; exitCode: number }): Error {
  return new Error('git ' + operation + ' failed (exit ' + result.exitCode + '): ' + (result.stderr || result.stdout).slice(0, 1000));
}

function runTrackedGit(
  args: string[],
  cwd: string,
  onSpawn?: (pid: number) => void,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
      delete env[name];
    }
    const child = spawn('git', args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.once('spawn', () => {
      if (child.pid) onSpawn?.(child.pid);
    });
    child.stdout?.on('data', (chunk: Buffer) => { stdout = capTail(stdout, chunk.toString('utf8'), 2 * 1024 * 1024); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = capTail(stderr, chunk.toString('utf8'), 64 * 1024); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

function capTail(current: string, next: string, max: number): string {
  const combined = current + next;
  return combined.length <= max ? combined : combined.slice(-max);
}

function decodeExternalStreamLine(line: string): StreamChunk[] | null {
  let source = line.trim();
  if (source.startsWith('data:')) source = source.slice(5).trim();
  if (!source || source === '[DONE]') return [];
  let value: unknown;
  try { value = JSON.parse(source); }
  catch { return null; }
  const decoded = decodeStreamValue(value);
  return decoded.recognized ? decoded.chunks : null;
}

function decodeStreamValue(value: unknown): { recognized: boolean; chunks: StreamChunk[] } {
  if (Array.isArray(value)) {
    const chunks: StreamChunk[] = [];
    let recognized = false;
    for (const item of value) {
      const decoded = decodeStreamValue(item);
      recognized ||= decoded.recognized;
      chunks.push(...decoded.chunks);
    }
    return { recognized, chunks };
  }
  if (!isRecord(value)) return { recognized: false, chunks: [] };

  const type = typeof value.type === 'string' ? value.type : '';
  if (type === 'text_delta' && typeof value.text === 'string') return { recognized: true, chunks: [{ type: 'text_delta', text: value.text }] };
  if (type === 'reasoning_delta' && typeof value.text === 'string') return { recognized: true, chunks: [{ type: 'reasoning_delta', text: value.text }] };
  if (type === 'tool_call_start' && typeof value.id === 'string' && typeof value.name === 'string') {
    return { recognized: true, chunks: [{ type: 'tool_call_start', id: value.id, name: value.name, arguments: typeof value.arguments === 'string' ? value.arguments : JSON.stringify(value.arguments ?? {}) }] };
  }
  if (type === 'tool_call_delta' && typeof value.id === 'string' && typeof value.argumentsDelta === 'string') {
    return { recognized: true, chunks: [{ type: 'tool_call_delta', id: value.id, argumentsDelta: value.argumentsDelta }] };
  }
  if (type === 'tool_call_end' && typeof value.id === 'string') return { recognized: true, chunks: [{ type: 'tool_call_end', id: value.id }] };
  if (type === 'usage') {
    return {
      recognized: true,
      chunks: [{
        type: 'usage',
        ...(numberField(value, 'inputTokens', 'prompt_tokens') !== undefined ? { inputTokens: numberField(value, 'inputTokens', 'prompt_tokens') } : {}),
        ...(numberField(value, 'outputTokens', 'completion_tokens') !== undefined ? { outputTokens: numberField(value, 'outputTokens', 'completion_tokens') } : {}),
        ...(numberField(value, 'costEstimate', 'cost') !== undefined ? { costEstimate: numberField(value, 'costEstimate', 'cost') } : {}),
        ...(numberField(value, 'cacheReadTokens', 'cache_read_input_tokens') !== undefined ? { cacheReadTokens: numberField(value, 'cacheReadTokens', 'cache_read_input_tokens') } : {}),
        ...(numberField(value, 'cacheCreationTokens', 'cache_creation_input_tokens') !== undefined ? { cacheCreationTokens: numberField(value, 'cacheCreationTokens', 'cache_creation_input_tokens') } : {}),
      }],
    };
  }
  if (type === 'message_end') return { recognized: true, chunks: [{ type: 'message_end', ...(typeof value.finishReason === 'string' ? { finishReason: value.finishReason } : {}) }] };

  // Claude-style JSONL records carry the normalized provider event one level
  // below `event`; OpenAI-compatible JSONL carries it under `choices[].delta`.
  if (type === 'stream_event' && isRecord(value.event)) return decodeStreamValue(value.event);
  if (type === 'content_block_delta' && isRecord(value.delta)) {
    const delta = value.delta;
    if (delta.type === 'text_delta' && typeof delta.text === 'string') return { recognized: true, chunks: [{ type: 'text_delta', text: delta.text }] };
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') return { recognized: true, chunks: [{ type: 'reasoning_delta', text: delta.thinking }] };
  }
  if (type === 'assistant' && isRecord(value.message) && Array.isArray(value.message.content)) {
    const chunks: StreamChunk[] = [];
    for (const part of value.message.content) {
      if (!isRecord(part)) continue;
      if (part.type === 'text' && typeof part.text === 'string') chunks.push({ type: 'text_delta', text: part.text });
      else if (part.type === 'thinking' && typeof part.thinking === 'string') chunks.push({ type: 'reasoning_delta', text: part.thinking });
      else if (part.type === 'tool_use' && typeof part.id === 'string' && typeof part.name === 'string') {
        chunks.push({ type: 'tool_call_start', id: part.id, name: part.name, arguments: JSON.stringify(part.input ?? {}) }, { type: 'tool_call_end', id: part.id });
      }
    }
    return { recognized: true, chunks };
  }
  if (type === 'result' && isRecord(value.usage)) {
    return decodeStreamValue({ type: 'usage', ...value.usage });
  }
  if (Array.isArray(value.choices)) {
    const chunks: StreamChunk[] = [];
    let recognized = false;
    for (const choice of value.choices) {
      if (!isRecord(choice)) continue;
      const delta = isRecord(choice.delta) ? choice.delta : undefined;
      if (delta && typeof delta.content === 'string') { chunks.push({ type: 'text_delta', text: delta.content }); recognized = true; }
      if (delta && typeof delta.reasoning_content === 'string') { chunks.push({ type: 'reasoning_delta', text: delta.reasoning_content }); recognized = true; }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tool of delta.tool_calls) {
          if (!isRecord(tool) || !isRecord(tool.function)) continue;
          const id = typeof tool.id === 'string' ? tool.id : 'tool_' + String(tool.index ?? chunks.length);
          if (typeof tool.function.name === 'string') chunks.push({ type: 'tool_call_start', id, name: tool.function.name, arguments: typeof tool.function.arguments === 'string' ? tool.function.arguments : '' });
          else if (typeof tool.function.arguments === 'string') chunks.push({ type: 'tool_call_delta', id, argumentsDelta: tool.function.arguments });
          recognized = true;
        }
      }
      if (typeof choice.finish_reason === 'string') { chunks.push({ type: 'message_end', finishReason: choice.finish_reason }); recognized = true; }
    }
    if (isRecord(value.usage)) {
      const usage = decodeStreamValue({ type: 'usage', ...value.usage });
      chunks.push(...usage.chunks);
      recognized ||= usage.recognized;
    }
    return { recognized, chunks };
  }
  return { recognized: false, chunks: [] };
}

function numberField(value: Record<string, unknown>, camel: string, snake: string): number | undefined {
  const candidate = value[camel] ?? value[snake];
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0 ? candidate : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
