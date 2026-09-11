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
  /**
   * vessel home dir. An explicit value wins; otherwise the effective root is
   * `VESSEL_SESSION_ROOT` ?? `~/.vessel` (see `resolveSessionRoot`). Tests inject
   * a tmp dir so the real home is never touched (AGENTS.md §8).
   */
  vesselHome?: string;
}

const SESSIONS_FILE = 'sessions.json';

/** 缺省会话注册表根目录：`~/.vessel`（与 ProviderStore/UsageStore 同款用户级约定）。 */
export function defaultSessionRoot(home = os.homedir()): string {
  return path.join(home, '.vessel');
}

/**
 * 生效的会话注册表根目录：`VESSEL_SESSION_ROOT` > `~/.vessel`
 * （与 `resolveUsageRoot()` / `defaultProviderRoot()` 同口径；env 覆盖是
 * SessionRegistry 测试隔离的前提）。
 */
export function resolveSessionRoot(): string {
  return process.env.VESSEL_SESSION_ROOT ?? defaultSessionRoot();
}

/**
 * `list()` 的最近活动排序键：`updatedAt` 存在且非空白时用它，否则 undefined
 * —— 缺字段的记录排最后，而不是被丢弃（不新增静默回退，仅排序语义）。
 */
function lastActivityAt(meta: SessionMeta): string | undefined {
  return typeof meta.updatedAt === 'string' && meta.updatedAt.trim() !== '' ? meta.updatedAt : undefined;
}

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
    // 显式注入最优先（测试传 tmp），其次 env 覆盖，最后 ~/.vessel 缺省。
    const home = opts.vesselHome ?? resolveSessionRoot();
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

  /**
   * All registered sessions, most recently active first.
   *
   * 排序键 = 最后活动时间 `updatedAt`（create/put/touch 都会刷新），ISO 字符串
   * 倒序；缺 `updatedAt` 的记录排最后；同一时刻按 id 倒序（与 HandoffStore.list
   * 同款决定序）。返回元素仍是完整 `SessionMeta`，字段名/结构未变（CLI 与
   * local-server 现有消费不受影响）。
   */
  list(): SessionMeta[] {
    return [...this.sessions.values()].sort((a, b) => {
      const ta = lastActivityAt(a);
      const tb = lastActivityAt(b);
      if (ta === undefined) return tb === undefined ? 0 : 1;
      if (tb === undefined) return -1;
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
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