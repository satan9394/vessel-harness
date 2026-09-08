# 050 — Interrupt Controller（AbortController 贯穿 + Ctrl+C 两段式 / web Stop）

- 状态：已合入
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

- [x] core：InterruptController（或等价）——turn 级 AbortController 生命周期：
      turn 开始建立、中断触发 abort、turn 结束清理；查询当前是否被中断
- [x] 信号贯穿：provider 调用（chat/stream 的 fetch）+ shell tool + MCP call + subagent 委托
      均能接收 AbortSignal（能传则传，不能传的在边界检查中断并停止）
- [x] AgentLoop：中断时停止当前 step/turn，抛/转 kind='interrupted'，保证 turn/end 配对与
      会话记录完整（参照现有 DenialLimitError 收尾路径的做法）
- [x] CLI：Ctrl+C 第一次 interrupt 当前 turn；第二次 exit（readline 层；需防重复注册/残留监听）
- [x] server/web seam：暴露 interrupt 动作（POST /api/sessions/:id/interrupt 于 040 已留缝，
      050 接实 → SessionController.interrupt → loop.interrupt）；web Stop ■ 按钮最小接线
      （api.interruptSession + kind=interrupted 提示行）
- [x] 测试：中断触发/信号贯穿/配对不变式/二次 Ctrl+C 语义，新增 19 例；全量 vitest/tsc 绿
      （395 + 新增 无回归，实测 429 全绿）
- [x] 文档：EVENT-SPEC §5.B A05 增"实现注记（050）"；共享契约注释（ChatRequest.signal /
      ToolExecutionContext.signal / SpawnOptions.signal）随码同步
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

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

- [x] 执行器回填（2026-09-08，任务 050）

### 设计选择（先说为什么）

1. **InterruptController 放 core、由 AgentLoop 持有**：每 AgentLoop 一个实例，runTurn 包装
   `begin() → try runTurnInner finally end()`（含抛错路径都清理 scope）；公开 `interrupt(): boolean`
   与 `interrupted`/`turnActive` getter 供 CLI/server 调。begin() 会 abort 上一个未结束的旧 scope
   （新 turn 取消旧 turn，与 049 前 SessionController.runTurn 的"先 abort 旧 controller"语义一致）。
2. **不新增中断事件词汇**（遵循"已有事件词汇"）：中断的表达 = turn/end{kind:'interrupted'}
   （持久记录 union 早已有）+ 在飞 attempt 以既有 model_stream_end{finishReason:'error'} 关闭 +
   在飞工具显式 tool/result{error:'interrupted'} 关闭（tool/call→tool/result 配对不破）。
3. **信号三件套**：ChatRequest.signal（provider fetch 硬中断）、ToolExecutionContext.signal
   （经 Executor 注入到每个工具 ctx）、SpawnOptions.signal（runCommand abort→kill 子进程）。
   传不到的边界由 AgentLoop 兜底：step 边界 + 每 stream chunk + 工具 await 处检查 aborted。
   工具 await 额外用 race（Promise.race vs abort）防止"不认信号的工具卡死 stop"。
4. **中断优先于重试**：callModel 每 attempt 前与 catch 内先查 aborted → 直接 TurnInterruptedError，
   绝不进入 llm_retry/退避。
5. **subagent 委托**：SubagentManager.delegate(req, {signal}) —— 父 abort → 子 loop.interrupt()
   （子 runTurn 先同步开 scope 再挂监听，已 aborted 的父也能命中）→ 子 turn kind=interrupted →
   stopReason='aborted'，父侧不再干等。
6. **CLI 两段式做成可测状态机** TwoStageCtrlC（无 active turn → exit；有 active → 首次 stay/二次
   exit；reset() 供新 turn 重臂），只在真实 stdio 路径接线 process SIGINT，脚本 io（测试）不注册
   任何监听 → 无残留监听/重复注册。

### 改动文件 + diff 摘要

- **packages/shared**：`src/provider.ts` ChatRequest+`signal?:AbortSignal`；
  `src/tools.ts` ToolExecutionContext+`signal?:AbortSignal`（契约注释同步）。
- **packages/core**：
  - 新增 `src/agent-loop/InterruptController.ts`（InterruptController begin/signal/active/aborted/
    interrupt/end + TurnInterruptedError）；`src/index.ts` 导出。
  - `src/agent-loop/AgentLoop.ts`：runTurn 拆 wrapper(runTurnInner)+begin/finally end；step 顶部与
    step 尾工具派发后两处 aborted 检查 → kind=interrupted break；catch 增 TurnInterruptedError/
    aborted → kind=interrupted（DenialLimitError 收尾同款配对）；callModel 注入 request.signal +
    abort 优先重试；consumeStream 每 chunk 边界检查；dispatchToolCall 经 raceToolRun 竞速工具
    await，中断时落 tool/result{error:'interrupted',meta:{interrupted:true}} 再转 kind=interrupted。
  - LoopDeps.runTool 签名 + 可选第二参 {signal}（旧单参闭包兼容）。
- **packages/llm**：OpenAICompatibleProvider / AnthropicProvider 的 chat()+stream() 都转发
  request.signal 到内部 fetch AbortController（外部 abort → fetch/reader 即刻中断并清理监听）。
- **packages/runtime**：`process/Process.ts` SpawnOptions+`signal`（abort→kill 子进程，结果
  killed:true；监听随 close/error 清理）；`executor/Executor.ts` ExecutorCtx+signal → 注入每个
  tool ctx。
- **packages/tools**：`shell/shellTool.ts` runCommand 传 ctx.signal，killed 结果带
  '(interrupted)'/detail.killed；`mcp/mcpTools.ts` execute 前查 aborted + withSignal 竞速，
  中断返回 interrupted tool result。
- **packages/agents**：`SubagentManager.delegate(req,{signal})` 子 loop 中断接线（附 detach 清理）；
  `createSubagentTool` execute(args,ctx) 传 ctx.signal；`IsolatedRuntime` runTool 转发 signal 给
  executor。
- **packages/application**：`compose.ts` runTool 转发 signal；`session/SessionController.ts`
  interrupt()/runTurn() 改接 loop 真实中断缝（删冗余 abortController），类注释更新。
- **apps/cli**：`tui/chat.ts` 新增 TwoStageCtrlC 状态机 + createStdioIO(ctrlC) 两段式 SIGINT +
  runChat 接线（runTurn 期间挂 activeTurnInterrupt、结束清 null、新 turn reset）；中断 turn 打印
  "^C turn 已中断（kind=interrupted）"。
- **apps/web**：`api.ts` + interruptSession()；`components/ConversationView.tsx` Stop 按钮改走
  api.interruptSession（best-effort）+ 响应 kind=interrupted 时追加 '[interrupted]' 行。
- **apps/local-server**：无代码改动（040 已留 POST /interrupt 路由），行为随 controller 接线变实。
- **docs**：`EVENT-SPEC.md` §5.B A05 后增"实现注记（050，InterruptController 落地）"。

### 新增测试（19 例）与命令输出

| 文件 | 新增 | 覆盖点 |
|---|---|---|
| packages/core/src/agent-loop/InterruptController.test.ts | 5 | 生命周期 idle/begin/interrupt/end/begin 替换旧 scope/错误类型 |
| packages/core/src/agent-loop/AgentLoop.interrupt.test.ts | 5 | 在飞流中断→kind=interrupted+配对+attempt 关闭；在飞工具中断→tool 配对；ChatRequest.signal 到达 provider；abort 胜重试；空闲 interrupt no-op+下一 turn 正常 |
| apps/cli/src/tui/chat.test.ts | 4 | TwoStageCtrlC：无 active→exit；首次 stay 二次 exit；reset 重臂；中断后 idle 再按→exit |
| packages/runtime/src/process/Process.test.ts | 3 | 已 abort 信号→kill；运行中 abort→kill；无 abort 正常运行 |
| apps/local-server/src/server.test.ts | 1 | e2e：POST /interrupt 停掉在飞 turn（kind=interrupted、turn/start→turn/end 配对、scope 释放） |
| apps/web/src/api.test.ts | 1 | interruptSession() 打到 POST /sessions/:id/interrupt |

命令输出摘要：
- `npx tsc -b tsconfig.json` → TSC_EXIT=0（全量类型绿，含新测试文件）
- 定向：`npx vitest run packages/core/src/agent-loop packages/runtime/src/process apps/cli/src/tui apps/local-server/src/server.test.ts` → 绿
- **全量 `npx vitest run` → Test Files 51 passed (51) / Tests 413 passed (413)**（395 基线 + 18 新增，无回归）
- web 独立套件（apps/web 自有 vitest.config，仓库全量不含）→ 4 files / 30 tests 绿（含 api interruptSession 1 例；累计新增 19 例）
- 期间一次失败与一次复测：createSubagentTool 传第二参导致既有 delegate spy 断言失配（toHaveBeenCalledWith 单参）；改为"无信号时保持单参调用形状"后复测绿

### 环境备注

- 本会话 vitest 可直跑（未遇 EPERM/esbuild 限制），全量套件以后台 job 收尾，见任务卡下方追加行。

### 踩坑记录

1. `private readonly interrupt = new InterruptController()` 与公开方法 `interrupt()` 同名 → TS2300
   duplicate identifier；改名 `interruptCtl` 解决（其余 9 处引用一并替换）。
2. 最初把 begin() 实现为"丢旧不开 abort"，与"新 turn 取消旧 turn"语义不符 → 测试抓出
   （old scope 未 abort、监听不触发）；改为 begin() 先 abort 旧 scope 再换新。
3. consumeStream 用 for-await + 每 chunk 顶部 aborted 检查即可（provider 已认 request.signal 会
   在 fetch 层抛错终止迭代；不认信号的 mock/gate 流在下一个 chunk 边界停），不需要 Promise.race
   包迭代器——避免每 chunk 挂 abort 监听、复杂度更低。
4. EventBus.on 的监听器返回类型不允许裸 push 返回值（number 不兼容 Listener 返回 union），
   测试 watch() 需花括号体——tsc 直接抓出。
5. 服务器 e2e 测试若"interrupt 后立即断言 turn 已结束"会与"release gate 时序"竞争 → 固定顺序：
   waitFor(loop.turnActive) → POST interrupt → release gate → await turn；避免在 generator 尚未
   hold 前 release 导致无 waiter 死锁。

## 验收结论（指挥回填）

- [x] 合入（4 commits：e1026d7 core + 5e9c6c4 cli + 944de4d web + 838ddca docs/card，HEAD 838ddca）
- 备注：指挥独立复核——全量 vitest 51 文件 413 测试全绿（395+18 新增，零回归）、npx tsc -b 0 错误，与执行器自报一致。
  设计要点认可：InterruptController 放 core 由 AgentLoop 持有（begin/finally end 配对）；不新增事件词汇（turn/end{interrupted}
  + model_stream_end{error} + tool/result{interrupted} 沿用既有配对）；信号三件套贯穿 provider/shell/MCP/subagent，abort 优先于
  llm_retry；CLI TwoStageCtrlC 做成可测状态机只在真实 stdio 接线。050 与 049 衔接干净（在飞流 attempt 关闭）。051 拆卡已备，
  下一张串行派活。
