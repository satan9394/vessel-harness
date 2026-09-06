import { describe, it, expect } from 'vitest';
import { classifyTask, DeterministicTaskClassifier, DEFAULT_CATEGORY_RULES, type CategoryRule } from './taskCategory.js';

describe('llm/router — task category classifier (V0.4-M1)', () => {
  it('classifies implementation tasks', () => {
    expect(classifyTask('请实现一个用户登录功能')).toBe('implementation');
    expect(classifyTask('implement the checkout feature')).toBe('implementation');
  });

  it('classifies search tasks', () => {
    expect(classifyTask('搜索 needle 在哪些文件被调用')).toBe('search');
    expect(classifyTask('find where computeTax is used')).toBe('search');
  });

  it('classifies review tasks', () => {
    expect(classifyTask('审查这段代码，找出问题')).toBe('review');
    expect(classifyTask('code review my diff')).toBe('review');
  });

  it('classifies planning and architecture tasks', () => {
    expect(classifyTask('为这个项目做一个开发计划')).toBe('planning');
    expect(classifyTask('设计新模块的架构与依赖边界')).toBe('architecture');
  });

  it('classifies simple fixes', () => {
    expect(classifyTask('修复 computeFee 的返回类型错误')).toBe('simple_fix');
    expect(classifyTask('quick fix the typo in cli.ts')).toBe('simple_fix');
  });

  it('unknown or empty task falls back to unknown', () => {
    expect(classifyTask('')).toBe('unknown');
    expect(classifyTask('hello there')).toBe('unknown');
  });

  it('first matching rule wins (rule order = priority)', () => {
    // "review + fix" — review rule precedes simple_fix in the default table
    const custom: CategoryRule[] = [
      { category: 'simple_fix', keywords: ['fix'] },
      { category: 'review', keywords: ['review'] },
    ];
    expect(classifyTask('fix this review finding', custom)).toBe('simple_fix');
  });

  it('DeterministicTaskClassifier adapts to the TaskClassifier seam', async () => {
    const c = new DeterministicTaskClassifier();
    expect(await c.classify('开发一个功能')).toBe('implementation');
  });

  it('DEFAULT_CATEGORY_RULES covers every non-unknown category', () => {
    const covered = new Set(DEFAULT_CATEGORY_RULES.map((r) => r.category));
    expect(covered.has('implementation')).toBe(true);
    expect(covered.has('simple_fix')).toBe(true);
    expect(covered.has('search')).toBe(true);
    expect(covered.has('review')).toBe(true);
    expect(covered.has('planning')).toBe(true);
    expect(covered.has('architecture')).toBe(true);
  });
});
