# 051 — Steering Queue（运行中注入 user steer，step boundary 消费）

- 状态：待执行
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

- [ ] core：SteeringQueue（或等价）——线程安全入队/消费；语义：steer 只在 step boundary
      生效（step 内正在执行的 tool call 不被注入打断；原子文件写入不被中断——参照路线 §7.4）
- [ ] AgentLoop：step boundary 检查 queue，把未消费 steer 转成用户级 steer 消息注入下一次
      buildContext/模型调用（消息形态遵循 session 记录与 @vessel/shared 的 message 契约）
- [ ] 注入后清空/标记已消费；steer 有来源与时间戳，可审计
- [ ] server/web seam：暴露 steer 动作（如 POST /api/sessions/:id/steer，与 039/040 API 风格一致）
- [ ] 测试：入队/消费/边界不打断/多次 steer 累积/与 interrupt 共存，新增 ≥6 例；全量 vitest/tsc 绿
      （385+049+050 新增数 无回归）
- [ ] 文档：EVENT-SPEC 或涉及接口说明同步（steer 注入的表达方式遵循既有事件/记录词汇）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

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

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
