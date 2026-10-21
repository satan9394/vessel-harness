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

const activity = new ActivityRoutes({ sessions: async () => [{ id: 'crashed', workspaceRoot: '/fixture', recordCount: 3 }],
  live: () => undefined, approvals: () => [], subagents: async () => [], teamStages: () => [], goalTasks: () => [] });
const row = (await activity.list()).runs[0];
assert.equal(row.status, 'completed');
console.log('F1 reproduced: recordCount=3, no terminal evidence => completed / source=' + row.statusSource);

const synthetic = 'AUDIT_SYNTHETIC_CREDENTIAL_249';
const saved = { id: 'saved', protocol: 'openai-compatible', baseUrl: 'https://saved.invalid/v1', apiKey: synthetic, model: 'fixture' };
let captured;
const providers = new ProviderRoutes(() => ({ get: id => id === 'saved' ? saved : undefined }), async (url, options) => {
  captured = { url, hasSavedCredential: options.headers.Authorization === `Bearer ${synthetic}` };
  return new Response(JSON.stringify({ data: [] }), { status: 200 });
});
const tested = await providers.test({ name: 'saved', protocol: 'openai-compatible', baseUrl: 'https://different.invalid/v1', apiKey: '' });
assert.equal(captured.hasSavedCredential, true);
assert.equal(captured.url, 'https://different.invalid/v1/models');
assert.equal(JSON.stringify(tested).includes(synthetic), false);
console.log('F2 reproduced: caller endpoint different.invalid receives saved Authorization; normal DTO omits synthetic secret; fetch stub only');

const reflected = new ProviderRoutes(() => ({ get: () => saved, update: () => {} }), async () =>
  new Response(JSON.stringify({ data: [{ id: synthetic }] }), { status: 200 }));
const reflectedResult = await reflected.test({ name: 'saved', protocol: saved.protocol, baseUrl: saved.baseUrl, apiKey: '' });
assert.equal(JSON.stringify(reflectedResult).includes(synthetic), true);
console.log('F3 reproduced: upstream model id reflecting the synthetic credential survives response; value suppressed from log');

assertCompactionConservation({ originalMessages: [{ id: 'anchor', role: 'assistant', content: 'ESSENTIAL_ANCHOR' }],
  compactedMessages: [{ role: 'assistant', content: 'unrelated', metadata: { keepID: 'anchor' } }], requiredKeepIds: ['anchor'] });
console.log('F4 reproduced: keepID label alone passes conservation with anchor content lost');

const records = Array.from({ length: 6 }, (_, i) => ({ seq: i + 1, ts: new Date(0).toISOString(),
  type: 'user/message', content: `fixture-${i}`, metadata: { keepID: `keep-${i}` } }));
const fakeSession = { sessionId: 'audit', replay: () => records.slice(), appendSync: async record => {
  const appended = { ...record, seq: records.length + 1, ts: new Date(0).toISOString() }; records.push(appended); return appended;
} };
const compacted = await new Compaction({ session: fakeSession, summarize: async () => 'ordinary summary' }).compact('manual');
assert.ok(compacted.removedRecords > 0);
assert.equal(compacted.summary.includes('keep-0'), false);
console.log('F4 production probe: Compaction committed summary without keep-0 metadata; source records retained');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-audit249-'));
// Retained intentionally: audit never invokes physical deletion, including cleanup.
const file = path.join(root, 'execution.jsonl');
fs.writeFileSync(file, '{"kind":"intent","key":"torn');
assert.throws(() => new EffectJournal(file), SyntaxError);
console.log('F5 reproduced: torn journal tail throws SyntaxError at construction; fixture retained at ' + root);
console.log('All 6 offline probes reproduced the documented counterexamples (exit 0 means reproduction, not control PASS).');
