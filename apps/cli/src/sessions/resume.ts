/**
 * `vessel resume` 的目标解析（G-10 / BRIEF-09）。
 *
 * 为什么单独一步：`Session.open` 对任意 sessionId 都会建目录，所以"不存在的 id"
 * 必须在**进入 harness 之前**拦住，否则 resume 会静默退化成"新建空会话"。
 * 本模块只做解析与校验：不建会话、不跑 harness、不 process.exit。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionRegistry, type SessionMeta } from '@vessel/application';

export interface ResumeTargetOk { ok: true; meta: SessionMeta; sessionFile: string }
export interface ResumeTargetErr { ok: false; message: string; exitCode: number }
export type ResumeTarget = ResumeTargetOk | ResumeTargetErr;

/** 会话日志文件路径（与 core 的 `Session.open` 推导保持一致）。 */
export function sessionFileFor(meta: SessionMeta): string {
  return path.join(meta.workspaceRoot, '.harness', 'sessions', meta.id, 'session.jsonl');
}

/**
 * 解析 `vessel resume [<id>] [--last]` 的目标。
 * - `--last` / 未给 id → 取登记表最近一条
 * - 给了 id → 查登记表；查不到 → 报错（exit 2）
 * - 登记表命中但日志文件不存在 → 报错（exit 2），绝不新建
 */
export function resolveResumeTarget(args: string[], opts: { last?: boolean; vesselHome?: string } = {}): ResumeTarget {
  let metas: SessionMeta[];
  try {
    metas = new SessionRegistry(opts.vesselHome ? { vesselHome: opts.vesselHome } : {}).list();
  } catch (err) {
    return { ok: false, message: `读取会话登记表失败：${(err as Error).message}`, exitCode: 1 };
  }
  const id = args[0];
  let meta: SessionMeta | undefined;
  if (opts.last || !id) {
    meta = metas[0];
    if (!meta) return { ok: false, message: '暂无历史会话可恢复。', exitCode: 2 };
  } else {
    meta = metas.find((m) => m.id === id);
    if (!meta) {
      return {
        ok: false,
        message: `未找到会话 ${id}。可用：vessel sessions list`,
        exitCode: 2,
      };
    }
  }
  const sessionFile = sessionFileFor(meta);
  if (!fs.existsSync(sessionFile)) {
    return {
      ok: false,
      message: `会话 ${meta.id} 的日志不存在（${sessionFile}）；为避免凭空新建，已中止。`,
      exitCode: 2,
    };
  }
  return { ok: true, meta, sessionFile };
}
