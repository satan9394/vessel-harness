import { describe, it, expect } from 'vitest';
import {
  normalizePreset,
  validatePreset,
  PresetRegistry,
  PresetValidationError,
  PresetNotFoundError,
} from './registry.js';
import { DEFAULT_MODEL_TIER, type AgentPreset, type AgentPresetInput } from './types.js';

describe('agents/presets — AgentPreset schema & registry (task 054)', () => {
  it('normalizePreset applies the default shape: modelTier=pro, optional flags omitted', () => {
    const p = normalizePreset({ id: 'lead', role: 'orchestrator' });
    expect(p).toEqual({ id: 'lead', role: 'orchestrator', modelTier: DEFAULT_MODEL_TIER });
    // 未声明字段不落键：下游可区分「未指定」与「false」
    expect(p.tools).toBeUndefined();
    expect(p.write).toBeUndefined();
    expect(p.canDelegate).toBeUndefined();
  });

  it('registry: register → get round-trips fields, including explicit false', () => {
    const registry = new PresetRegistry();
    const registered = registry.registerPreset({
      id: 'reviewer',
      role: 'evaluator',
      modelTier: 'review',
      write: false,
      description: '独立评审：只读证据面',
    });
    expect(registered).toEqual(registry.getPreset('reviewer'));
    expect(registered.write).toBe(false); // 显式 false 不被默认值吞掉
    expect(registered.canDelegate).toBeUndefined();
    expect(registry.hasPreset('reviewer')).toBe(true);
    expect(registry.size).toBe(1);
  });

  it('registry: seed constructor registers several presets in insertion order', () => {
    const registry = new PresetRegistry([
      { id: 'lead', role: 'orchestrator', canDelegate: true },
      { id: 'developer', role: 'generator', write: true },
      { id: 'reviewer', role: 'evaluator', write: false },
    ]);
    expect(registry.listPresets().map((p) => p.id)).toEqual(['lead', 'developer', 'reviewer']);
    expect(registry.ids()).toEqual(['lead', 'developer', 'reviewer']);
    expect(registry.size).toBe(3);
  });

  it('getPreset on an unknown id throws PresetNotFoundError bearing id + registered hint', () => {
    const registry = new PresetRegistry([{ id: 'lead', role: 'orchestrator' }]);
    let err: unknown;
    try {
      registry.getPreset('ghost');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PresetNotFoundError);
    const nf = err as PresetNotFoundError;
    expect(nf.presetId).toBe('ghost');
    expect(nf.message).toContain('ghost');
    expect(nf.message).toContain('lead'); // 给出已注册提示
  });

  it('getPreset on an empty registry explains that nothing is registered', () => {
    const registry = new PresetRegistry();
    expect(() => registry.getPreset('lead')).toThrowError(/no presets registered/);
  });

  it('validation rejects an unknown role with an id-bearing error', () => {
    let caught: unknown;
    try {
      validatePreset({ id: 'dev', role: 'writer' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PresetValidationError);
    const v = caught as PresetValidationError;
    expect(v.presetId).toBe('dev');
    expect(v.message).toContain('"dev"');
    expect(v.issues.join('; ')).toContain('role');
    // registerPreset 走同一校验，错误同样带 id（绕过类型检查构造非法入参）
    expect(() =>
      new PresetRegistry().registerPreset({ id: 'dev', role: 'writer' } as unknown as AgentPresetInput),
    ).toThrowError(/dev/);
  });

  it('validation rejects malformed id / modelTier / tools / booleans / unknown fields', () => {
    const bad: unknown[] = [
      { id: '', role: 'generator' },
      { id: '  ', role: 'generator' },
      { id: 'lead dev', role: 'generator' },
      { id: 'x'.repeat(65), role: 'generator' },
      { id: 42, role: 'generator' },
      { id: 'dev', role: 'generator', modelTier: '' },
      { id: 'dev', role: 'generator', modelTier: 'pro fast' },
      { id: 'dev', role: 'generator', tools: 'read' }, // 非数组
      { id: 'dev', role: 'generator', tools: [42] },
      { id: 'dev', role: 'generator', tools: [''] },
      { id: 'dev', role: 'generator', tools: ['read', 'read'] }, // 重复
      { id: 'dev', role: 'generator', write: 'yes' },
      { id: 'dev', role: 'generator', canDelegate: 1 },
      { id: 'dev', role: 'generator', description: 7 },
      // snake_case 字段（§8.1 yaml 写法）→ fail loud，防静默失效
      { id: 'dev', role: 'generator', model_tier: 'pro', can_delegate: true },
      null,
      'lead',
    ];
    for (const b of bad) {
      expect(() => validatePreset(b)).toThrowError(PresetValidationError);
    }
  });

  it('rejects duplicate registration with an id-bearing conflict error', () => {
    const registry = new PresetRegistry();
    registry.registerPreset({ id: 'lead', role: 'orchestrator' });
    let caught: unknown;
    try {
      registry.registerPreset({ id: 'lead', role: 'generator' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PresetValidationError);
    expect((caught as PresetValidationError).presetId).toBe('lead');
    expect((caught as PresetValidationError).message).toContain('already registered');
  });

  it('§8.1 semantics: lead=orchestrator/canDelegate, developer=generator/write, reviewer=evaluator/no-write', () => {
    const registry = new PresetRegistry([
      { id: 'lead', role: 'orchestrator', modelTier: 'pro', canDelegate: true, description: '编排：pro + 可委派' },
      { id: 'developer', role: 'generator', modelTier: 'pro', write: true },
      { id: 'reviewer', role: 'evaluator', modelTier: 'review', write: false },
    ]);
    const lead = registry.getPreset('lead');
    expect(lead.role).toBe('orchestrator');
    expect(lead.modelTier).toBe('pro');
    expect(lead.canDelegate).toBe(true);
    const developer = registry.getPreset('developer');
    expect(developer.role).toBe('generator');
    expect(developer.write).toBe(true);
    const reviewer = registry.getPreset('reviewer');
    expect(reviewer.role).toBe('evaluator');
    expect(reviewer.write).toBe(false);
    expect(reviewer.modelTier).toBe('review');
    // 未声明字段保持缺省（映射点留给接线层按运行时默认处理）
    expect(developer.canDelegate).toBeUndefined();
    expect(reviewer.canDelegate).toBeUndefined();
  });

  it('registered presets are frozen plain serializable data (JSON round-trip)', () => {
    const registry = new PresetRegistry([
      { id: 'lead', role: 'orchestrator', tools: ['Read', 'Write'], canDelegate: true },
    ]);
    const preset = registry.getPreset('lead');
    expect(Object.isFrozen(preset)).toBe(true);
    expect(Object.isFrozen(preset.tools)).toBe(true);
    const snapshot = JSON.parse(JSON.stringify(registry.listPresets())) as AgentPreset[];
    expect(snapshot).toEqual([
      { id: 'lead', role: 'orchestrator', modelTier: 'pro', tools: ['Read', 'Write'], canDelegate: true },
    ]);
  });

  it('accepts empty tools allow-list and a custom modelTier (open tier vocabulary)', () => {
    const input: AgentPresetInput = { id: 'planner', role: 'orchestrator', modelTier: 'mini', tools: [] };
    const registry = new PresetRegistry([input]);
    expect(registry.getPreset('planner')).toEqual({ id: 'planner', role: 'orchestrator', modelTier: 'mini', tools: [] });
  });
});
