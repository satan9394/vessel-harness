// Offline adversarial probes. No real credentials, network, sessions or deletions.
// Run after `npx tsc -b`: node evidence/sessions/2026-10-20-codex-adversarial-review-249-probes.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityRoutes } from '../../apps/local-server/dist/routes/activityRoutes.js';
import { ProviderRoutes } from '../../apps/local-server/dist/routes/providerRoutes.js';
import { EffectJournal } from '../../packages/runtime/dist/executor/EffectJournal.js';
import { assertCompactionConservation } from '../../packages/context/dist/compaction/assertCompactionConservation.js';
import { Compaction } from '../../packages/context/dist/compaction/Compaction.js';
const verify250 = process.argv.includes('--verify-250');
const verify251 = process.argv.includes('--verify-251');
const verify252 = process.argv.includes('--verify-252');

if (verify252) {
  const { composeHarness } = await import('../../packages/application/dist/compose.js');
  const { Session } = await import('../../packages/core/dist/index.js');
  const { MockProvider } = await import('../../packages/llm/dist/index.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-audit252-'));
  const file = path.join(root, 'execution.jsonl');
  const call = { toolCallId: 'durable', toolName: 'Write', arguments: {} };
  const tool = { name: 'Write', requiredPermission: 'workspace-write', effects: 'non_idempotent' };
  const invocation = { canonicalToolId: 'builtin:Write', subject: { sessionId: 'audit', runId: 'r', agentInstanceId: 'a' }, argumentsCanonicalHash: 'hash', requestedScopes: [] };
  new EffectJournal(file).begin(call, tool, invocation);
  const prefix = fs.readFileSync(file);
  fs.appendFileSync(file, '{"kind":"intent","key":"call-partial');
  const recovered = new EffectJournal(file);
  assert.deepEqual(fs.readFileSync(file), prefix);
  assert.equal(recovered.pending().length, 1);
  assert.throws(() => recovered.begin(call, tool, invocation), /OUTCOME_UNKNOWN/);
  recovered.finish(call, { content: 'reconciled', meta: {} });
  assert.equal(new EffectJournal(file).pending().length, 0);
  const repo = path.resolve(import.meta.dirname, '../..');
  const options = { workspaceRoot: root, sessionId: 'retry', provider: new MockProvider([]), model: 'mock', memory: { enabled: false },
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') };
  await assert.rejects(composeHarness({ ...options, adaptivePruning: { tokenThreshold: 100, targetTokenBudget: 0, preserveRecentTurns: 3 } }), /adaptivePruning requires symbolGraph/);
  assert.equal(fs.existsSync(path.join(root, '.harness/sessions/retry/.lease')), false);
  const reopened = await Session.open({ workspaceRoot: root, sessionId: 'retry' });
  await reopened.close();
  await assert.rejects(composeHarness({ ...options, mods: ['missing-mod'] }));
  const harness = await composeHarness(options);
  await harness.close();
  console.log('F5 resolved: torn-tail repair preserves durable intent and replay protection; subsequent appends reload; synchronous/asynchronous composition failures release lease for immediate reopen.');
  console.log('Task 252 offline controls PASS; fixture retained at ' + root);
  process.exit(0);
}

if (!verify251) {
const activity = new ActivityRoutes({ sessions: async () => [{ id: 'crashed', workspaceRoot: '/fixture', recordCount: 3 }],
  live: () => undefined, approvals: () => [], subagents: async () => [], teamStages: () => [], goalTasks: () => [] });
const row = (await activity.list()).runs[0];
assert.equal(row.status, verify250 ? 'unknown' : 'completed');
assert.equal(row.outcome, verify250 ? 'unknown' : 'completed');
console.log(`F1 ${verify250 ? 'resolved' : 'reproduced'}: recordCount=3, no terminal evidence => ${row.status} / source=${row.statusSource}`);

const synthetic = 'AUDIT_SYNTHETIC_CREDENTIAL_249';
const saved = { id: 'saved', protocol: 'openai-compatible', baseUrl: 'https://saved.invalid/v1', apiKey: synthetic, model: 'fixture' };
let captured;
const providers = new ProviderRoutes(() => ({ get: id => id === 'saved' ? saved : undefined, update: () => {} }), async (url, options) => {
  captured = { url, hasSavedCredential: options.headers.Authorization === `Bearer ${synthetic}` };
  return new Response(JSON.stringify({ data: [] }), { status: 200 });
});
const tested = await providers.test({ name: 'saved', protocol: 'openai-compatible', baseUrl: 'https://different.invalid/v1', apiKey: '' });
assert.equal(captured.hasSavedCredential, true);
assert.equal(captured.url, verify250 ? 'https://saved.invalid/v1/models' : 'https://different.invalid/v1/models');
assert.equal(JSON.stringify(tested).includes(synthetic), false);
console.log(`F2 ${verify250 ? 'resolved: saved endpoint receives saved Authorization' : 'reproduced: caller endpoint receives saved Authorization'}; fetch stub only`);
if (verify250) {
  for (const method of ['test', 'pullModels']) {
    for (const apiKey of ['', undefined]) {
      const result = await providers[method]({ name: 'saved', protocol: 'anthropic', baseUrl: 'https://different.invalid/v1', apiKey });
      assert.equal(result.ok, true);
      assert.equal(captured.url, 'https://saved.invalid/v1/models');
      assert.equal(captured.hasSavedCredential, true);
    }
  }
  console.log('F2 regression: test/pullModels with empty/omitted key and spoofed protocol stay bound');
}

const reflected = new ProviderRoutes(() => ({ get: () => saved, update: () => {} }), async () =>
  new Response(JSON.stringify({ data: [{ id: synthetic }] }), { status: 200 }));
const reflectedResult = await reflected.test({ name: 'saved', protocol: saved.protocol, baseUrl: saved.baseUrl, apiKey: '' });
assert.equal(JSON.stringify(reflectedResult).includes(synthetic), !verify250);
console.log(verify250 ? 'F3 resolved: credential-bearing model IDs rejected' : 'F3 reproduced: upstream model id reflecting the synthetic credential survives response; value suppressed from log');
if (verify250) {
  assert.deepEqual(reflectedResult, { ok: false, error: 'invalid_models_response' });
  console.log('Task 250 controls PASS (offline stubs; no real credential or upstream request).');
  process.exit(0);
}

}

const labelOnly = () => assertCompactionConservation({ originalMessages: [{ id: 'anchor', role: 'assistant', content: 'ESSENTIAL_ANCHOR' }],
  compactedMessages: [{ role: 'assistant', content: 'unrelated', metadata: { keepID: 'anchor' } }], requiredKeepIds: ['anchor'] });
if (verify251) assert.throws(labelOnly, error => error.violationType === 'keep_id_lost');
else labelOnly();
console.log(verify251 ? 'F4 resolved: label without anchor content rejected (keep_id_lost)' : 'F4 reproduced: keepID label alone passes conservation with anchor content lost');

const records = Array.from({ length: 6 }, (_, i) => ({ seq: i + 1, ts: new Date(0).toISOString(),
  type: 'user/message', content: `fixture-${i}`, metadata: { keepID: `keep-${i}` } }));
const fakeSession = { sessionId: 'audit', replay: () => records.slice(), appendSync: async record => {
  const appended = { ...record, seq: records.length + 1, ts: new Date(0).toISOString() }; records.push(appended); return appended;
} };
const compacted = await new Compaction({ session: fakeSession, summarize: async () => 'ordinary summary' }).compact('manual');
assert.ok(compacted.removedRecords > 0);
assert.equal(compacted.summary.includes('keep-0'), verify251);
if (verify251) {
  const commit = records.find(record => record.outcome === 'committed').projectionCommit;
  assert.ok(commit.metadata.keepIds.includes('keep-0'));
  assert.ok(compacted.summary.includes('fixture-0'));
  console.log('F4 production PASS: keep-0 identity, summary metadata and anchor content conserved');
  process.exit(0);
}
console.log('F4 production probe: Compaction committed summary without keep-0 metadata; source records retained');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-audit249-'));
// Retained intentionally: audit never invokes physical deletion, including cleanup.
const file = path.join(root, 'execution.jsonl');
fs.writeFileSync(file, '{"kind":"intent","key":"torn');
assert.throws(() => new EffectJournal(file), SyntaxError);
console.log('F5 reproduced: torn journal tail throws SyntaxError at construction; fixture retained at ' + root);
console.log('All 6 offline probes reproduced the documented counterexamples (exit 0 means reproduction, not control PASS).');
