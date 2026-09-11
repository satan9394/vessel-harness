# SCOPING-G10 — 会话恢复（session resume）+ 快照回滚（snapshot rollback）

> 架构侦察（只读，无改动）。结论口径：**能 / 不能 / 不确定** + 文件:行证据。
> 一句话结论：**resume 是"机制已在、只差接线"（同 G-09 模式）；快照回滚是"完全没有、且应独立成切片或砍掉"。**

## 1. 现状

**Q1-a 有没有会话持久化？——有，且比预期完整。**
- 事件日志是 append-only JSONL 唯一真源：`packages/core/src/session/Session.ts:20-29`（D3 决策 10）、`:111-124`（append 落盘）、`:138-140`（replay）、`:146-150`（surface 三型）。
- 会话元数据注册表已落盘 `~/.vessel/sessions.json`：`packages/application/src/session/SessionRegistry.ts:78-92`（create）、`:95-97`（list 倒序）、`:131-139`（tmp+rename 原子写）、`:53-75`（load）。
- 用户级状态根约定齐备：`resolveUsageRoot()` `apps/cli/src/usage/UsageStore.ts:367-369`；`providerStateRoot()` `apps/cli/src/providers/defaultStore.ts:18-19`；`VESSEL_HANDOFFS_ROOT` `packages/engine/src/handoff/HandoffStore.ts:24-26`。
- 缺口：`SessionRegistry` 是唯一**没有 env 覆盖**的状态根（`SessionRegistry.ts:47` 只有 `opts.vesselHome ?? ~/.vessel`），违反 AGENTS.md 约束 8 的测试隔离模式；`migrate` 的 `KNOWN_STATE_ENTRIES` 也不含 `sessions.json`/`handoffs`（`apps/cli/src/migrate.ts:20-27`）→ 接线时两处都得补。

**Q1-b 事件总线是否为可回放的结构化事件流？——是。恢复是否只需"持久化事件+重放"？——是，而且这两件都已实现。**
- `Session.ts:24` 注释即写明 `resume = replay + synthesize an interrupted turn closer`；`loadExisting()` 重开时读全量日志、容忍 torn tail、并为未闭合 turn 补 `turn/end{interrupted}`：`Session.ts:76-99`（`:84-87` 脏尾丢弃，`:89-98` 合成关闭器）——EVENT-SPEC `docs/EVENT-SPEC.md:608` 定义的正是此语义。
- 模型可见历史每步从日志重放重建：`packages/context/src/builder/Builder.ts:154-158` + wire 类型集合 `:87-92`（含 `assistant/attempt`，task 109）。EVENT-SPEC 承诺"日志=唯一真源 / 模型可见⟺已记录"（`docs/EVENT-SPEC.md:18`、`:452`）。
- 声明已就位但**无调用方**：`SessionStart source:'resume'`（`docs/EVENT-SPEC.md:161`、`:534`）、`packages/shared/src/events.ts:163`、`packages/agents/src/subagent/IsolatedRuntime.ts:10-19`（`IsolatedRuntime` 甚至已接受 `sessionId`/`sessionDir`，`:29-30`）——grep 全 `packages/` 无任何 `'resume'` 传参。

**Q1-c CLI 有没有 `--resume`/session 概念？——没有。且 `--session-dir` 是文档死旗帜。**
- 用法文本声明了 `--session-dir`（`apps/cli/src/cli.ts:101`），但全 `apps/cli/src` **无第二处引用**（grep 仅命中该行）。
- `cmdRun` 的 `composeHarness`（`cli.ts:270-282`）与 TUI `buildHarness`（`apps/cli/src/tui/chat.ts:266-277`）**都不传 `sessionId`**（`compose.ts:49` 该选项已存在且可用），于是每次运行都走随机 id（`Session.ts:50`）→ 日志写了、没人能再打开。
- CLI 完全没有 session 命令面（`cli.ts:60-87` 命令表无 sessions/resume）；`SessionRegistry` 只被 local-server 接线（`apps/local-server/src/server.ts:140`、`:253-256` GET `/api/sessions`），且非活跃会话 GET 直接 404（`server.ts:298-303`）——**"列得出、打不开"**。

**Q1-d 用量可恢复吗？——消息能，会话级用量不能。**
- `UsageEntry` 只有 `model/provider/tokens/costUsd/lastTs`，**无 `sessionId`**（`apps/cli/src/usage/UsageStore.ts:66-106`），compose 记账只传 provider/model/tokens（`packages/application/src/compose.ts:297-318`）。G-09 的"本会话"是内存基线差（`chat.ts:282-291`），恢复后无法归属。
- 快照回滚侧：grep `rollback|checkpoint|rewind` 在 `packages/` **零命中**（`State.snapshot`/`ProcessTree.snapshot`/`EnforcementProjection.snapshot` 全是无关语义）。最接近的现成构件是任务级 Context Reset Handoff（`HandoffStore.ts:9-26`、`:67-71`，含 changed files/`continuationOf` 链）与隔离用 git worktree（`packages/engine/src/workspace.ts:60-71`）——**都不是用户工作区回滚面**。

## 2. 最小可行切片

**Q2：能。目标锁定"`vessel` 能列出历史会话并恢复上一会话（消息 + turn 历史）"，改动面 4 处。**
1. `SessionRegistry.ts`：新增 `resolveSessionRoot()`（`VESSEL_SESSION_ROOT` > `~/.vessel`），顺手补 `migrate.ts:20-27` 清单。
2. `cli.ts`：加 `vessel sessions list` 与 `vessel resume [<id>|--last]`（parseArgs 已通用，`:126-137`）；resume = 用 `SessionController.create({ id: meta.id, ... })`（`SessionController.ts:116-131` 已含 `registry.put`）代替裸 `composeHarness`。
3. `chat.ts`：`runChat` 增 `resumeSessionId?` 透传进 `buildHarness`（`:266-277`）；**关键约束**：换 provider/model 重建 harness 时必须复用同一 `sessionId`，否则"换模型即丢上下文"（当前重建即开新目录）。
4. 测试：round-trip + 租约 + env 隔离三类（见 §4）。

**已存在但未接线的构件（G-09 同款"只差接线"）**：`Session.open` 的 resume 语义（`Session.ts:49-99`）、`SessionRegistry` 全量能力（`SessionRegistry.ts:42-140`）、`SessionController.create` + `SessionMeta`（`SessionController.ts:116-131`）、`source:'resume'` 枚举与 EVENT-SPEC A01 语义（未接线）。
**明确不承诺**：会话级用量归属（需先定 `UsageEntry.sessionId` 方案，属新缺口，应从本切片剥离）；工作区快照回滚（见 §5，建议独立切片）。

## 3. 成本与风险

**Q3 成本**：resume-only = **小-中**（4 文件 + 测试，无新存储、无 schema 变更）；含快照回滚 = **中-大**（工作区状态语义 + git 依赖 + 误删风险）。**建议只批 resume 半**。
- **风险①（决定可用性）stale lease**：`Session.open` 单写者租约 fail-closed（`Session.ts:57-69`），崩溃/强杀残留 `.lease` → resume 直接抛 `Session is already open by another writer`；grep `.lease` 全仓仅 `Session.ts` 5 处、**无回收逻辑**。"崩溃后恢复"这个核心场景当前会当场失败。
- 风险②半写：脏尾已处理（`Session.ts:84-87`）；但续写位是 `max(rec.seq)`（`:83`）而非行数，与 compaction 重编号（`:187-191`）叠加需回归确认 seq 单调不变式。
- 风险③格式版本：`session.jsonl` 无 `formatVersion`（EVENT-SPEC `:161` 只定义未实现），老日志靠未知类型宽容。本切片不引入版本字段，但应留一条 ADR。
- 风险④并发写：`sessions.json` last-write-wins 原子替换（`SessionRegistry.ts:131-139`），双进程并发 put 互覆盖；仅"单 CLI 进程 + 启动重载"下可接受。
- 风险⑤隐私/成本：恢复会把历史 `tool/result` 原文重新送进模型上下文（`Builder.ts:154-158`）→ 需打印"N 条记录 / 估算 token"提示；历史里可能含密钥与文件内容。
- 风险⑥跨目录：会话绑定 `SessionMeta.workspaceRoot`（`SessionRegistry.ts:10-11`），跨 cwd resume 必须校验并 fail loud。
- **前置项：无阻塞依赖**（G-03/G-04/G-05 均不前置）；唯一耦合是 G-09 的用量语义，已按上文剥离。

## 4. 判别性验收（≥3 条，标注最易假绿者）

1. **wire-level round-trip（判据核心）**：同 workspace 两次 run，第二次 `--resume <id>`；断言 **mock provider 收到的 messages** 含第一次的 `user/message` 与 `assistant/message`，且新日志 seq 连续单调。
2. **崩溃恢复**：构造 `turn/start` 无 `turn/end` → 重开 → 断言恰好合成一条 `turn/end{kind:'interrupted'}` 且既有记录条数不减（`Session.ts:89-98`）。
3. **列表面 + 隔离**：`vessel sessions list` 按 `updatedAt` 倒序含最新会话；`VESSEL_SESSION_ROOT` 指向 tmp 时**不读真实 `~/.vessel`**（AGENTS.md 约束 8）。
4. **租约**：对持有 `.lease` 的目录 resume → 非 0 退出 + 可操作提示；stale lease（pid 已死）按既定策略提示/接管，**不得静默新建空会话**。
5. **假 id fail loud**：`vessel resume <不存在 id>` → 报错且**不创建新会话目录**。
- **最易假绿 = 第 1 条若被写成 storage 断言**：只测 `session.replay().length` 增长或 `Session.open({sessionId})` 能读回记录，**不能**证明模型真看到了历史（日志增长 ≠ 上下文恢复）。同理 mock provider 若忽略 `messages`，E2E 也会假绿。→ 第 1 条必须断言 mock **收到的 messages 内容**；第 4/5 条必须断言"没有新建目录"这一否定事实。

## 5. 明确"不做"

- 不做完整多会话管理 UI：重命名/归档/搜索/分页/TUI 会话选择器一律不做，只要 `list` + `resume`。
- 不做云同步、跨机器/跨用户共享会话、会话加密。
- 不做分支树 / fork / rewind / 时间旅行回放编辑器。
- 不做**工作区快照回滚**（自动 commit / checkout / revert）：若日后要做，只允许"打印 `git diff` + 明确给出可复制命令"的克制形态，且**独立成切片**（本卡不动）。
- 不引入新存储引擎（无 DB/SQLite），复用 `session.jsonl` + `sessions.json`。
- 不改既有事件语义：不动 surface 三型裁定、不新增必填字段、不动 compaction 重编号规则、不动 `usage.json` schema（会话级用量归属另行立项）。
- 不改 provider/model 路由与 policy 语义、不加 core 机制 import。
