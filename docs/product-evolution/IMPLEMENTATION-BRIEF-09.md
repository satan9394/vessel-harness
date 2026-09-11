# IMPLEMENTATION-BRIEF-09 — 会话恢复最小切片（G-10 之 resume 半，P2）

> Round 9 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-10 + 侦察报告 `docs/product-evolution/SCOPING-G10.md`。
> 侦察硬结论：**resume 机制已实现、只差接线**（与 G-09 同款）——`Session.loadExisting()` 重开日志 + 补 `turn/end{interrupted}`，`Builder` 每步从日志重建模型历史；缺的是 CLI/TUI 没有 sessionId 通道，`--session-dir` 是死旗帜，`source:'resume'` 枚举无调用方。
> **本切片显式剥离**：会话级用量恢复（`UsageEntry` 无 `sessionId`，需先改 schema）、快照回滚（全仓零实现）、多会话管理 UI、fork/rewind、云同步。

## 目标

让用户能**列出历史会话并恢复**（模型真的看到历史），且**在崩溃后的会话上也能恢复**（这是 resume 的主要使用场景）。

## 用户场景

1. 用户跑 `vessel run --prompt "…"` 或用 TUI 连续对话 → 中途 Ctrl+C / 机器崩 / 进程被杀 → 期望：`vessel sessions list` 看得到该会话，`vessel resume --last` 能接着聊，且**模型确实拿到了此前历史**。
2. 崩溃后 `.lease` 残留 → 现状：`Session.open` 直接抛 `Session is already open by another writer`（**fail-closed 且无 stale 回收**，`packages/core/src/session/Session.ts:57-69`）→ resume 在最需要它的场景必然失败。

## 当前问题（证据）

- `packages/core/src/session/Session.ts:50-53`：`sessionId` 随机生成、目录默认 `<workspace>/.harness/sessions/<id>`；`:57-69` 租约 `openSync(leasePath,'wx')`，EEXIST 即抛，**无 stale 判定**；`:201-207` `close()` 会 `rmSync(leasePath)`（正常退出释放，崩溃不释放）。
- `SessionRegistry` 已把会话登记到 `~/.vessel/sessions.json`，但**只被 local-server 接线**（`apps/local-server/src/server.ts:140,253-256`），且非活跃会话 GET 直接 404（"列得出打不开"）。
- CLI：无 `--resume`、无 `sessions` 命令；`--session-dir` 只在 `apps/cli/src/cli.ts:101` 出现（死旗帜）；`cmdRun`（`:270-282`）与 TUI `buildHarness`（`apps/cli/src/tui/chat.ts:266-277`）**都不传 sessionId** → 每次随机 id，日志写了没人能重开。
- `source:'resume'` 枚举已在 `packages/shared/src/events.ts:163` 声明，**全仓无调用方**。
- `SessionRegistry` 是全仓**唯一没有 env 覆盖**的状态根（违反 AGENTS.md 约束 8 的测试隔离前提）。

## 理想行为

1. **stale 租约回收**（本切片的前提，先做）：`Session.open` 遇 `.lease` 已存在时，读其中记录的 `pid` 与时间戳；
   - pid **已不存在**（`process.kill(pid, 0)` 抛 `ESRCH`）→ 视为陈旧：删除该租约文件、重新 `openSync(...,'wx')` 获取；
   - pid **仍存活**（或为 `EPERM`，即存在但非本用户）→ **保持 fail-closed**，抛出**带恢复指引**的错误：`Session 正在被进程 <pid> 使用：<dir>；若确认该进程已退出，可删除 <dir>/.lease 后重试`；
   - `.lease` 内容不可解析（空/损坏）→ 按"陈旧"处理（记一句 `console.warn`）。
2. **会话注册表可隔离、可枚举**：`SessionRegistry` 支持 `VESSEL_SESSION_ROOT` 环境变量覆盖状态根（与 `VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT` 同款）；`list()` 返回按最近活动倒序的会话元数据（id / workspaceRoot / 最后活动时间）。
3. **CLI 两个入口**：
   - `vessel sessions list`：列出已登记会话（无则明确提示"暂无历史会话"）；
   - `vessel resume --last`（并支持 `vessel resume <sessionId>`）：打开已有会话并**继续跑**；
     - 恢复时若末轮缺 `turn/end`，由 `Session.loadExisting()` 补 `interrupted`（已实现，须验证生效）；
     - **不得新建会话目录**（必须复用同一 id 与同目录）；
     - 若该 id 不存在 → 清晰报错 + 非 0 退出码，且**不创建**任何目录。
4. **TUI 通道**：`ChatOptions` 增加 `resumeSessionId?: string`，TUI 构建 harness 时透传该 id（换模型重建 harness 时必须复用同一 id，否则换模型即丢上下文）。
5. `migrate` 的 `KNOWN_STATE_ENTRIES` 清单补上会话注册表文件（版本迁移不漏该项）。

## 涉及模块

`packages/core/src/session/Session.ts`（stale 租约）、`packages/application/src/session/SessionRegistry.ts`（env + list）、`apps/cli/src/cli.ts`（sessions/resume 子命令 + 传 sessionId）、`apps/cli/src/tui/chat.ts`（`resumeSessionId` 透传）、`apps/cli/src/**/migrate.ts`（清单）、相应测试。

## 不能破坏什么

- **fail-closed 语义**：活跃租约（pid 存活）仍必须拒绝打开（不得为了"好恢复"而放宽成"总是抢占"）。
- 既有会话/事件语义与 `session.jsonl` 格式；`Session.replay()`、`Builder`、local-server 的会话路由行为。
- 全量 `tsc -b` 0 与 `vitest`（现 **122 文件 / 1293 passed + 1 skipped**）全绿。
- 测试隔离（AGENTS.md 约束 8）：新增用例一律注入临时根（含新的 `VESSEL_SESSION_ROOT`），**不碰真实 `~/.vessel`**、不碰真实工作区 `.harness`。
- 无新依赖。

## 验收标准

1. **resume round-trip（判别性，最易假绿）**：临时 workspace 跑一次带 tool/文本的会话 → 关闭 → 用同 id `resume` 再跑一轮 → 断言 **mock provider 收到的 `messages` 里含此前历史**（**不得**只断言 storage 层"日志变长/能读回记录"）；并断言**没有新建第二个会话目录**。
2. **崩溃后仍可恢复**：手工写入一个 `.lease`（内容为**已退出进程**的 pid，如 `999999`）→ `Session.open` 同一 id 成功（陈旧回收），且租约文件归属于当前进程；同时：把 `.lease` 写成**当前测试进程的 pid** → `Session.open` 仍抛错（fail-closed 未被破坏）。
3. **未完成的轮被闭合**：日志末轮无 `turn/end` 时，恢复后再读日志可见 `turn/end{kind:'interrupted'}`。
4. **不存在 id 的行为**：`vessel resume <不存在的id>` → 非 0 退出 + 清晰错误，且**未创建**目录/注册项。
5. `sessions list` 在临时根下能列出刚创建的会话（含 id 与 workspace 路径）。
6. `tsc -b` 0；全量 vitest 绿（新增用例计入）。

## 错误场景

- `.lease` 不可读/不可写（权限）→ 明确报错，不静默继续。
- `sessions.json` 损坏 → 复用既有"隔离留档 + 警告 + 空表继续"的仓库模式（**不要**新增静默回退）。
- 会话 id 存在但目录已被手工删除 → 报清晰错误，不臆造空会话。

## 测试要求

- 分小卡串行派发（本环境实测：大文件多处编辑易失败）；**执行器不跑命令**，由指挥复跑 `tsc` + 全量 vitest + 真实 CLI E2E（`sessions list` / `resume --last` / 陈旧租约恢复 / 不存在 id）。
- 完成后交独立静态 Evaluator 复核（重点：验收 1 是否真断言了模型看到历史、验收 2 是否真锁住 fail-closed）。
