import { describe, expect, it, vi } from 'vitest';
import { ExternalInteractiveAdapter, probeExternalRuntime } from './InteractiveAdapter.js';
import type { ExternalAgentConfig } from './ExternalAgentRuntime.js';
import type { RuntimeProbeResult, SubagentResultContract } from '@vessel/shared';

describe('ARCH-04 versioned runtime facade (injected commands; no installed agents launched)', () => {
  it.each(['codex', 'opencode', 'dsh', 'claude-code', 'pi'])('records %s version/platform/source and degrades unknown versions or absent flags', async id => {
    const config: ExternalAgentConfig = { id, command: id, argsTemplate: ['run', '--fixture', '{prompt}'],
      interactive: { verifiedVersions: ['1.2.3'], evidenceSource: 'synthetic protocol fixture v1', helpArgs: ['run', '--help'] } };
    const command = vi.fn(async (_command: string, args: string[]) => ({ exitCode: 0, stdout: args[0] === '--version' ? `${id} 1.2.3` : 'run --fixture value' }));
    const probe = await probeExternalRuntime(config, command);
    expect(probe).toMatchObject({ installedVersion: '1.2.3', adapterVersion: '1.0.0', platform: process.platform, transformVersion: 1, evidenceSource: 'synthetic protocol fixture v1', capabilities: { start: 'supported', cancel: 'supported', resume: 'unsupported', events: 'unsupported' } });
    expect(command.mock.calls.map(call => call[1])).toEqual([['--version'], ['run', '--help']]);
    expect((await probeExternalRuntime({ ...config, interactive: { ...config.interactive!, verifiedVersions: ['9.0.0'] } }, command)).capabilities.start).toBe('unsupported');
    expect((await probeExternalRuntime(config, async () => ({ exitCode: 0, stdout: 'version 1.2.3' }))).capabilities.start).toBe('unsupported');
    expect((await probeExternalRuntime(config, async () => ({ exitCode: 1, stdout: '' }))).installedVersion).toBeUndefined();
    expect((await probeExternalRuntime(config, async () => { throw new Error('missing binary'); })).capabilities.start).toBe('unknown');
  });
  it('awaits the existing runtime cleanup on cancel, rejects scope widening and never exposes unsupported resume', async () => {
    let finish!: (result: SubagentResultContract) => void; let signal!: AbortSignal;
    const probe = { capabilities: { start: 'supported' } } as RuntimeProbeResult;
    const runtime = { probe: vi.fn(async () => probe), execute: vi.fn((input: { signal?: AbortSignal }) => {
      signal = input.signal!; return new Promise<SubagentResultContract>(resolve => { finish = resolve; });
    }) };
    const adapter = new ExternalInteractiveAdapter('fixture', runtime);
    await expect(adapter.startRun({ sessionId: 's', task: 't', workspaceRoot: '/fixture', allowedTools: ['Write'] })).rejects.toThrow('scope_mapping');
    const { runId } = await adapter.startRun({ sessionId: 's', task: 't', workspaceRoot: '/fixture' });
    expect(runtime.execute).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'fixture', policyProfile: 'read-only' }));
    let returned = false; const cancelling = adapter.cancelRun(runId).then(() => { returned = true; });
    expect(signal.aborted).toBe(true); await Promise.resolve(); expect(returned).toBe(false);
    finish({ output: '', stopReason: 'aborted' }); await cancelling; expect(returned).toBe(true);
    expect('resumeRun' in adapter).toBe(false);
    await expect(adapter.result(runId)).rejects.toThrow('not_found');
    runtime.probe.mockResolvedValue({ capabilities: { start: 'unsupported' } } as RuntimeProbeResult);
    await expect(adapter.startRun({ sessionId: 's', task: 't', workspaceRoot: '/fixture' })).rejects.toThrow('degraded');
  });
});
