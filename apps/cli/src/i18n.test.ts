import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentLocale, resolveLocale, setLocale, t } from './i18n.js';

describe('CLI i18n', () => {
  let oldLang: string | undefined;

  beforeEach(() => {
    oldLang = process.env.VESSEL_LANG;
    delete process.env.VESSEL_LANG;
    setLocale('zh');
  });

  afterEach(() => {
    if (oldLang === undefined) delete process.env.VESSEL_LANG;
    else process.env.VESSEL_LANG = oldLang;
    setLocale('zh');
  });

  it('defaults to zh and reads VESSEL_LANG with unknown values falling back to en', () => {
    expect(resolveLocale([])).toBe('zh');
    for (const [value, expected] of [['en', 'en'], ['zh', 'zh'], ['zz', 'en'], ['', 'en']]) {
      process.env.VESSEL_LANG = value;
      expect(resolveLocale([])).toBe(expected);
    }
  });

  it.each([
    [['--lang', 'en', '--help'], 'en'],
    [['--help', '--lang', 'en'], 'en'],
    [['run', '--prompt', 'hello', '--lang', 'zh'], 'zh'],
    [['--lang', 'zz'], 'en'],
    [['--lang'], 'en'],
    [['--lang', '--help'], 'en'],
    [['--lang', 'en', '--lang', 'zh'], 'zh'],
  ] as const)('resolves %j independently of argument position', (argv, expected) => {
    process.env.VESSEL_LANG = expected === 'zh' ? 'en' : 'zh';
    expect(resolveLocale(argv)).toBe(expected);
  });

  it('sets locale without persisting or changing the environment', () => {
    process.env.VESSEL_LANG = 'zh';
    setLocale('en');
    expect(currentLocale()).toBe('en');
    expect(process.env.VESSEL_LANG).toBe('zh');
  });

  it('translates help framing and interpolates string and number parameters', () => {
    expect(t('usage.header', { version: 'test' })).toBe('Vessel CLI vtest — 可组合 Agent Harness（品牌 Vessel）');
    expect(t('usage.commandsHint')).toBe('用法:');
    expect(t('usage.footer')).toContain('provider 协议说明:');
    setLocale('en');
    expect(t('usage.header', { version: 42 })).toBe('Vessel CLI v42 — Composable Agent Harness (Vessel)');
    expect(t('usage.commandsHint')).toBe('Usage:');
    expect(t('usage.footer')).toContain('Provider protocols:');
    expect(t('usage.header')).toContain('{version}');
    expect(t('usage.header', { x: 1 })).toContain('{version}');
  });

  it.each(['zh', 'en'] as const)('interpolates command defaults under %s while preserving endpoint templates', (value) => {
    setLocale(value);
    const template = t('usage.commands');
    expect(template).toContain('{syncTimeout}');
    expect(template).toContain('{syncRetries}');
    const commands = t('usage.commands', { syncTimeout: 23, syncRetries: 4 });
    expect(commands).not.toMatch(/\{syncTimeout\}|\{syncRetries\}/);
    expect(commands).toContain(value === 'zh' ? '超时 23s + 重试 4 次' : 'timeout 23s + 4 retries');
    expect(commands).toContain('{base}/chat/completions');
    expect(commands).toContain('{base}/v1/messages');
  });

  it('keeps command order, line count, and indentation across languages', () => {
    const zhLines = t('usage.commands').split('\n');
    setLocale('en');
    const enLines = t('usage.commands').split('\n');
    expect(zhLines).toHaveLength(90);
    expect(enLines).toHaveLength(90);
    for (const [i, zhLine] of zhLines.entries()) {
      const enLine = enLines[i]!;
      expect(enLine.match(/^ */)?.[0]).toBe(zhLine.match(/^ */)?.[0]);
      // Command names and flags keep their order; argument labels may be translated.
      expect(enLine.match(/^  (?:vessel [\w:|-]+|--[\w-]+)/)?.[0])
        .toBe(zhLine.match(/^  (?:vessel [\w:|-]+|--[\w-]+)/)?.[0]);
    }
    expect(enLines.join('\n')).not.toMatch(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/);
  });

  it.each(['zh', 'en'] as const)('returns unknown keys literally under %s', (value) => {
    setLocale(value);
    for (const key of ['nope.key', 'toString', '__proto__']) {
      expect(t(key, { extra: 1 })).toBe(key);
    }
    expect(t('unknown.{name}', { name: 'changed' })).toBe('unknown.{name}');
  });
});
