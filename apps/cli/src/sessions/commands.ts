/**
 * apps/cli/src/sessions/commands.ts — `vessel sessions list`（G-10 / BRIEF-09）。
 *
 * 数据源：`SessionRegistry` —— 进程重启后仍可读的会话登记表，落盘于
 * `<VESSEL_SESSION_ROOT ?? ~/.vessel>/sessions.json`，与 local-server 的
 * control plane 共用同一份文件（同一份「已登记的会话」事实源，不另建索引）。
 * `list()` 已按最近活动（`updatedAt`）倒序，CLI 只负责渲染，不重排。
 *
 * 约定：
 * - 登记表为空时明确提示「如何开始一段会话」，而不是打印一个空表头；
 * - `--json`（G-11）：stdout 只打一段可解析 JSON（`{ sessions: [...] }`，空表即 `{"sessions":[]}`），
 *   **不**走「暂无历史会话」的人类提示；读表失败时 stderr 打 JSON 信封并返回 1；
 * - 读表失败（如根目录不可写）返回退出码 1，错误走 stderr；
 * - **不调用 `process.exit`**：返回码交给调用方（`cli.ts`）决定进程行为，
 *   便于测试直接断言返回值。
 *
 * 本命令不构造任何默认 ProviderStore / UsageStore，不触网络；唯一的外部状态
 * 是 SessionRegistry 的根目录，测试通过 `opts.vesselHome` 注入 tmp 隔离，
 * 避免读到真实 `~/.vessel`（AGENTS.md §8 同款纪律）。
 */
import { SessionRegistry, type SessionMeta } from '@vessel/application';
import { emitJson } from '../output.js';

export interface SessionsCliOptions {
  /** 覆盖会话登记根（测试注入 tmp）；缺省 `VESSEL_SESSION_ROOT ?? ~/.vessel` */
  vesselHome?: string;
  /**
   * `--json`（G-11）：stdout 只打 `{ sessions: [...] }`，不打人类表头/空表提示。
   * 本文件是 opts 单一入参风格，故用布尔位而不是整张 flags（cli.ts 由另一张卡接线）。
   * 成功输出走 `output.emitJson`（stdout，不经 `log` seam）；失败信封走 `error` seam（stderr）。
   */
  json?: boolean;
  /** 输出通道（测试 capture；缺省 console.log） */
  log?: (line: string) => void;
  /** 错误通道（测试 capture；缺省 console.error） */
  error?: (line: string) => void;
}

/** 仅在有显式覆盖时传参，缺省交给 SessionRegistry 自己解析根目录。 */
function registryFor(opts: SessionsCliOptions): SessionRegistry {
  return opts.vesselHome ? new SessionRegistry({ vesselHome: opts.vesselHome }) : new SessionRegistry({});
}

/**
 * 渲染单个字段：登记表是磁盘 JSON，理论上可能被手工编辑出空白值，
 * 这里给出可读占位而不是打印 `undefined`（与 SessionRegistry.lastActivityAt
 * 的「缺字段不丢弃」同款防御姿态）。
 */
function display(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** 打印会话列表，返回进程退出码（0 = 正常，含「暂无会话」；1 = 读取失败）。 */
export function cmdSessionsList(opts: SessionsCliOptions = {}): number {
  const log = opts.log ?? ((line: string) => console.log(line));
  const error = opts.error ?? ((line: string) => console.error(line));

  let metas: SessionMeta[];
  try {
    metas = registryFor(opts).list();
  } catch (err) {
    const msg = `[vessel] 读取会话登记表失败：${err instanceof Error ? err.message : String(err)}`;
    if (opts.json) {
      // --json 的失败出口：与 `output.fail(1, msg, flags)` 同一信封、同一落点（stderr）。
      // 本文件已有 error seam（缺省即 console.error），JSON 字符串走 seam 便于测试捕获。
      error(JSON.stringify({ error: { message: msg, code: 1 } }));
      return 1;
    }
    error(msg);
    return 1;
  }

  if (opts.json) {
    // 空表也照常给合法文档（{"sessions":[]}），不落进下面的「暂无历史会话」人类提示。
    emitJson({
      sessions: metas.map((m) => ({
        id: m.id,
        workspaceRoot: m.workspaceRoot,
        provider: m.provider,
        model: m.model,
        permission: m.permission,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    });
    return 0;
  }

  if (metas.length === 0) {
    log('[vessel] 暂无历史会话。用 `vessel run --prompt "..."` 或直接运行 `vessel` 开始一段会话。');
    return 0;
  }

  log(`=== 历史会话（${metas.length}）===`);
  for (const m of metas) {
    const who = `${display(m.provider, 'unknown')}/${display(m.model, 'unknown')}`;
    log(
      `  ${display(m.id, '(no id)')}  ${display(m.updatedAt, '(未记录活动时间)')}  ${who}  ${display(m.workspaceRoot, '(未知工作区)')}`,
    );
  }
  return 0;
}
