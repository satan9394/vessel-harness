import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSymbolGraphTool } from '../src/ast/symbolGraphTool.js';
import { SymbolGraphService } from '@vessel/context';
import type { FsPolicyConfig } from '../src/filesystem/guards.js';
let root: string;
let policy: FsPolicyConfig;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-graph-tool-'));
  fs.writeFileSync(path.join(root, 'api.ts'), 'export function execute() { return 1 }');
  fs.writeFileSync(path.join(root, 'caller.ts'), 'import { execute } from "./api.js"; export function caller() { return execute() }');
  policy = { protected: [], denyRead: [], allow: [] };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const withContext = (instance: ReturnType<typeof createSymbolGraphTool>) => ({ ...instance,
  execute: (args: Record<string, unknown>) => instance.execute(args, { workspaceRoot: root, cwd: root }),
});
const tool = () => withContext(createSymbolGraphTool({ workspaceRoot: root, fsPolicy: policy, filePaths: ['api.ts', 'caller.ts'] }));
describe('code_symbol_graph', () => {
  it('returns implementers with service parity and follows mixed reference/implements paths', async () => {
    fs.writeFileSync(path.join(root, 'api.ts'), 'export interface Contract { execute(): number }');
    fs.writeFileSync(path.join(root, 'caller.ts'), 'import { Contract } from "./api.js"; export class Impl implements Contract { execute() { return 1 } }; export function use() { return new Impl() }');
    const graph = new SymbolGraphService({ workspaceRoot: root });
    await graph.indexFiles(['api.ts', 'caller.ts']);
    const serviceCallers = (await graph.getIncomingReferences('api.ts#Contract')).map(node => node.id).sort();
    const result = JSON.parse((await tool().execute({ action: 'get_references', filePath: 'api.ts', symbolName: 'Contract' })).content);
    expect(result.nodes.filter((node: { id: string }) => node.id !== 'api.ts#Contract').map((node: { id: string }) => node.id).sort()).toEqual(serviceCallers);
    expect(result.edges).toContainEqual({ fromId: 'caller.ts#Impl', toId: 'api.ts#Contract', relation: 'implements' });
    const indirect = JSON.parse((await tool().execute({ action: 'get_references', filePath: 'api.ts', symbolName: 'Contract', maxDepth: 2 })).content);
    expect(indirect.edges).toContainEqual({ fromId: 'caller.ts#use', toId: 'caller.ts#Impl', relation: 'references' });
    expect(indirect.edges.every((edge: { relation: string }) => ['references', 'implements'].includes(edge.relation))).toBe(true);
  });
  it('returns structured exact symbols, references, dependents and module graphs', async () => {
    const instance = tool();
    const found = await instance.execute({ action: 'find_symbol', symbolName: 'execute' });
    expect(JSON.parse(found.content).nodes.map((node: { id: string }) => node.id)).toEqual(['api.ts#execute']);
    for (const action of ['get_references', 'get_dependents']) {
      const result = await instance.execute({ action, filePath: 'api.ts', symbolName: 'execute' });
      expect(JSON.parse(result.content).edges).toContainEqual({ fromId: 'caller.ts#caller', toId: 'api.ts#execute', relation: 'references' });
    }
    const module = await instance.execute({ action: 'get_module_graph', filePath: 'caller.ts' });
    expect(JSON.parse(module.content).edges).toContainEqual({ fromId: 'caller.ts#module', toId: 'api.ts#module', relation: 'imports' });
    const missing = await instance.execute({ action: 'get_references', symbolName: 'missing' });
    expect(JSON.parse(missing.content).message).toContain('No matching symbol');
  });
  it('enforces canonical read guards before indexing, queries and cached refresh', async () => {
    const instance = tool();
    expect((await instance.execute({ action: 'find_symbol' })).error).toBeUndefined();
    policy.denyRead = ['api.ts'];
    expect((await instance.execute({ action: 'find_symbol' })).error?.errorClass).toBe('DENIED');
    expect((await tool().execute({ action: 'find_symbol', filePath: '../escape.ts' })).meta.guard).toBe('escape');
    const denied = withContext(createSymbolGraphTool({ workspaceRoot: root, fsPolicy: policy, filePaths: ['api.ts'] }));
    expect((await denied.execute({ action: 'find_symbol' })).meta.guard).toBe('deny-read');
  });
  it('never discovers denied/unindexed imports and rejects invalid arguments', async () => {
    fs.writeFileSync(path.join(root, 'api.ts'), 'export { secret } from "./secret.js";');
    fs.writeFileSync(path.join(root, 'secret.ts'), 'export const secret = "credential"');
    policy.denyRead = ['secret.ts'];
    expect(JSON.parse((await tool().execute({ action: 'find_symbol', symbolName: 'secret' })).content).nodes).toEqual([]);
    for (const args of [{ action: 'bad' }, { action: 'find_symbol', maxDepth: 4 }, { action: 'find_symbol', maxDepth: 1.5 }, { action: 'find_symbol', filePath: 1 }])
      expect((await tool().execute(args)).error?.errorClass).toBe('INVALID_ARGS');
    expect((await tool().execute({ action: 'get_module_graph' })).error?.errorClass).toBe('INVALID_ARGS');
  });
});
