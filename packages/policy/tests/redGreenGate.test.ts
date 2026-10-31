import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { RedGreenGate, PolicyEngine, compilePolicyYaml, type RedGreenGateConfig } from '../src/index.js';

let root: string;
let config: RedGreenGateConfig;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-red-green-'));
  fs.writeFileSync(path.join(root, 'value.cjs'), 'module.exports=0');
  fs.writeFileSync(path.join(root, 'repro.cjs'), "require('node:assert/strict').equal(require('./value.cjs'),1,'TARGET_BUG')");
  config = { cwd: root, reproductionCommand: { executable: process.execPath, args: ['repro.cjs'] },
    fullSuiteCommand: { executable: process.execPath, args: ['repro.cjs'] }, reproductionFiles: ['repro.cjs'], sourceFiles: ['value.cjs'], allowBaselineFailureReasons: ['TARGET_BUG'] };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const fix = () => fs.writeFileSync(path.join(root, 'value.cjs'), 'module.exports=1');
it('rejects false positives and missing full regression configuration', async () => {
  fix(); const gate = new RedGreenGate();
  expect(await gate.verifyRedPhase(config)).toMatchObject({ success: false, proof: { phase: 'rejected', redExecution: { exitCode: 0 } } });
  expect((await gate.verifyRedPhase({ ...config, fullSuiteCommand: undefined })).success).toBe(false);
});
it('records real target assertion failure and refuses unfinished repairs', async () => {
  const gate = new RedGreenGate(); const red = await gate.verifyRedPhase(config);
  expect(red.success).toBe(true); expect(red.proof.redExecution.stderr).toContain('AssertionError');
  expect(red.proof.signature).toMatch(/^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(root, 'value.cjs'), 'module.exports=2');
  expect(await gate.verifyGreenPhase(red.proof, config)).toMatchObject({ success: false, proof: { phase: 'rejected', greenExecution: { exitCode: 1 } } });
  expect(gate.completionVerdict()?.action).toBe('deny');
});
it.each([
  ['legacy assertion header', true],
  ['Node 26 assertion header', true],
  ['unknown internal header', false],
  ['missing line number', false],
  ['second assertion', false],
  ['unrelated error', false],
  ['missing target', false],
  ['missing version tail', false],
  ['trailing diagnostic', false],
  ['stdout diagnostic', false],
] as const)('keeps uncaught assertion classification strict: %s', async (variant, accepted) => {
  // 固定模板：不给分类器喂「本机 Node 版本 + 平台」决定的真实 stderr。
  // 真实形状（Node 26）：首行 node:internal/assert/utils:<n>，末行 Node.js vX.Y.Z。
  // 之前从 process.execPath 实跑一遍再替换首行，Windows/Node 22 上首行结构不同，
  // 导致某些本该被拒的变体反而通过（CI windows-latest, 22）。
  let stderr = [
    'node:internal/assert/utils:146',
    '  throw error;',
    '  ^',
    '',
    'AssertionError [ERR_ASSERTION]: TARGET_BUG',
    '',
    'Node.js v26.13.0',
  ].join('\n');
  if (variant === 'legacy assertion header') stderr = stderr.replace(/^.*\n/, 'node:assert:95\n');
  if (variant === 'unknown internal header') stderr = stderr.replace('assert/utils', 'errors');
  if (variant === 'missing line number') stderr = stderr.replace('utils:146', 'utils:');
  if (variant === 'second assertion') stderr = stderr.replace('\nNode.js', '\nAssertionError: TARGET_BUG\nNode.js');
  if (variant === 'unrelated error') stderr = stderr.replace('\nNode.js', '\nTypeError: unrelated\nNode.js');
  if (variant === 'missing target') stderr = stderr.replaceAll('TARGET_BUG', 'OTHER_BUG');
  if (variant === 'missing version tail') stderr = stderr.replace(/\nNode\.js v.*$/, '');
  if (variant === 'trailing diagnostic') stderr += '\nextra diagnostic';
  // Diagnostic fixtures exercise classification, not authenticity of arbitrary child output.
  const script = `process.stderr.write(${JSON.stringify(stderr)});${variant === 'stdout diagnostic' ? "console.log('extra diagnostic');" : ''}process.exit(1)`;
  const result = await new RedGreenGate().verifyRedPhase({ ...config,
    reproductionCommand: { executable: process.execPath, args: ['-e', script] } });
  expect(result.success).toBe(accepted);
});
it('rejects mixed real test failures and ambiguous reports even when a target assertion is present', async () => {
  const gate = new RedGreenGate();
  const mixed = { executable: process.execPath, args: ['-e',
    "const test=require('node:test');const assert=require('node:assert/strict');test('target',()=>assert.equal(0,1,'TARGET_BUG'));test('setup',()=>{throw new SyntaxError('UNRELATED_SETUP_FAILURE')})"] };
  const result = await gate.verifyRedPhase({ ...config, reproductionCommand: mixed });
  expect(result.success).toBe(false);
  expect(result.proof.redExecution.exitCode).toBe(1);
  expect(result.proof.redExecution.stdout + result.proof.redExecution.stderr).toContain('UNRELATED_SETUP_FAILURE');
  expect(gate.completionVerdict()?.action).toBe('deny');
  expect((await gate.verifyRedPhase({ ...config, reproductionCommand: { executable: process.execPath,
    args: ['-e', "console.error('AssertionError: TARGET_BUG');process.exit(1)"] } })).success).toBe(false);
});
it('rejects a changing Red baseline and an unchanged source repair', async () => {
  const gate = new RedGreenGate();
  const red = await gate.verifyRedPhase(config);
  expect((await gate.verifyGreenPhase(red.proof, config)).error).toContain('No source repair');
  config.reproductionCommand = { executable: process.execPath, args: ['-e', "require('node:fs').writeFileSync('value.cjs','module.exports=1');require('node:assert/strict').fail('TARGET_BUG')"] };
  expect((await gate.verifyRedPhase(config)).success).toBe(false);
});
it('permits completion only after real Green plus full suite; later edits invalidate it', async () => {
  const gate = new RedGreenGate(); const red = await gate.verifyRedPhase(config); fix();
  const green = await gate.verifyGreenPhase(red.proof, config);
  expect(green).toMatchObject({ success: true, proof: { phase: 'green_verified', regressionPassed: true, regressionExecution: { exitCode: 0 } } });
  expect(gate.completionVerdict(path.join(root, 'other-workspace'))?.action).toBe('deny');
  const policy = new PolicyEngine(compilePolicyYaml('version: "0.1"\nprofile: danger-full-access\napproval: never'), [call => call.toolName === 'claim_task_complete' ? gate.completionVerdict() : undefined]);
  expect((await policy.decide({ toolName: 'claim_task_complete', arguments: { proof: { phase: 'green_verified' } } })).action).toBe('allow');
  fs.writeFileSync(path.join(root, 'value.cjs'), 'module.exports=2');
  expect((await policy.decide({ toolName: 'claim_task_complete', arguments: {} })).action).toBe('deny');
});
it('rejects modified evaluator tests, command identity and recomputed public signatures', async () => {
  const gate = new RedGreenGate(); const red = await gate.verifyRedPhase(config); fix();
  red.proof.redExecution.stderr = 'forged';
  red.proof.signature = createHash('sha256').update(JSON.stringify({ ...red.proof, signature: '' })).digest('hex');
  expect((await gate.verifyGreenPhase(red.proof, config)).success).toBe(false);
  fs.writeFileSync(path.join(root, 'value.cjs'), 'module.exports=0');
  const next = await gate.verifyRedPhase(config); fix();
  expect((await gate.verifyGreenPhase(next.proof, { ...config, timeoutMs: 5000 })).success).toBe(false);
  fs.writeFileSync(path.join(root, 'value.cjs'), 'module.exports=0');
  const last = await gate.verifyRedPhase(config); fix();
  fs.writeFileSync(path.join(root, 'repro.cjs'), '');
  expect((await gate.verifyGreenPhase(last.proof, config)).success).toBe(false);
});
it('rejects regression failures, unrelated exits, spawn errors, shell syntax and timeouts', async () => {
  const gate = new RedGreenGate();
  config.fullSuiteCommand = { executable: process.execPath, args: ['-e', 'process.exit(7)'] };
  const red = await gate.verifyRedPhase(config); fix();
  expect((await gate.verifyGreenPhase(red.proof, config)).success).toBe(false);
  for (const reproductionCommand of [
    { executable: process.execPath, args: ['-e', 'process.exit(1)'] },
    { executable: 'missing-vessel-executable', args: [] },
    'node repro.cjs && echo fake',
    { executable: process.execPath, args: ['-e', "setTimeout(()=>{},10000)"] },
  ]) expect((await gate.verifyRedPhase({ ...config, reproductionCommand, timeoutMs: 100 })).success).toBe(false);
});
it('unverified completion and cross-evaluator proofs cannot grant authority', async () => {
  const gate = new RedGreenGate(); expect(gate.completionVerdict()?.action).toBe('deny');
  const red = await gate.verifyRedPhase(config); fix();
  expect((await new RedGreenGate().verifyGreenPhase(red.proof, config)).success).toBe(false);
});
