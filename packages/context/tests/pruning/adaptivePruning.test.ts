import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ChatMessage } from '@vessel/shared';
import { Session } from '@vessel/core';
import { canonicalJson } from '@vessel/llm';
import { ContextBuilder } from '../../src/builder/Builder.js';
import { SymbolGraphService } from '../../src/ast/symbolGraph.js';
import { AdaptiveContextPruner, gitModifiedFiles, sourceSkeleton } from '../../src/pruning/adaptivePruning.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-pruning-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const source = (i: number) => `export function file${i}(input: number): number {\n${Array.from({ length: 160 }, (_, j) => `const value${j} = input + ${j};`).join('\n')}\nreturn input;\n}`;
const options = { tokenThreshold: 100, targetTokenBudget: 0, preserveRecentTurns: 3 };
function fixture() {
  const files: Record<string, string> = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}.ts`, source(i)]));
  files['f1.ts'] = `import { file0 } from './f0';\n${source(1).replace('return input;', 'return file0(input);')}`;
  const graph = new SymbolGraphService({ workspaceRoot: root, readFile: file => files[path.basename(file)] });
  const pruner = new AdaptiveContextPruner({ workspaceRoot: root, graph, refreshGraph: () => graph.indexFiles(Object.keys(files)), modifiedFiles: async () => ['f0.ts'] });
  const messages: ChatMessage[] = [{ role: 'system', content: 'fixed policy' }, { role: 'user', content: 'fixed AGENTS', source: 'instruction' },
    { role: 'user', content: 'fixed memory', source: 'memory' }, { role: 'user', content: 'task: repair f0' }];
  for (let i = 0; i < 20; i++) messages.push({ role: 'assistant', content: '', toolCalls: [{ id: `r${i}`, name: 'Read', arguments: { path: `f${i}.ts` } }] },
    { role: 'tool', name: 'Read', toolCallId: `r${i}`, content: files[`f${i}.ts`]! });
  return { messages, pruner };
}
it('20-file context saves at least 40%, with exact dependencies and immutable prefixes/tasks/recent three groups', async () => {
  const { messages, pruner } = fixture();
  const before = canonicalJson(messages);
  const result = await pruner.prune(messages, options);
  expect(result.result.prunedTokenCount / result.result.originalTokenCount).toBeLessThanOrEqual(0.6);
  expect(result.result.blastRadius).toMatchObject({ modifiedFiles: ['f0.ts'], directDependencies: ['f1.ts'] });
  expect(result.result.blastRadius.unrelatedFiles).toEqual(Array.from({ length: 15 }, (_, i) => `f${i + 2}.ts`).sort());
  const hash = (m: ChatMessage[]) => createHash('sha256').update(canonicalJson(m)).digest('hex');
  expect(hash(result.messages.slice(0, 4))).toBe(hash(messages.slice(0, 4)));
  expect(result.messages.slice(-6)).toEqual(messages.slice(-6));
  expect(result.messages.slice(4, 8)).toEqual(messages.slice(4, 8));
  expect(result.messages[9]!.content).toContain('export function file2(input: number): number;');
  expect(result.messages[9]!.content).not.toContain('value159');
  expect(result.messages.map(({ content, ...rest }) => rest)).toEqual(messages.map(({ content, ...rest }) => rest));
  expect(canonicalJson(messages)).toBe(before);
});
it('retains errors, incomplete groups, active files and earlier reads of recently active files', async () => {
  const { messages, pruner } = fixture();
  messages[9]!.content = '[custom-error] ' + 'failure detail '.repeat(500);
  messages.splice(12, 0, { role: 'assistant', content: '', toolCalls: [{ id: 'pending', name: 'Read', arguments: { path: 'f4.ts' } }] });
  messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 'active', name: 'Read', arguments: { path: 'f5.ts' } }] },
    { role: 'tool', name: 'Read', toolCallId: 'active', content: source(5) });
  const result = await pruner.prune(messages, options);
  for (const id of ['r2', 'r4', 'r5']) expect(result.messages.find(m => m.toolCallId === id)).toEqual(messages.find(m => m.toolCallId === id));
});
it('summarizes old logs with a verifiable hash and factual counts, preserves explicit record errors', async () => {
  const { messages, pruner } = fixture();
  messages[4]!.toolCalls![0] = { id: 'log', name: 'Shell', arguments: { command: 'test' } };
  messages[5] = { role: 'tool', name: 'Shell', toolCallId: 'log', content: 'assertion passed\n'.repeat(1000) };
  const out = await pruner.prune(messages, options);
  expect(out.messages[5]!.content).toContain(createHash('sha256').update(messages[5]!.content).digest('hex'));
  expect(out.messages[5]!.content).toContain('1001 lines');
  expect((await pruner.prune(messages, { ...options, protectedToolCallIds: ['log'] })).messages[5]).toEqual(messages[5]);
});
it('does not fake a budget when immutable content exceeds it, and never changes below threshold', async () => {
  const { messages, pruner } = fixture();
  expect((await pruner.prune(messages, { ...options, tokenThreshold: 1e9 })).messages).toEqual(messages);
  expect((await pruner.prune([{ role: 'user', content: 'task '.repeat(10000) }], options)).result.prunedTokenCount).toBeGreaterThan(0);
  await expect(pruner.prune(messages, { ...options, preserveRecentTurns: 2 })).rejects.toThrow('minimum 3');
});
it('skeletonizes class bodies, variables and comments, with safe fallback for malformed source', () => {
  const text = 'export class API { field: number = 123; method(x: number): number { return x + 100; } }\nexport const value: number = 999;\n// private\nfunction hidden() {}';
  const skeleton = sourceSkeleton('api.ts', text)!;
  expect(skeleton).toContain('method(x: number): number;');
  expect(skeleton).toContain('field: number;');
  expect(skeleton).not.toMatch(/123|100|999|hidden|private/);
  expect(sourceSkeleton('bad.ts', 'export function broken(')).toBeUndefined();
});
it('preserves explicit exported arrow/function signatures without implementations or invented return types', async () => {
  const { messages, pruner } = fixture();
  messages[9]!.content = `export const greet = (name: string): string => { ${'const detail = name;\n'.repeat(500)} return name; };\n`
    + 'export const echo = function<T>(value: T): T { return value; };\nexport const fallback = (name: string = "private"): string => name;';
  const result = await pruner.prune(messages, options);
  expect(result.messages[9]!.content).toContain('export const greet: (name: string) => string;');
  expect(result.messages[9]!.content).toContain('export const echo: <T>(value: T) => T;');
  expect(result.messages[9]!.content).toContain('export const fallback: (name?: string) => string;');
  expect(result.messages[9]!.content).not.toMatch(/detail|return value|private/);
  expect(result.messages.slice(-6)).toEqual(messages.slice(-6));
  expect(sourceSkeleton('untyped.ts', 'export const greet = (name: string) => name;')).toBeUndefined();
  expect(sourceSkeleton('typed.ts', 'export const greet: (name: string) => string = name => name;')).toContain('(name: string) => string');
  messages[9]!.content = `export const greet = (name: string) => { ${'const detail = name;\n'.repeat(500)} return name; };`;
  const retained = await pruner.prune(messages, options);
  expect(retained.messages[9]).toEqual(messages[9]);
  expect(retained.result.prunedTurnsSummary.find(item => item.turnIndex === 9)!.action).toBe('retained');
  expect(retained.messages.slice(-6)).toEqual(messages.slice(-6));
});
it('retains old Diff and Shell diff output verbatim for modified files, including Git global arguments', async () => {
  const { messages, pruner } = fixture();
  const commands = ['git diff -- f0.ts', 'git --no-pager diff -- f0.ts', 'git -C "workspace" --no-pager diff -- f0.ts'];
  for (const [i, command] of commands.entries()) {
    messages[4 + i * 2]!.toolCalls![0] = { id: `diff${i}`, name: 'Shell', arguments: { command } };
    messages[5 + i * 2] = { role: 'tool', name: 'Shell', toolCallId: `diff${i}`, content: `diff --git a/f0.ts b/f0.ts\n${'+important modification\n'.repeat(1000)}` };
  }
  messages[10]!.toolCalls![0] = { id: 'diff-tool', name: 'Diff', arguments: { path: 'f2.ts' } };
  messages[11] = { role: 'tool', name: 'Diff', toolCallId: 'diff-tool', content: '+important modification\n'.repeat(1000) };
  const result = await pruner.prune(messages, options);
  expect(result.result.blastRadius.modifiedFiles).toEqual(['f0.ts']);
  expect(result.messages.slice(4, 12)).toEqual(messages.slice(4, 12));
  expect(result.messages.slice(-6)).toEqual(messages.slice(-6));
  expect(result.result.prunedTurnsSummary.filter(item => [5, 7, 9, 11].includes(item.turnIndex)).every(item => item.action === 'retained')).toBe(true);
  expect(result.result.prunedTokenCount).toBeLessThan(result.result.originalTokenCount);
});
it('collects real staged, unstaged and untracked paths via NUL records without touching HEAD', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'staged name.ts'), 'export const x = 1;');
  git('add', 'staged name.ts');
  fs.writeFileSync(path.join(root, 'staged name.ts'), 'export const x = 2;');
  fs.writeFileSync(path.join(root, 'untracked.ts'), 'export const y = 1;');
  expect(await gitModifiedFiles(root)).toEqual(['staged name.ts', 'untracked.ts']);
});
it('real builder preserves stable/scoped hashes, task text, session history and accurate volatile suffix', async () => {
  const { messages, pruner } = fixture();
  const session = await Session.open({ workspaceRoot: root });
  try {
    for (const [index, message] of messages.slice(3).entries()) {
      if (message.role === 'user') await session.appendSync({ type: 'user/message', msgId: `u${index}`, role: 'user', content: message.content, surface: true });
      if (message.role === 'assistant') await session.appendSync({ type: 'assistant/attempt', msgId: `a${index}`, content: message.content,
        toolCalls: message.toolCalls!.map(c => ({ toolCallId: c.id, name: c.name, arguments: c.arguments })), attemptNo: 1, surface: false });
      if (message.role === 'tool') await session.appendSync({ type: 'tool/result', toolCallId: message.toolCallId!, toolName: message.name!, content: message.content, meta: {}, surface: true });
    }
    const deps = { session, model: 'mock', stableSections: () => ['fixed'], policyGuidance: () => ['policy'], instructions: () => [], projectMemory: () => 'memory', scopedAppendix: 'rules', getVisibleTools: () => [], volatileText: () => 'environment' };
    const plain = await new ContextBuilder(deps).assemble(1);
    const history = canonicalJson(session.replay());
    const pruned = await new ContextBuilder({ ...deps, projectMemory: undefined, adaptivePruning: { pruner, options } }).assemble(1);
    expect(pruned.prefixLayout.prefixByteHash).toBe(plain.prefixLayout.prefixByteHash);
    expect(pruned.prefixLayout.scopedPrefix).toBe(plain.prefixLayout.scopedPrefix);
    expect(pruned.prefixLayout.volatileSuffix).toBe(pruned.messages.filter(m => m.role !== 'system' && m.source !== 'memory' && m.source !== 'instruction').map(m => m.content).filter(Boolean).join('\n\n'));
    expect(pruned.messages.find(m => m.content === 'task: repair f0')).toBeDefined();
    expect(pruned.pruning!.prunedTokenCount / pruned.pruning!.originalTokenCount).toBeLessThan(0.6);
    expect(canonicalJson(session.replay())).toBe(history);
  } finally { await session.close(); }
});
