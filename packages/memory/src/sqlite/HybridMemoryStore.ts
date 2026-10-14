import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import type { SessionRecord } from '@vessel/shared';
import { SessionIndexStore, type SessionIndexSource } from './SessionIndexStore.js';
import { jsonlLinesSync } from './jsonlSource.js';

export interface ReflectiveRule {
  id: string;
  category: 'policy_denial' | 'tool_failure' | 'architecture_constraint';
  triggerCondition: string;
  lesson: string;
  recommendedAction: string;
  frequency: number;
  updatedAt: number;
  confidence?: number;
}
export interface HybridSearchParams { query: string; embedding?: number[]; limit?: number; minScore?: number }
export interface HybridSearchResult { sessionId: string; matchedContent: string; rrfScore: number; ftsRank: number; vectorRank: number }
type RuleInput = Omit<ReflectiveRule, 'id' | 'frequency' | 'updatedAt'>;
const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
export const normalizeRuleTrigger = (trigger: string) => trigger.trim().replace(/\s+/g, ' ').toLowerCase();
const identity = (rule: RuleInput) => createHash('sha256').update(JSON.stringify([rule.category, normalizeRuleTrigger(rule.triggerCondition)])).digest('hex');
function vector(value: number[]): void {
  if (!Array.isArray(value) || !value.length || value.length > 4096 || Array.from(value).some(x => typeof x !== 'number' || !Number.isFinite(x))) throw new RangeError('Invalid embedding');
}
/** Scaling first avoids overflow for otherwise valid finite vectors. Zero norms have no semantic evidence. */
export function cosineSimilarity(a: number[], b: number[]): number {
  vector(a); vector(b);
  if (a.length !== b.length) throw new RangeError('Embedding dimensions differ');
  const scaleA = Math.max(...a.map(Math.abs)); const scaleB = Math.max(...b.map(Math.abs));
  if (!scaleA || !scaleB) return 0;
  let dot = 0; let normA = 0; let normB = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]! / scaleA; const y = b[i]! / scaleB; dot += x * y; normA += x * x; normB += y * y; }
  return dot / Math.sqrt(normA * normB);
}
function validateRule(rule: RuleInput): void {
  if (!['policy_denial', 'tool_failure', 'architecture_constraint'].includes(rule.category) ||
    [rule.triggerCondition, rule.lesson, rule.recommendedAction].some(text => typeof text !== 'string' || !text.trim() || text.length > 2048)) throw new RangeError('Invalid reflective rule');
  if (rule.confidence !== undefined && (!Number.isFinite(rule.confidence) || rule.confidence < 0 || rule.confidence > 1)) throw new RangeError('Invalid rule confidence');
}
/** Deterministic templates consume event facts, never turn arbitrary stderr into instructions. */
export function extractReflectiveRule(record: SessionRecord): RuleInput | undefined {
  if (record.type === 'audit/denial') return {
    category: 'policy_denial', triggerCondition: `${record.toolName || 'input'} ${record.stage} ${record.ruleRef ?? ''}`.trim(),
    lesson: 'A previous action was denied by the active policy.',
    recommendedAction: 'Check the current policy and choose an allowed action; do not bypass enforcement.',
  };
  if (record.type === 'tool/result') {
    const healing = record.meta?.selfHealing as { retries?: { code?: string }[] } | undefined;
    const platformCode = record.error?.detail?.code ?? healing?.retries?.[0]?.code;
    const code = record.error?.errorClass === 'DENIED' ? 'DENIED' :
      typeof platformCode === 'string' && ['EBUSY', 'ETXTBSY', 'ECONNRESET', 'ETIMEDOUT'].includes(platformCode) ? platformCode : record.error?.errorClass;
    if (typeof code === 'string' && (record.error || healing?.retries?.length)) return {
      category: record.error?.errorClass === 'DENIED' ? 'policy_denial' : 'tool_failure',
      triggerCondition: `${record.toolName} ${code}`,
      lesson: record.error ? 'A previous tool invocation failed.' : 'A previous tool invocation required a transient retry.',
      recommendedAction: record.error?.errorClass === 'DENIED' ? 'Check current permissions before invoking this tool.' : 'Inspect current inputs and tool retry safety before retrying; avoid repeating side effects.',
    };
  }
  return undefined;
}

/** Adds hybrid recall and derived lessons to the existing disposable JSONL session projection. */
export class HybridMemoryStore extends SessionIndexStore {
  /**
   * 已索引 embedding 的内存镜像（`sessionId → seq → { vector, content }`）。
   *
   * 它只做**热路径加速**：`memory_embeddings` 表始终是唯一事实源，镜像的每次读写点都与
   * 表内变化严格同点发生（构造/重建/对账时从表重载，写入与删除时同步增删）。这样
   * `searchHybrid` 的向量那一跳不再做「全表 JOIN + 逐行 JSON.parse」，但候选集合、
   * 排序与返回内容与改前逐字节一致。content 随向量一起缓存，因为 JOIN 原本就是从这里取正文。
   */
  private readonly embeddings = new Map<string, Map<number, { vector: number[]; content: string }>>();
  private putEmbedding(sessionId: string, seq: number, vector: number[], content: string): void {
    let bySeq = this.embeddings.get(sessionId);
    if (!bySeq) { bySeq = new Map(); this.embeddings.set(sessionId, bySeq); }
    bySeq.set(seq, { vector: [...vector], content });
  }
  private dropEmbedding(sessionId: string, seq: number): void {
    const bySeq = this.embeddings.get(sessionId); if (!bySeq) return;
    bySeq.delete(seq); if (!bySeq.size) this.embeddings.delete(sessionId);
  }
  private dropEmbeddings(sessionId?: string): void {
    if (sessionId === undefined) this.embeddings.clear(); else this.embeddings.delete(sessionId);
  }
  /** 绑定镜像与表：先清掉该范围，再按表的当前内容重建（覆盖重启、重建与对账三条路径）。 */
  private loadEmbeddings(sessionId?: string): void {
    this.dropEmbeddings(sessionId);
    const sql = `SELECT e.session_id,e.seq,e.embedding,m.content FROM memory_embeddings e JOIN messages_fts m ON m.session_id=e.session_id AND m.seq=e.seq`;
    const rows = sessionId === undefined ? this.db.prepare(sql).all() : this.db.prepare(`${sql} WHERE e.session_id=?`).all(sessionId);
    for (const row of rows) {
      try { this.putEmbedding(String(row.session_id), Number(row.seq), JSON.parse(String(row.embedding)) as number[], String(row.content)); }
      catch { /* 与 jsonl/镜像的既有口径一致：损坏行不进镜像，也不因此让整个 store 打不开 */ }
    }
  }
  constructor(dbPath: string) {
    super(dbPath);
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_embeddings(session_id TEXT NOT NULL,seq INTEGER NOT NULL,embedding TEXT NOT NULL,PRIMARY KEY(session_id,seq));
      CREATE TABLE IF NOT EXISTS reflective_rules(id TEXT PRIMARY KEY,category TEXT NOT NULL,trigger_condition TEXT NOT NULL,lesson TEXT NOT NULL,action TEXT NOT NULL,frequency INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reflective_manual(id TEXT PRIMARY KEY,frequency INTEGER NOT NULL,ts INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reflective_events(session_id TEXT NOT NULL,seq INTEGER NOT NULL,rule_id TEXT NOT NULL,ts INTEGER NOT NULL,PRIMARY KEY(session_id,seq));`);
    this.db.exec('CREATE INDEX IF NOT EXISTS reflective_event_rule ON reflective_events(rule_id);');
    if (!this.db.prepare('PRAGMA table_info(reflective_rules)').all().some(row => row.name === 'confidence')) this.db.exec('ALTER TABLE reflective_rules ADD COLUMN confidence REAL;');
    this.db.exec('CREATE TABLE IF NOT EXISTS reflection_provenance(source TEXT PRIMARY KEY,session_id TEXT,seq INTEGER,rule_id TEXT NOT NULL,ts INTEGER NOT NULL); DELETE FROM reflection_provenance; DELETE FROM reflective_manual;');
    // Migrate previous content-based identities before replaying the durable rule journal.
    for (const row of this.db.prepare('SELECT * FROM reflective_rules').all()) {
      const old = this.readRule(row); const id = identity(old);
      if (id === old.id) continue;
      this.saveRule(old, old.updatedAt, false);
      this.db.prepare('UPDATE reflective_events SET rule_id=? WHERE rule_id=?').run(id, old.id);
      this.db.prepare('DELETE FROM reflective_rules WHERE id=?').run(old.id);
    }
    if (fs.existsSync(dbPath + '.rules.jsonl')) for (const line of jsonlLinesSync(dbPath + '.rules.jsonl')) {
      try { const item = JSON.parse(line) as { rule: RuleInput; ts: number; source?: string; increment?: boolean; indexedSource?: { sessionId: string; seq: number } }; validateRule(item.rule); if (!Number.isFinite(item.ts)) continue;
        const saved = this.saveRule(item.rule, item.ts, item.source ? false : item.increment !== false);
        if (item.source) this.db.prepare('INSERT INTO reflection_provenance VALUES(?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET ts=MAX(ts,excluded.ts)').run(item.source, item.indexedSource?.sessionId ?? null, item.indexedSource?.seq ?? null, saved.id, item.ts); }
      catch { /* ponytail: a torn journal tail is preserved and skipped like session JSONL. */ }
    }
    this.refreshRules();
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS reflective_rules_fts USING fts5(id UNINDEXED,content);
      DELETE FROM reflective_rules_fts;
      INSERT INTO reflective_rules_fts SELECT id,trigger_condition || ' ' || lesson || ' ' || action FROM reflective_rules;
      CREATE TRIGGER IF NOT EXISTS rule_fts_insert AFTER INSERT ON reflective_rules BEGIN
        INSERT INTO reflective_rules_fts VALUES(new.id,new.trigger_condition || ' ' || new.lesson || ' ' || new.action); END;
      CREATE TRIGGER IF NOT EXISTS rule_fts_delete AFTER DELETE ON reflective_rules BEGIN
        DELETE FROM reflective_rules_fts WHERE id=old.id; END;
      CREATE TRIGGER IF NOT EXISTS rule_fts_update AFTER UPDATE ON reflective_rules BEGIN
        DELETE FROM reflective_rules_fts WHERE id=old.id;
        INSERT INTO reflective_rules_fts VALUES(new.id,new.trigger_condition || ' ' || new.lesson || ' ' || new.action); END;`);
    this.restoreEmbeddings();
  }
  private saveRule(rule: RuleInput, updatedAt: number, increment: boolean): ReflectiveRule {
    validateRule(rule); const id = identity(rule);
    if (increment) this.db.prepare('INSERT INTO reflective_manual VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET frequency=reflective_manual.frequency+1,ts=MAX(ts,excluded.ts)').run(id, 1, updatedAt);
    this.db.prepare(`INSERT INTO reflective_rules(id,category,trigger_condition,lesson,action,frequency,updated_at,confidence) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      frequency=reflective_rules.frequency+?,updated_at=MAX(reflective_rules.updated_at,excluded.updated_at),
      lesson=CASE WHEN excluded.confidence IS NOT NULL AND excluded.confidence>=COALESCE(reflective_rules.confidence,0) THEN excluded.lesson ELSE reflective_rules.lesson END,
      action=CASE WHEN excluded.confidence IS NOT NULL AND excluded.confidence>=COALESCE(reflective_rules.confidence,0) THEN excluded.action ELSE reflective_rules.action END,
      confidence=MAX(COALESCE(reflective_rules.confidence,0),COALESCE(excluded.confidence,0))`)
      .run(id, rule.category, rule.triggerCondition, rule.lesson, rule.recommendedAction, increment ? 1 : 0, updatedAt, rule.confidence ?? null, increment ? 1 : 0);
    return this.readRule(this.db.prepare('SELECT * FROM reflective_rules WHERE id=?').get(id)!);
  }
  private readRule(row: Record<string, unknown>): ReflectiveRule {
    return { id: String(row.id), category: row.category as ReflectiveRule['category'], triggerCondition: String(row.trigger_condition), lesson: String(row.lesson),
      recommendedAction: String(row.action), frequency: Number(row.frequency), updatedAt: Number(row.updated_at), ...(row.confidence === null ? {} : { confidence: Number(row.confidence) }) };
  }
  private refreshRules(): void {
    this.db.exec(`UPDATE reflective_rules SET frequency=(SELECT COUNT(*) FROM reflective_events WHERE rule_id=reflective_rules.id)+(SELECT COUNT(*) FROM reflection_provenance p WHERE p.rule_id=reflective_rules.id AND NOT EXISTS(SELECT 1 FROM reflective_events e WHERE e.session_id=p.session_id AND e.seq=p.seq AND e.rule_id=p.rule_id))+COALESCE((SELECT frequency FROM reflective_manual WHERE id=reflective_rules.id),0),
      updated_at=MAX(COALESCE((SELECT MAX(ts) FROM reflection_provenance WHERE rule_id=reflective_rules.id),0),COALESCE((SELECT MAX(ts) FROM reflective_events WHERE rule_id=reflective_rules.id),0),COALESCE((SELECT ts FROM reflective_manual WHERE id=reflective_rules.id),0));
      DELETE FROM reflective_rules WHERE frequency=0;`);
  }
  protected override insert(sessionId: string, record: SessionRecord): void {
    const previous = this.db.prepare('SELECT json FROM records WHERE session_id=? AND seq=?').get(sessionId, record.seq);
    if (previous?.json === JSON.stringify(record)) return;
    super.insert(sessionId, record);
    this.db.prepare('DELETE FROM memory_embeddings WHERE session_id=? AND seq=?').run(sessionId, record.seq);
    this.dropEmbedding(sessionId, record.seq);
    const old = this.db.prepare('SELECT rule_id FROM reflective_events WHERE session_id=? AND seq=?').get(sessionId, record.seq);
    this.db.prepare('DELETE FROM reflective_events WHERE session_id=? AND seq=?').run(sessionId, record.seq);
    if (old) this.db.prepare('UPDATE reflective_rules SET frequency=frequency-1 WHERE id=?').run(old.rule_id!);
    const rule = extractReflectiveRule(record);
    if (rule) {
      const ts = Date.parse(record.ts) || 0; const saved = this.saveRule(rule, ts, false);
      this.db.prepare('INSERT INTO reflective_events VALUES(?,?,?,?)').run(sessionId, record.seq, saved.id, ts);
      this.db.prepare('UPDATE reflective_rules SET frequency=frequency+1,updated_at=MAX(updated_at,?) WHERE id=?').run(ts, saved.id);
    }
    if (old) {
      this.db.prepare('UPDATE reflective_rules SET updated_at=MAX(COALESCE((SELECT MAX(ts) FROM reflective_events WHERE rule_id=?),0),COALESCE((SELECT ts FROM reflective_manual WHERE id=?),0)) WHERE id=?').run(old.rule_id!, old.rule_id!, old.rule_id!);
      this.db.prepare('DELETE FROM reflective_rules WHERE id=? AND frequency=0 AND id NOT IN (SELECT rule_id FROM reflection_provenance)').run(old.rule_id!);
    }
  }
  protected override remove(sessionId: string): void {
    super.remove(sessionId);
    this.db.prepare('DELETE FROM memory_embeddings WHERE session_id=?').run(sessionId);
    this.dropEmbeddings(sessionId);
    this.db.prepare('DELETE FROM reflective_events WHERE session_id=?').run(sessionId); this.refreshRules();
  }
  protected override resetProjection(): void {
    this.db.exec('DELETE FROM memory_embeddings; DELETE FROM reflective_events;'); this.dropEmbeddings(); this.refreshRules();
  }
  async indexEmbedding(sessionId: string, seq: number, embedding: number[]): Promise<void> {
    vector(embedding); await this.queue;
    const message = this.db.prepare('SELECT content FROM messages_fts WHERE session_id=? AND seq=?').get(sessionId, seq);
    if (!message) throw new RangeError('Embedding needs an indexed message');
    const fd = fs.openSync(this.dbPath + '.embeddings.jsonl', 'a', 0o600);
    try { fs.writeSync(fd, '\n' + JSON.stringify({ sessionId, seq, embedding, fingerprint: this.fingerprint(String(message.content)) }) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.db.prepare('INSERT INTO memory_embeddings VALUES(?,?,?) ON CONFLICT(session_id,seq) DO UPDATE SET embedding=excluded.embedding').run(sessionId, seq, JSON.stringify(embedding));
    this.putEmbedding(sessionId, seq, embedding, String(message.content));
  }
  private fingerprint(content: string): string { return createHash('sha256').update(content).digest('hex'); }
  private restoreEmbeddings(sessionId?: string): void {
    const file = this.dbPath + '.embeddings.jsonl';
    // 表是唯一事实源：无论日志是否存在，重放完成后都按表的当前内容重建镜像。
    if (fs.existsSync(file)) {
      const latest = new Map<string, { sessionId: string; seq: number; embedding: number[]; fingerprint: string }>();
      for (const line of jsonlLinesSync(file)) {
        try {
          const item = JSON.parse(line) as { sessionId: string; seq: number; embedding: number[]; fingerprint: string };
          vector(item.embedding);
          if (typeof item.sessionId !== 'string' || !Number.isSafeInteger(item.seq) || item.seq < 1 || typeof item.fingerprint !== 'string') continue;
          if (sessionId === undefined || item.sessionId === sessionId) latest.set(JSON.stringify([item.sessionId, item.seq]), item);
        } catch { /* malformed embedding facts stay in the journal, never mutate session history. */ }
      }
      for (const item of latest.values()) {
        const row = this.db.prepare('SELECT content FROM messages_fts WHERE session_id=? AND seq=?').get(item.sessionId, item.seq);
        if (row && this.fingerprint(String(row.content)) === item.fingerprint) this.db.prepare('INSERT OR REPLACE INTO memory_embeddings VALUES(?,?,?)').run(item.sessionId, item.seq, JSON.stringify(item.embedding));
      }
    }
    this.loadEmbeddings(sessionId);
  }
  override async indexRecords(sessionId: string, records: readonly SessionRecord[]): Promise<void> { await super.indexRecords(sessionId, records); this.refreshRules(); }
  override async reconcileSession(source: SessionIndexSource): Promise<void> { await super.reconcileSession(source); this.refreshRules(); this.restoreEmbeddings(source.sessionId); }
  override async rebuild(sources: () => AsyncIterable<SessionIndexSource>): Promise<void> { await super.rebuild(sources); this.refreshRules(); this.restoreEmbeddings(); }
  async searchHybrid(params: HybridSearchParams): Promise<HybridSearchResult[]> {
    const limit = params.limit ?? 20; const min = params.minScore ?? 0;
    if (typeof params.query !== 'string' || params.query.length > 256 || !Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isFinite(min) || min < 0) throw new RangeError('Invalid hybrid query');
    if (params.embedding) vector(params.embedding);
    await this.queue;
    const candidates = new Map<string, HybridSearchResult>();
    const add = (sessionId: string, seq: number, content: string, rank: number, lane: 'ftsRank' | 'vectorRank') => {
      const key = JSON.stringify([sessionId, seq]); const row = candidates.get(key) ?? { sessionId, matchedContent: content, rrfScore: 0, ftsRank: 0, vectorRank: 0 };
      row[lane] = rank; row.rrfScore += 1 / (60 + rank); candidates.set(key, row);
    };
    const terms = words(params.query).slice(0, 12);
    if (terms.length) {
      const rows = this.db.prepare('SELECT session_id,seq,content FROM messages_fts WHERE messages_fts MATCH ? ORDER BY bm25(messages_fts),session_id,CAST(seq AS INTEGER)')
        .all(terms.map(word => `"${word}"*`).join(' OR '));
      rows.forEach((row, i) => add(String(row.session_id), Number(row.seq), String(row.content), i + 1, 'ftsRank'));
      const rules = this.db.prepare('SELECT id,content FROM reflective_rules_fts WHERE reflective_rules_fts MATCH ? ORDER BY bm25(reflective_rules_fts),id')
        .all(terms.map(word => `"${word}"*`).join(' OR '));
      rules.forEach((row, i) => add(`rule:${String(row.id)}`, 0, String(row.content), i + 1, 'ftsRank'));
    }
    if (params.embedding) {
      const query = params.embedding;
      // 读内存镜像（与 memory_embeddings 表同点同步），候选集合、排序键与取正文的位置与
      // 原来的「全表 JOIN + 逐行 JSON.parse」完全一致，只是不再每查一次就扫表与反序列化。
      const scored: { sessionId: string; seq: number; content: string; score: number }[] = [];
      for (const [sessionId, bySeq] of this.embeddings) for (const [seq, entry] of bySeq) {
        const score = entry.vector.length === query.length ? cosineSimilarity(query, entry.vector) : 0;
        if (score > 0) scored.push({ sessionId, seq, content: entry.content, score });
      }
      scored.sort((a, b) => b.score - a.score || a.sessionId.localeCompare(b.sessionId) || a.seq - b.seq);
      scored.forEach((item, i) => add(item.sessionId, item.seq, item.content, i + 1, 'vectorRank'));
    }
    return [...candidates.values()].filter(row => row.rrfScore >= min).sort((a, b) => b.rrfScore - a.rrfScore || a.sessionId.localeCompare(b.sessionId) || a.matchedContent.localeCompare(b.matchedContent)).slice(0, limit);
  }
  async upsertReflectiveRule(rule: RuleInput, source?: string, indexedSource?: { sessionId: string; seq: number }): Promise<ReflectiveRule> {
    validateRule(rule); await this.queue; const ts = Date.now();
    if (source !== undefined && (!source || source.length > 512)) throw new RangeError('Invalid reflection provenance');
    if (source && this.db.prepare('SELECT source FROM reflection_provenance WHERE source=?').get(source)) {
      const existing = this.db.prepare('SELECT * FROM reflective_rules WHERE id=?').get(identity(rule));
      if (existing && Number(existing.confidence ?? 0) >= (rule.confidence ?? 0)) return this.readRule(existing);
    }
    const increment = !source;
    const fd = fs.openSync(this.dbPath + '.rules.jsonl', 'a', 0o600);
    try { fs.writeSync(fd, '\n' + JSON.stringify({ rule, ts, source, increment, indexedSource }) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const saved = this.saveRule(rule, ts, increment);
    if (source) this.db.prepare('INSERT INTO reflection_provenance VALUES(?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET ts=MAX(ts,excluded.ts)').run(source, indexedSource?.sessionId ?? null, indexedSource?.seq ?? null, saved.id, ts);
    this.refreshRules(); return { ...saved, frequency: this.readRule(this.db.prepare('SELECT * FROM reflective_rules WHERE id=?').get(saved.id)!).frequency };
  }
  async matchRelevantRules(goal: string, limit = 5): Promise<ReflectiveRule[]> {
    if (typeof goal !== 'string' || goal.length > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Invalid rule query');
    await this.queue; const terms = new Set(words(goal));
    return this.db.prepare('SELECT * FROM reflective_rules').all().map(row => this.readRule(row))
      .map(rule => ({ rule, score: [...new Set(words(rule.triggerCondition))].filter(word => terms.has(word)).length }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.rule.frequency - a.rule.frequency || a.rule.id.localeCompare(b.rule.id)).slice(0, limit).map(item => item.rule);
  }
  async listReflectiveRules(limit = 20, category?: ReflectiveRule['category']): Promise<ReflectiveRule[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || category !== undefined && !['policy_denial', 'tool_failure', 'architecture_constraint'].includes(category)) throw new RangeError('Invalid rule filter');
    await this.queue;
    const rows = category === undefined
      ? this.db.prepare('SELECT * FROM reflective_rules ORDER BY updated_at DESC,id LIMIT ?').all(limit)
      : this.db.prepare('SELECT * FROM reflective_rules WHERE category=? ORDER BY updated_at DESC,id LIMIT ?').all(category, limit);
    return rows.map(row => this.readRule(row));
  }
  async memoryStats(): Promise<{ ruleCount: number; categories: Record<string, number>; embeddingCount: number; vectorDimensions: number[] }> {
    await this.queue;
    const categories = Object.fromEntries(this.db.prepare('SELECT category,SUM(frequency) AS hits FROM reflective_rules GROUP BY category').all().map(row => [String(row.category), Number(row.hits)]));
    const embeddings = this.db.prepare('SELECT embedding FROM memory_embeddings').all();
    return { ruleCount: Number(this.db.prepare('SELECT COUNT(*) AS total FROM reflective_rules').get()!.total), categories, embeddingCount: embeddings.length,
      vectorDimensions: [...new Set(embeddings.map(row => (JSON.parse(String(row.embedding)) as number[]).length))].sort((a, b) => a - b) };
  }
}
