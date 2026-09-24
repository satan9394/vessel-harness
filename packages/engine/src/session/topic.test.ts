import { describe, expect, it } from 'vitest';
import { deriveTopicTitle } from './topic.js';

describe('deriveTopicTitle', () => {
  it('uses the first sentence and strips markdown/list syntax', () => {
    expect(deriveTopicTitle('## 设计 **会话主题** 的持久化方案。后续内容不进入标题')).toBe('设计 会话主题 的持久化方案');
  });

  it('strips code fences and avoids code-only prompts as titles', () => {
    expect(deriveTopicTitle('```ts\nconst sessionId = "abc";\n```\n请解释这个会话 ID')).toBe('请解释这个会话 ID');
    expect(deriveTopicTitle('const sessionId = "abc";\nconsole.log(sessionId)')).toBe('代码处理请求');
  });

  it('maps greeting-only prompts to a useful short label', () => {
    expect(deriveTopicTitle('你好！')).toBe('日常问候对话');
    expect(deriveTopicTitle('hello')).toBe('日常问候对话');
  });

  it('normalizes newlines, punctuation and caps the title at 20 characters', () => {
    const title = deriveTopicTitle('# 这是一个非常非常非常非常长的主题名称，用于验证自动截断行为\n下一行');
    expect(title).toBe('这是一个非常非常非常非常长的主题名称 用');
    expect(title).toHaveLength(20);
    expect(title).not.toMatch(/[\r\n#*_`]/);
  });

  it('returns a stable fallback for empty or unusable prompts', () => {
    expect(deriveTopicTitle('   ')).toBe('New conversation');
    expect(deriveTopicTitle('```\ncode\n```')).toBe('New conversation');
  });
});
