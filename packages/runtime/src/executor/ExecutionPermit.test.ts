import { describe, it, expect, vi } from 'vitest';
import { canonicalArgumentsHash, createExecutionPermitAuthority, type CanonicalToolInvocation, type ToolSpec } from '@vessel/shared';
import { Executor } from './Executor.js';
import { Sandbox } from '../sandbox/Sandbox.js';

const call = { toolCallId: 'call', toolName: 'Write', arguments: { path: 'a', content: 'safe' } };
const subject = { sessionId: 'session', runId: 'run', agentInstanceId: 'agent' };
const ctx = { workspaceRoot: 'workspace', cwd: 'workspace', sandbox: new Sandbox(), subject };
const invocation = (): CanonicalToolInvocation => ({ canonicalToolId: 'builtin:Write', subject, argumentsCanonicalHash: canonicalArgumentsHash(call.arguments), requestedScopes: ['workspace-write', 'workspace', 'workspace'] });
function fixture() {
  const execute = vi.fn(async () => ({ content: 'done', meta: {} }));
  const tool: ToolSpec = { name: 'Write', family: 'file_write', requiredPermission: 'workspace-write', exclusive: true, description: '', inputSchema: { type: 'object', properties: {} }, execute };
  return { execute, tool };
}
const decide = async () => ({ action: 'allow' as const, decisionPath: ['fixture'] });

describe('ExecutionPermit trusted dispatch', () => {
  it('blocks direct execution without host authority or mismatched tool identity', async () => {
    const { tool, execute } = fixture();
    expect((await new Executor().runTool(tool, call, ctx)).error?.errorClass).toBe('DENIED');
    expect((await new Executor({ decide }).runTool(tool, { ...call, toolName: 'write' }, ctx)).error?.errorClass).toBe('DENIED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('accepts exactly one immutable, argument-bound capability; rejects forged and replayed JSON', async () => {
    const { tool, execute } = fixture();
    const permitAuthority = createExecutionPermitAuthority(() => 0);
    const executor = new Executor({ decide, permitAuthority });
    const permit = permitAuthority.issue(invocation());
    expect((await executor.runTool(tool, call, { ...ctx, permit: { ...permit } })).error?.errorClass).toBe('DENIED');
    expect((await executor.runTool(tool, call, { ...ctx, permit })).content).toBe('done');
    expect((await executor.runTool(tool, call, { ...ctx, permit })).error?.errorClass).toBe('DENIED');
    expect(execute).toHaveBeenCalledOnce();
  });
  it('rejects changed arguments, scopes, subject, expiry and policy revisions', async () => {
    const { tool, execute } = fixture();
    let revision = 0; let time = 0;
    const permitAuthority = createExecutionPermitAuthority(() => revision, () => time, 10);
    const executor = new Executor({ decide, permitAuthority });
    const attempt = async (changedCall = call, changedCtx = ctx) => executor.runTool(tool, changedCall, { ...changedCtx, permit: permitAuthority.issue(invocation()) });
    expect((await attempt({ ...call, arguments: { ...call.arguments, content: 'evil' } })).error?.errorClass).toBe('DENIED');
    expect((await attempt(call, { ...ctx, workspaceRoot: 'outside' })).error?.errorClass).toBe('DENIED');
    expect((await attempt(call, { ...ctx, cwd: 'outside' })).error?.errorClass).toBe('DENIED');
    expect((await attempt(call, { ...ctx, subject: { ...subject, agentInstanceId: 'other' } })).error?.errorClass).toBe('DENIED');
    const expired = permitAuthority.issue(invocation()); time = 10;
    expect((await executor.runTool(tool, call, { ...ctx, permit: expired })).error?.errorClass).toBe('DENIED');
    const revoked = permitAuthority.issue(invocation()); revision++;
    expect((await executor.runTool(tool, call, { ...ctx, permit: revoked })).error?.errorClass).toBe('DENIED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('rechecks live policy even for an otherwise valid permit', async () => {
    const { tool, execute } = fixture(); const permitAuthority = createExecutionPermitAuthority(() => 0);
    const executor = new Executor({ decide: async () => ({ action: 'deny', decisionPath: ['revoked'] }), permitAuthority });
    expect((await executor.runTool(tool, call, { ...ctx, permit: permitAuthority.issue(invocation()) })).error?.errorClass).toBe('DENIED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('checks expiry again at dispatch after durable intent persistence', async () => {
    const { tool, execute } = fixture(); let time = 0;
    const permitAuthority = createExecutionPermitAuthority(() => 0, () => time, 10);
    const executor = new Executor({ decide, permitAuthority, beforeDispatch: async () => { time = 10; } });
    expect((await executor.runTool(tool, call, { ...ctx, permit: permitAuthority.issue(invocation()) })).error?.errorClass).toBe('DENIED');
    expect(execute).not.toHaveBeenCalled();
  });
  it('never dispatches if cancelled during asynchronous intent persistence', async () => {
    const { tool, execute } = fixture(); const controller = new AbortController();
    const executor = new Executor({ decide, beforeDispatch: async () => { controller.abort(); } });
    expect((await executor.runTool(tool, call, { ...ctx, signal: controller.signal })).meta.interrupted).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not let a Mod intercept execute after rewriting an explicitly approved operation', async () => {
    const { tool, execute } = fixture(); const permitAuthority = createExecutionPermitAuthority(() => 0);
    const intercept = vi.fn(async () => ({ handled: true as const, result: { content: 'effect', meta: {} } }));
    const executor = new Executor({ decide, permitAuthority, mods: {
      dispatchObserve: async () => {},
      dispatchRewriteToolInput: async (_name, args) => ({ ...args, content: 'evil' }),
      dispatchIntercept: intercept,
    } });
    expect((await executor.runTool(tool, call, { ...ctx, permit: permitAuthority.issue(invocation()) })).error?.errorClass).toBe('DENIED');
    expect(intercept).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('rejects invalid supplied authority before any Mod observer, rewrite or interception', async () => {
    const { tool, execute } = fixture(); let time = 0;
    const permitAuthority = createExecutionPermitAuthority(() => 0, () => time, 10);
    const observe = vi.fn(async () => {});
    const rewrite = vi.fn(async (_name: string, args: Record<string, unknown>) => args);
    const intercept = vi.fn(async () => ({ handled: false as const }));
    const executor = new Executor({ decide, permitAuthority, mods: { dispatchObserve: observe, dispatchRewriteToolInput: rewrite, dispatchIntercept: intercept } });
    const original = permitAuthority.issue(invocation());
    expect((await executor.runTool(tool, call, { ...ctx, permit: { ...original } })).error?.errorClass).toBe('DENIED');
    expect((await executor.runTool(tool, { ...call, arguments: { ...call.arguments, content: 'evil' } }, { ...ctx, permit: original })).error?.errorClass).toBe('DENIED');
    time = 10;
    expect((await executor.runTool(tool, call, { ...ctx, permit: original })).error?.errorClass).toBe('DENIED');
    expect(observe).not.toHaveBeenCalled(); expect(rewrite).not.toHaveBeenCalled(); expect(intercept).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('does not invoke Mod callbacks when cancellation arrives during policy evaluation', async () => {
    const { tool, execute } = fixture(); const controller = new AbortController();
    const observe = vi.fn(async () => {}); const rewrite = vi.fn(async (_name: string, args: Record<string, unknown>) => args);
    const intercept = vi.fn(async () => ({ handled: false as const }));
    const executor = new Executor({ decide: async () => { controller.abort(); return decide(); }, mods: { dispatchObserve: observe, dispatchRewriteToolInput: rewrite, dispatchIntercept: intercept } });
    expect((await executor.runTool(tool, call, { ...ctx, signal: controller.signal })).meta.interrupted).toBe(true);
    expect(observe).not.toHaveBeenCalled(); expect(rewrite).not.toHaveBeenCalled(); expect(intercept).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
});
