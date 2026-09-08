# 049 — AgentLoop stream wiring（模型调用路径 stream 优先 + model_stream 事件）

- 状态：待验收
- 优先级：P0（Wave 1 / Milestone C 首发）
- 创建日期：2026-09-08
- 关联：046（streaming contract v2，已完成）；050 interrupt；052/053 live projections UI（后置）
- 执行器：隔离子代理（本卡一个执行器，干完回填本文档）

## 目标

把 AgentLoop 的模型调用路径升级为 **stream 优先**：provider 支持 `stream()`（046 已交付
`ChatProvider.stream?(): AsyncIterable<StreamChunk>`，llm 三 provider 均已实现）时，
AgentLoop 消费流式 chunk 并逐段发射 `model_stream*` 事件（接 040 已建的 event projections
框架）；无 stream 的 provider 回退现有 `chat()` 路径，行为不变。

## 验收标准（执行器逐条勾选）

- [x] EVENT-SPEC / shared 事件词汇：`EventType` 增加 model_stream 事件族（命名与 payload
      形态遵循 docs/EVENT-SPEC.md §2.1/§5.C 与现有 after_model/before_model 惯例；
      落地为 model_stream_start / model_stream_delta / model_stream_end，选择理由见工作证明）
- [x] AgentLoop：`callModel`（packages/core/src/agent-loop/AgentLoop.ts）在 provider.stream
      存在时走流式路径：
      - text_delta → 增量发射 model_stream_delta 并累积 finalText
      - tool_call_start/delta/end → 按 id 累积组装 toolCalls（arguments 跨 delta 拼接，
        支持交错并行工具调用，tool_call_end 解析）
      - usage / message_end → 逐字段 last-wins 汇入 usage、finishReason 汇入终止 payload
      - 语义等价性：assistant/message、assistant/attempt、after_model（带 usage）、纯文本
        停止判据、max_steps budget、llm_retry 全部复用既有代码路径，仅 callModel 内部换源
- [x] 回退：provider 无 stream() 时保持原 chat() 调用路径（回退测试覆盖，零回归）
- [x] 测试：新增 AgentLoop.stream.test.ts 10 例（流式文本/多 delta 拼接/工具调用分发/
      跨 delta 参数组装/交错并行工具/分帧 usage 合并/事件发射断言/回退路径/流中可重试错误
      重试/重试耗尽），全量 vitest/tsc 绿无回归
- [x] 文档：EVENT-SPEC.md §5.C A09 增补"实现注记（049）"词汇映射说明
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 core 层接线 + 事件词汇 + 测试。SSE/web 增量 UI（052/053）不在本卡。
- UsageProjection 等 040 projections 是否消费新事件：本卡只保证事件可订阅、形状稳定；
  增量 UI 消费留 052，本卡在"备注"给建议，不实现 UI。

## 涉及文件（指针，执行器自行精化）

- packages/core/src/agent-loop/AgentLoop.ts（模型调用点 callModel；bus.emit 点）
- packages/shared/src/events.ts（EventType 联合 + model_stream payload 接口）
- packages/shared/src/provider.ts（新增 ChatFinishReason 具名联合别名）
- docs/EVENT-SPEC.md（§5.C A09 实现注记）
- packages/core/src/agent-loop/AgentLoop.stream.test.ts（新增，10 例）
- packages/llm/src/provider/mock.ts（MockProvider.stream，测试用，未改动）

## 方法

- 读 EVENT-SPEC.md §2.1/§5.C 定事件名与 payload；读 046 的 StreamChunk 与 llm provider 实现
- AgentLoop 加流式分支：调用 stream() 的 AsyncIterable，逐 chunk 映射事件+累积状态
- 保持 ChatResponse 形状不变，下游（session 记录 / after_model / dispatchToolCall）不动

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 待执行器回填 → 已回填（见下）

### 改动文件与 diff 摘要

1. `packages/shared/src/provider.ts`
   - 新增 `export type ChatFinishReason = 'stop' | 'tool_calls' | 'length' | 'error';`
     （provider.ts ~L47），`ChatResponse.finishReason` 改引用该别名（联合值不变，
     非破坏性）；供 stream 归一化与事件 payload 共用，避免词汇与契约漂移。
2. `packages/shared/src/events.ts`
   - 顶部 type-only import `ChatFinishReason / ChatToolCall / ChatUsage / StreamChunk`
     from './provider.js'（type-only，编译期擦除，无运行时环）。
   - `EventType` 联合新增 3 成员：`model_stream_start` / `model_stream_delta` /
     `model_stream_end`（插在 before_model 与 after_model 之间，流事件先于终态事件）。
   - 新增 payload 接口族：`ModelStreamEnvelope {turnId, step, requestId}`（基）、
     `ModelStreamStartPayload + model`、`ModelStreamDeltaPayload + chunk: StreamChunk`、
     `ModelStreamEndPayload {finishReason, text, toolCalls, usage}`。
3. `packages/core/src/agent-loop/AgentLoop.ts`
   - imports 增补 `ChatFinishReason / ChatToolCall / ChatUsage / StreamChunk` 类型。
   - `callModel`（唯一模型调用点）改造为 stream 优先：`requestId = req_{turnId}_step{step}`
     （确定性，跨 attempt 稳定）；`typeof provider.stream === 'function'` → 调
     `consumeStream(provider.stream(request), …)`，否则保持 `provider.chat(request)`；
     重试/退避/llm_retry 包装对两路径完全一致（attempt 计数、backoff、onRetry 不动）。
   - 新增私有 `consumeStream`：逐 chunk 映射——message_start 跳过（model 已随
     model_stream_start 携带）；text_delta → `text +=` + emit model_stream_delta；
     tool_call_start/delta/end → 按 id 维护 `open: Map<id,{name,args}>` 累积参数并 emit
     model_stream_delta，tool_call_end（或流被截断收尾）时 `parseToolArguments` 解析入
     toolCalls（start 序保持，支持交错并行调用）；usage → 逐字段 last-wins 并入；
     message_end → 记 wireFinish。流抛错时先 emit `model_stream_end {finishReason:'error'}`
     再抛出（attempt 级 start→end 配对不变式），由 callModel 统一走 llm_retry。
     正常终止 emit model_stream_end 并返回与 chat() 等价的 ChatResponse。
   - 模块级 helper：`normalizeFinishReason(wire, hasToolCalls)`（chat() 语义等价：
     length/error 透传、tool_calls 或有工具调用 → 'tool_calls'，否则 'stop'）；
     `parseToolArguments(raw)`（空串 → {}；JSON 解析失败 → `{_raw}`，对齐 OpenAI chat()
     防御式回退，畸形/截断 fragment 不崩轮次）。
4. `packages/core/src/agent-loop/AgentLoop.stream.test.ts`（新增，10 例，见下测试节）
5. `docs/EVENT-SPEC.md`
   - §5.C A09 ModelStream 卡后新增"实现注记（049，flat 事件族落地）"：说明判别字段
     event:'start'|'delta'|'end' 粒度化为三个扁平 EventType、requestId 生成规则、
     三事件 payload 形状、usage/message_end 折叠进 end、失败 attempt 以 'error' 关闭。
6. `tasks/049-agentloop-stream-wiring.md`（本文件）：状态/验收勾选/工作证明回填。

### 事件命名选择与理由（简记）

- EVENT-SPEC §5.C A09 定义的是单个 ModelStream 扩展事件、以 `event:'start'|'delta'|'end'`
  判别；本仓库实现词汇是扁平每个决策点一个 EventType（before_model/after_model、
  before_tool/after_tool、llm_retry…），故把判别字段粒度化为三个可独立订阅的事件
  `model_stream_start / model_stream_delta / model_stream_end`（任务卡建议名一致），
  使 `bus.on('model_stream_delta')` 只订阅一件事、052 UI 投影可只挂增量渲染。
- 相关信封 `{turnId, step, requestId}`：turnId/step 与 after_model 载荷同口径；
  requestId = `req_{turnId}_step{step}` 确定性生成，一次逻辑请求的重试 attempt 共享，
  便于回放/按请求聚合；A09 规范字段 requestId 语义由此满足。
- 事件载荷直接复用 provider 契约类型（StreamChunk / ChatUsage / ChatToolCall /
  ChatFinishReason），保证事件词汇与 ChatProvider seam 不漂移。
- 终止记账 chunk（usage/message_end）不发 delta、折叠进 end payload（增量逐帧 usage
  记账留 v0.2 扩展），避免 delta 语义过载。

### 新增测试（10 例，文件 packages/core/src/agent-loop/AgentLoop.stream.test.ts）

| # | 用例 | 断言要点 |
|---|---|---|
| 1 | Mock 纯文本流 → 轮次停止 | kind=success、steps=1、finalText='world'、assistant/message 落库 |
| 2 | 事件发射形状与顺序 | start×1/delta×1/end×1、requestId=`req_{turnId}_step1`、chunk 透传、end 载荷 usage 100/20 |
| 3 | 多 text_delta 拼接 | finalText='Hello, world!'、逐 delta 事件各带片段 |
| 4 | Mock 工具调用流 → 分发 | toolCalls 派发 1 次、assistant/attempt+tool/result 落库、2 步 after_model usage=100/20 |
| 5 | 参数跨 tool_call_delta 组装 | dispatched arguments={path:'README.md'}、end.toolCalls 组装完整 |
| 6 | 交错并行工具调用 | 分发序 tc_a→tc_b、参数 {x:'a'}/{y:'b'}、end.toolCalls 按 start 序 |
| 7 | 分帧 usage 合并（Anthropic 式） | 3 帧 → end.usage 与 after_model.usage={100,20,5} |
| 8 | 回退路径（无 stream） | chat() 恰调 1 次、无任何 model_stream_* 事件、finalText 正确 |
| 9 | 流中可重试错误 → llm_retry+重试 | attempts=2、llm_retry TIMEOUT attempt1、attempt 级 start→end('error')→start→end('stop') |
| 10 | 重试耗尽 | rejects /Model call failed after 2 attempt/、llm_retry attempt=[1,2]、每次 attempt start→end('error') |

针对性命令与输出摘要（本会话命令可跑，无 EPERM/沙箱受限）：

```
npx vitest run packages/core/src/agent-loop/AgentLoop.stream.test.ts packages/core/src/agent-loop/AgentLoop.test.ts
→ Test Files  2 passed (2)
  Tests  15 passed (15)   （10 新增 + 5 既有 AgentLoop 测试）
```

### 全量验证结果

- [x] 全量 `npx vitest run`：**Test Files 48 passed (48)；Tests 395 passed (395)**
      （基线 385 + 新增 10 = 395，零失败零跳过；含既有 AgentLoop 5 例、projections、
      llm stream parser/provider、engine/agents/bench 全部既有用例，无回归）
- `npx tsc -b tsconfig.json`：**0 错误**（exit 0）。首次运行在新增测试文件报了 13 个
  noUncheckedIndexedAccess / listener 返回值类型错误（仅测试文件，源码首轮即干净），
  已修复后重跑 0 错误。

### 踩坑与解决（沉淀进 AGENTS.md）

1. 仓库 tsconfig 开 `strict` + `noUncheckedIndexedAccess`：对 `arr[0].field` 直取属性报
   TS2532。测试断言里所有 `starts[0]`/`deltas[0].chunk` 等需 `!` 断言（先 toHaveLength
   守卫再取，语义不变）。EventBus.on 监听器若用表达式体返回 `push()` 会报返回值类型错
   （Listener 期望 void/WaterfallResult），用块体 `{ …; }` 即消。
2. events.ts 与 provider.ts 双向 type-only import 无运行时环：`import type` 编译期擦除，
   tsc 首轮验证通过；若未来改 value import 需拆共享类型文件。
3. EventType 是扁平字符串联合、无 exhaustiveness switch 消费方，新增成员零风险；
   已 grep 确认全仓无 switch(EventType) 类站点。

### 环境备注（指挥确认用）

- 本会话命令环境未遇 EPERM/spawn/管道失败；npx tsc 与 npx vitest 均一次成功。
- 测试用 mkdtemp + afterEach `fs.rmSync(dir)` 清理 os.tmpdir() 临时目录（与既有
  AgentLoop.test.ts 同款模式，非工作区文件，不涉删除铁律）。
- 未删除/移动任何既有文件；无 force push。

### 备注（供 052/053 UI 参考，本卡不实现）

- 052 增量 UI 可订阅 `model_stream_delta`（text_delta 增量渲染；tool_call_* 自行累积
  或直接等 `model_stream_end.toolCalls` 终态）；`model_stream_end` 载荷与 after_model
  response 同构，可作为终态快照。实时 token 记账若需逐帧 usage，建议 v0.2 在 delta
  载荷扩展 usageDelta 字段（EVENT-SPEC A09 已预留 usageDelta 语义）。
- 050 interrupt 打断在飞流时：以 `model_stream_end {…}` 关闭该 attempt（interrupted
  语义字段留 050 按其规范扩展，本卡未预埋非规范字段）。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
