import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { InteractiveRuntimeAdapter, RuntimeProbeResult, SafeRunInput, SubagentResultContract } from '@vessel/shared';
import type { ExternalAgentConfig, ExternalAgentRuntime } from './ExternalAgentRuntime.js';

export type ProbeCommand = (command: string, args: string[]) => Promise<{ exitCode: number; stdout: string }>;
/** Only invoked by explicit probe/start; never during discovery/import. No shell or user task. */
const runProbe: ProbeCommand = (command, args) => new Promise(resolve => {
  execFile(command, args, { timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => {
    resolve({ exitCode: error ? 1 : 0, stdout });
  });
});

export async function probeExternalRuntime(config: ExternalAgentConfig, command: ProbeCommand = runProbe): Promise<RuntimeProbeResult> {
  const capabilities: RuntimeProbeResult['capabilities'] = { start: 'unknown', events: 'unsupported', steer: 'unsupported', cancel: 'unknown', resume: 'unsupported', approvals: 'unsupported', artifacts: 'unsupported' };
  const result: RuntimeProbeResult = { adapterVersion: '1.0.0', platform: process.platform, transformVersion: 1,
    probedAt: Date.now(), capabilities, evidenceSource: config.interactive?.evidenceSource ?? 'unverified configuration',
    degradedReasons: { events: 'CLI result only; no canonical live event adapter', steer: 'no steering contract', resume: 'no durable resume contract', approvals: 'no interactive approval channel', artifacts: 'no artifact receipts' } };
  let version: Awaited<ReturnType<ProbeCommand>>;
  let help: Awaited<ReturnType<ProbeCommand>>;
  try {
    version = await command(config.command, ['--version']);
    help = await command(config.command, config.interactive?.helpArgs ?? ['--help']);
  } catch { result.degradedReasons!.start = 'probe failed'; return result; }
  const match = version.exitCode === 0 ? /\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/.exec(version.stdout) : null;
  result.installedVersion = match?.[0];
  const flags = [...config.argsTemplate, ...(config.nonInteractiveArgs ?? [])].filter(arg => /^--[\w-]+(?:=|$)/.test(arg)).map(arg => arg.split('=')[0]!);
  const verified = Boolean(match && config.interactive?.evidenceSource && config.interactive.verifiedVersions.includes(match[0]));
  if (!verified || help.exitCode !== 0 || !flags.every(flag => help.stdout.includes(flag))) {
    capabilities.start = match ? 'unsupported' : 'unknown'; capabilities.cancel = 'unsupported';
    result.degradedReasons!.start = !match ? 'installed version unavailable' : !verified ? 'external version has no reviewed adapter evidence' : 'configured CLI flags missing from help';
    result.degradedReasons!.cancel = 'start is unavailable';
    return result;
  }
  capabilities.start = 'supported'; capabilities.cancel = 'supported';
  return result;
}

/** Lifecycle facade over the existing isolated runtime; it owns no agent loop. */
export class ExternalInteractiveAdapter implements InteractiveRuntimeAdapter {
  readonly version = '1.0.0';
  private readonly runs = new Map<string, { controller: AbortController; settled: Promise<SubagentResultContract> }>();
  constructor(readonly id: string, private readonly runtime: Pick<ExternalAgentRuntime, 'execute' | 'probe'>) {}
  probe(): Promise<RuntimeProbeResult> { return this.runtime.probe(this.id); }
  async startRun(input: SafeRunInput): Promise<{ runId: string }> {
    if (input.allowedTools || input.options) throw new Error('external_scope_mapping_unsupported');
    if (!input.task.trim() || !input.workspaceRoot.trim()) throw new Error('invalid_external_run');
    if ((await this.probe()).capabilities.start !== 'supported') throw new Error('external_runtime_degraded');
    const runId = randomUUID(); const controller = new AbortController();
    // Scope mapping is deliberately read-only until versioned tool/policy mapping exists.
    const settled = this.runtime.execute({ agentId: this.id, prompt: input.task, parentWorkspaceRoot: input.workspaceRoot, policyProfile: 'read-only', signal: controller.signal });
    void settled.catch(() => {}); // result()/cancelRun() retain and observe the rejection.
    this.runs.set(runId, { controller, settled });
    return { runId };
  }
  async cancelRun(runId: string): Promise<void> {
    const run = this.runs.get(runId); if (!run) throw new Error('external_run_not_found');
    run.controller.abort();
    await run.settled; // Existing runtime returns only after child/worktree cleanup.
    this.runs.delete(runId);
  }
  async result(runId: string): Promise<SubagentResultContract> {
    const run = this.runs.get(runId); if (!run) throw new Error('external_run_not_found');
    try { return await run.settled; } finally { this.runs.delete(runId); }
  }
}
