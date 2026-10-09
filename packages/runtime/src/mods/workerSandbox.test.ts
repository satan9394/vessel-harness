import { describe, expect, it } from 'vitest';
import { WorkerSandbox } from './workerSandbox.js';

const create = (source: string, timeoutMs = 2000) => new WorkerSandbox({ source, timeoutMs, root: process.cwd(), manifest: { name: 'test', version: '1', entrypoint: 'mod.js' } });
describe('permission-denied Mod worker', () => {
  it('runs JSON-only callbacks and preserves fallback', async () => {
    const sandbox = create('module.exports = { rewriteToolInput(input) { return { value: input.value + 1 }; } };');
    await expect(sandbox.invoke('rewriteToolInput', [{ value: 1 }])).resolves.toEqual({ value: 2 });
    await expect(sandbox.invoke('interceptToolCall', [{}], { handled: false })).resolves.toEqual({ handled: false });
  });
  it('executes ESM default and isolated async callbacks', async () => {
    await expect(create('export default { async rewritePromptFragment(fragment) { return fragment + "!"; } };').invoke('rewritePromptFragment', ['hello'])).resolves.toBe('hello!');
  });
  it.each(['while(true) {}', 'return new Promise(() => {});', 'return Promise.resolve().then(() => { while(true) {} });'])('terminates hanging callback %s', async body => {
    await expect(create(`module.exports = { observe() { ${body} } };`, 200).invoke('observe', [{}])).rejects.toThrow();
  });
});

