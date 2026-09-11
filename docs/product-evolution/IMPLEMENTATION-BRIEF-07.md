# IMPLEMENTATION-BRIEF-07 — 错误体回显脱敏（G-05b / 可靠性报告 R4，P1）

> Round 7 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-05 的第二项 / `docs/product-audit/RELIABILITY-REPORT.md` R4。
> 一句话：**provider 的错误响应体被原样回显最多 500 字符**（可能含密钥/内部 URL/长内部串），会进终端回滚区、日志与用户粘贴的 bug 报告。

## 目标

把 provider 错误体回显统一改为**脱敏 + 压缩 + 截断**（复用仓库既有 `sanitizeWireSnippet` 口径，并补密钥样式遮蔽），使错误信息"可诊断但不泄密"。

## 用户场景

用户配错 API key → provider 返回 401，响应体里可能带回请求片段/内部 URL/部分 key → 现状：`Error: OpenAI-compatible 401 Unauthorized: {"error":{... "key":"sk-live-…"}}`（最多 500 字符原文）被打印，用户复制粘贴到 issue 即泄密。期望：打印成 `<url>` 占位、`sk-…`/`Bearer …` 遮蔽、空白压缩、截断 240 字符。

## 当前问题（证据）

- `packages/llm/src/provider/OpenAICompatibleProvider.ts:119` 与 `:194`：`throw new Error(\`OpenAI-compatible ${resp.status} ${resp.statusText}: ${text.slice(0, 500)}\`)`（原文回显）。
- `packages/llm/src/provider/AnthropicProvider.ts:226` 与 `:317`：同款 `text.slice(0, 500)`。
- 对照（已成熟的既有口径）：`packages/llm/src/provider/OpencodeGoProvider.ts:176` 的 `sanitizeWireSnippet(text, max = 240)`：`https?://\S+` → `<url>`、`\s+` → 单空格、超长加 `…`；`:214`/`:565` 已在用。
- 无既有测试锁住上述 4 处的**具体文案**（已 grep 确认），故可安全调整渲染。

## 理想行为

1. 新增一个小模块（建议 `packages/llm/src/provider/errorBody.ts`）导出：
```ts
/** provider 错误体 → 可安全外显的一句话：剥 URL、遮蔽密钥样式、压缩空白、定长截断。 */
export function sanitizeErrorBody(text: string, max = 240): string;
```
行为：先按 `sanitizeWireSnippet` 的口径剥 URL/压空白（**直接 import 复用它**，不要复制实现）；再遮蔽密钥样式，至少覆盖：
   - `sk-` / `sk_live_` / `sk-proj-` 等 OpenAI 风格：`/\bsk-[A-Za-z0-9_-]{6,}/g` → `sk-<redacted>`
   - `Bearer <token>`：`/Bearer\s+[A-Za-z0-9._~+/-]{6,}=*/gi` → `Bearer <redacted>`
   - 常见 JSON 字段：`/"(api[_-]?key|authorization|token)"\s*:\s*"[^"]*"/gi` → `"$1":"<redacted>"`
   - Anthropic 风格 `sk-ant-…` 由第一条覆盖。
2. 四处 throw 改为使用它，**保留前缀**（`OpenAI-compatible <status> <statusText>: …` / `Anthropic <status> <statusText>: …`），只替换 `${text.slice(0, 500)}` 为 `${sanitizeErrorBody(text)}`。
3. 空体：`sanitizeErrorBody('')` 返回 `''`，错误信息尾部不留奇怪空白（形如 `…: ` 可接受，但不得抛错）。

## 涉及模块

`packages/llm/src/provider/errorBody.ts`（新）、`OpenAICompatibleProvider.ts`（2 处）、`AnthropicProvider.ts`（2 处）、相应测试文件（新增小文件即可）。

## 不能破坏什么

- **错误类型与可诊断性**：仍抛 `Error`，前缀与 HTTP 状态/statusText 保留（既有对状态码的断言不受影响）。
- `OpencodeGoProvider` 的 `sanitizeWireSnippet` 与既有测试**不动**（只 import 复用）。
- `tsc -b` 0；全量 `vitest`（现 **120 文件 / 1271 passed + 1 skipped**）全绿。
- 无新依赖；不改重试/超时/解析逻辑。

## 验收标准

1. `sanitizeErrorBody` 单测（≥6 条）：
   - 含 URL → 出现 `<url>`，不出现原 URL；
   - 含 `sk-abcdef123456` → 不出现原串，出现 `sk-<redacted>`；
   - 含 `Bearer eyJhbGciOi…` → 出现 `Bearer <redacted>`；
   - 含 `"api_key":"xxx"` → 出现 `"api_key":"<redacted>"`；
   - 超长（>240）→ 长度受限且以 `…` 结尾；
   - 空串/纯空白 → 返回 `''`。
2. 两 provider 的 4 处 throw 均改用新函数（给行号）；构造一个含密钥样式与 URL 的假错误体走该路径时，抛出的 `message` 里**不含**原始 key/URL。
3. `tsc -b` 0；全量 vitest 绿。

## 错误场景

- 响应体不是 JSON / 读体失败（既有 `catch(() => '')`）→ 仍按空串处理，不新增抛错路径。
- 非字符串输入 → 与 `sanitizeWireSnippet` 现有行为一致（不做额外防御，避免过度设计）。

## 测试要求

- 写入型微任务（单文件/单点，执行器不跑命令）；指挥复跑 `tsc -b` + 全量 vitest + 一个**判别性 E2E**：用一个假的 provider 响应（含 `sk-` 样式串与 URL）触发错误路径，断言 stderr/message 已脱敏。
- 之后交独立静态 Evaluator 复核。
