import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import UsageBar, { applyUsageDelta, emptyUsage, type UsageTotals } from './components/UsageBar';

/** Render a component to static HTML (node env, no jsdom needed; matches components.team.test). */
function render(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

function totals(over: Partial<UsageTotals> = {}): UsageTotals {
  return { ...emptyUsage(), ...over };
}

describe('UsageBar — cacheWrite (cacheCreation) 分项（task 107）', () => {
  it('emptyUsage 初始化为全 0（含 cacheCreationTokens）', () => {
    const u = emptyUsage();
    expect(u.cacheReadTokens).toBe(0);
    expect(u.cacheCreationTokens).toBe(0);
    expect(u.costUsd).toBe(0);
  });

  it('applyUsageDelta 累加 cacheWrite tokens；缺该字段时按 0 回退不 NaN', () => {
    let u = emptyUsage();
    u = applyUsageDelta(u, { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 });
    // 缺 cacheCreationTokens 的 delta 不该污染累加值（回退 0）
    expect(u.cacheCreationTokens).toBe(0);
    u = applyUsageDelta(u, { cacheCreationTokens: 2095 });
    expect(u.cacheCreationTokens).toBe(2095);
    expect(Number.isFinite(u.costUsd)).toBe(true);
  });

  it('cacheWrite 成本按 input×1.25 推导计入估算（089 derived 语义）', () => {
    // 1M in (0.5) + 1M out (1.5) + 1M cacheRead (0.1) + 1M cacheWrite (0.625) = 2.725
    const u = applyUsageDelta(emptyUsage(), {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    });
    expect(u.costUsd).toBeCloseTo(2.725, 9);
  });

  it('渲染 cache 读/写分项并列，且写分项带 derived 提示', () => {
    const html = render(
      <UsageBar usage={totals({ calls: 3, inputTokens: 10, outputTokens: 5, cacheReadTokens: 1024, cacheCreationTokens: 2095 })} />,
    );
    expect(html).toContain('cache 读 1024 / 写 2095');
    expect(html).toContain('cache 写价按 input×1.25 估算');
    expect(html).toContain('calls 3');
  });

  it('无 cacheWrite 时只渲染 cache 读，不出现写分项', () => {
    const html = render(<UsageBar usage={totals({ calls: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 1024 })} />);
    expect(html).toContain('cache 读 1024');
    expect(html).not.toContain('写');
    expect(html).not.toContain('input×1.25');
  });

  it('mock 增量链：多个 delta 累积后渲染正确（含缺字段帧回退）', () => {
    let u = emptyUsage();
    u = applyUsageDelta(u, { inputTokens: 12, outputTokens: 8, calls: 1 });
    u = applyUsageDelta(u, { cacheReadTokens: 1024, cacheCreationTokens: 2095 }); // 第二帧补 cache 分项
    expect(u.calls).toBe(1);
    expect(u.inputTokens).toBe(12);
    expect(u.cacheReadTokens).toBe(1024);
    expect(u.cacheCreationTokens).toBe(2095);

    const html = render(<UsageBar usage={u} />);
    expect(html).toContain('cache 读 1024 / 写 2095');
    expect(html).toContain('12+8 tok');
  });

  it('全零 usage 不渲染任何内容', () => {
    expect(render(<UsageBar usage={emptyUsage()} />)).toBe('');
  });
});