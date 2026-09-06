import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * memory/project — Project Memory (ARCHITECTURE §4.8, V0.3).
 *
 * File-based memory: a MEMORY.md index + per-topic content files under
 * `<workspaceRoot>/.harness/memory/`. This is project-scoped (cross-session,
 * project-isolated) long-term memory for the agent — distinct from the session
 * event log (memory/session) which is the per-session source of truth.
 *
 * Layout:
 *   .harness/memory/MEMORY.md          — index (one line per topic: `- name: summary`)
 *   .harness/memory/topics/<topic>.md  — topic content (free-form markdown)
 *
 * Scope note (ARCHITECTURE §4.8: user/project/local three-level): this module
 * implements the *project* level. user/local levels are V0.3-M2 (persistent)
 * and are structurally kept separate by using a distinct root dir per level.
 */

export interface MemoryIndexEntry {
  name: string;
  summary: string;
  updatedAt: string;
}

export interface ProjectMemoryOptions {
  /** project memory root; defaults to `<workspaceRoot>/.harness/memory` */
  rootDir?: string;
}

const MEMORY_INDEX_NAME = 'MEMORY.md';
const TOPICS_DIR = 'topics';

function esc(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_');
}

export class ProjectStore {
  private readonly root: string;
  private readonly indexFile: string;
  private readonly topicsDir: string;

  constructor(workspaceRoot: string, opts: ProjectMemoryOptions = {}) {
    this.root = opts.rootDir ?? path.join(workspaceRoot, '.harness', 'memory');
    this.indexFile = path.join(this.root, MEMORY_INDEX_NAME);
    this.topicsDir = path.join(this.root, TOPICS_DIR);
  }

  /** ensure the on-disk layout exists (idempotent). */
  ensure(): void {
    fs.mkdirSync(this.topicsDir, { recursive: true });
    if (!fs.existsSync(this.indexFile)) {
      fs.writeFileSync(this.indexFile, '# Project Memory Index\n', 'utf8');
    }
  }

  private topicPath(name: string): string {
    return path.join(this.topicsDir, `${esc(name)}.md`);
  }

  /** read the raw index file (or null if never initialized). */
  private readIndexRaw(): string {
    this.ensure();
    return fs.readFileSync(this.indexFile, 'utf8');
  }

  /** parse MEMORY.md index into entries. Non-index lines are ignored. */
  private parseIndex(text: string): MemoryIndexEntry[] {
    const out: MemoryIndexEntry[] = [];
    for (const line of text.split(/\r?\n/)) {
      const m = /^-\s+([^:]+):\s*(.*)$/.exec(line.trim());
      if (!m) continue;
      out.push({ name: m[1]!.trim(), summary: m[2]!.trim(), updatedAt: '' });
    }
    return out;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  /** write (create/overwrite) a topic and upsert its index line. */
  write(name: string, content: string): { name: string; updatedAt: string } {
    if (!name.trim()) throw new Error('ProjectMemory: topic name is required');
    this.ensure();
    const clean = name.trim();
    fs.writeFileSync(this.topicPath(clean), content, 'utf8');

    const ts = this.nowIso();
    const summary = content.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim().slice(0, 120) ?? '(empty)';
    const idx = this.readIndexRaw();
    const lines = idx.split(/\r?\n/);
    const header = lines.filter((l) => !/^-\s+/.test(l)).join('\n');
    const rest = lines.filter((l) => /^-\s+/.test(l));
    const without = rest.filter((l) => !new RegExp(`^-\\s+${escapeRegExp(clean)}:`).test(l));
    without.push(`- ${clean}: ${summary}  (updated ${ts})`);
    without.sort((a, b) => a.localeCompare(b));
    const body = [...header.split('\n').filter(Boolean), ...without].join('\n');
    fs.writeFileSync(this.indexFile, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
    return { name: clean, updatedAt: ts };
  }

  /** read a topic's content (undefined if absent). */
  read(name: string): string | undefined {
    if (!name.trim()) throw new Error('ProjectMemory: topic name is required');
    const p = this.topicPath(name.trim());
    if (!fs.existsSync(p)) return undefined;
    return fs.readFileSync(p, 'utf8');
  }

  /** list index entries (name + summary). */
  list(): MemoryIndexEntry[] {
    if (!fs.existsSync(this.indexFile)) return [];
    return this.parseIndex(this.readIndexRaw());
  }

  /** keyword search over index summaries (case-insensitive substring). */
  search(keyword: string): MemoryIndexEntry[] {
    const kw = keyword.toLowerCase();
    return this.list().filter(
      (e) => e.name.toLowerCase().includes(kw) || e.summary.toLowerCase().includes(kw),
    );
  }

  /**
   * frozen snapshot for context injection — a compact text form of the whole
   * project memory (index + up to a cap of each topic) suitable to be injected
   * as a single user/message with source='memory' (可回放可压缩, EVENT-SPEC B01).
   */
  snapshot(maxTopics = 32, maxTopicChars = 2000): string {
    const entries = this.list().slice(0, maxTopics);
    if (entries.length === 0) return '';
    const parts: string[] = ['[Project Memory 快照]'];
    for (const e of entries) {
      const body = this.read(e.name) ?? '';
      const clipped = body.length > maxTopicChars ? `${body.slice(0, maxTopicChars)}\n…(截断)` : body;
      parts.push(`## ${e.name}\n${clipped}`);
    }
    return parts.join('\n\n');
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
