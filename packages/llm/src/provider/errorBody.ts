import { sanitizeWireSnippet } from './OpencodeGoProvider.js';

/**
 * provider 错误体 → 可安全外显的一句话：剥 URL、遮蔽密钥样式、压缩空白、定长截断。
 *
 * 为什么需要：上游 401/500 的响应体常带回请求片段、内部 URL 甚至密钥片段；
 * 直接回显会进终端回滚区、日志与用户粘贴的 bug 报告（G-05b / 可靠性报告 R4）。
 */
export function sanitizeErrorBody(text: string, max = 240): string {
  const stripped = sanitizeWireSnippet(text, max);
  return stripped
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, 'sk-<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{6,}=*/gi, 'Bearer <redacted>')
    .replace(/"(api[_-]?key|authorization|token)"\s*:\s*"[^"]*"/gi, '"$1":"<redacted>"');
}
