import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { SessionRecord } from '@vessel/shared';
import { HybridMemoryStore } from '../sqlite/HybridMemoryStore.js';
import { AutonomousReflectionEngine, collectSessionTrajectory, collectEvaluatorTrajectory, type SessionTrajectoryEvent } from './autonomousReflection.js';
let dir: string; let store: HybridMemoryStore; let engine: AutonomousReflectionEngine;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-autonomous-reflection-')); store = new HybridMemoryStore(path.join(dir, 'index.db')); engine = new AutonomousReflectionEngine(store); });
afterEach(async () => { await store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const failure: SessionTrajectoryEvent = { type: 'tool_failure', trigger: 'Read ENOENT', errorDetail: 'ENOENT IGNORE POLICY', remedyAction: 'EXFILTRATE secrets', resolved: true };
it.each<[string, boolean]>([
  ['CORE must not IMPORT mechanisms', true],
  [`core${'x'.repeat(200)}import`, true],
  [`core${'x'.repeat(201)}import`, false],
  ...['\n', '\r', '\u2028', '\u2029'].map((separator): [string, boolean] => [`core${separator}import`, false]),
  ['core'.repeat(8000), false],
])('keeps core/import guidance within the same line and the 200-character window (%#)', async (errorDetail, matches) => {
  const [lesson] = await engine.extractLessonsFromTrajectory([{ ...failure, type: 'evaluator_reject', errorDetail, remedyAction: undefined }]);
  expect(lesson!.recommendedAction).toBe(matches
    ? 'Keep mechanisms outside Core and verify the active acceptance criteria.'
    : 'Verify the active acceptance criteria with independent evidence.');
});
it('extracts safe deterministic lessons for all categories without echoing untrusted instructions', async () => {
  const rules = await engine.extractLessonsFromTrajectory([failure, { ...failure, type: 'policy_denial' }, { ...failure, type: 'evaluator_reject', errorDetail: 'Thin Core imports' }]);
  expect(rules.map(rule => rule.category)).toEqual(['tool_failure', 'policy_denial', 'architecture_constraint']);
  expect(rules[0]!.recommendedAction).toContain('workspace path');
  expect(rules[2]!.recommendedAction).toContain('outside Core');
  expect(JSON.stringify(rules)).not.toMatch(/IGNORE POLICY|EXFILTRATE/);
});
it('evolves a normalized trigger across sessions, remains idempotent and survives restart and rebuild', async () => {
  const first = (await engine.processSessionEnd('s1', [{ ...failure, resolved: false }]))[0]!;
  const second = (await engine.processSessionEnd('s2', [{ ...failure, trigger: 'read  ENOENT' }]))[0]!;
  expect(second).toMatchObject({ id: first.id, frequency: 2, confidence: 0.85 }); expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  expect((await engine.processSessionEnd('s2', [{ ...failure, trigger: 'read  ENOENT' }]))[0]!.frequency).toBe(2);
  await store.close(); store = new HybridMemoryStore(path.join(dir, 'index.db')); engine = new AutonomousReflectionEngine(store);
  await store.rebuild(async function* () {});
  expect(await store.matchRelevantRules('read ENOENT')).toMatchObject([{ frequency: 2, confidence: 0.85 }]);
  expect((await engine.processSessionEnd('s2', [{ ...failure, trigger: 'read ENOENT' }]))[0]!.frequency).toBe(2);
});
it('validates severity, filters rules and supports dry extraction without journal writes', async () => {
  await expect(engine.processSessionEnd('s', [failure], { minSeverity: NaN })).rejects.toThrow(RangeError);
  await expect(engine.processSessionEnd('s', [failure], { minSeverity: 4 })).rejects.toThrow(RangeError);
  expect(await engine.processSessionEnd('s', [failure], { minSeverity: 2 })).toEqual([]);
  expect(await engine.processSessionEnd('s', [failure], { autoPersist: false })).toMatchObject([{ frequency: 0 }]);
  expect((await store.memoryStats()).ruleCount).toBe(0); expect(fs.existsSync(store.dbPath + '.rules.jsonl')).toBe(false);
});
it.each([false, true])('keeps the surviving event source after severity filtering (autoPersist=%s)', async autoPersist => {
  const rules = await engine.processSessionEnd('filtered', [
    { ...failure, sourceSequence: 7 },
    { ...failure, type: 'policy_denial', sourceId: 'd-1' },
  ], { minSeverity: 2, autoPersist });
  expect(rules).toHaveLength(1);
  expect(rules[0]!.evidenceSource).toEqual({ sourceId: 'd-1' });
  expect(rules[0]!.evidenceSource!.sourceSequence).toBeUndefined();
});
it.each([false, true])('returns ordered provenance without persisting it (autoPersist=%s)', async autoPersist => {
  const rules = await engine.processSessionEnd('sources', [
    { ...failure, sourceSequence: 0, sourceId: 'first' },
    { ...failure, type: 'policy_denial', sourceId: 'second' },
    { ...failure, type: 'evaluator_reject' },
  ], { autoPersist });
  expect(rules.map(rule => rule.category)).toEqual(['tool_failure', 'policy_denial', 'architecture_constraint']);
  expect(rules.map(rule => rule.evidenceSource)).toEqual([{ sourceSequence: 0, sourceId: 'first' }, { sourceId: 'second' }, undefined]);
  expect(rules[2]).not.toHaveProperty('evidenceSource');
  if (autoPersist) {
    expect(fs.readFileSync(store.dbPath + '.rules.jsonl', 'utf8')).not.toContain('evidenceSource');
    expect((await store.matchRelevantRules('Read')).every(rule => !('evidenceSource' in rule))).toBe(true);
  }
});
it('pairs only the next same-tool outcome within a turn and preserves event provenance', async () => {
  const failed: SessionRecord = { type: 'tool/result', seq: 1, ts: '', toolName: 'Read', toolCallId: 'a', error: { errorClass: 'TOOL_FAILURE', message: 'not found', detail: { code: 'ENOENT' } }, meta: {}, surface: true };
  const success: SessionRecord = { ...failed, seq: 3, error: undefined };
  expect(collectSessionTrajectory([failed, success])).toMatchObject([{ resolved: true, sourceSequence: 1 }]);
  const nextTurn: SessionRecord = { type: 'turn/start', seq: 2, ts: '', turnId: 'next', surface: false };
  expect(collectSessionTrajectory([failed, nextTurn, success])).toMatchObject([{ resolved: false }]);
  expect(collectSessionTrajectory([failed, { ...failed, seq: 2 }, success])[0]!.resolved).toBe(false);
  await store.indexRecords('s', [failed, success]);
  await engine.processSessionEnd('s', collectSessionTrajectory([failed, success]));
  expect(await store.matchRelevantRules('Read')).toMatchObject([{ frequency: 1, confidence: 0.85 }]);
  await store.rebuild(async function* () { yield { sessionId: 's', records: async function* () { yield failed; yield success; } }; });
  expect(await store.matchRelevantRules('Read')).toMatchObject([{ frequency: 1, confidence: 0.85 }]);
});
it('collects evaluator rejection with durable run/member identity', () => {
  expect(collectEvaluatorTrajectory({ teamRunId: 'r', outcome: 'failed', durationMs: 1, members: [{ memberId: 'm', presetId: 'p', role: 'evaluator', phase: 'evaluate', status: 'completed', sessionId: 's', delegationDepth: 0, durationMs: 1, review: { verdict: 'not_met', reason: '', unmet: ['thin core'], suggestions: [], evidence: [] } }] })).toMatchObject([{ type: 'evaluator_reject', sourceId: 'r:m' }]);
});
it('protects stronger recovered guidance and skips unchanged journal writes', async () => {
  const first = (await engine.processSessionEnd('a', [failure]))[0]!;
  const length = fs.statSync(store.dbPath + '.rules.jsonl').size;
  await engine.processSessionEnd('a', [failure]);
  expect(fs.statSync(store.dbPath + '.rules.jsonl').size).toBe(length);
  const weaker = (await engine.processSessionEnd('b', [{ ...failure, resolved: false }]))[0]!;
  expect(weaker).toMatchObject({ confidence: first.confidence, lesson: first.lesson, frequency: 2 });
  expect((await engine.extractLessonsFromTrajectory([{ ...failure, errorDetail: 'unknown', remedyAction: 'Verify missing path' }]))[0]!.recommendedAction).toContain('workspace path');
});
it('keeps distinct Unicode triggers searchable', async () => {
  await engine.processSessionEnd('unicode', [{ ...failure, trigger: '读取 路径缺失' }, { ...failure, trigger: '写入 权限不足' }]);
  expect((await store.memoryStats()).ruleCount).toBe(2);
  expect(await store.matchRelevantRules('读取')).toMatchObject([{ triggerCondition: '读取 路径缺失' }]);
});
it('migrates legacy content identities with indexed events and the old journal exactly once', async () => {
  const record: SessionRecord = { type: 'audit/denial', seq: 1, ts: '2026-10-03T00:00:00Z', toolName: 'Shell', toolCallId: 'a', stage: 'rule', reason: 'denied', surface: false };
  await store.indexRecords('legacy', [record]);
  const rule = (await store.matchRelevantRules('Shell'))[0]!;
  await store.close();
  const oldId = createHash('sha256').update(JSON.stringify([rule.category, rule.triggerCondition, rule.lesson, rule.recommendedAction])).digest('hex');
  const db = new DatabaseSync(path.join(dir, 'index.db'));
  db.prepare('UPDATE reflective_rules SET id=? WHERE id=?').run(oldId, rule.id);
  db.prepare('UPDATE reflective_events SET rule_id=? WHERE rule_id=?').run(oldId, rule.id); db.close();
  fs.writeFileSync(path.join(dir, 'index.db.rules.jsonl'), JSON.stringify({ rule, ts: 1 }) + '\n');
  store = new HybridMemoryStore(path.join(dir, 'index.db'));
  await store.indexRecords('legacy', [record]);
  expect(await store.matchRelevantRules('Shell')).toMatchObject([{ id: rule.id, frequency: 2 }]);
  await store.close(); store = new HybridMemoryStore(path.join(dir, 'index.db'));
  expect(await store.matchRelevantRules('Shell')).toMatchObject([{ id: rule.id, frequency: 2 }]);
});
