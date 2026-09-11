import { describe, expect, it } from 'vitest';
import { sanitizeErrorBody } from './errorBody.js';

/** G-05b / 可靠性报告 R4：provider 错误体必须"可诊断但不泄密"。 */
describe('sanitizeErrorBody（错误体脱敏）', () => {
  it('剥掉 URL：出现 <url> 占位，不出现原始 URL', () => {
    const out = sanitizeErrorBody('fetch failed for https://api.internal.example.com/v1/chat?trace=abc');
    expect(out).toContain('<url>');
    expect(out).not.toContain('api.internal.example.com');
    expect(out).not.toContain('trace=abc');
  });

  it('遮蔽 OpenAI 风格 key', () => {
    const out = sanitizeErrorBody('{"error":"invalid api key sk-abcdef1234567890"}');
    expect(out).toContain('sk-<redacted>');
    expect(out).not.toContain('sk-abcdef1234567890');
  });

  it('遮蔽 Bearer token', () => {
    const out = sanitizeErrorBody('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(out).toContain('Bearer <redacted>');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('遮蔽 JSON 字段里的 api_key / authorization / token', () => {
    const out = sanitizeErrorBody('{"api_key":"secret-value-123","authorization":"Basic zzzz","token":"tok-1"}');
    expect(out).not.toContain('secret-value-123');
    expect(out).not.toContain('Basic zzzz');
    expect(out).not.toContain('tok-1');
    expect(out).toContain('<redacted>');
  });

  it('超长文本被截断且以 … 结尾（默认上限 240）', () => {
    const out = sanitizeErrorBody('x'.repeat(1000));
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.endsWith('…')).toBe(true);
  });

  it('空串与纯空白 → 空串', () => {
    expect(sanitizeErrorBody('')).toBe('');
    expect(sanitizeErrorBody('   \n\t ')).toBe('');
  });

  it('自定义 max 生效', () => {
    const out = sanitizeErrorBody('y'.repeat(100), 10);
    expect(out.length).toBeLessThanOrEqual(11);
    expect(out.startsWith('y'.repeat(10))).toBe(true);
  });

  it('遮蔽下划线分隔的密钥（sk_live_/sk_test_，Stripe 风格）', () => {
    const live = sanitizeErrorBody('{"error":"invalid api key sk_live_51H8xQ2eZvKYlo2C"}');
    expect(live).not.toContain('sk_live_51H8xQ2eZvKYlo2C');
    expect(live).toContain('<redacted>');

    const test = sanitizeErrorBody('bad credential sk_test_abcdef123456 rejected');
    expect(test).not.toContain('abcdef123456');
    expect(test).toContain('<redacted>');
  });

  it('紧贴单词字符的密钥也不漏（去掉 \\b 后的回归保护）', () => {
    const out = sanitizeErrorBody('bad credential xxxxsk-abcdef123456 rejected');
    expect(out).not.toContain('abcdef123456');
    expect(out).toContain('<redacted>');
  });

  it('遮蔽 gsk_ / hf_ / AIza 三类第三方前缀', () => {
    const gsk = sanitizeErrorBody('bad credential gsk_abcdef123456 rejected');
    expect(gsk).not.toContain('gsk_abcdef123456');
    expect(gsk).toContain('<redacted>');

    const hf = sanitizeErrorBody('bad credential hf_abcdefghijkl rejected');
    expect(hf).not.toContain('hf_abcdefghijkl');
    expect(hf).toContain('<redacted>');

    const aiza = sanitizeErrorBody('bad credential AIzaSyABCDEFGHIJKLMNOP rejected');
    expect(aiza).not.toContain('AIzaSyABCDEFGHIJKLMNOP');
    expect(aiza).toContain('<redacted>');
  });

  it('跨 240 截断边界的密钥仍被完整遮蔽（先遮蔽后截断的回归保护）', () => {
    const key = 'sk-abcdef1234567890';
    // key 前留词边界（空格），且 key 起点在 240 之前、结尾在之后。
    // 前缀取 225（而非 235）：遮蔽标记 `sk-<redacted>` 共 13 字符，须整体落在 240 内，
    // 否则 `toContain('<redacted>')` 断言的正是被截掉的那半截，用例会误红。
    const crossed = `${'x'.repeat(225)} ${key} trailing`;
    const out = sanitizeErrorBody(crossed);
    expect(out).not.toContain('abcdef1234567890'); // 不得残留 key 主体
    expect(out).not.toContain('sk-abcdef'); // 不得残留 ≥6 字符的 key 片段
    expect(out).toContain('<redacted>');
    expect(out.length).toBeLessThanOrEqual(241); // 仍受 max 约束
  });

  it('负对照：旧行为（只截断不遮蔽）会泄漏该 key 片段', () => {
    const key = 'sk-abcdef1234567890';
    const crossed = `${'x'.repeat(225)} ${key} trailing`;
    // 直接 slice(0,240) 模拟"截断先于遮蔽"的旧实现 → 必然出现 sk-a 之类碎片
    expect(crossed.slice(0, 240).includes('sk-a')).toBe(true);
  });

  it('普通文本不被误遮蔽（误伤边界的负对照）', () => {
    const out = sanitizeErrorBody('模型返回 503 service unavailable，请稍后重试');
    expect(out).not.toContain('<redacted>');
    expect(out).toContain('503');
  });
});
