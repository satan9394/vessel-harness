import * as path from 'node:path';
import { spawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { createJobObject, WindowsJobObject, type JobObjectConfinement } from '../sandbox/backend/windows-job-object.js';

export interface ExternalCliSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  autoApproveRules?: {
    allowPaths?: string[];
    deniedCommands?: string[];
  };
  /** Native headless flags supplied by the selected CLI adapter, appended when absent. */
  nonInteractiveArgs?: string[];
  /** Parent cancellation (Subagent tool / event-bus interruption). */
  signal?: AbortSignal;
  /** Called after the child PID is available so the caller can maintain its lease. */
  onSpawn?: (pid: number, processGroupId?: number) => void;
  /** Called once the Windows Job Object has confirmed confinement. */
  onJobAttached?: (jobName: string) => void;
  onEvent?: (event: CliInteractionEvent) => void;
  maxOutputBytes?: number;
}

export interface CliInteractionEvent {
  kind: 'prompt_detected' | 'stdout_chunk' | 'stderr_chunk' | 'exit';
  data?: string;
  matchedPrompt?: string;
}

export interface VirtualProxyRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  interceptionsCount: number;
  deniedPromptsCount: number;
  killedByTimeout: boolean;
}

export interface VirtualProxyDependencies {
  platform?: NodeJS.Platform;
  spawnProcess?: typeof spawn;
  createJob?: typeof createJobObject;
  enumerateDescendants?: (pid: number) => Promise<number[]>;
  quietWindowMs?: number;
  killWindowsTree?: (pid: number) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_QUIET_WINDOW_MS = 200;
const MAX_PROMPT_BUFFER = 8192;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const PROMPT_PATTERN = /\[\s*[yY]\s*\/\s*[nN]\s*\]|\(\s*[yY]\s*\/\s*[nN]\s*\)|\bpress\s+enter\b/giu;
const YES_NO_PATTERN = /[\[(]\s*[yY]\s*\/\s*[nN]\s*[\])]/u;

/** Spawn a headless CLI with policy-gated prompt replies and whole-tree cleanup. */
export function spawnWithVirtualProxy(
  opts: ExternalCliSpawnOptions,
  deps: VirtualProxyDependencies = {},
): Promise<VirtualProxyRunResult> {
  return new Promise<VirtualProxyRunResult>((resolve, reject) => {
    if (!opts.command.trim()) return reject(new Error('virtual proxy requires a command'));
    if (!opts.cwd.trim()) return reject(new Error('virtual proxy requires a working directory'));
    const platform = deps.platform ?? process.platform;
    const timeoutMs = positiveInt(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
    const quietWindowMs = positiveInt(deps.quietWindowMs, DEFAULT_QUIET_WINDOW_MS);
    const maxOutputBytes = positiveInt(opts.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
    const args = appendNativeArgs(opts.args, opts.nonInteractiveArgs ?? []);
    const spawnProcess = deps.spawnProcess ?? spawn;
    const spawnOptions: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] } = {
      cwd: path.resolve(opts.cwd),
      env: { ...process.env, ...opts.env },
      windowsHide: true,
      detached: platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    let child: ChildProcess;
    try {
      child = spawnProcess(opts.command, args, spawnOptions);
    } catch (error) {
      reject(error);
      return;
    }
    if (child.pid) {
      try { opts.onSpawn?.(child.pid, platform === 'win32' ? undefined : child.pid); } catch { /* lease observers cannot break process control */ }
    }

    let stdout = '';
    let stderr = '';
    let promptBuffer = '';
    let interceptionsCount = 0;
    let deniedPromptsCount = 0;
    let killedByTimeout = false;
    let killRequested = false;
    let killTask: Promise<void> | undefined;
    let closed = false;
    let settled = false;
    let job: JobObjectConfinement | undefined;
    let jobSetup: Promise<void> = Promise.resolve();
    let attachError: Error | undefined;
    let promptTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let lastPromptKey: string | undefined;
    const emit = (event: CliInteractionEvent): void => {
      try { opts.onEvent?.(event); } catch { /* observers cannot break process control */ }
    };

    const killWindowsTree = deps.killWindowsTree ?? defaultKillWindowsTree;
    const terminateTree = async (): Promise<void> => {
      if (platform === 'win32') {
        if (job && job.attached !== false) {
          await job.terminate();
        } else if (child.pid) {
          await killWindowsTree(child.pid);
        } else {
          child.kill('SIGKILL');
        }
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch { child.kill('SIGKILL'); }
      } else {
        child.kill('SIGKILL');
      }
    };
    const requestKill = (timedOut: boolean): void => {
      if (timedOut) killedByTimeout = true;
      if (killRequested || closed) return;
      killRequested = true;
      killTask = terminateTree().catch((error: unknown) => {
        // Direct-child termination is the last-resort fallback; the caller still
        // receives an error if the process refuses to close.
        child.kill('SIGKILL');
        if (!attachError) attachError = error instanceof Error ? error : new Error(String(error));
      });
    };

    const onData = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') stdout = appendCapped(stdout, text, maxOutputBytes);
      else stderr = appendCapped(stderr, text, maxOutputBytes);
      promptBuffer = appendCapped(promptBuffer, text, MAX_PROMPT_BUFFER);
      emit({ kind: stream === 'stdout' ? 'stdout_chunk' : 'stderr_chunk', data: text.slice(0, 4096) });
      schedulePromptCheck();
    };

    function schedulePromptCheck(): void {
      const match = [...promptBuffer.matchAll(PROMPT_PATTERN)].at(-1);
      if (!match || match.index === undefined) return;
      const key = `${match.index}:${match[0]}`;
      if (key === lastPromptKey) return;
      if (promptTimer) clearTimeout(promptTimer);
      const matchedPrompt = match[0];
      const contextStart = Math.max(0, match.index - 512);
      const promptContext = promptBuffer.slice(contextStart, Math.min(promptBuffer.length, match.index + matchedPrompt.length + 512));
      promptTimer = setTimeout(() => {
        lastPromptKey = key;
        const allow = promptIsWhitelisted(promptContext, opts.cwd, opts.autoApproveRules);
        emit({ kind: 'prompt_detected', data: promptContext.slice(-512), matchedPrompt });
        interceptionsCount += 1;
        if (!allow) deniedPromptsCount += 1;
        const reply = matchedPrompt.toLowerCase().includes('enter')
          ? (allow ? '\n' : '\u0003')
          : (allow ? 'y\n' : 'n\n');
        child.stdin?.write(reply);
        if (!allow && !YES_NO_PATTERN.test(matchedPrompt)) requestKill(false);
      }, quietWindowMs);
    }

    const onAbort = (): void => requestKill(false);
    if (opts.signal?.aborted) requestKill(false);
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    if (platform === 'win32' && child.pid) {
      const pid = child.pid;
      jobSetup = (async () => {
        const create = deps.createJob ?? createJobObject;
        const confinement = await create(pid, { maxActiveProcesses: 128 }, 30_000);
        if (closed) {
          if (confinement.attached === false) await killWindowsTree(pid);
          else {
            const descendants = await (deps.enumerateDescendants ?? WindowsJobObject.enumerateDescendants)(pid);
            if (descendants.length > 0) {
              const attached = await confinement.attachDescendants?.(descendants) ?? 0;
              if (attached < descendants.length) throw new Error(`Job Object attached ${attached}/${descendants.length} late descendants`);
            }
            await confinement.terminate();
            await confinement.dispose();
          }
          return;
        }
        if (confinement.attached === false) {
          attachError = new Error(`Windows Job Object did not attach to child process ${pid}`);
          requestKill(false);
          return;
        }
        job = confinement;
        try { opts.onJobAttached?.(confinement.jobName); } catch { /* lease observers cannot break process control */ }
        const descendants = await (deps.enumerateDescendants ?? WindowsJobObject.enumerateDescendants)(pid);
        if (descendants.length > 0) {
          const attached = await confinement.attachDescendants?.(descendants) ?? 0;
          if (attached < descendants.length) {
            throw new Error(`Job Object attached ${attached}/${descendants.length} pre-existing descendants`);
          }
        }
        if (killRequested) await confinement.terminate();
      })().catch(async (error: unknown) => {
        attachError = error instanceof Error ? error : new Error(String(error));
        if (closed && child.pid) {
          try { await killWindowsTree(child.pid); }
          catch { child.kill('SIGKILL'); }
        }
        else requestKill(false);
      });
    }

    timeoutTimer = setTimeout(() => requestKill(true), timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => onData(chunk, 'stdout'));
    child.stderr?.on('data', (chunk: Buffer) => onData(chunk, 'stderr'));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      cleanupTimersAndSignal();
      reject(error);
    });
    child.on('close', (exitCode) => {
      closed = true;
      cleanupTimersAndSignal();
      emit({ kind: 'exit', data: exitCode === null ? 'signal' : String(exitCode) });
      void (async () => {
        try {
          await jobSetup;
          await killTask;
          if (platform !== 'win32' && child.pid) await killAndWaitForProcessGroup(child.pid);
          await job?.dispose();
          if (attachError) throw attachError;
          if (settled) return;
          settled = true;
          resolve({ exitCode, stdout, stderr, interceptionsCount, deniedPromptsCount, killedByTimeout });
        } catch (error) {
          if (settled) return;
          settled = true;
          reject(error);
        }
      })();
    });

    function cleanupTimersAndSignal(): void {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (promptTimer) clearTimeout(promptTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  });
}

function appendNativeArgs(args: string[], additions: string[]): string[] {
  const result = [...args];
  for (const arg of additions) if (arg && !result.includes(arg)) result.push(arg);
  return result;
}

function promptIsWhitelisted(
  prompt: string,
  cwd: string,
  rules: ExternalCliSpawnOptions['autoApproveRules'],
): boolean {
  const normalized = prompt.toLocaleLowerCase();
  if (rules?.deniedCommands?.some((command) => command.trim() && normalized.includes(command.toLocaleLowerCase()))) return false;
  if (!rules?.allowPaths?.length) return false;
  const policyText = prompt.replace(/(?:\[\s*[yY]\s*\/\s*[nN]\s*\]|\(\s*[yY]\s*\/\s*[nN]\s*\))/gu, '');
  const paths = policyText.match(/(?:[A-Za-z]:[\\/]|\/|\.\.?[\\/])[^\s"'`<>?,;]+/gu) ?? [];
  if (paths.length === 0) return false;
  return paths.every((token) => {
    const candidate = path.resolve(cwd, token.replace(/[).]+$/u, ''));
    return rules.allowPaths!.some((allowedPath) => {
      const root = path.resolve(cwd, allowedPath);
      const relative = path.relative(root, candidate);
      return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    });
  });
}

function appendCapped(current: string, next: string, max: number): string {
  const combined = current + next;
  return combined.length <= max ? combined : combined.slice(-max);
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function defaultKillWindowsTree(pid: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let fallbackStarted = false;
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const fallback = (originalError?: Error): void => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      void killEnumeratedWindowsDescendants(pid).then(resolve, (error) => reject(originalError ?? error));
    };
    killer.once('error', (error) => fallback(error));
    killer.once('close', (code) => {
      if (code === 0) resolve();
      else fallback(new Error(`taskkill exited with code ${code}`));
    });
  });
}

async function killEnumeratedWindowsDescendants(pid: number): Promise<void> {
  const descendants = await WindowsJobObject.enumerateDescendants(pid);
  if (descendants.length === 0) return;
  await WindowsJobObject.terminatePids(descendants);
  const remaining = await WindowsJobObject.enumerateDescendants(pid);
  if (remaining.length > 0) throw new Error(`Windows process tree still has ${remaining.length} live descendant(s)`);
}

async function killAndWaitForProcessGroup(processGroupId: number): Promise<void> {
  try { process.kill(-processGroupId, 'SIGKILL'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    throw error;
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try { process.kill(-processGroupId, 0); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`process group ${processGroupId} remained alive after termination`);
}
