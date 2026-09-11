# EVALUATION-REPORT-08 — Round 7 独立静态评审（G-05b 错误体脱敏 + P2 补测）

- 范围：`IMPLEMENTATION-BRIEF-07.md` 验收标准 1–3；`UsageStore.recovery.test.ts` 新增 2 例（Round 5b 必修 P2）。
- 立场：对抗（先假设有错）。**静态审查，未复跑命令**（本文所有结论来自读文件，指挥侧的 tsc/vitest/E2E 证据未复核、未采信）。
- 结论：**ACCEPT**（0 个必须修复项；3 条 P3 残留 + 1 条范围外遗漏通道，均不阻塞验收）。

## 1. 四处回显是否全部改造 —— 通过
- `OpenAICompatibleProvider.ts:11` import；`:120`（chat）、`:195`（stream）均为 `OpenAI-compatible ${resp.status} ${resp.statusText}: ${sanitizeErrorBody(text)}`。
- `AnthropicProvider.ts:11` import；`:227`（chat）、`:318`（stream）同上，前缀保留。
- 全仓 grep `slice(0, 500)`：`packages/llm` 内**已无**任何 provider 命中（剩余命中在 `packages/tools`/`context`，非 provider 错误体，属范围外）。
- 残留裸回显（未改造，见第 6 节/P3）：`OpencodeGoProvider.ts:520→521→214` 只走 `sanitizeWireSnippet`（剥 URL/压空白/截断，**不遮密钥**）；`OpenAICompatibleProvider.ts:125`、`AnthropicProvider.ts:232` 在 HTTP 200 带 error 体时原样回显 `body.error.message`。

## 2. 脱敏函数正确性 —— 通过（有 1 处理论缺口，P3）
- 三类正则齐备（`errorBody.ts:12-14`）：`sk-`（含 `sk-ant-`/`sk_live_`/`sk-proj-`，因 `_`/`-` 在字符类内）、`Bearer …`、JSON 字段 `api[_-]?key|authorization|token`（`i` 标志，`$1` 保留原大小写）。
- 顺序：先 `sanitizeWireSnippet`（`OpencodeGoProvider.ts:176-182`：URL→`<url>`、`\s+`→单空格、`>max` 截断加 `…`），后遮蔽。**URL 内嵌 key 不构成漏洞**：整段 URL 先被 `<url>` 吞掉，key 随之消失（比"遮 key 留下 URL 骨架"更安全）。
- **理论缺口（P3）**：截断发生在遮蔽**之前**。key 恰好被切在第 240 字符处时，尾部残留 `sk-` 后不足 6 字符的片段不匹配 `{6,}`，可存活 **≤5 个字符**（Bearer 同理）。不足以还原或误用凭据，判 P3；最小修复=调换顺序：先 mask 再 `sanitizeWireSnippet(masked, max)`（截断落在 `sk-<redacted>` 内无害）。
- 另一残留（P3）：非 `sk-` 形态密钥（`gsk_…`/`AIza…`/`hf_…` 等 OpenAI-compatible 上游）出现在自由文本 `message` 里不会被遮。brief 只要求"至少"三类，实现达线；建议后续加通用前缀类。
- `max` 参数透传正确；`max` 过小（如 1）时输出 `x…`，无异常。

## 3. 可诊断性未丢 —— 通过
- 前缀与 `resp.status`/`statusText` 原样保留（4 处行号见第 1 节），状态码断言不受影响。
- 空体：`sanitizeErrorBody('')===''`（`errorBody.test.ts:40`），message 尾部为 `…: `，brief 明确可接受；非 JSON 体无 `JSON.parse`，不新增抛错路径；`await resp.text().catch(() => '')` 4 处均保留。

## 4. 测试真实性（`errorBody.test.ts`，7 例）—— 通过
- 7 例均双向断言（出现占位 + **原串消失**）：`<url>`/`api.internal.example.com`/`trace=abc`(:8-10)、`sk-<redacted>`+原 key 不出现(:15-16)、`Bearer <redacted>`+JWT 不出现(:21-22)、JSON 三字段 secret 均不出现(:27-29)、截断 `≤241` 且 `endsWith('…')`(:35-36)、空串与纯空白(:40-41)、自定义 max=10(:45-47)。
- **无永真断言**：第 4 例虽只断言泛化 `<redacted>`（brief 字面要求 `"api_key":"<redacted>"`），但已用三条 `not.toContain(secret)` 兜底，不会假绿；属措辞偏差，非正确性缺口。
- 缺口（P3）：无一条覆盖"截断把 key 切成半截"这第 2 节的边界，故该理论缺口无测试锁定。

## 5. P2 补测真实性 —— 通过
- `EACCES → suppressWrite`（`UsageStore.recovery.test.ts:182-207`）**可失败**：`save()` 的 `if (this.suppressWrite) return`（`UsageStore.ts:627`）删掉后，`record()` 会走到 `writeFileSync(tmp)+renameWithRetry`（:630-636，rename 未被 mock），`usage.json` 必然出现 → `:200` 的 `existsSync===false` 变红。
- 测试不会假绿：`:195` 要求 warn 文本含 `EACCES`（对应 `UsageStore.ts:462`），若 deny 钩子未命中会退化成 ENOENT 路径 → 无 warn → `:192` 变红。测试缺陷不会被当成实现缺陷。
- `fsHooks` 委托式 mock（:34-44）先 `importActual('node:fs')` 再只覆写 `readFileSync`，谓词仅命中 `path.resolve(file)===path.resolve(usageFile)`（:186），其它路径/其它 API（含 afterEach 的 `rmSync`、断言用的 `existsSync`）走真实实现 —— 委托正确。
- 同毫秒二次隔离（:209-231）**可失败**：`UsageStore.ts:560-562` 的唯一化（`while (existsSync) …-${++n}`）去掉后，第二次 `renameSync` 要么在 Windows 抛错（走 :566-570 抑制分支、第一份保留）要么在 POSIX 覆盖，两种情况 `listCorrupted` 只有 1 份 → `:223` `toHaveLength(2)` 变红。`Date.now` 被固定(:212)，同毫秒条件确定。

## 6. 越界 / 回归 —— 通过（受限于未跑 grep-diff，见下）
- 静态证据：`sanitizeErrorBody` 仅被 `errorBody.test.ts` 与两个 provider（各 1 行 import）引用；`sanitizeWireSnippet` 本体（`OpencodeGoProvider.ts:176-182`）与既有 `opencodeGoProvider.test.ts` 未见任何针对其文案/断言的改动痕迹，属"只 import 复用"。
- 未见对 `resp.text()`/重试/超时/解析逻辑的其它改动（5 处 `resp.text()` 中原 4 处仅替换渲染，第 5 处在 OpencodeGo 未动）。
- 限制：受"不运行命令"约束，未做 `git diff --stat` 式文件集核对，仅凭内容与引用面推断改动面。

## 7. Round 6 残留 P3 复核 —— 属实
- `packages/application/src/credential/dpapiArgv.test.ts:56-72` 只断言 argv 无材料（:62-64）与 `options.input` 是字符串且含材料（:66-71）；**未断言脚本含 `$input`**。
- 实现确用 `'$o = $input | ConvertFrom-Json; '`（`CredentialStore.ts:342`/`:363`）。`$input` 按行枚举，未来 payload 含换行会静默失配；当前 `JSON.stringify` 单行 + 值为 base64，实际不可达。维持 **P3**（Windows 真实往返用例 :183-217 是兜底）。

## 8. 判定与最小修复方向
- 验收标准 1、2、3：**通过**；P2 补测：**通过**。总判定 **ACCEPT**。
- P3-1（建议）：`errorBody.ts:10-14` 改为先遮蔽后 `sanitizeWireSnippet`，并补一条"key 跨截断边界"用例。
- P3-2（建议）：`OpencodeGoProvider` 的 detail（:214）复用同一遮蔽口径（注意与 `errorBody.ts` 的循环依赖，需把遮蔽 helper 下沉到中立模块）；`OpenAICompatibleProvider:125`/`AnthropicProvider:232` 的 200-with-error 路径同样过一遍。
- P3-3：DPAPI 用例补 `expect(call[1].join(' ')).toContain('$input')`。
