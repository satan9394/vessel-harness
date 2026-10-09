import { expect, it, vi } from 'vitest';
import type { ToolSpec, Verdict } from '@vessel/shared';
import { Executor, type ExecutorModPipeline } from '../executor/Executor.js';
import { Sandbox } from '../sandbox/Sandbox.js';

const ctx = { workspaceRoot: process.cwd(), cwd: process.cwd(), sandbox: new Sandbox() };
function fixture() {
  const execute = vi.fn(async () => ({ content: 'real', meta: { sandbox: { secret: 'host only' } } }));
  const tool: ToolSpec = { name: 'Read', description: '', family: 'file_read', requiredPermission: 'read', exclusive: false, inputSchema: { type: 'object', properties: {} }, execute };
  const mods: ExecutorModPipeline = { dispatchObserve: vi.fn(async () => {}), dispatchRewriteToolInput: vi.fn(async (_name, input) => input), dispatchIntercept: vi.fn(async () => ({ handled: false })) };
  const decide = vi.fn(async (): Promise<Verdict> => ({ action: 'allow', decisionPath: ['host'] }));
  return { execute, tool, mods, decide, call: { toolCallId: 't', toolName: 'Read', arguments: { path: 'safe' } } };
}
it('original host denial prevents every Mod callback', async () => {
  const f = fixture(); f.decide.mockResolvedValue({ action: 'deny', decisionPath: ['host'] });
  const result = await new Executor(f).runTool(f.tool, f.call, ctx);
  expect(result.error?.errorClass).toBe('DENIED'); expect(f.mods.dispatchObserve).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});
it('rewritten host denial prevents interceptor and tool execution', async () => {
  const f = fixture(); vi.mocked(f.mods.dispatchRewriteToolInput).mockResolvedValue({ path: 'forbidden' });
  f.decide.mockResolvedValueOnce({ action: 'allow', decisionPath: [] }).mockResolvedValueOnce({ action: 'deny', decisionPath: ['rewritten'] });
  expect((await new Executor(f).runTool(f.tool, f.call, ctx)).error?.errorClass).toBe('DENIED');
  expect(f.mods.dispatchIntercept).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});
it('handled result shortcircuits and observers never receive host metadata', async () => {
  const f = fixture(); vi.mocked(f.mods.dispatchIntercept).mockResolvedValue({ handled: true, result: { content: 'handled', meta: {} } });
  expect((await new Executor(f).runTool(f.tool, f.call, ctx)).content).toBe('handled'); expect(f.execute).not.toHaveBeenCalled();
  const plain = fixture(); const result = await new Executor(plain).runTool(plain.tool, plain.call, ctx);
  expect(result.meta).toHaveProperty('sandbox');
  expect(plain.mods.dispatchObserve).toHaveBeenLastCalledWith('after_tool', { content: 'real' }, expect.anything());
});
it('invalid intercepted result trips the circuit and records failure', async () => {
  const f = fixture(); vi.mocked(f.mods.dispatchIntercept).mockResolvedValue({ handled: true, result: 'bad' });
  const onModFailure = vi.fn(); const executor = new Executor({ ...f, onModFailure });
  expect((await executor.runTool(f.tool, f.call, ctx)).error?.errorClass).toBe('DENIED');
  expect((await executor.runTool(f.tool, f.call, ctx)).error?.errorClass).toBe('DENIED');
  expect(f.mods.dispatchIntercept).toHaveBeenCalledTimes(1); expect(onModFailure).toHaveBeenCalledTimes(2); expect(f.execute).not.toHaveBeenCalled();
});
it('host result audit survives a failed after_tool observer exactly once', async () => {
  const f = fixture(); vi.mocked(f.mods.dispatchObserve).mockImplementation(async type => { if (type === 'after_tool') throw Error('observer failed'); });
  const onResult = vi.fn(); const executor = new Executor({ ...f, onResult });
  expect((await executor.runTool(f.tool, f.call, ctx)).error?.errorClass).toBe('DENIED');
  expect(onResult).toHaveBeenCalledTimes(1); expect(onResult.mock.calls[0]![1].meta).toHaveProperty('sandbox');
  await executor.runTool(f.tool, f.call, ctx); expect(onResult).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
});
