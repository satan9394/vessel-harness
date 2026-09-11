/**
 * provider 错误体「可诊断但不泄密」的中立下沉点（零 import 叶子模块）。
 *
 * 为什么 `sanitizeWireSnippet` 定义在本文件而不是 `OpencodeGoProvider.ts`（Round 7b）：
 * `OpencodeGoProvider` 的 detail（原 `:214`）也要用遮蔽口径；若它 import `sanitizeErrorBody`，
 * 而本模块又反向 import 它的 `sanitizeWireSnippet`，就形成 OpencodeGo ↔ errorBody 双向 import，
 * 违反仓库硬约束「依赖零环」。因此把 `sanitizeWireSnippet` 下沉到本模块，`OpencodeGoProvider`
 * 改为 import + re-export（导出名与行为不变，既有导入方不破），依赖保持单向：
 * `OpencodeGoProvider → errorBody`。该函数体自 `OpencodeGoProvider.ts` **原样搬移**，未作修改：
 * 剥 URL（`https?://\S+` → `<url>`）、压缩空白、超 `max` 截断加 `…`。
 */

/** 剥掉 URL、压缩空白并截断——错误信息里绝不带凭据/长内部串。 */
export function sanitizeWireSnippet(text: string, max = 240): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/**
 * provider 错误体 → 可安全外显的一句话：剥 URL、遮蔽密钥样式、压缩空白、定长截断。
 *
 * 为什么需要：上游 401/500 的响应体常带回请求片段、内部 URL 甚至密钥片段；
 * 直接回显会进终端回滚区、日志与用户粘贴的 bug 报告（G-05b / 可靠性报告 R4）。
 *
 * 顺序：**先遮蔽、后截断**（mask → sanitizeWireSnippet）。反过来会先按 `max` 定长切断文本，
 * 恰好跨过边界的密钥只剩 ≤5 字符尾巴，够不到 `{6,}` 之类的长度门槛，遮蔽正则直接漏过，
 * 密钥碎片仍会被外显。因此遮蔽必须看到完整原文，再由 sanitizeWireSnippet 负责
 * 剥 URL、压缩空白与最终截断。密钥前缀覆盖：`sk-` 与 `sk_` 两种分隔符（含连字符变体
 * sk-ant-/sk-proj-，以及下划线变体 sk_live_/sk_test_ 等 Stripe 风格）、`gsk_`（Groq）、
 * `hf_`（HuggingFace）、`AIza`（Google），另加 `Bearer …` 与 JSON 的
 * `api_key|api-key|authorization|token` 字段。
 *
 * 左边界刻意**不用 `\b`**（也不用等价的 `(?<![A-Za-z0-9])`）：`\b` 要求前缀的前一字符是非
 * 单词字符，密钥紧贴单词字符时（`xxxxsk-abc123`、`api_key_sk-…`）压根匹配不上，直接漏遮蔽；
 * 且 `xxxxsk-abc123` 与英文词 `disk-format` 结构同形（都是 `[A-Za-z]+sk-[A-Za-z0-9]+`），
 * 任何左边界都必然漏掉前者。按"宁可多遮蔽，不可漏遮蔽"取无左边界形态
 * （代价：`disk-format` 一类含 `sk-` 的英文词会被一并遮蔽，属可接受的观感损失）。
 */
export function sanitizeErrorBody(text: string, max = 240): string {
  const masked = text
    .replace(/(?:sk[-_]|gsk_|hf_)[A-Za-z0-9_-]{6,}/g, 'sk-<redacted>')
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, 'AIza<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{6,}=*/gi, 'Bearer <redacted>')
    .replace(/"(api[_-]?key|authorization|token)"\s*:\s*"[^"]*"/gi, '"$1":"<redacted>"');
  return sanitizeWireSnippet(masked, max);
}
