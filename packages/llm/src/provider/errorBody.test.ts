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
});
