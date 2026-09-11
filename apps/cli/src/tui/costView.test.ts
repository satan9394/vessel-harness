import { describe, expect, it } from 'vitest';
import { renderCostLines, renderTurnDelta, type UsageTotalsLike } from './costView.js';

/** G-09 / BRIEF-08：会话内成本文案的纯函数渲染。 */
const base: UsageTotalsLike = { costUsd: 0.0068, calls: 2, inputTokens: 300, outputTokens: 100 };
const now: UsageTotalsLike = { costUsd: 0.01, calls: 3, inputTokens: 1500, outputTokens: 500 };

describe('costView（会话内成本文案）', () => {
  it('renderCostLines：相对基线给「本会话」增量，并给「累计」', () => {
    const out = renderCostLines(now, base);
    const [session, total] = out.split('\n');
    expect(session).toBe('本会话: $0.0032 · 1 次调用 · 1200 in / 400 out');
    expect(total).toBe('累计: $0.0100 · 3 次');
  });

  it('renderCostLines：无基线时本会话 = 累计', () => {
    const out = renderCostLines(now);
    const [session, total] = out.split('\n');
    expect(session).toBe('本会话: $0.0100 · 3 次调用 · 1500 in / 500 out');
    expect(total).toBe('累计: $0.0100 · 3 次');
  });

  it('renderCostLines：会话内零调用 → 明确说「暂无用量记录」（仍给累计）', () => {
    const out = renderCostLines(now, now);
    const [session, total] = out.split('\n');
    expect(session).toBe('本会话暂无用量记录');
    expect(total).toBe('累计: $0.0100 · 3 次');
  });

  it('renderTurnDelta：单回合增量含金额与 token 明细', () => {
    expect(renderTurnDelta(now, base)).toBe('· 本回合 $0.0032（1200 in / 400 out）');
  });

  it('renderTurnDelta：本回合无用量 → 明确标注，不显示 0 in / 0 out', () => {
    expect(renderTurnDelta(now, now)).toBe('· 本回合 $0.0000（无用量记录）');
  });

  it('金额一律 4 位小数（大额也不丢精度位数）', () => {
    const big = { costUsd: 12.5, calls: 9, inputTokens: 1, outputTokens: 1 };
    expect(renderCostLines(big)).toContain('$12.5000');
    expect(renderTurnDelta(big)).toContain('$12.5000');
  });
});
