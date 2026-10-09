import { mkdtemp, writeFile, rm, symlink, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkerSandbox } from './workerSandbox.js';

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'vessel-mod-')); await writeFile(path.join(root, 'safe.txt'), 'safe'); await writeFile(path.join(root, '.env'), 'secret'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const run = (tool: string, filename: string, allow = true) => {
  const delegateTool = vi.fn(async () => ({ content: 'safe' }));
  const sandbox = new WorkerSandbox({ root, timeoutMs: 2000, source: `module.exports = { async interceptToolCall(input, ctx, api) { return { handled: true, result: await api.callTool(${JSON.stringify(tool)}, {path:${JSON.stringify(filename)}}) }; } };`, manifest: { name: 'rpc', version: '1', entrypoint: 'mod.js', permissions: { allowedTools: ['Read'], filesystemRead: ['.'] } }, authorizeTool: async () => allow, delegateTool });
  return { result: sandbox.invoke('interceptToolCall', [{}, {}]), delegateTool };
};
it('delegates only a whitelisted path through the host policy', async () => {
  const { result, delegateTool } = run('Read', 'safe.txt');
  await expect(result).resolves.toEqual({ handled: true, result: { content: 'safe' } });
  expect(delegateTool).toHaveBeenCalledWith('Read', { path: await realpath(path.join(root, 'safe.txt')) }, expect.any(AbortSignal));
});
it.each([['Read', '../outside'], ['Read', '.env'], ['credentials', 'safe.txt'], ['Bash', 'safe.txt']])('denies %s %s', async (tool, filename) => {
  const { result, delegateTool } = run(tool, filename); await expect(result).rejects.toThrow(); expect(delegateTool).not.toHaveBeenCalled();
});
it('requires independent host authorization', async () => { const { result, delegateTool } = run('Read', 'safe.txt', false); await expect(result).rejects.toThrow('policy denied'); expect(delegateTool).not.toHaveBeenCalled(); });
it('denies a symlink to a hidden credential file', async () => {
  await mkdir(path.join(root, '.private')); await writeFile(path.join(root, '.private', 'data.txt'), 'secret');
  await symlink(path.join(root, '.private'), path.join(root, 'alias'), 'junction');
  const { result, delegateTool } = run('Read', 'alias/data.txt'); await expect(result).rejects.toThrow(); expect(delegateTool).not.toHaveBeenCalled();
});
it('allows an internal ordinary symlink', async () => { await mkdir(path.join(root, 'safe')); await writeFile(path.join(root, 'safe', 'data.txt'), 'safe'); await symlink(path.join(root, 'safe'), path.join(root, 'alias'), 'junction'); await expect(run('Read', 'alias/data.txt').result).resolves.toMatchObject({ handled: true }); });
it('rejects network and arbitrary tool grants at startup', () => {
  const base = { root, source: '', manifest: { name: 'bad', version: '1', entrypoint: 'mod.js', permissions: { network: true } } };
  expect(() => new WorkerSandbox(base)).toThrow('networking');
  expect(() => new WorkerSandbox({ ...base, manifest: { ...base.manifest, permissions: { filesystemRead: ['../'] } } })).toThrow('grant');
});
it('never dispatches a tool after delayed authorization outlives the invocation', async () => {
  let authorize!: (allow: boolean) => void;
  let started!: () => void;
  const authorizationStarted = new Promise<void>(resolve => { started = resolve; });
  const delegateTool = vi.fn(async () => ({}));
  const sandbox = new WorkerSandbox({ root, timeoutMs: 800, source: 'module.exports = { observe(event, api) { return api.callTool("Write", {path:"safe.txt"}); } };', manifest: { name: 'cancel', version: '1', entrypoint: 'mod.js', permissions: { allowedTools: ['Write'], filesystemWrite: ['.'] } }, authorizeTool: () => { started(); return new Promise<boolean>(resolve => { authorize = resolve; }); }, delegateTool });
  const result = sandbox.invoke('observe', [{}]);
  const rejection = expect(result).rejects.toThrow('timed out');
  await authorizationStarted;
  await rejection;
  authorize(true);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(delegateTool).not.toHaveBeenCalled();
});

