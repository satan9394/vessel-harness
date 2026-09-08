# 067 — Context Reset Handoff（结构化交接，长任务续跑）

- 状态：已合入
- 优先级：P0（Wave 3 / Milestone E）
- 创建日期：2026-09-08
- 关联：063（IterationStore/任务状态可作 handoff 素材）；064（worktree 生命周期）；066（Goal/Loop 模式）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §12（L1231-1262）：Context Reset + Structured Handoff
  用于真正多小时任务；handoff yaml 字段 goal/completed/current_state/changed_files/tests/decisions/blockers/
  next_actions/evidence；新 Agent/新 Session 从 Handoff 启动；不要只靠无限 compact

## 目标

Context Reset + Structured Handoff：长任务（Goal/Loop 模式）在上下文接近预算时，把运行状态固化为
结构化 handoff（对齐 §12 yaml 字段），并支持从 handoff 启动新 Session/Agent 续跑——与既有
Compaction（packages/context/src/compaction/Compaction.ts）并存但不同机制（compact=对话内压缩，
reset=全新上下文 + 结构化交接）。素材复用 063 IterationStore/任务状态。

## 验收标准（执行器逐条勾选）

- [x] Handoff 生成：给定任务+当前状态+改动文件+测试+决策+阻塞+下一步+证据（素材取自 063 IterationStore/
      任务对象与 064 清理前快照）→ 结构化 handoff（§12 yaml 字段齐；存储走既有 .vessel 约定/原子写/id 前缀
      handoff_ 或沿用 review 模式）
- [x] 从 handoff 启动：新 Session/Agent 从 handoff 恢复（goal/completed/next_actions 注入起始上下文；
      current_state/changed_files/tests 可查；blockers/decisions 透传）——复用 061-064 运行链或既有
      session 创建机制
- [x] 触发条件：上下文预算（如 066 budget 或会话长度阈值）到达时可生成 handoff 供续跑；与 065 Goal UI
      状态可见（可后续接 UI，本卡 seam 即可）
- [x] 与既有 Compaction 并存说明（文档：何时 compact vs reset）；不破坏现有 compaction 测试
- [x] 测试 ≥6 例：handoff 生成字段齐/持久化 round-trip/从 handoff 启动恢复/素材来源/异常；root vitest/tsc 绿
      （618+ 无回归）
- [x] 文档同步（§12 语义：Context Reset vs Compaction）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 handoff 生成/启动机制 + seam。1h soak（068）各自成卡；UI 打磨不做（seam 即可）。

## 涉及文件（指针，执行器自行精化）

- packages/context（既有 compaction/Compaction.ts——并存参照；或新 handoff 模块）
- packages/engine（063 IterationStore/任务状态；064 清理前快照；066 budget 触发）
- 存储参照 059/063 模式（目录/id/原子写/root 覆盖）
- session 创建（新 Session 从 handoff 启动——core/session 或 application compose seam）

## 方法

- 读 §12 与 Compaction.ts 现状；定 handoff 类型（TS 源）+ 序列化（yaml/json 均可，字段对齐 §12）
- 生成：从 IterationStore/任务状态聚合素材；启动：handoff → 新 session 首轮上下文
- 触发：budget/长度阈值处生成；测试直接调生成/启动 API

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已回填（2026-09-08，执行器）

### 改动文件（diff 摘要）

| 文件 | 改动 |
|---|---|
| packages/shared/src/events.ts | B01 `UserMessageRecord.source` 联合新增 `'handoff'`（判别值扩展；EVENT-SPEC 已同步，无倒挂） |
| packages/engine/src/handoff/Handoff.ts | **新增**：HandoffRecord（§12 yaml 字段逐字 snake_case：goal/completed/current_state/changed_files/tests/decisions/blockers/next_actions/evidence）+ 引擎复用元数据（taskId/acceptance/projectRoot/continuationOf）；buildHandoff（goal 空 fail loud、数组归一）；isHandoffRecord/parseHandoff/serializeHandoff；newHandoffId（`handoff_<ts>_<hex>`） |
| packages/engine/src/handoff/HandoffMaterial.ts | **新增**：collectHandoffMaterial —— 素材聚合（063 QueueTask + IterationStore 回放 + 064 清理前快照 → §12 素材；met→completed、not_met→blockers、逐迭代→decisions/evidence、next_actions 确定性派生） |
| packages/engine/src/handoff/HandoffStore.ts | **新增**：目录存储（059/063 模式：`~/.vessel/handoffs`，env `VESSEL_HANDOFFS_ROOT` 覆盖；`<root>/<handoff-id>/meta.json` + handoff.md；tmp+rename 原子写；get/list/latest 容错损坏） |
| packages/engine/src/handoff/HandoffRender.ts | **新增**：renderHandoffText —— §12 yaml 对齐文本投影（handoff.md artifact） |
| packages/engine/src/handoff/HandoffTrigger.ts | **新增**：shouldGenerateHandoff（budget 0.9×window 晚于 Compaction 0.8 / 长度阈值 1500 条 / force）；handoffSeamState —— 065 Goal UI 可见 seam 纯状态（不深做 UI） |
| packages/engine/src/handoff/StartFromHandoff.ts | **新增**：seedSessionFromHandoff（B01 user/message source='handoff' 注入新 Session 起始上下文；goal/completed/next_actions 注入、blockers/decisions 透传、§12 九字段内联 + handoff id 可查）；handoffStartContext；handoffToTaskSeed（接 061-064 LoopEngine 运行链） |
| packages/engine/src/index.ts | 导出 handoff 六模块 |
| packages/engine/src/handoff/handoff.test.ts | **新增 16 例测试**（见下） |
| docs/CONTEXT-RESET-HANDOFF.md | **新增**：机制文档（compact vs reset 决策规则、结构/存储/触发/启动、设计选择） |
| docs/Vessel_后续开发方向与产品化路线_v1.0.md | §12 追加「§12.1 实现落地（067）」同步（原路线文本不动） |
| docs/EVENT-SPEC.md | B01 source 枚举同步 `handoff`（V1.3 新增，EVENT-SPEC 行 451） |
| tasks/067-context-reset-handoff.md | 本卡：验收勾选 + 工作证明 + 状态改待验收 |

### 新增测试（16 例，packages/engine/src/handoff/handoff.test.ts）

1. buildHandoff §12 九字段齐 + id 前缀 handoff_ + 时间戳（生成字段齐）
2. buildHandoff 异常：goal 空 fail loud；数组宽容归一（异常）
3. serialize/parse round-trip + isHandoffRecord 校验 + malformed 异常（持久化 round-trip/异常）
4. newHandoffId id 约定
5. defaultHandoffRoot env VESSEL_HANDOFFS_ROOT 覆盖（存储 root 覆盖）
6. HandoffStore create 落盘 meta.json + handoff.md + 原子写无 tmp 残留 + get round-trip（持久化 round-trip）
7. list 最新在前 + latest + 未知 id/损坏 meta → undefined 容错（异常/容错）
8. renderHandoffText §12 全部 yaml 字段名
9. collectHandoffMaterial 从 QueueTask + IterationStore 回放聚合素材（素材来源）
10. collectHandoffMaterial 无迭代/无快照安全缺省 + next_actions 第一轮（素材来源/异常）
11. seedSessionFromHandoff 新 Session 恢复：goal/completed/next_actions 注入 + blockers/decisions 透传 + handoff id 可查（从 handoff 启动恢复）
12. handoffStartContext 纯函数 §12 九字段内联 + 空字段占位（从 handoff 启动）
13. handoffToTaskSeed 061-064 LoopTask 形状映射（运行链复用）
14. shouldGenerateHandoff budget 比例（0.9 晚于 Compaction 0.8）（触发条件）
15. shouldGenerateHandoff 长度阈值 + force + 非法阈值 fail loud（触发条件/异常）
16. handoffSeamState 065 Goal UI 可见 seam 纯状态（触发条件 seam）

### 验证输出（本机直跑，无环境受限）

```
$ npx tsc -b tsconfig.json --pretty false        → EXIT:0
$ npx vitest run packages/engine/src/handoff     → 16 tests passed (16)
$ npx vitest run packages/engine                 → 10 files / 115 tests passed（无回归）
$ npx vitest run（root 全量）                     → 72 files / 634 tests passed（618 基线 + 16 新增；无回归）
$ npx vitest run（apps/web 独立套件）             → 8 files / 74 tests passed（不变）
```

### 设计选择与理由

1. **模块放 packages/engine 而非 context**：素材（IterationStore/QueueTask/064 清理前快照）与触发
   （066 RunControl budget）全在 engine；放 context 需新增 engine→context 跨层依赖（违反「不引入跨层
   依赖」），放 engine 零新增依赖。Compaction 留 context（session 日志内压缩），Handoff 在 engine
   （编排层快照 + 重启）——分层自然，二者并存。
2. **记录字段名与 §12 yaml 逐字一致（snake_case）**：JSON 存储即 §12 结构，零映射歧义；handoff.md
   渲染同名输出。首次实现曾用 camelCase（currentState/changedFiles/nextActions），测试暴露与 §12
   字段名不一致，改为逐字对齐（见踩坑）。
3. **存储走 059/063 模式**：`~/.vessel/handoffs`（env `VESSEL_HANDOFFS_ROOT`）；id 前缀 `handoff_`；
   tmp+rename 原子写；目录布局 meta.json + handoff.md（review 模式同款）。
4. **start seam 只做 seed 纯函数**：session 创建复用 core/application 既有机制（Session.open /
   SessionController.create），本卡不新造会话工厂；运行链复用走 handoffToTaskSeed → LoopEngine。
5. **shared/events.ts 仅加一个 source 判别值 'handoff'**（B01 user/message），不新增事件词汇；
   EVENT-SPEC B01 已同步（吸取 V0.2 MINOR-1「规范先行」教训，无倒挂）。
6. **触发默认值**：budget 0.9×contextWindow（晚于 Compaction 0.8 —— 先 compact 后 reset，reset 是
   多次压缩后仍近上限的最后手段）；长度阈值 1500 条；force 手动。
7. **065 UI 只做 seam**：handoffSeamState 纯状态（generate/reason/latestHandoffId），UI 后续接入
   只读该状态，本卡不深做 UI（范围边界）。

### 踩坑记录

- **两个 store 共用同一 tmp 根目录会互相覆盖 meta.json**（测试 bug）：ProjectTaskQueue 与
  IterationStore 同 root 时，appendIteration 会把 QueueTask 的 meta.json 覆盖成 IterationTaskRecord
  形状 → queue.get 校验失败返回 undefined。修复：测试给两个 store 各自独立 tmp 根（生产路径本就
  `~/.vessel/taskqueue` vs `~/.vessel/iterations` 分离）。
- **`expect(parseHandoff(x)).toThrow()` 不会捕获**：throw 在 toThrow 求值前发生（急切求值），
  需包函数 `expect(() => parseHandoff(x)).toThrow()`。
- **`toContain(expect.stringContaining(...))` 对字符串数组不生效**（vitest 2.x 行为）：改
  `array.join('|')` 后 contains。
- **§12 字段命名**：初版用 camelCase，测试 `toHaveProperty('current_state')` 暴露与 §12 yaml
  不一致 → 改为逐字 snake_case（记录即 §12 结构）。
- **`§` 不是合法 JS 标识符**：测试常量命名 `§12_FIELDS` 编译失败 → 改名 HANDOFF_FIELDS。
- **destructure 数组在 noUncheckedIndexedAccess 下元素可为 undefined**：`const [record] = ...`
  TS18048 → 改 `records[0]!`。

### 未做（范围边界）

- 1h soak（068 各自成卡）；UI 打磨不做（065 seam 已提供）；HTTP/API 接线不做（本卡 seam 即可）。

## 验收结论（指挥回填）

- [x] 合入（commit 0bc85d6）
- 备注：指挥独立复核——全量 vitest 72 文件 634 测试全绿（618+16，零回归）、tsc -b 0 错误，与执行器自报一致。
  设计认可：handoff 六模块（Handoff 九字段逐字 snake_case 对齐 §12 / HandoffStore 059 模式 / HandoffMaterial 素材
  聚合自 063+064 / HandoffTrigger budget 0.9×window 晚于 Compaction 0.8 + 长度阈值 + force / StartFromHandoff
  seedSessionFromHandoff 注入 B01 source='handoff' + handoffToTaskSeed 接运行链）；模块放 engine（避免跨层依赖，
  与 context/Compaction 分工清晰：compact=同会话压缩、reset=新会话结构化交接）。路线文档追加 §12.1 实现注记（未改
  原文）。下一张：068（1h soak——Milestone E 收官）。
