import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { deriveTopicTitle, type SessionTopic } from '@vessel/engine';
import { envRoot, writeFileAtomic, vesselHome } from '@vessel/shared';

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
  /** Optional for backward compatibility with session files written before topic support. */
  topic?: SessionTopic;
}

export type SessionInput = Partial<Pick<SessionMeta, 'workspaceRoot' | 'provider' | 'model' | 'permission'>> & {
  topic?: SessionTopic;
};

export interface SessionRegistryOptions {
  /**
   * vessel home dir. An explicit value wins; otherwise the effective root is
   * `VESSEL_SESSION_ROOT` ?? `~/.vessel` (see `resolveSessionRoot`). Tests inject
   * a tmp dir so the real home is never touched (AGENTS.md §8).
   *
   * `VESSEL_SESSION_ROOT` 为空/纯空白时**按未设置**处理（唯一口径见 `envRoot`）——
   * 兼容前 `''` 会原样成为根，`fs.mkdirSync('')` 直接抛 ENOENT，而生产调用点
   * （`apps/cli/src/cli.ts` 的 `new SessionRegistry()`）把它 try/catch 吞掉 ⇒ **静默不登记**。
   */
  vesselHome?: string;
  /**
   * Clock injection (tests only; default `Date.now`). `list()` orders by
   * `updatedAt` and falls back to id order on a tie, so two creates in the same
   * millisecond have no insertion-order guarantee; a monotonic test clock keeps
   * ordering tests deterministic instead of racing the real clock.
   */
  now?: () => number;
}

const SESSIONS_FILE = 'sessions.json';

/** 缺省会话注册表根目录：`~/.vessel`（与 ProviderStore/UsageStore 同款用户级约定）。 */
export function defaultSessionRoot(home = os.homedir()): string {
  return vesselHome(home);
}

/**
 * 生效的会话注册表根目录：`VESSEL_SESSION_ROOT` > `~/.vessel`
 * （与 `resolveUsageRoot()` / `providerStateRoot()` / `resolveMcpRoot()` / `resolveSettingsRoot()`
 * 同口径，唯一实现 = `@vessel/shared` 的 `envRoot`：空/纯空白 ⇒ 未设置，其余 trim）。
 *
 * 为什么不能写 `process.env.VESSEL_SESSION_ROOT ?? defaultSessionRoot()`：
 * `??` 只挡 `undefined`，`VESSEL_SESSION_ROOT=`（空串）会原样成为根 ⇒ 构造函数里
 * `fs.mkdirSync('')` 抛 ENOENT（`path.join('', 'sessions.json') === 'sessions.json'`）。
 */
export function resolveSessionRoot(): string {
  return envRoot('VESSEL_SESSION_ROOT') ?? defaultSessionRoot();
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
  private readonly now: () => number;
  private readonly sessions = new Map<string, SessionMeta>();
  private readonly sessionIdsByTopic = new Map<string, Set<string>>();
  private readonly topicBySession = new Map<string, string>();

  constructor(opts: SessionRegistryOptions = {}) {
    // 显式注入最优先（测试传 tmp），其次 env 覆盖，最后 ~/.vessel 缺省。
    const home = opts.vesselHome ?? resolveSessionRoot();
    fs.mkdirSync(home, { recursive: true });
    this.file = path.join(home, SESSIONS_FILE);
    this.now = opts.now ?? Date.now;
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
      const data = JSON.parse(raw) as { sessions?: unknown };
      if (!Array.isArray(data.sessions)) return;
      for (const s of data.sessions ?? []) {
        if (!s || typeof s !== 'object') continue;
        const item = s as Partial<SessionMeta>;
        if (typeof item.id === 'string' && item.id.length > 0 && typeof item.workspaceRoot === 'string') {
          const topic = isSessionTopic(item.topic) ? item.topic : undefined;
          const meta: SessionMeta = {
            ...item,
            workspaceRoot: path.resolve(item.workspaceRoot),
            ...(topic ? { topic } : { topic: undefined }),
          } as SessionMeta;
          this.sessions.set(meta.id, meta);
          this.indexTopic(meta);
        }
      }
    } catch {
      // corrupt store: start fresh rather than crash the control plane
      this.sessions.clear();
    }
  }

  /** Create a session metadata entry and return it. */
  create(input: SessionInput = {}): SessionMeta {
    const nowMs = this.now();
    const ts = new Date(nowMs).toISOString();
    const meta: SessionMeta = {
      id: `sess_${nowMs}_${crypto.randomBytes(4).toString('hex')}`,
      workspaceRoot: input.workspaceRoot ?? process.cwd(),
      provider: input.provider ?? 'unknown',
      model: input.model ?? 'unknown',
      permission: input.permission ?? 'workspace-write',
      createdAt: ts,
      updatedAt: ts,
      ...(input.topic ? { topic: input.topic } : {}),
    };
    this.sessions.set(meta.id, meta);
    this.indexTopic(meta);
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
    const previous = this.sessions.get(meta.id);
    const updated = {
      ...meta,
      ...(meta.topic === undefined && previous?.topic ? { topic: previous.topic } : {}),
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.sessions.set(updated.id, updated);
    this.indexTopic(updated);
    this.persist();
    return updated;
  }

  /** Assign an automatically derived Topic once, from the first user prompt. */
  nameTopicFromPrompt(id: string, firstPrompt: string): SessionMeta | undefined {
    const meta = this.sessions.get(id);
    if (!meta || meta.topic || typeof firstPrompt !== 'string' || firstPrompt.trim() === '') return meta;
    const now = this.now();
    meta.topic = {
      topicId: `topic_${id}`,
      title: deriveTopicTitle(firstPrompt),
      createdAt: now,
      updatedAt: now,
      isArchived: false,
    };
    meta.updatedAt = new Date(now).toISOString();
    this.indexTopic(meta);
    this.persist();
    return meta;
  }

  /** Rename the Topic attached to a session. Invalid/blank titles fail closed. */
  renameTopic(id: string, title: string): SessionMeta | undefined {
    const meta = this.sessions.get(id) ?? this.listByTopic(id)[0];
    const cleanTitle = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (!meta || cleanTitle === '') return undefined;
    const now = this.now();
    const topicId = meta.topic?.topicId ?? `topic_${meta.id}`;
    for (const member of this.sessionsForTopic(meta, topicId)) {
      member.topic = {
        ...(member.topic ?? { topicId, createdAt: now, isArchived: false }),
        topicId,
        title: cleanTitle,
        updatedAt: now,
      };
      member.updatedAt = new Date(now).toISOString();
      this.indexTopic(member);
    }
    this.persist();
    return meta;
  }

  /** Archive or restore a Topic without deleting session history. */
  setTopicArchived(id: string, isArchived: boolean): SessionMeta | undefined {
    const meta = this.sessions.get(id) ?? this.listByTopic(id)[0];
    if (!meta) return undefined;
    const now = this.now();
    const topicId = meta.topic?.topicId ?? `topic_${meta.id}`;
    for (const member of this.sessionsForTopic(meta, topicId)) {
      member.topic = {
        ...(member.topic ?? { topicId, title: 'New conversation', createdAt: now }),
        topicId,
        updatedAt: now,
        isArchived,
      };
      member.updatedAt = new Date(now).toISOString();
      this.indexTopic(member);
    }
    this.persist();
    return meta;
  }

  /** Sessions belonging to one Topic, in the registry's normal recent-first order. */
  listByTopic(topicId: string): SessionMeta[] {
    const ids = this.sessionIdsByTopic.get(topicId);
    if (!ids) return [];
    return this.list().filter((session) => ids.has(session.id));
  }

  /** Bump updatedAt to reflect controller activity. */
  touch(id: string): void {
    const meta = this.sessions.get(id);
    if (!meta) return;
    meta.updatedAt = new Date(this.now()).toISOString();
    this.persist();
  }

  /**
   * Mark a session as removed from the registry. Meta is dropped from the map
   * and the persisted file, but the underlying session log on disk is left
   * intact (no permanent deletion — removal from the registry only).
   */
  remove(id: string): boolean {
    if (!this.sessions.has(id)) return false;
    this.indexTopic({ id } as SessionMeta);
    this.sessions.delete(id);
    this.persist();
    return true;
  }

  private indexTopic(meta: SessionMeta): void {
    const previousTopicId = this.topicBySession.get(meta.id);
    if (previousTopicId) {
      const previousIds = this.sessionIdsByTopic.get(previousTopicId);
      previousIds?.delete(meta.id);
      if (previousIds?.size === 0) this.sessionIdsByTopic.delete(previousTopicId);
      this.topicBySession.delete(meta.id);
    }
    if (!meta.topic) return;
    const ids = this.sessionIdsByTopic.get(meta.topic.topicId) ?? new Set<string>();
    ids.add(meta.id);
    this.sessionIdsByTopic.set(meta.topic.topicId, ids);
    this.topicBySession.set(meta.id, meta.topic.topicId);
  }

  private sessionsForTopic(seed: SessionMeta, topicId: string): SessionMeta[] {
    return [...this.sessions.values()].filter((session) => session.id === seed.id || session.topic?.topicId === topicId);
  }

  private persist(): void {
    const payload = JSON.stringify({ sessions: [...this.sessions.values()] }, null, 2);
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, `${SESSIONS_FILE}.${process.pid}.${Date.now()}.tmp`);
    writeFileAtomic(tmp, this.file, payload);
  }
}

function isSessionTopic(value: unknown): value is SessionTopic {
  if (!value || typeof value !== 'object') return false;
  const topic = value as Partial<SessionTopic>;
  return (
    typeof topic.topicId === 'string' && topic.topicId.length > 0 &&
    typeof topic.title === 'string' &&
    typeof topic.createdAt === 'number' &&
    typeof topic.updatedAt === 'number' &&
    (topic.summary === undefined || typeof topic.summary === 'string') &&
    (topic.tags === undefined || (Array.isArray(topic.tags) && topic.tags.every((tag) => typeof tag === 'string'))) &&
    (topic.isArchived === undefined || typeof topic.isArchived === 'boolean')
  );
}
