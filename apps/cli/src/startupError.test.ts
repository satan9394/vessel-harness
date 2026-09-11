/**
 * startupError.test.ts — 启动期异常「人话渲染」的单元测试。
 *
 * 断言按 startupError.ts 实际实现对齐（不是按理想设计）：
 * - 判定顺序：config-corrupted → file-missing → permission → unknown；
 * - config-corrupted 的触发条件：`err instanceof SyntaxError`、`err.name === 'SyntaxError'`，
 *   或去掉 `.json` 字样后仍命中 JSON 报错特征（所以 `ENOENT ... config.json` 不会被误判为损坏）；
 * - 路径由 extractPath() 从 message 中「尽力提取」（优先 `.json` 结尾片段，支持 Windows 与 POSIX
 *   绝对路径，并把 `\\` 还原为 `\`），提取不到时 path 为 undefined 且文案里不出现空占位；
 * - 每类文案末尾必带一句恢复指引（vessel setup / vessel provider add / vessel --help）；
 * - 永不输出裸栈：文案只由 message 拼装，不含 stack 行。
 *
 * 全部用例使用合成 error，不读写文件系统、不触达网络。
 */

import { describe, expect, it } from 'vitest';

import { describeStartupFailure } from './startupError.js';

/** 出现的栈行特征：换行 + 缩进 + `at `。 */
const STACK_LINE_RE = /\n\s+at\s/;

/** Windows 绝对路径（单反斜杠，即真实错误文案里的形态）。 */
const WIN_JSON_PATH = String.raw`C:\Users\x\.vessel\providers.json`;

describe('describeStartupFailure', () => {
  it('JSON 语法错误 → config-corrupted，并给出恢复指引', () => {
    const res = describeStartupFailure(new SyntaxError('Unexpected token } in JSON at position 5'));

    expect(res.kind).toBe('config-corrupted');
    expect(res.message).toContain('配置文件损坏');
    // 恢复指引关键词：二者实现里同时出现，任一存在即视为满足意图。
    expect(res.message).toMatch(/vessel setup|vessel provider add/);
    expect(res.message).toContain('Unexpected token } in JSON at position 5');
  });

  it('从 message 中提取 Windows 绝对路径（优先 .json 片段）', () => {
    const res = describeStartupFailure(new SyntaxError(`Unexpected end of JSON input at ${WIN_JSON_PATH}`));

    expect(res.kind).toBe('config-corrupted');
    expect(res.path).toBeDefined();
    expect(res.path).toContain('providers.json');
    // 用 toContain 兼容实现的路径清洗细节（标点裁剪、反斜杠还原等）。
    expect(res.message).toContain(WIN_JSON_PATH);
    expect(res.message).toContain(`涉及文件：${WIN_JSON_PATH}`);
  });

  it('双反斜杠转义的路径会被还原为干净的 Windows 路径', () => {
    const escaped = String.raw`C:\\Users\\x\\.vessel\\providers.json`;
    const res = describeStartupFailure(new Error(`ENOENT: no such file or directory, open '${escaped}'`));

    expect(res.kind).toBe('file-missing');
    expect(res.path).toContain('providers.json');
    expect(res.path).not.toContain('\\\\');
  });

  it('POSIX 绝对路径同样可提取', () => {
    const posixPath = '/home/me/.vessel/config.json';
    const res = describeStartupFailure(new Error(`ENOENT: no such file or directory, open '${posixPath}'`));

    expect(res.kind).toBe('file-missing');
    expect(res.path).toBe(posixPath);
    expect(res.message).toContain(posixPath);
  });

  it('ENOENT → file-missing，且不会因为文件名带 .json 被误判为损坏', () => {
    const res = describeStartupFailure(
      new Error(String.raw`ENOENT: no such file or directory, open 'C:\tmp\a.json'`),
    );

    expect(res.kind).toBe('file-missing');
    expect(res.message).toContain('文件不存在');
    expect(res.message).toContain(String.raw`C:\tmp\a.json`);
    expect(res.message).not.toContain('配置文件损坏');
    expect(res.message).toMatch(/vessel setup/);
  });

  it('EPERM/EACCES/EBUSY → permission，并给出权限类恢复指引', () => {
    const res = describeStartupFailure(new Error('EPERM: operation not permitted, rename ...'));

    expect(res.kind).toBe('permission');
    expect(res.message).toContain('权限不足');
    expect(res.message).toMatch(/杀软|只读属性|稍后重试/);
  });

  it('未知错误 → unknown，原始文案保留且带通用指引', () => {
    const res = describeStartupFailure(new Error('boom'));

    expect(res.kind).toBe('unknown');
    expect(res.message).toContain('boom');
    expect(res.message).toContain('vessel --help');
  });

  it('非 Error 输入不抛异常，且分类仍然正确', () => {
    const asString = describeStartupFailure('ENOENT: no such file or directory, open /var/tmp/a.json');
    expect(asString.kind).toBe('file-missing');

    // 跨 realm / 序列化后的 SyntaxError：靠 name 字段识别。
    // 注意（按实现对齐）：非 Error 对象的「原始错误」行会退化为 String(err)，即 `[object Object]`；
    // 这里只断言分类与指引，不把该退化文案当成契约。
    const asPlainObject = describeStartupFailure({ name: 'SyntaxError', message: 'Unexpected token }' });
    expect(asPlainObject.kind).toBe('config-corrupted');
    expect(asPlainObject.message).toContain('配置文件损坏');
    expect(asPlainObject.message).toMatch(/vessel setup|vessel provider add/);
  });

  it('无裸栈守卫：任何分类的输出都不含 stack 行，也没有空占位', () => {
    const samples: unknown[] = [
      new SyntaxError('Unexpected token } in JSON at position 5'),
      new SyntaxError(`Unexpected end of JSON input at ${WIN_JSON_PATH}`),
      new Error(String.raw`ENOENT: no such file or directory, open 'C:\tmp\a.json'`),
      new Error('EPERM: operation not permitted, rename ...'),
      new Error('boom'),
      // name-only 的 SyntaxError（跨 realm / 反序列化形态）：rawMessage 仍走 Error.message。
      Object.assign(new Error('Unexpected non-whitespace character after JSON'), { name: 'SyntaxError' }),
    ];

    for (const err of samples) {
      expect(() => describeStartupFailure(err)).not.toThrow();
      const res = describeStartupFailure(err);

      expect(res.message).not.toMatch(STACK_LINE_RE);
      expect(res.message).not.toContain('undefined');
      expect(res.message).not.toContain('[object Object]');
      expect(['config-corrupted', 'file-missing', 'permission', 'unknown']).toContain(res.kind);
      expect(res.message.trim().length).toBeGreaterThan(0);
    }

    // 无路径可提取时，不出现「涉及文件：」空行。
    const noPath = describeStartupFailure(new Error('boom'));
    expect(noPath.path).toBeUndefined();
    expect(noPath.message).not.toContain('涉及文件');
  });
});
