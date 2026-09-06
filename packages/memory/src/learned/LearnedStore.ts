import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * memory/learned — auto-learn SUGGEST channel (V0.3-M5; 任务书 §12/§13).
 *
 * Auto-learning is suggest-only: an agent may PRODUCE a structured candidate
 * (skill or memory entry), but it is never auto-applied to the user's skill or
 * memory areas. Candidates land in an isolated `learned/` zone; they are only
 * materialized (copied into the learned skill/memory dirs) after an explicit
 * approval gate — an independent evaluator verdict of `met` AND a user/commander
 * approve() call.
 *
 * Layout under the learned root (default ~/.dsh/learned):
 *   suggestions/<id>.json        — pending/rejected candidates (audit trail)
 *   skills/<name>/SKILL.md       — approved skill (only after approve)
 *   memory/<name>.md             — approved memory topic (only after approve)
 *
 * Hard guarantees:
 *  - suggest() writes ONLY under suggestions/ (never user skill/memory dirs)
 *  - approve() is the ONLY path that materializes, and only into learned/
 *  - reject() marks the record; nothing is ever written outside learned/
 *  - deletion/cleanup follows the recycle-bin rule (no permanent deletes here)
 */

export type LearnKind = 'skill' | 'memory';

export type LearnStatus = 'pending' | 'approved' | 'rejected';

export interface LearnSuggestion {
  id: string;
  kind: LearnKind;
  name: string;
  content: string;
  reason: string;
  evidence: string[];
  createdAt: string;
  status: LearnStatus;
  /** evaluator verdict that gated approval (met/not_met/...) */
  verdict?: string;
}

export interface LearnedStoreOptions {
  /** learned root; defaults to ~/.dsh/learned */
  rootDir?: string;
}

function esc(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_');
}

export class LearnedStore {
  private readonly root: string;
  private readonly suggestionsDir: string;
  private readonly skillsDir: string;
  private readonly memoryDir: string;

  constructor(opts: LearnedStoreOptions = {}) {
    this.root = opts.rootDir ?? path.join(os.homedir(), '.dsh', 'learned');
    this.suggestionsDir = path.join(this.root, 'suggestions');
    this.skillsDir = path.join(this.root, 'skills');
    this.memoryDir = path.join(this.root, 'memory');
  }

  /** generate a unique suggestion id. */
  private static newId(): string {
    return `sug_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private suggestionPath(id: string): string {
    return path.join(this.suggestionsDir, `${esc(id)}.json`);
  }

  /**
   * Record a candidate suggestion. Writes ONLY under suggestions/ — the user's
   * skill/memory areas are never touched here.
   */
  suggest(input: Omit<LearnSuggestion, 'id' | 'createdAt' | 'status'>): LearnSuggestion {
    const rec: LearnSuggestion = {
      ...input,
      id: LearnedStore.newId(),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    fs.mkdirSync(this.suggestionsDir, { recursive: true });
    fs.writeFileSync(this.suggestionPath(rec.id), JSON.stringify(rec, null, 2), 'utf8');
    return rec;
  }

  /** load a suggestion record by id. */
  get(id: string): LearnSuggestion | undefined {
    const p = this.suggestionPath(id);
    if (!fs.existsSync(p)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as LearnSuggestion;
    } catch {
      return undefined;
    }
  }

  /** list all suggestion records (audit). */
  list(): LearnSuggestion[] {
    if (!fs.existsSync(this.suggestionsDir)) return [];
    return fs
      .readdirSync(this.suggestionsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.suggestionsDir, f), 'utf8')) as LearnSuggestion;
        } catch {
          return null;
        }
      })
      .filter((r): r is LearnSuggestion => r !== null)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  private persist(rec: LearnSuggestion): void {
    fs.writeFileSync(this.suggestionPath(rec.id), JSON.stringify(rec, null, 2), 'utf8');
  }

  /**
   * Record an independent-evaluator verdict on a pending suggestion.
   * A non-met verdict leaves the record pending (it can be re-evaluated or
   * rejected) — it never auto-materializes.
   */
  recordVerdict(id: string, verdict: string): LearnSuggestion | undefined {
    const rec = this.get(id);
    if (!rec || rec.status !== 'pending') return rec;
    rec.verdict = verdict;
    this.persist(rec);
    return rec;
  }

  /**
   * Explicit approval gate: ONLY when an independent evaluator verdict is 'met'
   * does approve() materialize the candidate into the learned/ zone (never the
   * user's own skill/memory dirs). approve() is the single write path.
   */
  approve(id: string): { ok: boolean; rec?: LearnSuggestion; path?: string; reason?: string } {
    const rec = this.get(id);
    if (!rec) return { ok: false, reason: `no suggestion ${id}` };
    if (rec.status === 'rejected') return { ok: false, reason: 'suggestion was rejected' };
    if (rec.status === 'approved') return { ok: true, rec, path: this.materializedPath(rec) };
    if (rec.verdict !== 'met') {
      return { ok: false, reason: `suggestion ${id} has no met evaluator verdict (got ${rec.verdict ?? 'none'}) — independent review required before approve` };
    }
    const outPath = this.materialize(rec);
    rec.status = 'approved';
    this.persist(rec);
    return { ok: true, rec, path: outPath };
  }

  /** where an approved candidate materializes (inside learned/ only). */
  private materializedPath(rec: LearnSuggestion): string {
    return rec.kind === 'skill'
      ? path.join(this.skillsDir, esc(rec.name), 'SKILL.md')
      : path.join(this.memoryDir, `${esc(rec.name)}.md`);
  }

  private materialize(rec: LearnSuggestion): string {
    const outPath = this.materializedPath(rec);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const content =
      rec.kind === 'skill'
        ? `---\nname: ${rec.name}\ndescription: ${rec.reason}\nlearned: true\nsource: auto-learn suggestion ${rec.id}\n---\n\n${rec.content}`
        : `# ${rec.name}\n\n> learned from suggestion ${rec.id} (${rec.createdAt})\n\n${rec.content}`;
    fs.writeFileSync(outPath, content, 'utf8');
    return outPath;
  }

  /** mark a suggestion rejected (audit); nothing is materialized. */
  reject(id: string): LearnSuggestion | undefined {
    const rec = this.get(id);
    if (!rec) return undefined;
    rec.status = 'rejected';
    rec.verdict = rec.verdict ?? 'rejected-by-user';
    this.persist(rec);
    return rec;
  }
}
