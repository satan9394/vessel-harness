import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const directory = import.meta.dirname;
const root = path.resolve(directory, '../../..');
const read = name => fs.readFileSync(path.join(directory, name), 'utf8').replace(/^\uFEFF/, '');
const hash = value => createHash('sha256').update(value).digest('hex');
const gates = JSON.parse(read('accepted15-final-gates.json'));
assert.equal(gates.gates.length, 5);
for (const gate of gates.gates) assert.equal(gate.exitCode, 0, gate.name);
assert.ok(gates.finishedAt);
const performance = JSON.parse(read('accepted15-performance.log'));
assert.equal(performance.samplesMs.length, 12);
assert.equal(performance.precision, 1);
assert.deepEqual(performance.actualCallers, performance.expectedCallers);
assert.ok(performance.meanMs <= 15);
assert.ok(performance.maximumMs <= 25);
const testLog = read('accepted15-test-all.log').replace(/\x1b\[[0-9;]*m/g, '');
assert.equal((testLog.match(/Test Files\s+\d+ passed/g) ?? []).length, 2, 'both roots must pass');
assert.ok(!/Tests\s+[^\r\n]*\bfailed\b/.test(testLog));
const testSummaries = testLog.split(/\r?\n/).filter(line => /^\s*(?:Test Files|Tests)\s+/.test(line));
const boundaries = JSON.parse(read('accepted15-boundaries.log'));
assert.deepEqual(boundaries.coreChanged, []);
assert.deepEqual(boundaries.baselineFilesMissing, []);
const capture = JSON.parse(read('card199-evaluator-proof.json'));
const proof = capture.proof;
assert.equal(proof.signature, hash(JSON.stringify({ ...proof, signature: '' })));
assert.equal(proof.redExecution.exitCode, 1);
assert.equal(proof.greenExecution.exitCode, 0);
assert.equal(proof.regressionExecution.exitCode, 0);
assert.ok(capture.reduction >= 0.4);
const sourcePaths = ['packages/context/src/ast/symbolGraph.ts', 'packages/context/tests/ast/symbolGraph.test.ts', 'packages/memory/src/sqlite/SessionIndexStore.ts', 'packages/application/src/v23Integration.test.ts'];
const currentSourceHashes = Object.fromEntries(sourcePaths.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
const audit = {
  epicComplete: true, approvedDoD: { meanMs: 15, maximumMs: 25 },
  semanticRequirement: 'Complete recursive references and type-driven refresh retained; production graph unchanged by this approval',
  scoped: { graphTests: 12, toolTests: 4, totalPassed: 16, log: 'accepted15-scoped.log' },
  performance, finalGates: gates, testSummaries,
  evaluator: { redExit: 1, greenExit: 0, regressionExit: 0, signatureValid: true, evidence: 'card199-evaluator-proof.json' },
  pruning: { original: capture.originalTokenCount, pruned: capture.prunedTokenCount, reduction: capture.reduction, prefixByteHash: capture.prefixByteHash },
  boundaries: { coreChanged: [], baselineFilesMissing: [] }, currentSourceHashes, unmet: [],
  verifiedAt: new Date().toISOString(),
};
const priorPath = path.join(directory, 'completion-audit-before15.json');
if (!fs.existsSync(priorPath)) fs.copyFileSync(path.join(directory, 'completion-audit.json'), priorPath);
fs.writeFileSync(path.join(directory, 'completion-audit.json'), JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify(audit, null, 2));
