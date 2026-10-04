import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runCommand, type SpawnOptions, type SpawnResult } from '@vessel/runtime';
import { WindowsRestrictedRunner } from './windowsRestricted.js';
import type { NativeSandboxRunner, SandboxAuditEvent, SandboxExecutionOptions, SandboxExecutionResult } from './types.js';

export interface PlatformSandboxDeps {
  platform?: NodeJS.Platform;
  run?: typeof runCommand;
  windows?: NativeSandboxRunner;
  audit?: (event: SandboxAuditEvent) => void | Promise<void>;
}

export { allowedWriteRoots } from './options.js';
import { allowedWriteRoots, validateSandboxOptions } from './options.js';

export class PlatformSandboxRunner implements NativeSandboxRunner {
  private readonly platform: NodeJS.Platform;
  private readonly run: typeof runCommand;
  private readonly windows: NativeSandboxRunner;
  constructor(private readonly deps: PlatformSandboxDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.run = deps.run ?? runCommand;
    this.windows = deps.windows ?? new WindowsRestrictedRunner({ run: this.run });
  }

  async isAvailable(): Promise<boolean> {
    if (this.platform === 'win32') return this.windows.isAvailable();
    if (this.platform !== 'linux' && this.platform !== 'darwin') return false;
    try {
      const command = this.platform === 'linux' ? '/usr/bin/bwrap' : '/usr/bin/sandbox-exec';
      // Probe the actual namespace/profile, not just executable presence.
      const args = this.platform === 'linux'
        ? ['--die-with-parent', '--unshare-all', '--ro-bind', '/', '/', '--', '/bin/true']
        : ['-p', '(version 1) (allow default)', '/usr/bin/true'];
      return (await this.run(command, args, { cwd: tmpdir(), timeoutMs: 5_000 })).exitCode === 0;
    } catch { return false; }
  }

  async execute(command: string, args: string[], options: SandboxExecutionOptions): Promise<SandboxExecutionResult> {
    validateSandboxOptions(options);
    const roots = allowedWriteRoots(options);
    if (this.platform === 'win32') {
      try {
        const result = await this.windows.execute(command, args, { ...options, allowedWritePaths: roots });
        await this.deps.audit?.({ ...pick(result), outcome: result.sandboxed ? 'enforced' : 'fallback', allowedWritePaths: roots });
        return result;
      } catch (error) {
        await this.deps.audit?.({ isolationTier: 'windows-job-restricted', sandboxed: false, outcome: 'denied', allowedWritePaths: roots, reason: String(error) });
        throw error;
      }
    }
    let executable = command;
    let argv = args;
    let tier: SandboxExecutionResult['isolationTier'] = 'passthrough-fallback';
    if (await this.isAvailable()) {
      if (this.platform === 'linux') {
        executable = '/usr/bin/bwrap';
        argv = ['--die-with-parent', '--unshare-all', '--new-session', '--ro-bind', '/', '/', '--proc', '/proc', '--dev', '/dev', ...roots.flatMap(root => ['--bind', root, root]), '--chdir', realpathSync(options.cwd), '--', command, ...args];
        tier = 'bwrap-ns';
      } else {
        executable = '/usr/bin/sandbox-exec';
        const quote = (value: string) => JSON.stringify(value);
        argv = ['-p', `(version 1) (allow default) (deny file-write*) ${roots.map(root => `(allow file-write* (subpath ${quote(root)}))`).join(' ')}`, command, ...args];
        tier = 'macos-seatbelt';
      }
    }
    if (options.maxMemoryBytes !== undefined) throw new Error('native memory limits require Windows Job Object; POSIX helpers do not enforce them');
    // Execution failure NEVER falls back or replays the command.
    const result = await this.run(executable, argv, { ...spawnOptions(options), processGroup: true });
    const converted = convert(result, tier);
    await this.deps.audit?.({ ...pick(converted), outcome: tier === 'passthrough-fallback' ? 'fallback' : 'enforced', allowedWritePaths: roots, ...(tier === 'passthrough-fallback' ? { reason: 'native-helper-unavailable' } : {}) });
    return converted;
  }
}

export function spawnOptions(options: SandboxExecutionOptions): SpawnOptions {
  return { cwd: options.cwd, timeoutMs: options.cpuTimeoutMs ?? 30_000, signal: options.signal, maxOutputBytes: 1024 * 1024, shell: false };
}

function convert(result: SpawnResult, isolationTier: SandboxExecutionResult['isolationTier']): SandboxExecutionResult {
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 1, isolationTier, sandboxed: isolationTier !== 'passthrough-fallback',
    constraints: { readOnlyPaths: isolationTier === 'passthrough-fallback' ? [] : ['/'], memoryLimitBytes: null,
      privilegeReduction: isolationTier === 'bwrap-ns' ? 'Bubblewrap namespace confinement. Root is read-only except write roots and the virtual /proc and /dev mounts.'
        : isolationTier === 'macos-seatbelt' ? 'Seatbelt denies filesystem writes except configured write roots.' : 'No native privilege reduction.' } };
}
function pick(result: SandboxExecutionResult) { return { isolationTier: result.isolationTier, sandboxed: result.sandboxed, ...(result.constraints ? { constraints: result.constraints } : {}) }; }
