import { Worker } from 'node:worker_threads';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateModManifest, type ClaudeModManifest } from '@vessel/shared';

export class ModSecurityViolationError extends Error {
  constructor(message: string) { super(message); this.name = 'ModSecurityViolationError'; }
}

export interface WorkerSandboxOptions {
  source: string;
  manifest: ClaudeModManifest;
  root: string;
  timeoutMs?: number;
  authorizeTool?: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<boolean>;
  delegateTool?: (tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

/** No accessors, prototypes, authority fields, or host references cross the boundary. */
export function modData(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || (!Array.isArray(value) && ![null, Object.prototype].includes(Object.getPrototypeOf(value)))) throw new ModSecurityViolationError('Non-JSON Mod data');
  if (ancestors.has(value)) throw new ModSecurityViolationError('Cyclic Mod data');
  ancestors.add(value);
  const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || /(__proto__|constructor|prototype|credential|sandbox|policy|apikey|accesstoken|secret|permission)/i.test(key)) throw new ModSecurityViolationError('Forbidden Mod authority field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new ModSecurityViolationError('Mod accessors forbidden');
    Object.defineProperty(result, key, { value: modData(descriptor.value, ancestors), enumerable: true });
  }
  ancestors.delete(value);
  return Object.freeze(result);
}

const workerProgram = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
if (!process.permission || process.permission.has('fs.read') || process.permission.has('fs.write') || process.permission.has('child') || process.permission.has('worker')) throw Error('Restricted Worker unavailable');
const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
const run = code => vm.runInContext(code, context, { timeout: workerData.timeout });
context.__source = workerData.source;
run(\`
'use strict';
for (const name of ['Object', 'JSON', 'Promise', 'Map', 'Error', 'String', 'Array', 'Reflect']) {
 Object.freeze(globalThis[name]); if (globalThis[name].prototype) Object.freeze(globalThis[name].prototype);
 Object.defineProperty(globalThis, name, {value:globalThis[name], writable:false, configurable:false});
}
\`);
run('(function() { "use strict"; const module = {exports:{}}; const exports = module.exports; ' + context.__source + '\\n; Object.defineProperty(globalThis, "__implementation", {value:module.exports, writable:false, configurable:false}); })()');
delete context.__source;
run(\`
(() => {
const outbound = [], pending = new Map(); let sequence = 0;
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
const api = Object.freeze({ callTool: (tool, input) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, {resolve, reject}); outbound.push({kind:'rpc', id, tool, input}); }) });
const implementation = __implementation;
const invoke = message => {
 const args = deepFreeze(message.args);
 Promise.resolve().then(() => {
   const callback = implementation[message.operation];
   if (callback === undefined) return message.fallback;
   if (typeof callback !== 'function') throw Error('Invalid Mod callback');
   return callback(...args, api);
 }).then(value => outbound.push({kind:'result', value}), error => outbound.push({kind:'error', message:String(error)}));
};
Object.defineProperties(globalThis, {
 __invoke: {value:invoke},
 __drain: {value:() => JSON.stringify(outbound.splice(0))},
 __respond: {value:message => { const callback = pending.get(message.id); if (!callback) throw Error('Unknown RPC'); pending.delete(message.id); message.error ? callback.reject(Error(message.error)) : callback.resolve(deepFreeze(message.value)); } }
});
})();
\`);
parentPort.on('message', message => {
  try {
    context.__message = JSON.stringify(message);
    run(\`{ const message = JSON.parse(__message); delete globalThis.__message; if (message.kind === 'invoke') __invoke(message); else __respond(message); }\`);
  } catch (error) { parentPort.postMessage({kind:'error', message:String(error)}); }
});
setInterval(() => {
  try { const output = run('__drain()'); for (const item of JSON.parse(output)) parentPort.postMessage(item); }
  catch (error) { parentPort.postMessage({kind:'error', message:String(error)}); }
}, 5);
`;

/** One permission-denied Worker per invocation. Arbitrary imports/network/process tools fail closed. */
export class WorkerSandbox {
  private readonly options: WorkerSandboxOptions;
  constructor(options: WorkerSandboxOptions) {
    const manifest = validateModManifest(options.manifest);
    if (manifest.permissions?.network) throw new ModSecurityViolationError('Mod networking unsupported');
    if ((manifest.permissions?.allowedTools ?? []).some(tool => !['Read', 'Write', 'Edit'].includes(tool))) throw new ModSecurityViolationError('Unsupported Mod tool permission');
    for (const grant of [...manifest.permissions?.filesystemRead ?? [], ...manifest.permissions?.filesystemWrite ?? []]) {
      if (path.isAbsolute(grant) || grant.split(/[\\/]/).includes('..')) throw new ModSecurityViolationError('Invalid Mod filesystem grant');
    }
    const timeoutMs = options.timeoutMs ?? 1000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Invalid Mod timeout');
    this.options = { ...options, manifest, timeoutMs };
  }

  async invoke(operation: string, args: unknown[], fallback?: unknown): Promise<unknown> {
    if (!['observe', 'rewriteToolInput', 'rewritePromptFragment', 'interceptToolCall'].includes(operation)) throw new ModSecurityViolationError('Unknown Mod operation');
    const safeArgs = modData(args);
    const safeFallback = modData(fallback);
    const source = this.options.source.replace(/^\s*export\s+default\s/m, 'module.exports = ');
    return new Promise((resolve, reject) => {
      let worker: Worker;
      let settled = false;
      const cancellation = new AbortController();
      const finish = (error: Error | undefined, value?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer); cancellation.abort();
        void worker?.terminate();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => finish(new ModSecurityViolationError('Mod execution timed out')), this.options.timeoutMs);
      try {
        worker = new Worker(workerProgram, { eval: true, env: {}, execArgv: ['--permission'], resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 2 }, workerData: { source, timeout: this.options.timeoutMs } });
        worker.on('error', error => finish(error));
        worker.on('exit', code => { if (!settled) finish(new ModSecurityViolationError(`Mod Worker exited: ${code}`)); });
        worker.on('message', (message: { kind: string; id?: number; tool?: unknown; input?: unknown; value?: unknown; message?: string }) => {
          if (settled) return;
          if (message.kind === 'result') {
            try { finish(undefined, modData(message.value)); } catch (error) { finish(error as Error); }
          } else if (message.kind === 'error') finish(new ModSecurityViolationError(message.message ?? 'Mod failed'));
          else if (message.kind === 'rpc') {
            void this.rpc(message.tool, message.input, cancellation.signal).then(value => {
              if (!settled) worker.postMessage({ kind: 'rpc', id: message.id, value: modData(value) });
            }).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
          } else finish(new ModSecurityViolationError('Unknown Mod RPC operation'));
        });
        worker.postMessage({ kind: 'invoke', operation, args: safeArgs, fallback: safeFallback });
      } catch (error) { finish(error as Error); }
    });
  }

  private async rpc(tool: unknown, input: unknown, signal: AbortSignal): Promise<unknown> {
    if (typeof tool !== 'string' || !this.options.manifest.permissions?.allowedTools?.includes(tool) || !['Read', 'Write', 'Edit'].includes(tool)) throw new ModSecurityViolationError('Mod tool denied');
    const data = modData(input) as Record<string, unknown>;
    if (!data || Array.isArray(data) || typeof data.path !== 'string') throw new ModSecurityViolationError('Mod tool requires path');
    const root = await realpath(this.options.root);
    const target = path.resolve(root, data.path);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => /^\.|credential|provider|policy|secret|token/i.test(part))) throw new ModSecurityViolationError('Mod path denied');
    // Require existing parent: no unchecked symlink or auto-created directory traversal.
    let resolved: string;
    try { resolved = await realpath(target); }
    catch { resolved = path.join(await realpath(path.dirname(target)), path.basename(target)); }
    const confined = path.relative(root, resolved);
    if (!confined || confined.startsWith('..') || path.isAbsolute(confined) || confined.split(/[\\/]/).some(part => /^\.|credential|provider|policy|secret|token/i.test(part))) throw new ModSecurityViolationError('Mod symlink escape denied');
    const grants = tool === 'Read' ? this.options.manifest.permissions?.filesystemRead : this.options.manifest.permissions?.filesystemWrite;
    let granted = false;
    for (const grant of grants ?? []) {
      let scope: string;
      try { scope = await realpath(path.resolve(root, grant)); } catch { scope = path.resolve(root, grant); }
      const scopeRelative = path.relative(root, scope);
      const within = path.relative(scope, resolved);
      if (!scopeRelative.startsWith('..') && !path.isAbsolute(scopeRelative) && !within.startsWith('..') && !path.isAbsolute(within)) granted = true;
    }
    if (!granted) throw new ModSecurityViolationError('Mod filesystem permission denied');
    const delegated = Object.freeze({ ...data, path: resolved });
    if (signal.aborted) throw new ModSecurityViolationError('Mod invocation cancelled');
    if (!this.options.authorizeTool || !this.options.delegateTool || !await this.options.authorizeTool(tool, delegated, signal)) throw new ModSecurityViolationError('Host policy denied Mod tool');
    if (signal.aborted) throw new ModSecurityViolationError('Mod invocation cancelled');
    return this.options.delegateTool(tool, delegated, signal);
  }
}

