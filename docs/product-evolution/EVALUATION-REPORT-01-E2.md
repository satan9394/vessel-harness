# EVALUATION-REPORT-01-E2（独立 Evaluator · 对抗性静态审查）

审查对象：G-01（MockProvider surface 匹配过滤）、`ChatMessage.source` 泄漏面、G-02（未知命令分支安全性）。
立场：假设实现有错，逐条反向挑错。**本报告为静态审查，未复跑任何命令/测试**（受委托限制，禁止执行命令）。

## 判定 1 — G-01 过滤正确性：**通过**

`surfaceUserMessage`（`packages/llm/src/provider/MockProvider.ts:54-58`）自尾向前找 `role==='user' && !INJECTED_MESSAGE_SOURCES.has(m.source ?? '')`，
无 source（真实输入）经 `?? ''` 归一，不会误判为注入；`context()` 用其 content 作 haystack（同文件 89-100），`matches()` 只对该 haystack 跑 `when`（102-107）。

生产者↔白名单逐一对齐（`packages/shared/src/provider.ts:46-51` 白名单 = environment / instruction / memory / compacted-summary）：

| 注入点 | source | 是否入白名单 |
| --- | --- | --- |
| `packages/context/src/builder/Builder.ts:132`（AGENTS.md 指令，持久化 user/message） | `instruction` | 是 |
| `packages/context/src/builder/Builder.ts:144`（项目记忆快照，持久化） | `memory` | 是 |
| `packages/context/src/builder/Builder.ts:165`（volatile 层 `[环境] …`，请求内追加为**最后一条** user） | `environment` | 是 |
| `packages/context/src/compaction/Compaction.ts:91`（压缩摘要，替换区间写入） | `compacted-summary` | 是 |
| `packages/core/src/agent-loop/AgentLoop.ts:689`（step 边界 steer，**非注入**） | `steer` | 否（有意，见下） |

- 透传链完整：`recordToMessage`（`Builder.ts:41-50`）仅在 `user/message` 且 `r.source !== undefined` 时带上 source；真实输入记录（`AgentLoop.ts:186-192`、`219-225`）不带 source → 保持可匹配。`default:` 分支（`Builder.ts:73`）返回空 content 的 user，在 156-158 行先按记录类型过滤、再按 `content !== ''` 过滤，不可达，不构成遮蔽。
- 拼写一致性：全仓 `source: '...'` 取值仅上述 6 处（grep 全库），无 `compact-summary`/`compaction` 之类变体，无白名单漂移。
- 对抗点「真实输入带 source 但不在白名单」：唯一路径是 `steer`，且 `MockProvider.ts:52` 明确声明 steer 属真实驱动输入、应保持可匹配；`AgentLoop.drainSteers` 记录 content 为操作者原话。**残余风险（低）**：若同一轮先落 steer 再 buildContext，haystack 变为 steer 文本而非原始任务，测试脚本需对 steer 文本另设 entry；这是设计取舍而非缺陷，建议在 steer 用例中显式覆盖。

## 判定 2 — `source` 泄漏：**通过**

三个 wire 映射均为显式字段挑选，无一使用对象展开（`...m` / `...message`）或 `JSON.stringify(request)`；`.source` 字样在 `packages/llm/src/provider/` 下只出现于 MockProvider 与其测试。

- `OpenAICompatibleProvider.ts:26-44`：`tool` 分支与 `base` 分支均逐字段构造（`role/content/name/tool_call_id/reasoning_content/tool_calls`），无 spread；调用点 104、183 均经 `toOpenAIMessages`。
- `OpencodeGoProvider.ts:320-338`：同形显式构造，调用点 482 经 `toOpencodeGoWireMessages`。
- `AnthropicProvider.ts:102-157`：user 分支 `{ role:'user', content: m.content }`（145）/ tool_result + text 合并（148-150），均不携带 source；调用点 205、293。
- 唯一字符串化是 `toolCalls.arguments` 内部 JSON（三处一致），与 source 无关。

结论：`source` 不会进入任何真实 provider 的 HTTP body。

## 判定 3 — G-02 分支安全性：**通过**

- 位置：未知命令分支在 `apps/cli/src/cli.ts:1496-1499`，位于全部已知子命令分派（1479-1492）**之后**，无条件 `first !== undefined` 才拦截并 `return 2`。
- 无参保护：`vessel`（无 positionals）→ `first === undefined` → 跳过该分支，落到 1501 行 TUI/run 路径；`vessel run --prompt "…"` 中 `run` 由 `parseArgs` 在 `cli.ts:124` 作为 command 消费、**不进 positionals**，故 `first` 仍为 `undefined`，不被误拦。
- 已知命令逐一对齐（全部在 1496 之前命中）：run（124/1501/1524，非 positional 路径）、guide 1488、settings 1489、provider 1479、pricing 1483、usage 1482、models 1480、explain|term 1486、list-terms 1487、bench-report 1490、serve 1491、web 1492；另有 setup 1481、migrate 1484、review 1485（USAGE 39-85 中所有已记录命令均被覆盖，无文档命令落入未知分支）。
- 残余风险（低，非本次判据）：`--flag value` 取值逻辑（`cli.ts:125-135`）在**未加引号**的多词 prompt 下会让多余词成为 positional，例如 `vessel run --prompt the bug` → `未知命令 the`（exit 2）。属非法/易误用调用形态，非已知命令误拦；建议 USAGE 中强调 prompt 必须加引号，或对 `--prompt` 后剩余 positional 做吸收。

## 结论：**ACCEPT**

三项判定全部通过，未发现 `source` 泄漏、白名单漂移或已知命令被吞。无需最小修复；仅建议两条可选加固（steer haystack 的测试覆盖、未加引号 prompt 的用法提示），均不阻塞验收。

（范围与限制：仅静态阅读上述 7 个文件及必要的注释/测试引用点，未运行任何命令、未复跑测试与 benchmark。）
