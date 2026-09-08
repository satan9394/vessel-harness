import { describe, it, expect } from 'vitest';
import type { ChatProvider } from '@vessel/shared';
import {
  AutoTaskRouter,
  DEFAULT_ROUTE_MODE,
  DEFAULT_CATEGORY_COMPLEXITY,
  DEFAULT_COMPLEXITY_ROLES,
  DEFAULT_ROLE_TIERS,
  complexityForCategory,
  rolesForComplexity,
  roleTierFor,
  resolveTierBinding,
  routeSelectionLabel,
  isRouteMode,
  type RouteMode,
  type TierBindings,
} from './autoRouter.js';
import type { TaskCategory } from './taskCategory.js';

function mockProvider(id: string): ChatProvider {
  return { id, chat: async () => ({ content: '', usage: { inputTokens: 0, outputTokens: 0 } }) } as unknown as ChatProvider;
}

/** pro/fast/mini/review 四档 providers —— provider 层视角的 tier→model 绑定（056 不写死）。 */
const providers: Record<string, ChatProvider> = {
  pro: mockProvider('pro'),
  fast: mockProvider('fast'),
  mini: mockProvider('mini'),
  review: mockProvider('review'),
};

const bindings: TierBindings = {
  pro: { providerId: 'pro', model: 'deepseek-v4-pro' },
  fast: { providerId: 'fast', model: 'deepseek-v4-flash' },
  mini: { providerId: 'fast', model: 'mini-model' },
  review: { providerId: 'review', model: 'review-internal-flash' },
};

describe('llm/router — AutoTaskRouter (task 056: 默认 Auto)', () => {
  it('defaults to Auto mode when the caller gives no explicit mode', () => {
    expect(DEFAULT_ROUTE_MODE).toBe('auto');
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '请实现一个用户登录功能' });
    expect(r.mode).toBe('auto');
    expect(r.pinned).toBe(false);
  });

  it('isRouteMode validates the Auto/Fast/Pro vocabulary', () => {
    expect(['auto', 'fast', 'pro'].every((m) => isRouteMode(m))).toBe(true);
    expect(isRouteMode('mini')).toBe(false);
    expect(isRouteMode(undefined)).toBe(false);
  });

  it('classifies an implementation task → medium → Developer+Reviewer (developer pro + reviewer review)', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '请实现一个用户登录功能' });
    expect(r.category).toBe('implementation');
    expect(r.complexity).toBe('medium');
    expect(r.roles).toEqual(['developer', 'reviewer']);
    expect(r.roleModels[0]).toMatchObject({ role: 'developer', tier: 'pro', model: 'deepseek-v4-pro', configured: true });
    expect(r.roleModels[1]).toMatchObject({ role: 'reviewer', tier: 'review', model: 'review-internal-flash', configured: true });
    expect(r.primary).toBe(r.roleModels[0]);
  });

  it('§8.2 三档 —— 小任务 → Single Agent (developer fast)', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '搜索 needle 在哪些文件被调用' });
    expect(r.category).toBe('search');
    expect(r.complexity).toBe('small');
    expect(r.roles).toEqual(['developer']);
    expect(r.roleModels[0]).toMatchObject({ role: 'developer', tier: 'fast', model: 'deepseek-v4-flash' });
    expect(r.roleModels.length).toBe(1);
  });

  it('§8.2 三档 —— 中任务 → Developer+Reviewer', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '请实现一个用户登录功能' });
    expect(r.roles).toEqual(['developer', 'reviewer']);
  });

  it('§8.2 三档 —— 复杂任务 → Lead+Developer+Reviewer (lead pro)', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '设计这个系统的模块边界与架构方案' });
    expect(r.category).toBe('architecture');
    expect(r.complexity).toBe('complex');
    expect(r.roles).toEqual(['lead', 'developer', 'reviewer']);
    expect(r.roleModels.map((m) => m.role)).toEqual(['lead', 'developer', 'reviewer']);
    expect(r.roleModels[0]).toMatchObject({ role: 'lead', tier: 'pro', model: 'deepseek-v4-pro' });
    expect(r.primary.model).toBe('deepseek-v4-pro');
  });

  it('tier 解析：每个角色的模型来自 bindings（含 review 档）；resolveTierBinding 单测', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '请实现一个用户登录功能' });
    expect(r.roleModels.map((m) => m.model)).toEqual(['deepseek-v4-pro', 'review-internal-flash']);
    // step-level: tier → binding
    expect(resolveTierBinding('review', bindings).configured).toBe(true);
    expect(resolveTierBinding('pro', bindings).binding.model).toBe('deepseek-v4-pro');
  });

  it('显式 Fast 绕过 classify 直达 fast tier（任务文本本会分到 pro 档也无效）', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '设计系统的架构', mode: 'fast' });
    expect(r.mode).toBe('fast');
    expect(r.category).toBe('unknown'); // not classified
    expect(r.complexity).toBeUndefined();
    expect(r.roles).toEqual(['developer']);
    expect(r.primary).toMatchObject({ tier: 'fast', model: 'deepseek-v4-flash' });
  });

  it('显式 Pro 绕过 classify 直达 pro tier', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '随便一个文本', mode: 'pro' });
    expect(r.mode).toBe('pro');
    expect(r.category).toBe('unknown');
    expect(r.primary).toMatchObject({ tier: 'pro', model: 'deepseek-v4-pro' });
  });

  it('Pin for this session：pin 后 Auto 不再重判，unpin 恢复重判', () => {
    const router = new AutoTaskRouter({ providers, bindings });
    const first = router.resolve({ task: '请实现一个用户登录功能' });
    router.pinCurrent();
    expect(router.isPinned()).toBe(true);

    // 换成会分到不同档/角色的任务，pin 仍返回锁定选择且 pinned=true
    const second = router.resolve({ task: '搜索 needle 在哪些文件被调用' });
    expect(second.pinned).toBe(true);
    expect(second.primary.model).toBe(first.primary.model);
    expect(second.category).toBe(first.category);
    expect(second.roles).toEqual(first.roles);

    // 显式 Fast/Pro 是用户最新意图 —— 不被 pin 吞掉
    const pro = router.resolve({ task: '搜索 needle', mode: 'pro' });
    expect(pro.pinned).toBe(false);
    expect(pro.primary.tier).toBe('pro');

    router.unpin();
    expect(router.isPinned()).toBe(false);
    const third = router.resolve({ task: '搜索 needle 在哪些文件被调用' });
    expect(third.pinned).toBe(false);
    expect(third.category).toBe('search');
    expect(third.primary.model).toBe('deepseek-v4-flash');
  });

  it('pinCurrent before any auto resolve throws with guidance', () => {
    const router = new AutoTaskRouter({ providers, bindings });
    expect(() => router.pinCurrent()).toThrow(/no auto route to pin/);
  });

  it('未配置 tier → 清晰回落默认档 + hints 提示（configured=false）', () => {
    // review 档未绑定 → reviewer 回落 pro；每个未绑定角色一条 hint
    const minimal: TierBindings = {
      pro: { providerId: 'pro', model: 'deepseek-v4-pro' },
      fast: { providerId: 'fast', model: 'deepseek-v4-flash' },
    };
    const r = new AutoTaskRouter({ providers, bindings: minimal }).resolve({ task: '请实现一个用户登录功能' });
    const reviewer = r.roleModels[1]!;
    expect(reviewer.configured).toBe(false);
    expect(reviewer.model).toBe('deepseek-v4-pro'); // 回落 pro 绑定
    expect(r.hints.length).toBeGreaterThan(0);
    expect(r.hints[0]).toContain('review');
    expect(r.hints[0]).toContain('fell back');
  });

  it('未配置提示 —— 显式 Fast 且 fast 未绑定 → 回落默认档 + hint', () => {
    const onlyPro: TierBindings = { pro: { providerId: 'pro', model: 'deepseek-v4-pro' } };
    const r = new AutoTaskRouter({ providers, bindings: onlyPro }).resolve({ mode: 'fast' });
    expect(r.primary).toMatchObject({ tier: 'fast', model: 'deepseek-v4-pro', configured: false });
    expect(r.hints.length).toBe(1);
  });

  it('默认档也未配置 → 抛错并列出已配置 tiers（fail loud，不静默）', () => {
    const empty: TierBindings = {};
    expect(() => new AutoTaskRouter({ providers, bindings: empty }).resolve({ mode: 'pro' })).toThrow(/no model binding/);
  });

  it('provider 未注册 → 抛错列出可用 providers（fail loud）', () => {
    const bad: TierBindings = { pro: { providerId: 'ghost', model: 'x' } };
    expect(() => new AutoTaskRouter({ providers, bindings: bad }).resolve({ mode: 'pro' })).toThrow(/no provider bound/);
  });

  it('解析链每步纯函数可独立测（classify→complexity→roles→tier→binding）', () => {
    // complexity
    expect(complexityForCategory('search' as TaskCategory)).toBe('small');
    expect(complexityForCategory('implementation' as TaskCategory)).toBe('medium');
    expect(complexityForCategory('architecture' as TaskCategory)).toBe('complex');
    // roles
    expect(rolesForComplexity('small')).toEqual(['developer']);
    expect(rolesForComplexity('medium')).toEqual(['developer', 'reviewer']);
    expect(rolesForComplexity('complex')).toEqual(['lead', 'developer', 'reviewer']);
    // tier
    expect(roleTierFor('developer', 'small')).toBe('fast');
    expect(roleTierFor('developer', 'medium')).toBe('pro');
    expect(roleTierFor('reviewer', 'medium')).toBe('review');
    expect(roleTierFor('ghost-role', 'medium')).toBe('pro'); // 未知角色回落默认
    // binding
    expect(resolveTierBinding('review', bindings).binding.model).toBe('review-internal-flash');
    expect(resolveTierBinding('ghost', bindings).configured).toBe(false);
    // default data tables are the documented §8.2/§8.3 shape
    expect(DEFAULT_ROUTE_MODE).toBe('auto');
    expect(DEFAULT_CATEGORY_COMPLEXITY.simple_fix).toBe('small');
    expect(DEFAULT_COMPLEXITY_ROLES.complex).toEqual(['lead', 'developer', 'reviewer']);
    expect(DEFAULT_ROLE_TIERS.lead?.complex).toBe('pro');
  });

  it('分类器可注入（classify seam 覆盖确定性规则）', () => {
    const r = new AutoTaskRouter({
      providers,
      bindings,
      classify: () => 'review' as TaskCategory,
    }).resolve({ task: 'anything' });
    expect(r.category).toBe('review');
    expect(r.complexity).toBe('medium');
  });

  it('显式 category 覆盖跳过分类（与显式输入语义一致）', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ category: 'simple_fix' as TaskCategory });
    expect(r.category).toBe('simple_fix');
    expect(r.complexity).toBe('small');
    expect(r.roles).toEqual(['developer']);
  });

  it('routeSelectionLabel 输出「Auto → <model>」展示串（§10 UI）', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({ task: '请实现一个用户登录功能' });
    expect(routeSelectionLabel(r)).toBe('auto → deepseek-v4-pro');
    expect(routeSelectionLabel({ ...r, mode: 'pro' as RouteMode })).toBe('pro → deepseek-v4-pro');
  });

  it('无任务文本的 auto 落到 unknown → medium（pro 主档 + 角色面保守）', () => {
    const r = new AutoTaskRouter({ providers, bindings }).resolve({});
    expect(r.category).toBe('unknown');
    expect(r.complexity).toBe('medium');
    expect(r.roles).toEqual(['developer', 'reviewer']);
    expect(r.primary.tier).toBe('pro');
  });
});
