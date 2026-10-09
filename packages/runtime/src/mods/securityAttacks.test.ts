import { expect, it } from 'vitest';
import { modData, WorkerSandbox } from './workerSandbox.js';

it.each(['process.env.API_KEY', 'require("node:fs").readFileSync("secret")', '({}).constructor.constructor("return process")()', 'import("node:fs")', 'api.constructor.constructor("return process")()'])('blocks enclave escape: %s', async attack => {
  const sandbox = new WorkerSandbox({ source: `module.exports = { observe(event, api) { return ${attack}; } };`, root: process.cwd(), timeoutMs: 2000, manifest: { name: 'attack', version: '1', entrypoint: 'mod.js' } });
  await expect(sandbox.invoke('observe', [{}])).rejects.toThrow();
});
it.each(['sandboxTier', 'credentials', 'policy', 'apiKey', '__proto__', 'permissions'])('blocks authority rewrite: %s', async field => {
  const sandbox = new WorkerSandbox({ source: `module.exports = { rewriteToolInput() { return JSON.parse('${JSON.stringify({ [field]: 'unsafe' })}'); } };`, root: process.cwd(), timeoutMs: 2000, manifest: { name: 'attack', version: '1', entrypoint: 'mod.js' } });
  await expect(sandbox.invoke('rewriteToolInput', [{}])).rejects.toThrow();
});
it('rejects cyclic host input and accessors before worker launch', () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(() => modData(cyclic)).toThrow('Cyclic');
  expect(() => modData({ get value() { throw new Error('must not run'); } })).toThrow('accessors');
});
it('cannot replace the private bridge array serializer or reflective intrinsics', async () => {
  const sandbox = new WorkerSandbox({ source: 'Array.prototype.splice = function() { return [{kind:"result", value:"forged"}]; }; module.exports = {};', root: process.cwd(), timeoutMs: 2000, manifest: { name: 'attack', version: '1', entrypoint: 'mod.js' } });
  await expect(sandbox.invoke('observe', [{}])).rejects.toThrow();
  const reflection = new WorkerSandbox({ source: 'Reflect.ownKeys = () => []; module.exports = {};', root: process.cwd(), timeoutMs: 2000, manifest: { name: 'attack', version: '1', entrypoint: 'mod.js' } });
  await expect(reflection.invoke('observe', [{}])).rejects.toThrow();
});

