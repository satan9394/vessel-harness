import { describe, it, expect } from 'vitest';
import { RingHistory } from './bounded-history.js';

/**
 * engine/bounded-history — V1.1-B 有界环/retention 单元测试。
 * 语义：保最近 N 条（FIFO 覆盖最旧）；total 单调递增（覆盖不清零）；last 恒为最近一条。
 */
describe('engine/bounded-history — RingHistory 有界环语义（V1.1-B）', () => {
  it('构造校验：非正整数 limit fail loud', () => {
    expect(() => new RingHistory(0)).toThrow(/positive integer/);
    expect(() => new RingHistory(-3)).toThrow(/positive integer/);
    expect(() => new RingHistory(1.5)).toThrow(/positive integer/);
    expect(() => new RingHistory(Number.NaN)).toThrow(/positive integer/);
  });

  it('未满时按调用序返回全部（最旧在前），last 为末条', () => {
    const h = new RingHistory<string>(5);
    h.push('a');
    h.push('b');
    h.push('c');
    expect(h.items).toEqual(['a', 'b', 'c']);
    expect([...h.items]).toEqual(['a', 'b', 'c']);
    expect(h.last).toBe('c');
    expect(h.total).toBe(3);
    expect(h.limit).toBe(5);
  });

  it('超过上限后覆盖最旧（FIFO），保最近 limit 条', () => {
    const h = new RingHistory<string>(3);
    for (const s of ['1', '2', '3', '4', '5']) h.push(s);
    expect(h.items).toEqual(['3', '4', '5']); // 保最近 3；1、2 被覆盖
    expect(h.items.length).toBe(3);
    expect(h.last).toBe('5');
    // total 单调递增，覆盖不清零
    expect(h.total).toBe(5);
  });

  it('total 覆盖后仍单调：计入被覆盖条目（计数消费方不因覆盖失真）', () => {
    const h = new RingHistory<number>(2);
    for (let i = 1; i <= 100; i += 1) h.push(i);
    expect(h.items).toEqual([99, 100]); // 保最近 2
    expect(h.total).toBe(100);
    expect(h.last).toBe(100);
  });

  it('toArray 返回独立数组快照：外部改动数组结构不影响环内部（元素为共享引用，同旧 runs 语义）', () => {
    const h = new RingHistory<string>(3);
    h.push('a');
    h.push('b');
    const snapshot = h.toArray();
    snapshot.length = 0; // 清空外部数组不影响环
    expect(h.items).toEqual(['a', 'b']);
    // 环持续推进也不改写早前取出的快照
    const early = h.toArray();
    h.push('c');
    h.push('d');
    expect(early).toEqual(['a', 'b']);
    expect(h.items).toEqual(['b', 'c', 'd']);
  });

  it('空环：items=[]、last=undefined、total=0', () => {
    const h = new RingHistory<number>(3);
    expect(h.items).toEqual([]);
    expect(h.last).toBeUndefined();
    expect(h.total).toBe(0);
  });

  it('环形回绕正确（head 多次环绕后顺序仍最旧在前）', () => {
    const h = new RingHistory<number>(4);
    for (let i = 1; i <= 9; i += 1) h.push(i); // 3 次环绕
    expect(h.items).toEqual([6, 7, 8, 9]);
    expect(h.last).toBe(9);
    expect(h.total).toBe(9);
  });
});