/**
 * `envRoot` 的唯一实现 + **"空串不等于 CWD"** 的判别性用例（Round 123）。
 *
 * 背景：`VESSEL_*_ROOT` 的空串语义此前**只有 `mcp/config.ts` 处理对**，其余四个状态根用
 * `process.env.X ?? 默认值` ⇒ `VESSEL_PROVIDER_ROOT=`（shell 里"清空变量"的常见写法）
 * 会让该状态**落到进程 CWD**，而同一次运行的 mcp.json 仍在 `~/.vessel`
 * ⇒ **同一次运行的状态根被拆成两处，且没有任何报错**。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { envRoot } from './envRoot.js';
import { providerStateRoot } from './providers/defaultStore.js';
import { resolveUsageRoot } from './usage/UsageStore.js';

const KEY = 'VESSEL_PROVIDER_ROOT';
const saved = process.env[KEY];

afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe('envRoot — 状态根环境变量的唯一读法', () => {
  it('① 未设置 ⇒ undefined；空/纯空白 ⇒ 同样按未设置（不是空串）', () => {
    delete process.env[KEY];
    expect(envRoot(KEY)).toBeUndefined();
    process.env[KEY] = '';
    expect(envRoot(KEY)).toBeUndefined();
    process.env[KEY] = '   ';
    expect(envRoot(KEY)).toBeUndefined();
  });

  it('② 有值 ⇒ 去掉首尾空白后的值', () => {
    process.env[KEY] = '  C:\\tmp\\vessel-root  ';
    expect(envRoot(KEY)).toBe('C:\\tmp\\vessel-root');
  });

  it('③ 判别性：`VESSEL_PROVIDER_ROOT=` 空串 ⇒ 回落**默认根**，绝不落到进程 CWD', () => {
    // 改前：`process.env[KEY] ?? defaultProviderRoot()` 会得到 '' ⇒ 状态根 = 空串（= CWD）
    delete process.env[KEY];
    const fallback = providerStateRoot();
    process.env[KEY] = '';
    expect(providerStateRoot()).toBe(fallback);
    expect(providerStateRoot()).not.toBe('');
    process.env[KEY] = '   ';
    expect(providerStateRoot()).toBe(fallback);
  });

  it('④ 负对照：有值 ⇒ 仍以该值为根（既有语义不变）', () => {
    process.env[KEY] = 'C:\\tmp\\explicit-root';
    expect(providerStateRoot()).toBe('C:\\tmp\\explicit-root');
  });

  it('⑤ usage 根同样处理空串（不再是 CWD）', () => {
    const UKEY = 'VESSEL_USAGE_ROOT';
    const usaved = process.env[UKEY];
    try {
      delete process.env[UKEY];
      const fallback = resolveUsageRoot(); // 读环境的那个；defaultUsageRoot() 恒为 ~/.vessel，不能用它当基线
      process.env[UKEY] = '';
      expect(resolveUsageRoot()).toBe(fallback);
      process.env[UKEY] = 'C:\\tmp\\explicit-usage';
      expect(resolveUsageRoot()).toBe('C:\\tmp\\explicit-usage');
    } finally {
      if (usaved === undefined) delete process.env[UKEY];
      else process.env[UKEY] = usaved;
    }
  });
});
