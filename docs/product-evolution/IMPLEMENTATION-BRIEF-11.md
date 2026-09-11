# IMPLEMENTATION-BRIEF-11 — 错误体脱敏收口（Round 7b，P3 集群）

> 来源：`EVALUATION-REPORT-08.md`（Round 7 评审判 ACCEPT 后列出的 4 项 P3）+ Round 6 遗留 P3。
> 主题单一：**"密钥/内部串不外显"这条线的剩余缺口**。低成本、互相耦合，合为一轮。

## 目标

把 Round 7 已建立的 `sanitizeErrorBody` 口径**补齐到所有回显点**，并修掉"截断先于遮蔽"造成的残留片段风险。

## 当前问题（证据，均来自 Round 7 评审）

1. **截断先于遮蔽**：`errorBody.ts` 先 `sanitizeWireSnippet(text, max)`（含截断）再跑遮蔽正则 → 恰好跨过 240 边界的 key 会被截成 ≤5 字符片段，**躲过 `{6,}` 门槛**从而不被遮蔽。
2. **`OpencodeGoProvider.ts:214`** 的 detail 只走 `sanitizeWireSnippet`（剥 URL/压空白/截断），**不做密钥遮蔽** → opencode-go 的 401 体里 `sk-live-…` 仍会原样外显。
3. **HTTP 200 带 error 体**：`OpenAICompatibleProvider.ts:125` 与 `AnthropicProvider.ts:232` 仍原样回显 `body.error.message`。
4. **非 `sk-` 形态**：`gsk_`（Groq）/`AIza`（Google）/`hf_`（HuggingFace）等前缀在自由文本里不被遮蔽。
5. **Round 6 遗留**：`dpapiArgv.test.ts` 未断言脚本含 `$input`（mocked 用例只证明"argv 干净 + input 已传"，不证明脚本真的消费 stdin）。

## 理想行为

1. `sanitizeErrorBody(text, max = 240)`：**先遮蔽、后截断**（保证任何长度的密钥都被整体替换为占位符再受截断约束）；`max` 语义不变。
2. 遮蔽规则至少覆盖：`sk-`（OpenAI 系，含 `sk-ant-`/`sk-proj-`）、`gsk_`、`AIza`、`hf_`、`Bearer <token>`、JSON 里的 `api_key|authorization|token`。
3. `OpencodeGoProvider.ts:214` 的 detail 改用 `sanitizeErrorBody`（或等价遮蔽）。
4. 两处 **HTTP 200 + error 体** 改用 `sanitizeErrorBody(body.error.message)`（保留 `provider error: ` 前缀）。
5. `dpapiArgv.test.ts` 的 mocked 用例补一条**跨平台**断言：传给 `execFileSync` 的脚本字符串含 `$input`（证明"脚本确实读 stdin"，不再只依赖非 Windows 才跑的真实往返）。

## 涉及模块

`packages/llm/src/provider/errorBody.ts`、`errorBody.test.ts`、`OpenAICompatibleProvider.ts`、`AnthropicProvider.ts`、`OpencodeGoProvider.ts`、`packages/application/src/credential/dpapiArgv.test.ts`（仅补断言）。

## 不能破坏什么

- Round 7 已通过的 7 例 `errorBody.test.ts` 语义（若断言顺序导致冲突，按"先遮蔽后截断"的新语义调整**断言**，并在回复说明）。
- `sanitizeWireSnippet`（`OpencodeGoProvider.ts:176`）本身与其既有用法/测试不动（只新增遮蔽层）。
- 四处 throw 的**前缀与状态码可读性**不变。
- `tsc -b` 0；全量 `vitest`（现 **125 文件 / 1313 passed + 1 skipped**）全绿。
- 无新依赖。

## 验收标准

1. **边界残留（判别性）**：构造一个**恰好跨 240 边界**的 key（例如 `'a'.repeat(238) + 'sk-abcdef123456'`）→ 输出中**不得**出现 `sk-abcdef`（或其任何长度 ≥6 的片段），且不得出现原始长串。
2. 四类新前缀各自被遮蔽：`gsk_`/`AIza`/`hf_`/`sk-ant-` 单测各一条。
3. `OpencodeGoProvider` 的 detail 路径：含 `sk-` 样式的错误体经其错误构造后**不含**原始 key。
4. 两处 HTTP 200 + error 体：构造 `body.error.message` 含假 key 的响应 → 抛出的 message 不含原始 key、含 `<redacted>`（用现有测试的 fetch mock 手法）。
5. `dpapiArgv.test.ts` 新增断言：`execFileSync` 收到的脚本字符串含 `$input`。
6. `tsc -b` 0；全量 vitest 绿。

## 错误场景

- 非字符串/空串输入：与 `sanitizeWireSnippet` 现有行为一致（返回 `''`），不新增抛错路径。
- 遮蔽后长度反而变长（占位符比原文长）：允许；`max` 只约束最终输出。

## 测试要求

- 小块串行派发；执行器不跑命令，由指挥复跑 `tsc` + 全量 vitest + 一个**判别性探针**（跨 240 边界的 key 必须被完整遮蔽）。
- 完成后交独立静态 Evaluator 复核（重点：验收 1 的边界用例是否真能抓住"截断先于遮蔽"这一旧缺陷）。
