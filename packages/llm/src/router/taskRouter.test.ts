import { describe, it, expect } from 'vitest';
import type { ChatProvider } from '@vessel/shared';
import { TaskRouter, DEFAULT_PRESETS, type TierModelMap } from './TaskRouter.js';
import { classifyTask, type TaskCategory } from './taskCategory.js';

function mockProvider(id: string): ChatProvider {
  return { id, chat: async () => ({ content: '', usage: { inputTokens: 0, outputTokens: 0 } }) } as unknown as ChatProvider;
}

const providers: Record<string, ChatProvider> = {
  pro: mockProvider('pro'),
  fast: mockProvider('fast'),
};
const tierModel: TierModelMap = {
  pro: { providerId: 'pro', model: 'claude-sonnet-pro' },
  fast: { providerId: 'fast', model: 'gpt-flash-fast' },
  mini: { providerId: 'fast', model: 'mini-model' },
};

describe('llm/router — TaskRouter (V0.4-M2)', () => {
  const router = new TaskRouter({ providers, tierModel });

  it('routes an implementation task to the pro tier model', () => {
    const r = router.resolve({ task: '请实现一个用户登录功能' });
    expect(r.category).toBe('implementation');
    expect(r.model).toBe('claude-sonnet-pro');
    expect(r.preset.agentPreset).toBe('developer');
    expect(r.explicit).toBe(false);
  });

  it('routes a search task to the fast tier model', () => {
    const r = router.resolve({ task: '搜索 needle 在哪些文件被调用' });
    expect(r.category).toBe('search');
    expect(r.model).toBe('gpt-flash-fast');
    expect(r.preset.agentPreset).toBe('explorer');
  });

  it('routes a review task to an independent reviewer preset', () => {
    const r = router.resolve({ task: 'code review my diff' });
    expect(r.category).toBe('review');
    expect(r.preset.agentPreset).toBe('reviewer');
  });

  it('explicit hints always win over category inference (backward compatible)', () => {
    const r = router.resolve({ task: '请实现一个用户登录功能', provider: 'fast', model: 'gpt-flash-fast' });
    expect(r.explicit).toBe(true);
    expect(r.provider.id).toBe('fast');
    expect(r.model).toBe('gpt-flash-fast');
  });

  it('explicit provider only (model from tier binding of the hinted provider)', () => {
    // explicit provider but no model: model resolves from the tier binding of the category preset
    const r = router.resolve({ task: '搜索 x', provider: 'pro' });
    expect(r.provider.id).toBe('pro');
    expect(r.explicit).toBe(true);
  });

  it('unknown task falls back to the default (unknown → pro) preset', () => {
    const r = router.resolve({ task: 'hello there' });
    expect(r.category).toBe('unknown');
    expect(r.model).toBe('claude-sonnet-pro');
  });

  it('throws on an unknown explicit provider', () => {
    expect(() => router.resolve({ task: 'x', provider: 'nope' })).toThrow(/unknown provider/);
  });

  it('supports explicit category override (skips classifier)', () => {
    const r = router.resolve({ category: 'simple_fix' as TaskCategory, model: 'm' });
    expect(r.category).toBe('simple_fix');
    expect(r.model).toBe('m');
  });

  it('preset table is data — every non-unknown category has a preset', () => {
    for (const c of ['implementation', 'simple_fix', 'search', 'review', 'planning', 'architecture'] as TaskCategory[]) {
      expect(DEFAULT_PRESETS[c]?.modelTier).toBeDefined();
    }
  });

  it('custom classifier can be injected', () => {
    const r = new TaskRouter({
      providers,
      tierModel,
      classify: () => 'review' as TaskCategory,
    }).resolve({ task: 'anything' });
    expect(r.category).toBe('review');
  });

  it('classifyTask is deterministic and exported for offline tests', () => {
    expect(classifyTask('写一个新功能')).toBe('implementation');
  });
});
