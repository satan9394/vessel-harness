import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { RedGreenGate } from '@vessel/policy';
import { composeHarness, type ComposedHarness } from './compose.js';

const repo = path.resolve(import.meta.dirname, '../../..');
let root: string | undefined;
let harness: ComposedHarness | undefined;
afterEach(async () => {
  await harness?.close(); harness = undefined;
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it('repairs a real defect through composed tools, preserving exact references and cached context until evaluator Green', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-v23-e2e-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, '.git/info/exclude'), '*.ts\n.harness/\n');
  fs.writeFileSync(path.join(root, 'arithmetic.mjs'), 'export function add(a, b) { return a - b; }');
  fs.writeFileSync(path.join(root, 'caller.mjs'), 'import { add as sum } from "./arithmetic.mjs"; export function calculate() { return sum(2, 3); }');
  fs.writeFileSync(path.join(root, 'repro.cjs'), "const assert = require('node:assert/strict'); assert.equal(require('./caller.mjs').calculate(), 5, 'TARGET_ADDITION_BUG');");
  fs.writeFileSync(path.join(root, 'regression.cjs'), "const assert = require('node:assert/strict'); const {add}=require('./arithmetic.mjs'); for(const [a,b,want] of [[0,0,0],[-2,3,1],[8,-3,5]]) assert.equal(add(a,b),want); console.log('3 regression assertions passed');");
  const noiseFiles = Array.from({ length: 20 }, (_, i) => `noise${i}.ts`);
  for (const [i, file] of noiseFiles.entries()) {
    fs.writeFileSync(path.join(root, file), `export function noise${i}(): number {\n${'// unrelated historical implementation detail\n'.repeat(250)}return ${i}; }`);
  }
  const gate = new RedGreenGate();
  const config = { cwd: root, reproductionCommand: { executable: process.execPath, args: ['repro.cjs'] },
    fullSuiteCommand: { executable: process.execPath, args: ['regression.cjs'] }, reproductionFiles: ['repro.cjs', 'regression.cjs'],
    sourceFiles: ['arithmetic.mjs', 'caller.mjs'], allowBaselineFailureReasons: ['TARGET_ADDITION_BUG'] };
  const red = await gate.verifyRedPhase(config);
  expect(red.success, red.error).toBe(true);
  expect(red.proof.redExecution.exitCode).not.toBe(0);
  expect(red.proof.redExecution.stderr).toContain('TARGET_ADDITION_BUG');
  const provider = new MockProvider([
    { when: 'repair with tools', maxToolResults: 22, response: { toolCalls: [{ name: 'code_symbol_graph', arguments: { action: 'get_references', filePath: 'arithmetic.mjs', symbolName: 'add' } }] } },
    { when: 'repair with tools', minToolResults: 23, maxToolResults: 23, response: { toolCalls: [{ name: 'Edit', arguments: { path: 'arithmetic.mjs', old_string: 'return a - b;', new_string: 'return a + b;' } }] } },
    { when: /.*/, response: { text: 'Repair complete.' } },
  ]);
  const h = harness = await composeHarness({ workspaceRoot: root, provider, model: 'mock', taskType: 'bugfix', redGreenGate: gate,
    memory: { enabled: false }, symbolGraph: { filePaths: ['arithmetic.mjs', 'caller.mjs', ...noiseFiles] },
    adaptivePruning: { tokenThreshold: 100, targetTokenBudget: 0, preserveRecentTurns: 3, activeFiles: ['arithmetic.mjs'] },
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') });
  const task = 'TASK: repair addition without changing regression tests or task definitions';
  await h.session.appendSync({ type: 'user/message', msgId: 'task', role: 'user', content: task, surface: true });
  const prefix = (await h.builder.assemble(1)).prefixLayout;
  // History contains actual composed Read outputs; each assistant call/result pair remains adjacent.
  const readFiles = ['arithmetic.mjs', 'caller.mjs', ...noiseFiles];
  for (const [i, file] of readFiles.entries()) {
    await h.session.appendSync({ type: 'assistant/attempt', msgId: `a${i}`, content: '', attemptNo: 1, surface: false,
      toolCalls: [{ toolCallId: `read${i}`, name: 'Read', arguments: { path: file } }] });
    const result = await h.registry.spec('Read')!.execute({ path: file }, { workspaceRoot: root, cwd: root });
    expect(result.error).toBeUndefined();
    await h.session.appendSync({ type: 'tool/result', toolCallId: `read${i}`, toolName: 'Read', content: result.content, meta: result.meta, surface: true });
  }
  const envelope = await h.builder.assemble(1);
  expect(envelope.prefixLayout.prefixByteHash).toBe(prefix.prefixByteHash);
  expect(envelope.prefixLayout.stablePrefix).toBe(prefix.stablePrefix);
  expect(envelope.prefixLayout.scopedPrefix).toBe(prefix.scopedPrefix);
  expect(envelope.messages.some(message => message.content === task)).toBe(true);
  expect(envelope.messages.find(message => message.toolCallId === 'read2')!.content).toContain('AST skeleton');
  for (const id of ['read19', 'read20', 'read21']) {
    expect(envelope.messages.find(message => message.toolCallId === id)!.content).toContain('unrelated historical implementation detail');
  }
  expect(envelope.messages.find(message => message.toolCallId === 'read0')!.content).toContain('return a - b;');
  const reduction = 1 - envelope.pruning!.prunedTokenCount / envelope.pruning!.originalTokenCount;
  expect(reduction).toBeGreaterThanOrEqual(0.4);
  await expect(h.loop.runTurn('attempt completion before repair')).rejects.toThrow(/Policy Deny/);
  await expect(h.loop.runTurn('repair with tools')).rejects.toThrow(/Policy Deny/);
  expect(fs.readFileSync(path.join(root, 'arithmetic.mjs'), 'utf8')).toContain('return a + b;');
  const results = h.session.replay().filter(record => record.type === 'tool/result');
  const graphResult = results.find(record => record.toolName === 'code_symbol_graph')!;
  expect(graphResult.error).toBeUndefined();
  const graph = JSON.parse(graphResult.content!);
  expect(graph.edges).toEqual([{ fromId: 'caller.mjs#calculate', toId: 'arithmetic.mjs#add', relation: 'references' }]);
  expect(results.find(record => record.toolName === 'Edit')!.error).toBeUndefined();
  const green = await gate.verifyGreenPhase(red.proof, config);
  expect(green.success, green.error).toBe(true);
  expect(green.proof.greenExecution!.exitCode).toBe(0);
  expect(green.proof.regressionExecution!.exitCode).toBe(0);
  expect(green.proof.regressionExecution!.stdout).toContain('3 regression assertions passed');
  expect(green.proof.signature).toBe(createHash('sha256').update(JSON.stringify({ ...green.proof, signature: '' })).digest('hex'));
  expect((await h.loop.runTurn('complete after independent Green')).kind).toBe('success');
  const final = await h.builder.assemble(1);
  expect(final.prefixLayout.prefixByteHash).toBe(prefix.prefixByteHash);
  expect(final.messages.some(message => message.content === task)).toBe(true);
  expect(h.session.replay().filter(record => record.type === 'audit/denial' && record.ruleRef === 'gate:red-green').length).toBeGreaterThanOrEqual(2);
  // Optional delivery capture is evaluator output; ordinary test runs never write repository evidence.
  const evidence = { proof: green.proof, prefixByteHash: prefix.prefixByteHash,
    reduction, originalTokenCount: envelope.pruning!.originalTokenCount, prunedTokenCount: envelope.pruning!.prunedTokenCount,
    exactReferenceEdges: graph.edges };
  if (process.env.VESSEL_V23_CAPTURE === '1') fs.writeFileSync(path.join(repo,
    'evidence/sessions/2026-10-08-v2.3/card199-evaluator-proof.json'), JSON.stringify(evidence, null, 2));
}, 30_000);
