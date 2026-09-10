import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { renameWithRetry } from '@vessel/shared';

/** Persisted metadata describing one application session. */
export interface SessionMeta {
  /** unique session id (also the core Session id) */
  id: string;
  /** absolute workspace root the session is bound to */
  workspaceRoot: string;
  /** provider id label (e.g. 'mock', 'anthropic') */
  provider: string;
  /** model id the session runs with */
  model: string;
  /** permission profile the session was opened with */
  permission: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of the last update */
  updatedAt: string;
}

export type SessionInput = Partial<Pick<SessionMeta, 'workspaceRoot' | 'provider' | 'model' | 'permission'>>;

export interface SessionRegistryOptions {
  /** vessel home dir; defaults to `~/.vessel`. Tests inject a tmp dir. */
  vesselHome?: string;
}

const SESSIONS_FILE = 'sessions.json';

/**
 * SessionRegistry — the control plane's persisted registry of known sessions.
 * Keeps the active-session map in memory and mirrors every mutation to
 * `<vesselHome>/sessions.json` (atomic tmp+rename) so a restart can restore the
 * session list. Session metadata only — the live loop is owned by a
 * SessionController; registry entries can outlive their controller to keep the
 * list for `list`/`get`.
 */
export class SessionRegistry {
  private readonly file: string;
  private readonly sessions = new Map<string, SessionMeta>();

  constructor(opts: SessionRegistryOptions = {}) {
    const home = opts.vesselHome ?? path.join(os.homedir(), '.vessel');
    fs.mkdirSync(home, { recursive: true });
    this.file = path.join(home, SESSIONS_FILE);
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    let raw: string;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return;
    }
    try {
      const data = JSON.parse(raw) as { sessions: SessionMeta[] };
      for (const s of data.sessions ?? []) {
        if (s?.id) {
          this.sessions.set(s.id, {
            ...s,
            workspaceRoot: path.resolve(s.workspaceRoot),
          });
        }
      }
    } catch {
      // corrupt store: start fresh rather than crash the control plane
      this.sessions.clear();
    }
  }

  /** Create a session metadata entry and return it. */
  create(input: SessionInput = {}): SessionMeta {
    const ts = new Date().toISOString();
    const meta: SessionMeta = {
      id: `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      workspaceRoot: input.workspaceRoot ?? process.cwd(),
      provider: input.provider ?? 'unknown',
      model: input.model ?? 'unknown',
      permission: input.permission ?? 'workspace-write',
      createdAt: ts,
      updatedAt: ts,
    };
    this.sessions.set(meta.id, meta);
    this.persist();
    return meta;
  }

  /** All registered sessions, newest first. */
  list(): SessionMeta[] {
    return [...this.sessions.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Look up a session by id, or undefined when missing. */
  get(id: string): SessionMeta | undefined {
    return this.sessions.get(id);
  }

  /** Register a pre-existing session meta (e.g. created by a SessionController). */
  put(meta: SessionMeta): SessionMeta {
    const updated = { ...meta, updatedAt: new Date().toISOString() };
    this.sessions.set(updated.id, updated);
    this.persist();
    return updated;
  }

  /** Bump updatedAt to reflect controller activity. */
  touch(id: string): void {
    const meta = this.sessions.get(id);
    if (!meta) return;
    meta.updatedAt = new Date().toISOString();
    this.persist();
  }

  /**
   * Mark a session as removed from the registry. Meta is dropped from the map
   * and the persisted file, but the underlying session log on disk is left
   * intact (no permanent deletion — removal from the registry only).
   */
  remove(id: string): boolean {
    const existed = this.sessions.delete(id);
    if (existed) this.persist();
    return existed;
  }

  private persist(): void {
    const payload = JSON.stringify({ sessions: [...this.sessions.values()] }, null, 2);
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${SESSIONS_FILE}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, payload, 'utf8');
    // task 113: 共享有界重试（EPERM/EBUSY/EACCES，3 次 5/15ms），原子语义不变。
    renameWithRetry(tmp, this.file);
  }
}