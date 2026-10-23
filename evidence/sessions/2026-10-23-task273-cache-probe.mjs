// In-memory JSON fixtures only. Run after the coordinator's shared build.
import assert from 'node:assert/strict';
import { canonicalArgumentsHash, projectSession } from '../../packages/shared/dist/index.js';

const source = [
  { type: 'user/message', seq: 1, ts: '2026-10-23T00:00:00Z', content: 'keep the goal' },
  { type: 'tool/result', seq: 2, ts: '2026-10-23T00:00:01Z', toolCallId: 'read-1', content: 'original', meta: { nested: { value: 1 } } },
];
const provenance = { schemaVersion: 1, sourceSessionId: 'task273-probe', sourceStart: 1, sourceEnd: 2,
  sourceHash: canonicalArgumentsHash(source), pendingApprovalRefs: ['approval-1'] };
const summary = 'fixture summary';
const events = [...source, { type: 'compaction/end', seq: 3, ts: '2026-10-23T00:00:02Z', outcome: 'committed',
  projectionCommit: { expectedRevision: 0, startSeq: 1, endSeq: 2, summary,
    metadata: { provenance, summaryHash: canonicalArgumentsHash({ summary, provenance }) } } }];
const projection = projectSession('task273-probe', events);
assert.deepEqual(projection.visibleMessages[0].metadata.provenance, provenance);
assert.equal(provenance.sourceHash, canonicalArgumentsHash(JSON.parse(JSON.stringify(events.filter(record =>
  record.seq >= provenance.sourceStart && record.seq <= provenance.sourceEnd
  && record.type !== 'compaction/start' && record.type !== 'compaction/end')))));

const cases = {
  summary: (records, commit) => { commit.summary += ' changed'; },
  provenance: (records, commit) => { commit.metadata.provenance.pendingApprovalRefs = []; },
  source: records => { records[1].content += ' changed'; },
  sourceHash: (records, commit) => {
    commit.metadata.provenance.sourceHash = 'forged';
    commit.metadata.summaryHash = canonicalArgumentsHash({ summary: commit.summary, provenance: commit.metadata.provenance });
  },
  nestedSource: records => { records[1].meta.nested.value = 2; },
  replacedSource: records => { records[1] = { ...records[1], content: 'replacement' }; },
  removedSource: records => { records.splice(1, 1); },
};
const results = [];
for (const [name, tamper] of Object.entries(cases)) {
  const records = structuredClone(events);
  assert.equal(projectSession('task273-probe', records).revision, 1);
  const commit = records.at(-1).projectionCommit;
  tamper(records, commit);
  assert.throws(() => projectSession('task273-probe', records), error => error.message === 'Compaction evidence hash mismatch');
  results.push({ name, warmCacheMutationRejected: true });
}
assert.equal(projectSession('task273-probe', events).revision, 1);
console.log(JSON.stringify({ metadataProvenanceRetained: true, independentlyRecomputedSourceHash: true, results }, null, 2));
