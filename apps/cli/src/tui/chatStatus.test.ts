import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventBus } from '@vessel/core';
import { composeHarness, type ComposedHarness } from '@vessel/application';
import { WorkspaceFingerprinter } from '@vessel/tools';
import type { PermissionActionWidget } from '@vessel/shared';
import { ProviderStore } from '../providers/ProviderStore.js';
import { createStdioIO, runChat } from './chat.js';

vi.mock('@vessel/application', async importOriginal => ({ ...await importOriginal<typeof import('@vessel/application')>(), composeHarness: vi.fn() }));
const temporary: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('runChat terminal projections', () => {
  it('ticks elapsed time, restores status after widgets and pauses redraw during selection', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-status-')); temporary.push(root);
    const bus = new EventBus();
    let tick: (() => void) | undefined;
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const timer = setInterval(() => {}, 60000); clearInterval(timer);
    vi.spyOn(globalThis, 'setInterval').mockImplementation(callback => { tick = callback as () => void; return timer; });
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const statusLine = { update: vi.fn(), render: vi.fn(), clear: vi.fn(), dispose: vi.fn() };
    const widget: PermissionActionWidget = { id: 'a', kind: 'permission_action', turnIndex: 0, timestamp: '2026-10-09T00:00:00Z', status: 'pending', payload: { actionType: 'filesystem_write', description: 'Ask', options: [{ id: 'deny', label: 'Deny', tone: 'neutral' }] } };
    vi.mocked(composeHarness).mockResolvedValue({ bus, session: { sessionId: 'clock-test' }, close: vi.fn(), loop: { interrupt: vi.fn(), runTurn: async () => {
      now = 2000; tick!();
      expect(statusLine.update).toHaveBeenCalledWith({ turnElapsedMs: 1000 });
      await bus.emit('ui/widget_block', widget);
      const renders = statusLine.render.mock.calls.length; tick!();
      expect(statusLine.render).toHaveBeenCalledTimes(renders + 1);
      return { kind: 'success', finalText: 'ok', steps: 1, toolCalls: 0 };
    } } } as unknown as ComposedHarness);
    vi.spyOn(WorkspaceFingerprinter, 'compute').mockResolvedValue({ timestamp: 1, trackedFilesHash: 'a'.repeat(64), uncommittedDiffBytes: 0, fileCount: 0 });
    const lines = ['hello', null];
    await runChat({ workspaceRoot: root, store: new ProviderStore({ rootDir: root }), settingsRoot: root, policySystemPath: 'unused', behaviorIRPath: 'unused', io: {
      readLine: async () => lines.shift() ?? null, write: vi.fn(), statusLine,
      writeWidget: () => statusLine.clear(), selectPermission: async () => {
        const renders = statusLine.render.mock.calls.length; tick!();
        expect(statusLine.render).toHaveBeenCalledTimes(renders);
        return 'deny';
      },
    } });
    expect(clear).toHaveBeenCalledWith(timer);
  });
  it('restores stdin raw mode and removes selection and SIGINT listeners after arrows/Enter or cancellation', async () => {
    const descriptors = [
      [process.stdin, 'isTTY'], [process.stdin, 'isRaw'], [process.stdin, 'setRawMode'], [process.stdout, 'isTTY'], [process.stdout, 'columns'],
    ] as const;
    const previous = descriptors.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
    const setRawMode = vi.fn();
    const signalCount = process.listenerCount('SIGINT'); const resizeCount = process.stdout.listenerCount('resize');
    let io: ReturnType<typeof createStdioIO> | undefined;
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
      Object.defineProperty(process.stdin, 'isRaw', { configurable: true, value: false });
      Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: setRawMode });
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
      Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 80 });
      io = createStdioIO();
      const widget: PermissionActionWidget = { id: 'a', kind: 'permission_action', turnIndex: 0, timestamp: '2026-10-09T00:00:00Z', status: 'pending', payload: { actionType: 'filesystem_write', description: 'Ask', options: [{ id: 'deny', label: 'Deny', tone: 'neutral' }, { id: 'allow', label: 'Allow', tone: 'primary' }] } };
      const selected = io.selectPermission!(widget);
      process.stdin.emit('data', Buffer.from('\x1b'));
      process.stdin.emit('data', Buffer.from('[B\r'));
      expect(await selected).toBe('allow');
      expect(setRawMode.mock.calls.map(args => args[0])).toEqual([true, false]);
      const cancelled = io.selectPermission!(widget); io.dispose!();
      expect(await cancelled).toBeUndefined();
      expect(process.listenerCount('SIGINT')).toBe(signalCount);
      expect(process.stdout.listenerCount('resize')).toBe(resizeCount);
    } finally {
      io?.dispose?.(); write.mockRestore();
      descriptors.forEach(([target, key], i) => { const descriptor = previous[i]; if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
    }
  });
  it('projects actual bus events and widget decisions, refreshes fingerprint and detaches on exit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-status-')); temporary.push(root);
    const bus = new EventBus();
    const widget: PermissionActionWidget = { id: 'approval', kind: 'permission_action', turnIndex: 1, timestamp: '2026-10-09T00:00:00Z', status: 'pending', payload: { actionType: 'policy_override', description: 'Approval', options: [{ id: 'deny', label: 'Deny', tone: 'neutral' }] } };
    const close = vi.fn();
    vi.mocked(composeHarness).mockResolvedValue({ bus, session: { sessionId: 'status-test' }, close, loop: {
      interrupt: vi.fn(), runTurn: async () => {
        await bus.emit('before_model', { envelope: { model: 'measured', reasoningEffort: 'medium' } });
        await bus.emit('after_model', { usage: { cacheMetrics: { billedHitRate: 0.75 } } });
        await bus.emit('audit/sandbox_enforced', { isolationTier: 'windows-job-restricted', outcome: 'enforced' });
        await bus.emit('ui/widget_block', widget);
        return { kind: 'success', finalText: 'ok', steps: 1, toolCalls: 0 };
      },
    } } as unknown as ComposedHarness);
    vi.spyOn(WorkspaceFingerprinter, 'compute').mockResolvedValue({ timestamp: 1, trackedFilesHash: 'a'.repeat(64), uncommittedDiffBytes: 0, fileCount: 0 });
    const statusLine = { update: vi.fn(), render: vi.fn(), clear: vi.fn(), dispose: vi.fn() };
    const lines = ['hello', null]; const write = vi.fn(); const dispose = vi.fn(); const respond = vi.fn(); const selectPermission = vi.fn().mockResolvedValue('deny');
    const code = await runChat({ workspaceRoot: root, store: new ProviderStore({ rootDir: root }), settingsRoot: root, policySystemPath: 'unused', behaviorIRPath: 'unused', io: { readLine: async () => lines.shift() ?? null, write, statusLine, dispose, selectPermission }, onWidgetResponse: respond });
    expect(code).toBe(0); expect(close).toHaveBeenCalledOnce(); expect(dispose).toHaveBeenCalledOnce();
    expect(statusLine.update).toHaveBeenCalledWith(expect.objectContaining({ workspaceFingerprint: 'a'.repeat(64), activeTurns: 1 }));
    expect(statusLine.update).toHaveBeenCalledWith({ modelName: 'measured', reasoningEffort: 'medium' });
    expect(statusLine.update).toHaveBeenCalledWith({ cachedTokensRate: 0.75 });
    expect(statusLine.update).toHaveBeenCalledWith({ sandboxTier: 'JobRestricted' });
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Approval [pending]'));
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 'approval', selectedOptionId: 'deny' }));
    const calls = statusLine.update.mock.calls.length; await bus.emit('after_model', { usage: { cacheMetrics: { billedHitRate: 0.2 } } });
    expect(statusLine.update).toHaveBeenCalledTimes(calls);
  });
  it('keeps failed workspace observations unknown and reports default decisions only through the bus', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-status-')); temporary.push(root);
    const bus = new EventBus(); const selection = vi.fn().mockResolvedValue('deny'); const response = vi.fn(); bus.on('ui/widget_response', response);
    vi.mocked(composeHarness).mockResolvedValue({ bus, session: { sessionId: 'unknown-test' }, close: vi.fn(), loop: { interrupt: vi.fn(), runTurn: async () => {
      await bus.emit('ui/widget_block', { id: 'a', kind: 'permission_action', turnIndex: 0, timestamp: '2026-10-09T00:00:00Z', status: 'pending', payload: { actionType: 'filesystem_write', description: 'Ask', options: [{ id: 'deny', label: 'Deny', tone: 'neutral' }] } });
      return { kind: 'success', finalText: 'ok', steps: 1, toolCalls: 0 };
    } } } as unknown as ComposedHarness);
    vi.spyOn(WorkspaceFingerprinter, 'compute').mockRejectedValue(new Error('cannot observe'));
    const statusLine = { update: vi.fn(), render: vi.fn(), clear: vi.fn(), dispose: vi.fn() }; const write = vi.fn(); const lines = ['hello', null];
    await runChat({ workspaceRoot: root, store: new ProviderStore({ rootDir: root }), settingsRoot: root, policySystemPath: 'unused', behaviorIRPath: 'unused', io: { readLine: async () => lines.shift() ?? null, write, statusLine, selectPermission: selection } });
    expect(statusLine.update).toHaveBeenCalledWith(expect.objectContaining({ workspaceFingerprint: 'unknown', activeTurns: 1 }));
    expect(write).toHaveBeenCalledWith('Ask [pending]\nDeny'); expect(selection).toHaveBeenCalledOnce();
    expect(response).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 'a', selectedOptionId: 'deny' }), expect.anything());
  });
});
