import { describe, it, expect } from 'vitest';
import { INJECTED_MESSAGE_SOURCES } from './provider.js';
import { MESSAGE_SOURCES } from './events.js';

/**
 * 注入来源集合漂移守卫（G-16 / BRIEF-02）。
 *
 * `MESSAGE_SOURCES`（events.ts）是 source 的唯一运行时事实源；`INJECTED_MESSAGE_SOURCES`
 * （provider.ts）是 MockProvider 用来跳过"非真实输入"的白名单。二者一旦漂移，
 * 新增的注入来源会被当作真实输入参与脚本匹配（历史实例：plan/handoff/inject 曾漏登记）。
 */
const SURFACE_SOURCES: readonly string[] = ['user', 'steer'];

describe('注入来源集合漂移守卫（G-16）', () => {
  it('events 联合里除真实输入外的每个来源都必须登记进 INJECTED_MESSAGE_SOURCES', () => {
    const injected = MESSAGE_SOURCES.filter((s) => !SURFACE_SOURCES.includes(s));
    const missing = injected.filter((s) => !INJECTED_MESSAGE_SOURCES.has(s));
    expect(missing).toEqual([]);
  });

  it('真实输入来源不得被登记为注入（否则会误伤匹配）', () => {
    const wrong = SURFACE_SOURCES.filter((s) => INJECTED_MESSAGE_SOURCES.has(s));
    expect(wrong).toEqual([]);
  });

  it('environment 是 Builder 合成标记，必须仍在注入集合内', () => {
    expect(INJECTED_MESSAGE_SOURCES.has('environment')).toBe(true);
  });

  it('注入集合同联合全等：= MESSAGE_SOURCES 去掉真实输入 + 唯一的合成值 environment', () => {
    const expected = [
      ...MESSAGE_SOURCES.filter((s) => !SURFACE_SOURCES.includes(s)),
      'environment',
    ].sort();
    expect([...INJECTED_MESSAGE_SOURCES].sort()).toEqual(expected);
    const extras = [...INJECTED_MESSAGE_SOURCES].filter(
      (s) => !(MESSAGE_SOURCES as readonly string[]).includes(s),
    );
    expect(extras).toEqual(['environment']);
  });
});
