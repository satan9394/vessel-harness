import { describe, it, expect } from 'vitest';
import { createDefaultPresetRegistry } from '../presets/defaults.js';
import { PresetRegistry } from '../presets/registry.js';
import { composeRosterFromRoute, normalizeRoster, phaseForPresetId, phaseForRole, resolveRoster } from './roster.js';

function registry(): PresetRegistry {
  return createDefaultPresetRegistry();
}

describe('agents/team — roster 组合纯函数（057）', () => {
  it('phaseForRole 把 preset 判别映射到阶段节拍（orchestrator→orchestrate / generator→generate / evaluator→evaluate）', () => {
    expect(phaseForRole('orchestrator')).toBe('orchestrate');
    expect(phaseForRole('generator')).toBe('generate');
    expect(phaseForRole('evaluator')).toBe('evaluate');
    const reg = registry();
    expect(phaseForPresetId('lead', reg)).toBe('orchestrate');
    expect(phaseForPresetId('developer', reg)).toBe('generate');
    expect(phaseForPresetId('reviewer', reg)).toBe('evaluate');
  });

  it('route → roster：按 §8.2 复杂度三档组合（小 1 / 中 2 / 复杂 3），roleModels 携带模型解析', () => {
    const reg = registry();
    const small = composeRosterFromRoute(
      {
        complexity: 'small',
        roles: ['developer'],
        roleModels: [{ role: 'developer', tier: 'fast', providerId: 'fast', model: 'fast-model' }],
      },
      reg,
    );
    expect(small.map((m) => m.presetId)).toEqual(['developer']);
    expect(small[0]).toMatchObject({ memberId: 'developer', model: 'fast-model', providerId: 'fast', tier: 'fast' });

    const medium = composeRosterFromRoute(
      {
        complexity: 'medium',
        roles: ['developer', 'reviewer'],
        roleModels: [
          { role: 'developer', tier: 'pro', providerId: 'pro', model: 'pro-model' },
          { role: 'reviewer', tier: 'review', providerId: 'review', model: 'review-model' },
        ],
      },
      reg,
    );
    expect(medium.map((m) => m.presetId)).toEqual(['developer', 'reviewer']);
    expect(medium[1]).toMatchObject({ memberId: 'reviewer', model: 'review-model', providerId: 'review' });

    const complex = composeRosterFromRoute(
      {
        complexity: 'complex',
        roles: ['lead', 'developer', 'reviewer'],
        roleModels: [
          { role: 'lead', tier: 'pro', providerId: 'pro', model: 'pro-model' },
          { role: 'developer', tier: 'pro', providerId: 'pro', model: 'pro-model' },
          { role: 'reviewer', tier: 'review', providerId: 'review', model: 'review-model' },
        ],
      },
      reg,
    );
    expect(complex.map((m) => m.presetId)).toEqual(['lead', 'developer', 'reviewer']);
  });

  it('route 引用未知 preset 时 fail loud（PresetNotFoundError 带 id + 已注册列表）', () => {
    const reg = registry();
    expect(() =>
      composeRosterFromRoute(
        { roles: ['ghost'], roleModels: [{ role: 'ghost', model: 'm', providerId: 'p' }] },
        reg,
      ),
    ).toThrow(/unknown agent preset "ghost"/);
  });

  it('route.roles 与 roleModels 长度不一致或缺 model/providerId 时 fail loud（带指引）', () => {
    const reg = registry();
    expect(() => composeRosterFromRoute({ roles: ['developer'], roleModels: [] }, reg)).toThrow(/must align/);
    expect(() =>
      composeRosterFromRoute(
        { roles: ['developer'], roleModels: [{ role: 'developer', tier: 'pro' }] },
        reg,
      ),
    ).toThrow(/no resolved model\/providerId/);
    expect(() => composeRosterFromRoute({ roles: [], roleModels: [] }, reg)).toThrow(/roles is empty/);
  });

  it('normalizeRoster：memberId 缺省补 presetId；重复/空阵容/空字段 fail loud', () => {
    const rows = normalizeRoster([{ presetId: 'developer', model: 'm', providerId: 'p' }]);
    expect(rows[0]?.memberId).toBe('developer');
    expect(() => normalizeRoster([])).toThrow(/roster is empty/);
    expect(() =>
      normalizeRoster([
        { presetId: 'developer', memberId: 'x', model: 'm', providerId: 'p' },
        { presetId: 'reviewer', memberId: 'x', model: 'm', providerId: 'p' },
      ]),
    ).toThrow(/duplicate memberId "x"/);
    expect(() => normalizeRoster([{ presetId: '', model: 'm', providerId: 'p' }])).toThrow(/presetId/);
    expect(() => normalizeRoster([{ presetId: 'developer', model: '', providerId: 'p' }])).toThrow(/model \+ providerId/);
  });

  it('resolveRoster：校验 + 解析 preset/role/phase（未知 preset 抛错），产出与输入同序', () => {
    const reg = registry();
    const resolved = resolveRoster(
      [
        { presetId: 'lead', model: 'm1', providerId: 'p1' },
        { presetId: 'developer', model: 'm2', providerId: 'p2', tier: 'fast' },
      ],
      reg,
    );
    expect(resolved.map((r) => r.memberId)).toEqual(['lead', 'developer']);
    expect(resolved[0]).toMatchObject({ role: 'orchestrator', phase: 'orchestrate' });
    expect(resolved[1]).toMatchObject({ role: 'generator', phase: 'generate', tier: 'fast' });
    expect(() => resolveRoster([{ presetId: 'ghost', model: 'm', providerId: 'p' }], reg)).toThrow(/unknown agent preset "ghost"/);
  });
});
