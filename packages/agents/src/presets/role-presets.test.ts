import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatProvider, PolicyArtifacts, ToolSpec } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { PresetRegistry, PresetValidationError } from './registry.js';
import { DEFAULT_MODEL_TIER, type AgentPreset } from './types.js';
import {
  DEFAULT_AGENT_PRESETS,
  DEFAULT_DEVELOPER_PRESET,
  DEFAULT_LEAD_PRESET,
  DEFAULT_REVIEWER_PRESET,
  DEVELOPER_PRESET_ID,
  LEAD_PRESET_ID,
  REVIEWER_PRESET_ID,
  createDefaultPresetRegistry,
  seedDefaultPresets,
} from './defaults.js';
import { applyPresetToolFace, policyProfileForPreset, presetCapabilityDirective, SUBAGENT_TOOL_NAME } from './capabilities.js';
import { SubagentManager } from '../subagent/SubagentManager.js';

const POLICY_YAML = `
policy:
  version: 1
  profile: workspace-write
  approval: never
  filesystem:
    protected: ['.git', '.git/**']
  shell:
    deny: ['destructive-delete']
  tools:
    deny: []
  guidance:
    - 只调用显式允许的工具
`;

function artifacts(): PolicyArtifacts {
  return compilePolicyYaml(POLICY_YAML);
}

/** 合成候选工具面：覆盖 read / file_write / exec / other 各权限档。 */
function candidateTools(): ToolSpec[] {
  const read: ToolSpec = { name: 'Read', description: 'read', family: 'file_read', requiredPermission: 'read', exclusive: false, inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) };
  const glob: ToolSpec = { name: 'Glob', description: 'glob', family: 'search', requiredPermission: 'read', exclusive: false, inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) };
  const write: ToolSpec = { name: 'Write', description: 'write', family: 'file_write', requiredPermission: 'workspace-write', exclusive: true, inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) };
  const shell: ToolSpec = { name: 'Shell', description: 'shell', family: 'exec', requiredPermission: 'danger-full-access', exclusive: true, inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) };
  const subagent: ToolSpec = { name: SUBAGENT_TOOL_NAME, description: 'delegate', family: 'other', requiredPermission: 'workspace-write', exclusive: false, inputSchema: { type: 'object', properties: {} }, execute: async () => ({ content: '', meta: {} }) };
  return [read, glob, write, shell, subagent];
}

describe('agents/presets — Lead/Developer/Reviewer 默认实例 + 能力映射 (task 055)', () => {
  it('§8.1 语义锚定：lead=orchestrator/pro/canDelegate，developer=generator/pro|write，reviewer=evaluator/review/no-write', () => {
    const registry = createDefaultPresetRegistry();
    expect(registry.ids()).toEqual([LEAD_PRESET_ID, DEVELOPER_PRESET_ID, REVIEWER_PRESET_ID]);

    const lead = registry.getPreset('lead');
    expect(lead.role).toBe('orchestrator');
    expect(lead.modelTier).toBe('pro');
    expect(lead.canDelegate).toBe(true);
    expect(lead.write).toBeUndefined(); // 未声明 = 继承运行时默认

    const developer = registry.getPreset('developer');
    expect(developer.role).toBe('generator');
    expect(developer.modelTier).toBe('pro'); // 默认档 pro；056 路由可按任务复杂度选 fast（§8.3）
    expect(developer.write).toBe(true);

    const reviewer = registry.getPreset('reviewer');
    expect(reviewer.role).toBe('evaluator');
    expect(reviewer.modelTier).toBe('review');
    expect(reviewer.write).toBe(false); // 强只读
    expect(reviewer.canDelegate).toBeUndefined(); // 未声明；只读面下 Subagent 工具本就被剔除
  });

  it('默认集实例形状：id/role/modelTier/description 齐备，规范化为冻结可序列化数据', () => {
    expect(DEFAULT_AGENT_PRESETS).toHaveLength(3);
    for (const p of DEFAULT_AGENT_PRESETS) {
      expect(p.id.length).toBeGreaterThan(0);
      expect(p.role).toBeTruthy();
      expect(p.modelTier).toBeTruthy();
    }
    const registry = createDefaultPresetRegistry();
    for (const p of registry.listPresets()) {
      expect(Object.isFrozen(p)).toBe(true);
    }
    expect(JSON.parse(JSON.stringify(registry.listPresets()))).toEqual(registry.listPresets());
  });

  it('归一化默认实例与注册表 get 结果一致；重复注册默认 id 抛 PresetValidationError', () => {
    const registry = createDefaultPresetRegistry();
    expect(registry.getPreset('lead')).toEqual(DEFAULT_LEAD_PRESET);
    expect(registry.getPreset('developer')).toEqual(DEFAULT_DEVELOPER_PRESET);
    expect(registry.getPreset('reviewer')).toEqual(DEFAULT_REVIEWER_PRESET);
    expect(DEFAULT_LEAD_PRESET).toEqual({
      id: 'lead',
      role: 'orchestrator',
      modelTier: 'pro',
      canDelegate: true,
      description: expect.any(String),
    });
    expect(() => registry.registerPreset({ id: 'lead', role: 'generator' })).toThrowError(PresetValidationError);
    expect(() => seedDefaultPresets(registry)).toThrowError(/already registered/);
  });

  it('seedDefaultPresets 把默认集播种进既有 registry（插入序）', () => {
    const registry = new PresetRegistry([{ id: 'planner', role: 'orchestrator', modelTier: 'mini' }]);
    seedDefaultPresets(registry);
    expect(registry.ids()).toEqual(['planner', 'lead', 'developer', 'reviewer']);
    expect(registry.size).toBe(4);
  });

  it('能力映射：reviewer 的 write:false 把候选面收窄到 read 权限工具（剔除 file_write/exec/Subagent）', () => {
    const reviewer = createDefaultPresetRegistry().getPreset('reviewer');
    const face = applyPresetToolFace(reviewer, candidateTools());
    expect(face.map((t) => t.name).sort()).toEqual(['Glob', 'Read']);
    // 显式意图提取
    const d = presetCapabilityDirective(reviewer);
    expect(d.readOnly).toBe(true);
    expect(d.delegateForbidden).toBe(false); // canDelegate 未声明
  });

  it('能力映射：tools allow-list shrink-only（不放大），canDelegate:false 剔除 Subagent 工具', () => {
    const custom = new PresetRegistry().registerPreset({ id: 'x', role: 'orchestrator', tools: ['Read', 'Glob'], canDelegate: false, write: true });
    const face = applyPresetToolFace(custom, candidateTools());
    // write:true 不过滤权限；allow-list 只留 Read/Glob；canDelegate:false 再剔除 Subagent（本就不在名单内）
    expect(face.map((t) => t.name).sort()).toEqual(['Glob', 'Read']);

    // allow-list 不含 Subagent 时即使 canDelegate:true 也不会放大出 Subagent
    const noDelegate = new PresetRegistry().registerPreset({ id: 'y', role: 'generator', canDelegate: false, write: true });
    const face2 = applyPresetToolFace(noDelegate, candidateTools());
    expect(face2.map((t) => t.name)).not.toContain(SUBAGENT_TOOL_NAME);
    // canDelegate:false 但保留写权限（write 未声明 false → 不施加只读过滤）
    expect(face2.map((t) => t.name)).toContain('Write');
  });

  it('能力映射：空 tools allow-list 把可见面收空；policyProfileForPreset 只在 write:false 降档 read-only', () => {
    const empty = new PresetRegistry().registerPreset({ id: 'z', role: 'evaluator', tools: [] });
    expect(applyPresetToolFace(empty, candidateTools())).toEqual([]);

    const registry = createDefaultPresetRegistry();
    expect(policyProfileForPreset(registry.getPreset('reviewer'))).toBe('read-only');
    expect(policyProfileForPreset(registry.getPreset('developer'))).toBeUndefined();
    expect(policyProfileForPreset(registry.getPreset('lead'))).toBeUndefined();
  });

  it('lead 默认面不做权限过滤：applyPresetToolFace 对未声明 write 的 lead 不缩权限（allow-list 未声明）', () => {
    const lead = createDefaultPresetRegistry().getPreset('lead');
    expect(presetCapabilityDirective(lead).readOnly).toBe(false);
    const face = applyPresetToolFace(lead, candidateTools());
    expect(face.map((t) => t.name).sort()).toEqual(['Glob', 'Read', 'Shell', 'Subagent', 'Write']);
  });
});

describe('agents/presets — 能力映射接线到 SubagentManager.delegate（委派时按角色面收窄子工具）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-preset-role-'));
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  function writeToolSpec(): ToolSpec {
    return {
      name: 'Write',
      description: 'write a file',
      family: 'file_write',
      requiredPermission: 'workspace-write',
      exclusive: true,
      inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      async execute(args, ctx) {
        const p = path.join(ctx.workspaceRoot, String(args.path ?? 'out.txt'));
        fs.writeFileSync(p, String(args.content ?? ''), 'utf8');
        return { content: `wrote ${path.relative(ctx.workspaceRoot, p)}`, meta: {} };
      },
    };
  }

  it('presetLookup 解析 reviewer：子代理先尝试 Write 后收窄到 unknown tool（只读面落地）', async () => {
    const registry = createDefaultPresetRegistry();
    const bus = new EventBus();
    const provider: ChatProvider = new MockProvider(
      [
        { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'out.txt', content: 'X' } }] } },
        { when: /.*/, minToolResults: 1, response: { text: 'REVIEW-DONE' } },
      ],
      { model: 'child-model' },
    );
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider,
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [writeToolSpec()],
      bus,
      presetLookup: (id) => registry.hasPreset(id) ? registry.getPreset(id) : undefined,
    });
    const result = await manager.delegate({ prompt: '审查（只读面）', preset: 'reviewer', delegationDepth: 0 });
    expect(result.stopReason).toBe('completed');
    // 子代理的 Write 工具被 reviewer 只读面剔除：Write 调用落到 unknown tool，文件不会被创建
    expect(fs.existsSync(path.join(workspace, 'out.txt'))).toBe(false);
  });

  it('presetLookup 解析 developer：write:true 不缩权限，子代理 Write 正常执行', async () => {
    const registry = createDefaultPresetRegistry();
    const bus = new EventBus();
    const provider: ChatProvider = new MockProvider(
      [
        { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'gen.txt', content: 'GEN' } }] } },
        { when: /.*/, minToolResults: 1, response: { text: 'GEN-DONE' } },
      ],
      { model: 'child-model' },
    );
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider,
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [writeToolSpec()],
      bus,
      presetLookup: (id) => registry.hasPreset(id) ? registry.getPreset(id) : undefined,
    });
    const result = await manager.delegate({ prompt: '实现（可写面）', preset: 'developer', delegationDepth: 0 });
    expect(result.stopReason).toBe('completed');
    expect(fs.existsSync(path.join(workspace, 'gen.txt'))).toBe(true);
  });

  it('presetLookup 缺省（未注入）：preset 仍只是标签，子工具面不被 preset 收窄（既有行为兼容）', async () => {
    const bus = new EventBus();
    const provider: ChatProvider = new MockProvider(
      [
        { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'legacy.txt', content: 'L' } }] } },
        { when: /.*/, minToolResults: 1, response: { text: 'LEGACY-DONE' } },
      ],
      { model: 'child-model' },
    );
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider,
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [writeToolSpec()],
      bus,
      // 不注入 presetLookup → 子工具面 = 父面（Write 保留）
    });
    const result = await manager.delegate({ prompt: '写文件', preset: 'reviewer', delegationDepth: 0 });
    expect(result.stopReason).toBe('completed');
    expect(fs.existsSync(path.join(workspace, 'legacy.txt'))).toBe(true);
  });

  it('presetLookup 未命中（非注册 preset 标签）→ 视为标签透传，不收窄（未知标签不改行为）', async () => {
    const registry = createDefaultPresetRegistry();
    const bus = new EventBus();
    const provider: ChatProvider = new MockProvider(
      [
        { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'ghost.txt', content: 'G' } }] } },
        { when: /.*/, minToolResults: 1, response: { text: 'GHOST-DONE' } },
      ],
      { model: 'child-model' },
    );
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider,
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [writeToolSpec()],
      bus,
      presetLookup: (id) => registry.hasPreset(id) ? registry.getPreset(id) : undefined,
    });
    const result = await manager.delegate({ prompt: '写文件', preset: 'explorer', delegationDepth: 0 });
    expect(result.stopReason).toBe('completed');
    expect(fs.existsSync(path.join(workspace, 'ghost.txt'))).toBe(true);
  });
});

describe('agents/presets — defaults 直接使用', () => {
  it('DEFAULT_AGENT_PRESETS 与 §8.1 顺序一致且每个都能通过 validate（registry 往返）', () => {
    const registry = new PresetRegistry(DEFAULT_AGENT_PRESETS);
    expect(registry.ids()).toEqual([LEAD_PRESET_ID, DEVELOPER_PRESET_ID, REVIEWER_PRESET_ID]);
    const lead: AgentPreset = registry.getPreset('lead');
    expect(lead.modelTier).toBe(DEFAULT_MODEL_TIER); // pro 兜底一致
    expect(lead.role).toBe('orchestrator');
  });
});
