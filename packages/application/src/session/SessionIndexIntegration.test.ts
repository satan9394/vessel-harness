import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { streamJsonlRecords } from '@vessel/memory';
import { SessionRegistry } from './SessionRegistry.js';
import { SessionController } from './SessionController.js';

let root: string; const registries: SessionRegistry[] = []; const controllers: SessionController[] = [];
const repo = path.resolve(import.meta.dirname, '..', '..', '..', '..');
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-index-app-')); });
afterEach(async () => { vi.restoreAllMocks(); for (const ctl of controllers.splice(0)) await ctl.close().catch(() => {}); for (const registry of registries.splice(0)) await registry.closeIndex(); fs.rmSync(root, { recursive: true, force: true }); });
const registry = (options: ConstructorParameters<typeof SessionRegistry>[0] = {}) => { const value = new SessionRegistry({ vesselHome: path.join(root, 'home'), index: true, ...options }); registries.push(value); return value; };
const controller = async (store: SessionRegistry) => {
  const value = await SessionController.create({ workspaceRoot: root, provider: new MockProvider([{ when: /.*/, response: { text: 'Resilient architecture conclusion' } }], { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheCreationTokens: 4 } }),
    model: 'mock', policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml'), registry: store });
  controllers.push(value); return value;
};

describe('production application session index integration', () => {
  it('does not open a caller-owned SQLite cache on ordinary turns until queried', async () => {
    const store = registry({ index: undefined }); const ctl = await controller(store);
    await ctl.runTurn('Caller owns optional index');
    expect(fs.existsSync(path.join(root, 'home', 'cache', 'session_index.db'))).toBe(false);
    await store.listIndexed(); expect(store.indexAvailable).toBe(true);
    await ctl.runTurn('Incremental after query');
    expect(await store.listIndexed()).toMatchObject([{ totalTokens: 240 }]);
  });
  it('does not advance an older projection cursor over a newer turn awaiting its model', async () => {
    const store = registry(); const ctl = await controller(store);
    let releaseProjection!: () => void; let projected!: () => void; let releaseModel!: () => void; let modelEntered!: () => void;
    const projectionGate = new Promise<void>(resolve => { releaseProjection = resolve; });
    const projectedGate = new Promise<void>(resolve => { projected = resolve; });
    const modelGate = new Promise<void>(resolve => { releaseModel = resolve; });
    const enteredGate = new Promise<void>(resolve => { modelEntered = resolve; });
    const project = store.projectRecords.bind(store); let calls = 0;
    vi.spyOn(store, 'projectRecords').mockImplementation(async (id, records) => {
      await project(id, records);
      if (++calls === 1) { projected(); await projectionGate; }
    });
    const first = ctl.runTurn('First indexed prompt'); await projectedGate;
    const off = ctl.bus.on('before_model', async () => { modelEntered(); await modelGate; }, 'test:held-model');
    const second = ctl.runTurn('UniqueSecondKeyword'); await enteredGate;
    releaseProjection(); await first; releaseModel(); await second; off();
    expect(await store.search({ query: 'UniqueSecondKeyword' })).toHaveLength(1);
  });
  it('durably records per-call usage and only projects new records on ordinary turns', async () => {
    let sourceReads = 0;
    const store = registry({ recordSource: meta => { sourceReads++; return streamJsonlRecords(path.join(meta.workspaceRoot, '.harness', 'sessions', meta.id, 'session.jsonl')); } });
    const ctl = await controller(store); await ctl.runTurn('Discuss resilient architecture'); await ctl.runTurn('Continue architecture');
    expect(sourceReads).toBe(1);
    expect(ctl.session.replay().filter(record => record.type === 'model/usage')).toHaveLength(2);
    expect(await store.listIndexed()).toMatchObject([{ id: ctl.sessionId, totalTokens: 240, inputTokens: 200, outputTokens: 40, cacheReadTokens: 120, cacheCreationTokens: 8 }]);
    expect(await store.search({ query: 'resil arch' })).not.toHaveLength(0);
  });
  it('restores metadata/title/topic from JSONL over a conflicting compatibility view, including tombstones', async () => {
    let store = registry(); const first = store.create({ workspaceRoot: root }); const second = store.create({ workspaceRoot: root });
    store.nameTopicFromPrompt(first.id, 'Original title'); store.renameTopic(first.id, 'Authoritative title'); store.setTopicArchived(first.id, true); store.remove(second.id);
    await store.listIndexed(); await store.closeIndex();
    fs.writeFileSync(path.join(root, 'home', 'sessions.json'), JSON.stringify({ sessions: [{ ...first, topic: { topicId: 'wrong', title: 'wrong', createdAt: 0, updatedAt: 0 } }, second] }));
    store = registry(); expect(store.list()).toHaveLength(1); expect(store.get(second.id)).toBeUndefined();
    expect(await store.listIndexed()).toMatchObject([{ id: first.id, topic: { title: 'Authoritative title', isArchived: true } }]);
  });
  it('reconciles a rewritten/compacted prefix instead of retaining stale rows', async () => {
    const store = registry(); const ctl = await controller(store); await ctl.runTurn('Before compaction architecture');
    await ctl.session.replaceRegion(1, ctl.session.size, { type: 'user/message', msgId: 'summary', role: 'user', content: 'Compacted summary', source: 'compacted-summary', surface: true });
    await ctl.runTurn('After compaction'); expect(await store.listIndexed()).toMatchObject([{ totalTokens: 120 }]);
    expect(await store.search({ query: 'Before compaction' })).toEqual([]);
  });
  it('does not let an optional SQLite failure break authoritative session writes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = registry({ indexFactory: () => { throw new Error('node:sqlite unavailable'); } }); const ctl = await controller(store);
    expect((await ctl.runTurn('Offline fallback')).kind).toBe('success'); expect(await store.listIndexed()).toMatchObject([{ id: ctl.sessionId }]); expect(store.indexAvailable).toBe(false);
    const journal = fs.readFileSync(path.join(root, 'home', 'sessions.metadata.jsonl'), 'utf8'); expect(journal).toContain(ctl.sessionId);
  });
  it('exposes model-usage JSONL failures at turn/close even though emit isolates observer failures', async () => {
    const store = registry({ index: false }); const ctl = await controller(store); const original = ctl.session.appendSync.bind(ctl.session);
    vi.spyOn(ctl.session, 'appendSync').mockImplementation(record => record.type === 'model/usage' ? Promise.reject(new Error('usage disk full')) : original(record));
    await expect(ctl.runTurn('Must persist usage')).rejects.toThrow('usage disk full'); await expect(ctl.close()).rejects.toThrow('usage disk full');
  });
  it('exposes authoritative metadata append failures without replacing the compatibility view', () => {
    const store = registry({ index: false }); const meta = store.create({ workspaceRoot: root });
    const file = path.join(root, 'home', 'sessions.json'); const previous = fs.readFileSync(file, 'utf8');
    const journal = path.join(root, 'home', 'sessions.metadata.jsonl'); fs.renameSync(journal, journal + '.retained'); fs.mkdirSync(journal);
    expect(() => store.renameTopic(meta.id, 'Cannot persist')).toThrow(); expect(fs.readFileSync(file, 'utf8')).toBe(previous);
  });
  it('preserves compatibility JSON if the metadata journal has no valid record and blocks silent overwrite', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = registry({ index: false }); const meta = store.create({ workspaceRoot: root }); const file = path.join(root, 'home', 'sessions.json'); const previous = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(path.join(root, 'home', 'sessions.metadata.jsonl'), '{broken'); const recovered = registry({ index: false });
    expect(recovered.get(meta.id)).toBeDefined(); expect(() => recovered.touch(meta.id)).toThrow('no recoverable'); expect(fs.readFileSync(file, 'utf8')).toBe(previous);
  });
});
