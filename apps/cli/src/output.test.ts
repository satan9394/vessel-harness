import { describe, expect, it, vi, afterEach } from 'vitest';
import { emitJson, fail, isJson } from './output.js';

/** G-11 / BRIEF-10：`--json` 的极小输出层。 */
describe('cli/output（--json 输出层）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isJson：只有带 --json 才算 JSON 模式', () => {
    expect(isJson(new Map([['json', 'true']]))).toBe(true);
    expect(isJson(new Map())).toBe(false);
    expect(isJson(new Map([['strict', 'true']]))).toBe(false);
  });

  it('emitJson：stdout 只出现一段可解析 JSON（缩进 2，无杂行）', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitJson({ a: 1, nested: { b: [1, 2] } });
    expect(spy).toHaveBeenCalledTimes(1); // 唯一一次输出 = 无 banner/提示
    const raw = String(spy.mock.calls[0]?.[0]);
    expect(raw).not.toContain('[vessel]');
    expect(JSON.parse(raw)).toEqual({ a: 1, nested: { b: [1, 2] } });
    expect(raw).toContain('\n  '); // 缩进 2
  });

  it('fail：JSON 模式走 stderr 的 JSON 信封，且返回该退出码', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = fail(2, '读不到数据', new Map([['json', 'true']]));
    expect(code).toBe(2);
    expect(logSpy).not.toHaveBeenCalled(); // 失败时 stdout 必须为空
    const raw = String(errSpy.mock.calls[0]?.[0]);
    expect(JSON.parse(raw)).toEqual({ error: { message: '读不到数据', code: 2 } });
  });

  it('fail：非 JSON 模式优先用 human() 文案，否则用原始 message', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flags = new Map<string, string>();
    fail(1, 'raw-message', flags, () => console.error('人话文案'));
    expect(String(errSpy.mock.calls[0]?.[0])).toBe('人话文案');
    errSpy.mockClear();
    fail(1, 'raw-message', flags);
    expect(String(errSpy.mock.calls[0]?.[0])).toBe('raw-message');
  });
});
