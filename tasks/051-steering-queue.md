# 051 — Steering Queue（运行中注入 user steer，step boundary 消费）

- 状态：待验收
- 优先级：P0（Wave 1 / Milestone C）
- 创建日期：2026-09-08
- 关联：049（AgentLoop stream wiring，前置已合入）；050（interrupt controller，前置，串行在 051 之前）；040 SSE
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §7.4 Steering（L970-990）

## 目标

实现 SteeringQueue：turn 运行中允许外部注入 user steer 指令（如"先别改这个文件"、
"把范围缩小到 backend"、"先跑测试再继续"），AgentLoop 在 step boundary 消费并作为
一条 user steer 事件/消息注入下一轮模型上下文，不打断正在执行的原子工具调用。
与 050 interrupt 互补：interrupt = 停，steer = 改方向继续。

## 验收标准（执行器逐条勾选）

- [x] core：SteeringQueue（或等价）——线程安全入队/消费；语义：steer 只在 step boundary
      生效（step 内正在执行的 tool call 不被注入打断；原子文件写入不被中断——参照路线 §7.4）
- [x] AgentLoop：step boundary 检查 queue，把未消费 steer 转成用户级 steer 消息注入下一次
      buildContext/模型调用（消息形态遵循 session 记录与 @vessel/shared 的 message 契约）
- [x] 注入后清空/标记已消费；steer 有来源与时间戳，可审计
- [x] server/web seam：暴露 steer 动作（POST /api/sessions/:id/steer，050 已留缝，本卡接通为
      实时转发 loop.steer；040 框架同风格）
- [x] 测试：入队/消费/边界不打断/多次 steer 累积/与 interrupt 共存，新增 13 例；全量 vitest/tsc 绿
      （413 + 13 = 426 无回归）
- [x] 文档：EVENT-SPEC A05 后追加 051 实现注记（steer 走既有 B01 user/message 记录，
      source:'steer' 判别值扩展，不新增事件词汇）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 core 队列机制 + AgentLoop step-boundary 注入 + server API seam + 测试。
- 不做 UI 打磨（steer 输入框等）；不做 resume/crash UI（053）。

## 涉及文件（指针，执行器自行精化）

- packages/core/src/agent-loop/AgentLoop.ts（step boundary 消费点；049/050 合入后在其上改）
- packages/core/src/ 新增 steering 模块（queue + 消费逻辑）
- packages/shared（message/event 契约扩展，如需）
- apps/local-server（steer API；040 框架）
- 相关测试：core agent-loop、server

## 方法

- 读路线 §7.4 与 049/050 合入后的 AgentLoop step 循环结构
- queue 在 step 边界 drain：未消费 steer → 包装为 user 消息追加进下次 buildContext 的 messages
- 边界语义：step 内（工具执行中）的入队只缓存，下一 step boundary 才生效

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 执行器已回填（2026-09-08，隔离执行器）

### 改动文件与 diff 摘要

- `packages/shared/src/events.ts` — B01 `UserMessageRecord.source` 联合追加 `'steer'` 判别值
  （steer 以既有 user/message 记录表达，不新增事件/记录类型；EVENT-SPEC B01 生产方词汇对齐）。
- `packages/core/src/agent-loop/SteeringQueue.ts`（新增）— SteeringQueue：`enqueue(content, source)` /
  `drain()` / `pending` / `peek()`。每项 `SteerItem {id, content, source, ts}`（来源 + ISO 入队时间戳，
  pending 态可审计）。enqueue/drain 均同步（无 await 间隙），单线程事件循环下原子取整批、不丢不重；
  空白内容拒绝入队。空内容 enqueue 返回 null。
- `packages/core/src/agent-loop/AgentLoop.ts` — 持有 `steerQueue`；公开 `steer(content, source?)` 与
  `pendingSteerCount`；step 循环顶部（interrupt 检查后、下一 step 的 beginStep/buildContext 之前）
  调用新增私有 `drainSteers()`：drain 整批 → 逐条 `session.appendSync` B01 记录
  `{type:'user/message', msgId:'m_steer_<hex>', role:'user', content, source:'steer', surface:true}`。
  语义：只消费于 step boundary，in-flight 工具/模型不被打断；注入即清空；turn 内无剩余 boundary 时
  未消费 steer 跨 turn 保留，下一 turn 首 boundary 注入。模型上下文经既有 surface 投影派生，无需改
  ContextBuilder。与 050 共存：interrupt 检查仍在 drain 之前（停优先），steer 从不 abort 任何信号。
- `packages/core/src/index.ts` — 导出 SteeringQueue 模块。
- `packages/application/src/session/SessionController.ts` — `steer(message, source?)` 从"本地缓存数组"
  改为转发 `this.harness.loop.steer(...)`；`pendingSteerCount` 读取 loop 队列长度（删除 pendingSteers）。
- `apps/local-server/src/server.ts` — 无改动（POST /api/sessions/:id/steer 路由 050 已存在，现经
  SessionController 实时接通）。
- `docs/EVENT-SPEC.md` — A05 050 注记后追加 051 实现注记（队列机制/边界语义/B01 source:'steer'/
  server seam）。
- `tasks/051-steering-queue.md` — 本工作证明回填。

### 新增测试（13 例，全部通过）

- `packages/core/src/agent-loop/SteeringQueue.test.ts`（6 例）：enqueue 审计字段（source+ts+id）、
  source 默认 user 且内容 trim、空白拒绝、drain FIFO 全清/空 drain 无操作、多次累积单次消费、
  drain 后新入队缓存到下一 drain。
- `packages/core/src/agent-loop/AgentLoop.steer.test.ts`（5 例）：idle 入队 → 下一 turn step-1 boundary
  注入（模型上下文可见 + B01 source:'steer' 记录 + 顺序在 user input 之后 assistant 之前）；
  工具执行中入队不打断（signal 不 abort、tool/result 正常配对、step-1 上下文无 steer、step-2 上下文有）；
  多次 steer 累积 FIFO 单边界消费；与 interrupt 共存（interrupt 停 turn 后 steer 跨 turn 保留并在下一
  turn 注入）；纯文本末步到达的 steer 不注入当轮、下一轮生效。
- `packages/application/src/session/SessionController.test.ts`（+1）：steer() → runTurn 消费 →
  pendingSteerCount 归零 + 记录 source='steer'。
- `apps/local-server/src/server.test.ts`（+1）：POST /api/sessions/:id/steer 在 turn in-flight 时入队
  返回 pendingSteerCount=1 → 当轮纯文本完成不注入 → 下一轮首 boundary 消费并落 source='steer' 记录。

### 命令输出摘要

- `npx tsc -b tsconfig.json --pretty false` → exit 0（全仓类型构建绿）。
- `npx vitest run` → **426 passed (426)**，53 test files，无回归（基线 413 + 新增 13）。
  一次全量运行中出现 1 例与本次改动无关的 Windows 瞬时 flake：
  `apps/cli/src/providers/ProviderStore.test.ts`（EPERM rename providers.json.tmp，temp 目录瞬时锁）；
  该文件独立重跑 28/28 通过，且首轮全量与最终全量均全绿，判定为环境瞬时抖动非回归。

### 设计选择与理由

1. 队列归属 AgentLoop（对称 050 InterruptController），SessionController 只做转发——steer 是 loop
   运行期语义，跨 runTurn 生存期在 loop 内最自然。
2. 注入形态走 B01 `user/message` 记录（`source:'steer'`）而非新事件/新记录——消息形态遵循既有
   session 记录契约，模型上下文经 surface 投影自动派生（模型可见 ⟺ 已记录），ContextBuilder 零改动；
   与 050"不新增事件词汇"一致，仅在既有记录 source 联合上扩一个判别值。
3. 消费点放在 step 循环顶部、interrupt 检查之后、beginStep/buildContext 之前——"step boundary"
   的精确落点：上一 step 的 step/end 之后才可能 drain；in-flight 工具期间入队只缓存；interrupt
   优先于 steer（停优先于改方向）。
4. drain 整批原子 splice + 逐条 appendSync：不丢不重，注入即清空；同批多条按 FIFO 落盘。
5. queue 项带 source（user/api/cli/web）与 ts（ISO）满足"来源与时间戳可审计"；落盘后 seq/ts 由
   Session 自动赋，构成持久审计轨迹。

### 踩坑记录

- 环境备注：本会话 pwsh 可直接跑 npx vitest/tsc（无 EPERM 限制），全程命令均 1 次成功。
- server 端到端测试初版在全量负载下偶发 30s 超时：原因是以 `loop.turnActive`（scope 刚开）作为
  "in-flight"等待点，turn 的模型 gate 尚未注册，单次 `release()` 可能先于 waiter 注册触发导致
  turn1 永久挂起。修复：等待 GatedServerProvider 暴露的 `holding`（waiter 已注册 = 模型真在 gate 上）
  再发 steer，并把第二轮的 release 循环上限放宽到 15s（多余 release 为 no-op）。
- vitest 全量一次报 ProviderStore rename EPERM：判定为 Windows temp 目录瞬时锁 flake（独立文件
  28/28 绿、与本 diff 无交集、首末两轮全量均绿），非回归。

### 范围边界核对

- 未做 UI（steer 输入框）、未做 resume/crash UI（053）、未改 ContextBuilder、未新增依赖、
  未做无关重构。core 仅依赖 @vessel/shared 契约。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
