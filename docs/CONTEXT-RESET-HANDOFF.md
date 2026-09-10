# Context Reset + Structured Handoff（task 067）

> 机制文档：Context Reset 与既有 Compaction 的分工、handoff 结构/存储/触发、从 handoff 启动。
> 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §12（L1231-1262）。
> 实现位置：packages/engine/src/handoff/（素材来源 063 IterationStore/任务对象；触发 066 budget）。

## 1. 何时 compact vs 何时 reset（与 Compaction 的分工）

| 维度 | Compaction（既有，context 包） | Context Reset + Handoff（本卡，engine 包） |
|---|---|---|
| 机制 | 对话内压缩：同一 session log 内把最旧「平衡」surface 段替换为 `<compacted-summary>` | 全新上下文 + 结构化交接：运行状态固化为 handoff，新 Session 从 handoff 重启 |
| 触发 | 0.8 × contextWindow（压力）/ 溢出 / 手动 | 0.9 × contextWindow（budget）/ 会话长度阈值 / 手动 force |
| 会话 | 不新建会话（同一 session 继续） | 新建 Session（旧 session 归档，不无限压缩） |
| 丢失风险 | 旧段细节被摘要（不可恢复） | 全字段结构化保留（JSON 持久，可回读） |
| 适用 | 一轮任务内上下文渐满、仍需继续对话 | 真正多小时任务（Goal/Loop 模式）预算/长度到限，需要续跑交接 |

**决策规则**：先 compact（0.8 压力）续完当前轮；当 compact 多次后仍接近上限（0.9 budget）或
会话记录数到达长度阈值（缺省 1500 条）时，生成 handoff 供 reset —— 不要只靠无限 compact
（§12 原话）。本卡不破坏既有 compaction 测试（Compaction.ts 不动；handoff 是并存的新机制）。

## 2. Handoff 结构（§12 yaml 字段逐字）

记录字段名与 §12 yaml **逐字一致**（snake_case），JSON 存储即 §12 结构：

```yaml
handoff:
  goal:           # 续跑目标（非空校验，构建期 fail loud）
  completed:      # 已完成事项 []
  current_state:  # 当前状态描述
  changed_files:  # 改动文件清单 []
  tests:          # 测试证据/结果清单 []
  decisions:      # 已做决策（含理由）[]
  blockers:       # 阻塞项（透传给新 Agent）[]
  next_actions:   # 下一步行动（注入新 Session 起始上下文）[]
  evidence:       # 证据（命令输出/路径/引用）[]
```

引擎复用元数据（§12 超集）：`taskId`（QueueTask.id，重建 LoopTask 的 key）、`acceptance`
（验收标准透传，评审判据来源）、`projectRoot`、`continuationOf`（前序 handoff id，长任务续跑链）。

## 3. 存储（059/063 模式）

- 根目录：`~/.vessel/handoffs`（env `VESSEL_HANDOFFS_ROOT` 可覆盖；测试注入 tmp）。
- id 约定：`handoff_<ts>_<hex>`（沿用 `<kind>_<ts>_<hex>`）。
- 目录布局（每条记录一个目录，同 review 模式）：

```
<root>/<handoff-id>/
  meta.json   —— 结构化记录（§12 九字段 + 元数据；JSON，可回读/续跑/校验）
  handoff.md  —— §12 yaml 对齐的文本投影（生成时快照，供阅读/复制）
```

- 原子写：meta.json 走 tmp+rename（写坏/半写不可能落盘）；读取容忍损坏条目（get → undefined，list 跳过）。
  task 114 起 rename 统一走 `@vessel/shared` 的 `renameWithRetry`（EPERM/EBUSY/EACCES 有界重试 3 次、5/15ms 退避）。
- API：`HandoffStore.create(material, opts)` / `get(id)` / `list()` / `latest()`。
- 并发安全：单进程同步 IO + 原子写；多写者需自行串行（本卡不引入锁）。

## 4. 素材来源（063 IterationStore / 任务对象 / 064 清理前快照）

`collectHandoffMaterial({ task, iterations, snapshot })` 把运行状态聚合为 §12 素材：

- `goal` / `taskId` / `projectRoot` / `acceptance` ← QueueTask（透传）；
- `completed` ← 迭代中 verdict==='met' 的条目（iter N: reason）；
- `decisions` ← 每条迭代的 verdict+reason（一次迭代 = 一个决策点）；
- `blockers` ← verdict 为 not_met/impossible/error 的条目 reason + 运行侧 snapshot.blockers；
- `evidence` ← 迭代 evidence 数组 + outputPath + snapshot.evidence；
- `tests` ← snapshot.tests + 迭代 testResults（非空）；
- `next_actions` ← 派生（无迭代 → 第一轮；末次 met → 收尾；否则 → 下一轮 + 阻塞摘要）；
- `current_state` ← 任务状态 + 迭代数 + snapshot.currentState。

`snapshot` 是 064 清理前快照入参（调用方在清理/退出前收集改动文件/测试/证据）。

## 5. 触发条件（066 budget / 会话长度阈值 / 手动）

`shouldGenerateHandoff(estimateTokens, contextWindow, recordCount, opts)` 纯函数：

- `budget`：`estimateTokens >= 0.9 × contextWindow`（缺省 0.9，晚于 Compaction 0.8 —— 先 compact 后 reset）；
- `length`：`recordCount >= 1500`（缺省会话长度阈值）；
- `manual`：`force: true`；
- 非法阈值（ratio 越界等）fail loud = 调用方 bug。

065 Goal UI 可见 seam：`handoffSeamState({...})` 输出纯状态（generate/reason/estimateTokens/
recordCount/latestHandoffId），UI 后续接入只读此状态即可展示/触发 —— 本卡不深做 UI。

## 6. 从 handoff 启动（新 Session/Agent 续跑）

`StartFromHandoff.ts` 提供两条复用既有机制的路径：

1. **会话侧**：`seedSessionFromHandoff(session, handoff)` —— 把 handoff 固化为一条 B01
   `user/message`（source='handoff'）注入新 Session 起始上下文（复用 core/session append-only
   JSONL 真源；可回放、可压缩）。注入内容 = §12 九字段全量内联：goal/completed/next_actions
   注入起始上下文，blockers/decisions 透传，current_state/changed_files/tests/evidence 一并给出
   （handoff id 同时写入，完整记录持久在 HandoffStore 按 id 可查）。session 由调用方创建
   （Session.open / SessionController.create —— 061-064 既有创建机制），本函数只做 seed。
2. **运行链侧**：`handoffToTaskSeed(handoff)` —— handoff → 061-064 运行链的 LoopTask 形状
   （goal/acceptance 透传；id 沿用 taskId），上层把该 seed 交给 LoopEngine.selectTask 即可续跑
   （复用 061-064 select → generate → evaluate → persist 运行链，goalSeam 同款）。

典型续跑流：budget/length 触发 → `collectHandoffMaterial` → `HandoffStore.create` →
`Session.open`（新 Session）→ `seedSessionFromHandoff` → `handoffToTaskSeed` → LoopEngine 续跑。

## 7. 设计选择与理由

- **放 engine 包而非 context 包**：素材（IterationStore/QueueTask/064 清理前快照）与触发
  （066 RunControl budget）全在 engine；放 context 需新增 engine→context 跨层依赖
  （违反「不引入跨层依赖」），放 engine 零新增依赖。Compaction 留在 context（session 日志内
  压缩），Handoff 在 engine（编排层快照 + 重启）—— 分层自然。
- **记录字段用 §12 逐字 snake_case**：JSON 存储即 §12 结构，零映射歧义；handoff.md 渲染同名输出。
- **存储走 059/063 模式**：目录 + id 前缀 handoff_ + tmp+rename 原子写 + env root 覆盖。
- **start seam 只做 seed 纯函数**：session 创建复用 core/application 既有机制，不新造会话工厂。
- **shared/events.ts 仅加一个 source 判别值 'handoff'**（B01 user/message；EVENT-SPEC 已同步），
  不新增事件词汇。
