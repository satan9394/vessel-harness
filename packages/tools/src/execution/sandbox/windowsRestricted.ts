import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { win32 } from 'node:path';
import { runCommand } from '@vessel/runtime';
import type { NativeSandboxRunner, SandboxExecutionOptions, SandboxExecutionResult } from './types.js';
import { WINDOWS_RESTRICTED_SOURCE } from './windowsRestrictedSource.js';
import { allowedWriteRoots, validateSandboxOptions } from './options.js';

/** Stable per-worktree SID for explicit out-of-band ACL provisioning; never modifies host ACLs. */
export function restrictedWriteSid(cwd: string): string {
  const hash = createHash('sha256').update(cwd.toLowerCase()).digest();
  return `S-1-5-21-${hash.readUInt32LE(0)}-${hash.readUInt32LE(4)}-${hash.readUInt32LE(8)}-183`;
}

export function buildWindowsRestrictedScript(command: string, args: string[], options: SandboxExecutionOptions): string {
  const config = Buffer.from(JSON.stringify({ command, args, cwd: options.cwd, roots: options.allowedWritePaths ?? [], sid: restrictedWriteSid(options.cwd), maxMemoryBytes: options.maxMemoryBytes ?? 512 * 1024 * 1024, timeoutMs: options.cpuTimeoutMs ?? 30_000 })).toString('base64');
  return `$ErrorActionPreference = 'Stop'\nAdd-Type -TypeDefinition @'\n${WINDOWS_RESTRICTED_SOURCE}\n'@\n$c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config}')) | ConvertFrom-Json\ntry { [VesselRestricted]::Run($c.command, [string[]]$c.args, $c.cwd, [string[]]$c.roots, $c.sid, [UInt64]$c.maxMemoryBytes, [UInt32]$c.timeoutMs) | ConvertTo-Json -Compress } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
}

export class WindowsRestrictedRunner implements NativeSandboxRunner {
  private readonly run: typeof runCommand;
  private readonly powershell = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  constructor(deps: { run?: typeof runCommand } = {}) { this.run = deps.run ?? runCommand; }
  async isAvailable(): Promise<boolean> {
    try { return (await this.run(this.powershell, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { cwd: process.cwd(), timeoutMs: 5_000 })).exitCode === 0; }
    catch { return false; }
  }
  async execute(command: string, args: string[], options: SandboxExecutionOptions): Promise<SandboxExecutionResult> {
    validateSandboxOptions(options);
    if (options.lowIntegrity === false) throw new Error('sandbox Low Integrity cannot be disabled');
    const canonical = { ...options, cwd: realpathSync(options.cwd), allowedWritePaths: allowedWriteRoots(options) };
    const script = buildWindowsRestrictedScript(command, args, canonical);
    const result = await this.run(this.powershell, ['-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding = [Text.Encoding]::UTF8; & ([ScriptBlock]::Create([Console]::In.ReadToEnd()))'], {
      cwd: options.cwd, timeoutMs: (options.cpuTimeoutMs ?? 30_000) + 30_000, signal: options.signal, maxOutputBytes: 1024 * 1024, stdin: script,
    });
    if (result.killed || result.exitCode !== 0) throw new Error(`restricted sandbox denied: ${result.stderr || 'launcher interrupted/failed'}`);
    const value: unknown = JSON.parse(result.stdout);
    if (!value || typeof value !== 'object' || !('Enforced' in value) || value.Enforced !== true || !('Stdout' in value) || typeof value.Stdout !== 'string' || !('Stderr' in value) || typeof value.Stderr !== 'string' || !('ExitCode' in value) || typeof value.ExitCode !== 'number') {
      throw new Error('restricted sandbox missing enforcement acknowledgement');
    }
    const integrityRid = 'ChildIntegrityRid' in value && typeof value.ChildIntegrityRid === 'number' ? value.ChildIntegrityRid : undefined;
    return { stdout: value.Stdout, stderr: value.Stderr, exitCode: value.ExitCode, sandboxed: true, isolationTier: 'windows-job-restricted',
      constraints: { readOnlyPaths: [], memoryLimitBytes: options.maxMemoryBytes ?? 512 * 1024 * 1024,
        privilegeReduction: 'Restricted token, Low Integrity, and Job Object confinement. Reads follow host ACLs; write roots require provisioned restricted SID ACLs.',
        ...(integrityRid === undefined ? {} : { integrityRid }) } };
  }
}
