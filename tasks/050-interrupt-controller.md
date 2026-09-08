# 050 — Interrupt Controller（AbortController 贯穿 + Ctrl+C 两段式 / web Stop）

- 状态：待执行
- 优先级：P0（Wave 1 / Milestone C）
- 创建日期：2026-09-08
- 关联：049（AgentLoop stream wiring，前置，须先合入）；051 steering queue；040 SSE 框架
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §7.3 Interrupt（L938-966）

## 目标

实现 interrupt controller：每个 active turn 建立 AbortController，使 provider 请求（含
049 之后的 stream 消费）、shell 进程、MCP call、subagent 都能拿到 AbortSignal 并在中断时停止；
CLI 支持 Ctrl+C 第一次 = interrupt current turn / 第二次 = exit；web surface 暴露 Stop 动作。
中断后的 turn 以 kind='interrupted' 正常收尾（配对 turn/start→turn/end 不变式不能破）。

## 验收标准（执行器逐条勾选）

- [ ] core：InterruptController（或等价）——turn 级 AbortController 生命周期：
      turn 开始建立、中断触发 abort、turn 结束清理；查询当前是否被中断
- [ ] 信号贯穿：provider 调用（chat/stream 的 fetch）+ shell tool + MCP call + subagent 委托
      均能接收 AbortSignal（能传则传，不能传的在边界检查中断并停止）
- [ ] AgentLoop：中断时停止当前 step/turn，抛/转 kind='interrupted'，保证 turn/end 配对与
      会话记录完整（参照现有 DenialLimitError 收尾路径的做法）
- [ ] CLI：Ctrl+C 第一次 interrupt 当前 turn；第二次 exit（readline 层；需防重复注册/残留监听）
- [ ] server/web seam：暴露 interrupt 动作（如 POST /api/sessions/:id/interrupt 或 SSE 命令通道，
      与 040/039 现有 API 风格一致）；web Stop ■ 按钮能触发（前端最小接线即可，UX 打磨不在此卡）
- [ ] 测试：中断触发/信号贯穿/配对不变式/二次 Ctrl+C 语义，新增 ≥6 例；全量 vitest/tsc 绿
      （385+049 新增数 无回归）
- [ ] 文档：EVENT-SPEC/涉及接口说明同步（中断事件的表达方式，遵循已有事件词汇）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 聚焦 core 中断机制 + CLI 键位 + 最小 web 接线。steering（051）单独成卡。
- 不做优雅恢复/resume UI（053）、不做 UI 打磨。

## 涉及文件（指针，执行器自行精化）

- packages/core/src/agent-loop/AgentLoop.ts（turn 生命周期/收尾路径；049 合入后在其上改）
- packages/core/src/ 新增 interrupt 模块（放 core，勿进薄核之外；AbortController 是标准机制）
- provider/shell/MCP/subagent 的调用点（signal 贯穿；packages/*/src 下对应实现）
- apps/cli（Ctrl+C readline 处理）
- apps/local-server（interrupt API/SSE；040 框架）
- 相关测试：core agent-loop、cli、server

## 方法

- 读路线 §7.3 与 EVENT-SPEC 事件流；看现有 CLI 键位处理与 local-server API 风格
- core 层设计 turn 级 signal：deps 注入或 controller 持有；agent 循环在 step 边界检查 aborted
- CLI：SIGINT handler 状态机（无 active turn → exit；有 active turn → 第一次 abort 第二次 exit）

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
