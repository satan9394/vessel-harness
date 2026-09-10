# 109 — 线协议修复（deepseek-flash 跑通前提）+ judgeUnit 误报

- 编号：109
- 状态：已合入
- 优先级：P0（线协议是 deepseek 系真实模型跑通前提；judgeUnit 误报影响门禁可信度）
- 创建日期：2026-09-10
- 关联：108（087977c：deepseek-flash 恒 0/10 = 100% 可复现线协议不兼容，转卡）；
      102/103（opencode-go 协议 + OpencodeGoProvider SSOT）；046（stream 契约）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（108 实测确诊）

1. **线协议不兼容（P0）**：deepseek-flash 走 `/chat/completions`，strict 上游要求：
   - 第 2 轮起 `role:'tool'` 消息**必须紧跟一条前置 `role:'assistant'` 且含 `tool_calls`** 的消息——
     当前 harness 的消息序列在第 2 次请求缺 assistant tool_calls（surface 投影未补），上游 400
     `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`；
   - 修正序列后，thinking 模式还需**回传 `reasoning_content`**（否则 400）。
   → 修后 deepseek-flash 才可能跑通 lane。
2. **judgeUnit 正则误报（P1）**：release-report 的 Unit gate 用正则判 vitest 输出，对"实际全绿"的运行误报 fail
   （108 的 release-report Unit=fail 但 vitest 实为 1155+1 exit 0）→ 门禁可信度受损。

## 验收标准（执行器逐条勾选）

### 线协议修复（P0，主）
- [x] 定位消息组装点：surface 投影 / 请求构造（`packages/llm` 或 core 到 provider 的 messages 序列）——确认
      `role:'tool'` 前是否总有含 `tool_calls` 的 assistant 消息；无则按非流式/流式两条路径补
- [x] 补 assistant `tool_calls` 投影（把上一轮的 tool_calls 一起发给上游——OpenAI 兼容约定；保留 tool_call_id 对应）
- [x] thinking/推理模型：解析并**回传 `reasoning_content`**（deepseek 系；opencode-go 的 reasoning 字段，102/103 已见
      content=null + reasoning 有值）——请求时带 reasoning/thinking 回传参数（按上游要求），响应解析归一
- [x] 不破坏 mimo-v2.5 / 其它 openai-compatible 路径（全量回归）
- [x] 测试 ≥6 例：工具多轮序列含 assistant tool_calls / tool 响应紧跟 / reasoning_content 回传 /
      非推理模型不受影响 / 流式路径 / mock 上游 400 复现修复

### judgeUnit 误报（P1，次）
- [x] 修 judgeUnit 判据（对通过运行的 vitest 输出不再误报）：用 exit code 或稳定摘要行判断，而非脆弱正则
- [x] 测试：构造"全绿输出"样本断言 pass；构造真失败样本断言 fail

### 共同
- [x] `npx tsc -b tsconfig.json` exit 0；全量 vitest（1155+ 无回归）+ web 82
- [x] **真实验证（尽力而为）**：key 从 CredentialStore（--key-source=store，勿收 key）；deepseek-flash 跑 082 lane
      最小子集（如 B001/S001）——若线协议修复到位应 ≥1 场景通过；仍失败则如实记录新报错（不伪造，优先级 P0 但
      "真实跑通"若依赖上游更多语义则转卡）
- [x] 文档同步（REAL-MODEL-LANE / EVENT-SPEC 若涉消息契约）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只修线协议（工具消息序列 + reasoning 回传）与 judgeUnit 判据。不改 pricing/统计/展示；不换 lane 默认模型
  （换模型另卡，需 deepseek 跑通后再说）；不加依赖。
- 密钥不落盘；真实调用配额最小化（probe + 最小子集 ×1）。

## 涉及文件（指针，执行器自行精化）

- `packages/llm/`（OpencodeGoProvider SSOT 103、OpenAICompatibleProvider、消息/usage 解析）
- `packages/core/`（AgentLoop after_model / 消息序列组装，若涉 core 需薄改+说明）
- `benchmarks/runners/src/release-gates/`（judgeUnit）
- 报告参考：`benchmarks/reports/real-model-lane-1789037140071-deepseek-flash.md`（108 失败证据）

## 方法

- 读 108 失败报告与消息组装路径 → 补 assistant tool_calls 投影 + reasoning 回传 → mock 上游 400 复现→修复 →
  judgeUnit 修 → 全量回归 → 真实最小子集验证

## 工作证明（执行器回填：改动 diff/消息序列修复点/reasoning 回传/真实子集结果/judgeUnit 修法/测试输出，全部写进本文件，勿留对话里）

### 1. 改动总览（修复点定位）

两个线协议缺口都修在**消息组装/序列化层**（未动 lane 默认模型 / pricing / 依赖）：

- **① assistant tool_calls 投影（P0 主）**：`packages/context/src/builder/Builder.ts` 的 wire 历史派生
  从 `session.surface()`（EVENT-SPEC §6 仅 `user/message`、`assistant/message`、`tool/result` 三型）改为
  **replay 四型过滤**（新增 `assistant/attempt`）。`assistant/attempt` 恰恰承载上一轮模型的 tool_calls
  （toolCallId/name/arguments，AgentLoop B03 已持久化），`recordToMessage` 本来就有 `assistant/attempt →
  assistant + toolCalls` 的映射，只是 surface 把它裁掉。补回后 wire 里每条 `role:'tool'` 消息必然紧跟
  一条含对应 `tool_calls` 的 `role:'assistant'` 消息（OpenAI 兼容约定），strict 上游 400
  `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'` 消除。
  `Session.surface()` 本身语义（三型投影）**未改**——只扩了 ContextBuilder 的模型可见面，见
  docs/EVENT-SPEC.md §6 task 109 增补。
- **② reasoning_content 回传（P0 副）**：thinking 模式思维链全链路打通——
  - 响应解析：`reasoning_content`（DeepSeek 系）/ `reasoning`（opencode-go）归一进
    `ChatResponse.reasoningContent`（OpencodeGoProvider.parseOpencodeGoChatCompletion、
    OpenAICompatibleProvider.chat；流式新增 `reasoning_delta` chunk，parseOpenAI 映射
    `delta.reasoning_content`，AgentLoop.consumeStream 累计）；
  - 持久化：AgentLoop 在 `assistant/message` 与 `assistant/attempt` 记录写入 `reasoningContent`
    （`packages/shared/src/events.ts` 两记录类型加可选字段）；
  - 请求回传：ContextBuilder.recordToMessage 把记录的 `reasoningContent` 带上 assistant 消息，
    两 provider 的 wire 序列化（`toOpencodeGoWireMessages` / `toOpenAIMessages`）在 assistant 消息上
    输出 `reasoning_content`（DeepSeek thinking 校验要求）；非推理模型无字段 → 不产生该键（不受影响）。
- **judgeUnit（P1）**：`benchmarks/runners/src/release-gates/gates.ts` 的判据从脆弱正则
  `/FAIL|failed .*tests/i`（对全绿运行误报）改为 **exit code + vitest 稳定汇总行**判定：
  `vitestSummaryHasFailed` 只认以 `Test Files`/`Tests` 起首的合计行（如 `Test Files  1 failed | …`）
  含 failed 计数；通过运行里的任意 "FAIL"/"failed" 字样（用例名、console 输出）不再误判。

改动文件（不含测试）：
```
packages/shared/src/provider.ts        ChatMessage.reasoningContent / ChatResponse.reasoningContent / StreamChunk.reasoning_delta
packages/shared/src/events.ts          AssistantMessageRecord / AssistantAttemptRecord 加 reasoningContent?
packages/context/src/builder/Builder.ts  wire 历史四型过滤（assistant/attempt 投影）+ recordToMessage 携带 reasoningContent
packages/core/src/agent-loop/AgentLoop.ts assistant 记录写 reasoningContent；consumeStream 累计 reasoning_delta → reasoningContent
packages/llm/src/provider/OpencodeGoProvider.ts    wire 序列化 reasoning_content；解析 reasoning_content+reasoning 归一；chat() 返回 reasoningContent
packages/llm/src/provider/OpenAICompatibleProvider.ts 同上（chat + stream 共用 toOpenAIMessages 序列化）
packages/llm/src/provider/MockProvider.ts         response.reasoningContent 注入 + stream 产 reasoning_delta
packages/llm/src/stream/parseOpenAI.ts            delta.reasoning_content → reasoning_delta
benchmarks/runners/src/release-gates/gates.ts     judgeUnit：exit code + 稳定汇总行（vitestSummaryHasFailed）
```

### 2. 新增测试（11 例，全部离线/mock）

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| packages/context/src/context.test.ts | assistant/attempt 投影进 wire 历史，tool 紧跟 assistant | 工具多轮序列含 assistant tool_calls |
| packages/context/src/context.test.ts | 每条 tool 消息前都有带 tool_calls 的 assistant 且 tool_call_id 对应 | 严格上游形状（108 400 反转） |
| packages/context/src/context.test.ts | reasoningContent 携带 + 非推理模型不受影响 | reasoning_content 回传链路 |
| packages/llm/src/provider/opencodeGoProvider.test.ts | wire 序列化 assistant tool_calls + reasoning_content，tool 消息 tool_call_id 对应 | 线协议序列化 |
| packages/llm/src/provider/opencodeGoProvider.test.ts | 非推理模型 → wire 无 reasoning_content 键 | 非推理不受影响 |
| packages/llm/src/provider/opencodeGoProvider.test.ts | 解析 `reasoning_content`（DeepSeek）与 `reasoning`（opencode-go）归一 | 响应解析归一 |
| packages/llm/src/provider/opencodeGoProvider.test.ts | mock 严格上游 400 复现→修复：修复形状 200；旧形状/缺 reasoning_content → 400 | 108 实验①/② 复现 |
| packages/llm/src/provider/streamProvider.test.ts | stream() 请求体带 assistant tool_calls + reasoning_content | 流式路径 |
| packages/llm/src/stream/parseOpenAI.test.ts | delta.reasoning_content → reasoning_delta（含空增量/并行） | 流式 reasoning 解析 |
| packages/core/src/agent-loop/AgentLoop.test.ts | thinking 模式：model 返回 reasoningContent → 落 assistant/attempt 与 assistant/message 记录 | 回传链路（AgentLoop 持久化） |
| benchmarks/runners/src/release-gates/release-gates.test.ts | 全绿样本（108 实测回归）→ pass；真失败样本 → fail | judgeUnit 判据 |

### 3. judgeUnit 修法细节

旧判据：`outcome.stderr.match(/FAIL|failed .*tests/i) ?? outcome.stdout.match(...)` —— 通过的运行里
只要测试输出含 "FAIL"/"failed …tests" 字样就误报 fail（108 实测：vitest 全绿 1155+1 exit 0，Unit gate
却显示 fail）。新判据：

```ts
export function judgeUnit(outcome: CommandOutcome, expectedTestFilesMin = 0): GateVerdict {
  const summaryFailed = vitestSummaryHasFailed(outcome); // 只认 "Test Files"/"Tests" 起首的合计行含 failed
  const pass = outcome.code === 0 && !summaryFailed && parsedTestCount(outcome) >= expectedTestFilesMin;
  ...
}
```

判定语义：exit≠0 → fail；exit=0 但 vitest 汇总行报 failed 计数 → fail（防御）；其余（含 108 全绿
样本）→ pass。stderr 与 stdout 都纳入汇总行判定。

### 4. 回归与类型

- `npx tsc -b tsconfig.json --force` → **exit 0**
- 全量 vitest（root）：**108 文件 / 1166 passed + 1 skipped（1167），exit 0**（基线 1155+1 → +11 新测试，无回归）
- 全量 vitest（apps/web）：**9 文件 / 82 passed，exit 0**（基线 82，无回归）

### 5. 真实验证（deepseek-flash 最小子集 B001/S001，2026-09-10T11:46Z，key-source=store）

命令：`npx tsx benchmarks/runners/src/lane/run-opencode-lane.ts --key-source=store --model=deepseek-flash --scenarios=B001,S001`
（单次调用 = probe ×1 + 场景子集 ×1，配额最小化；key 指纹 `sk-8Dl…Cp4n1`，来源 CredentialStore，未落盘）。

**结果：probe 200 + B001/S001 双双 passed（2/2，0 failed）**：

| 项 | 结果 | 修复前（108）对比 |
| --- | --- | --- |
| probe | `ok content=34B reasoning=143B usage={31,47,0}` | 108 时 reasoning=0B（provider 只解析 `message.reasoning`，未解析 `reasoning_content`）→ 现在 thinking 思维链可见 |
| B001 | **passed**（3640 ms，toolCalls=1，$0.00217） | 108 恒 failed（第 2 次请求 400） |
| S001 | **passed**（49063 ms，toolCalls=21，$0.02333） | 108 恒 failed |

报告：`benchmarks/reports/real-model-lane-1789040766242.md` + `.json`；`V1.1-F-openmodel-lane.json` 已刷新。

**结论**：线协议修复到位——S001 完整跑完 **21 轮工具链**（29k 输入 token，无一次上游 400），第 2 轮起的
`tool` 消息序列（前导 assistant tool_calls + reasoning_content 回传）被 strict 上游接受。108 确诊的两个
缺口在真实模型上同时验证通过。**未发现新报错**，无需转卡；deepseek-flash 具备 lane 候选资格（换默认模型
仍属指挥决策，本卡不动）。

### 6. 文档同步

- `docs/EVENT-SPEC.md` §6：增补 task 109 说明——wire 历史在 surface 三类之外追加投影
  `assistant/attempt`；请求侧 `reasoningContent` → `reasoning_content` 回传；响应侧两字段归一。
- `docs/REAL-MODEL-LANE.md`：新增「线协议修复落地（task 109）」小节（两个缺口 + 两 provider 路径 + 实跑指针）。

### 7. 踩坑 / 环境备注

1. `tsc -b` 曾报 MockScriptEntry 旧类型错误——`packages/llm` 的增量构建信息陈旧，`--force` 全量构建后
   exit 0；后续按 `--force` 跑。
2. AgentLoop 是 **stream-first**（task 049）：MockProvider 实现 stream()，AgentLoop 走流式分支——
   reasoning 单走 chat() 不够，必须打通流式（新增 `reasoning_delta` chunk + consumeStream 累计），
   否则真实 CLI 走 OpenAICompatibleProvider.stream() 时推理链仍会丢。这也是卡内「流式路径」验收的落点。

## 验收结论（指挥回填）

- [x] 合入（commit 9ec20df）
- 备注：指挥独立复核——`tsc -b` exit 0；全量 vitest 两次：首次 1165 passed + 1 failed（偶发 flaky）+ 1 skipped、
  重跑 **exit 0 全绿**（无 FAIL；与执行器自报 1166 一致，首次差值即该 flaky）；web 82。
  **关键成果（真实模型）**：线协议修复到位——deepseek-flash B001（1 调用）与 S001（**21 轮工具链**）真实
  **双双 passed**（108 时恒 0/10 全红 400）；probe 显示 thinking 链 reasoning=143B。
  认可：① ContextBuilder wire 历史三型→四型（补 assistant tool_calls 投影，tool 消息前必有含 tool_calls 的
  assistant，严格上游 400 消除）；② reasoning_content（deepseek）/reasoning（opencode-go）归一进
  `ChatResponse.reasoningContent`，持久化后回传，chat + 流式（新增 reasoning_delta chunk）双路径；③ judgeUnit
  改 exit code + 稳定汇总行（108 误报样本回归 pass）；+11 测试；EVENT-SPEC/REAL-MODEL-LANE 同步。
  **109 关闭。**