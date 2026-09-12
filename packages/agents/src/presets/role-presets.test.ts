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
import {
  applyPresetToolFace,
  applyStrictestPresetFace,
  policyProfileForPreset,
  presetCapabilityDirective,
  STRICTEST_PRESET_FACE,
  SUBAGENT_TOOL_NAME,
} from './capabilities.js';
import { resolveDelegationPresetFace, SubagentManager } from '../subagent/SubagentManager.js';

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

  /** read 权限工具 —— 用来区分「收窄到最严格面（只读）」与「把面清空」。 */
  function readToolSpec(): ToolSpec {
    return {
      name: 'Read',
      description: 'read a file',
      family: 'file_read',
      requiredPermission: 'read',
      exclusive: false,
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      async execute(args, ctx) {
        const p = path.join(ctx.workspaceRoot, String(args.path ?? ''));
        return { content: fs.readFileSync(p, 'utf8'), meta: {} };
      },
    };
  }

  /** 收窄降级告警的记录器（注入 onWarn，保持测试输出干净并断言「降级不静默」）。 */
  function warnTape(): { warnings: string[]; onWarn: (m: string) => void } {
    const warnings: string[] = [];
    return { warnings, onWarn: (m: string) => warnings.push(m) };
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
    // 负对照：命中注册 preset ⇒ 收窄如实应用（新增可见状态位，行为不变）
    expect(result.presetNarrowing).toBe('applied');
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
    // 负对照：全权（write:true）角色不被「一律只读」压坏
    expect(result.presetNarrowing).toBe('applied');
  });

  it('BRIEF 判别性①：声明了 preset 但 presetLookup 未接线 → 收窄到最严格面（只读）+ 可见状态/warn，绝不落到全量面', async () => {
    const bus = new EventBus();
    const warn = warnTape();
    // 子代理先 Read（只读面应保留）再 Write（只读面应剔除），最后收敛成文本
    const provider: ChatProvider = new MockProvider(
      [
        { when: /.*/, maxToolResults: 0, response: { toolCalls: [{ name: 'Read', arguments: { path: 'data.txt' } }] } },
        { when: /.*/, minToolResults: 1, maxToolResults: 1, response: { toolCalls: [{ name: 'Write', arguments: { path: 'legacy.txt', content: 'L' } }] } },
        { when: /.*/, minToolResults: 2, response: { text: 'FALLBACK-DONE' } },
      ],
      { model: 'child-model' },
    );
    fs.writeFileSync(path.join(workspace, 'data.txt'), 'READ-OK-1', 'utf8');
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider,
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [readToolSpec(), writeToolSpec()],
      bus,
      onWarn: warn.onWarn,
      // 不注入 presetLookup —— 旧实现：声明了 preset 也当标签透传 ⇒ 子代理拿到 Write（fail-open）
    });
    const result = await manager.delegate({ prompt: '写文件', preset: 'reviewer', delegationDepth: 0 });

    expect(result.stopReason).toBe('completed');
    // 旧实现在此写盘成功（legacy.txt 存在）⇒ 本断言是判别性的
    expect(fs.existsSync(path.join(workspace, 'legacy.txt'))).toBe(false);
    // 只读面 ≠ 空面：read 权限工具仍在（Read 真跑通、文件内容进了子会话记录），写工具已被剔除
    const childLog = fs.readFileSync(path.join(workspace, '.harness', 'sessions', result.childSessionId, 'session.jsonl'), 'utf8');
    expect(childLog).toContain('READ-OK-1');
    expect(childLog).toContain('unknown tool: Write');
    // 状态/原因可见（调用方消费面）：状态位 + diagnostic + warn 三处都留痕
    expect(result.presetNarrowing).toBe('strictest-fallback');
    expect(result.diagnostic).toContain('preset "reviewer"');
    expect(result.diagnostic).toContain('未接线 presetLookup');
    expect(warn.warnings).toHaveLength(1);
    expect(warn.warnings[0]).toContain('preset "reviewer"');
    expect(warn.warnings[0]).toContain('最严格面');
  });

  it('BRIEF 判别性②：presetLookup 已接线但未命中（未注册名）→ 拒绝委派，不产生子会话、不落到全量面', async () => {
    const registry = createDefaultPresetRegistry();
    const bus = new EventBus();
    const warn = warnTape();
    const started: string[] = [];
    bus.on('subagent_start', (p) => { started.push((p as { childSessionId: string }).childSessionId); });
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
      onWarn: warn.onWarn,
      // registry.getPreset 语义：未注册即抛（带已注册列表）—— 解析失败必须 fail-closed
      presetLookup: (id) => registry.getPreset(id),
    });
    const result = await manager.delegate({ prompt: '写文件', preset: 'explorer', delegationDepth: 0 });

    expect(result.stopReason).toBe('denied');
    expect(result.isError).toBe(true);
    expect(result.presetNarrowing).toBe('denied-unresolved');
    expect(result.diagnostic).toContain('unknown agent preset "explorer"');
    expect(result.diagnostic).toContain('registered presets: lead, developer, reviewer');
    // 拒绝发生在任何子会话之前：没有 child session、没有 subagent_start、盘上无改动
    expect(result.childSessionId).toBe('');
    expect(started).toEqual([]);
    expect(fs.existsSync(path.join(workspace, 'ghost.txt'))).toBe(false);
    // 拒绝是「显式失败」，不是静默降级 ⇒ 不产生 warn（warn 专用于兜底面）
    expect(warn.warnings).toEqual([]);
  });

  it('BRIEF 判别性②b：presetLookup 未命中返回 undefined（非抛错形状）→ 同样拒绝（两条未命中路径都 fail-closed）', async () => {
    const registry = createDefaultPresetRegistry();
    const bus = new EventBus();
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider: new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'NEVER' } }], { model: 'child-model' }),
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [writeToolSpec()],
      bus,
      onWarn: () => {},
      presetLookup: (id) => (registry.hasPreset(id) ? registry.getPreset(id) : undefined),
    });
    const result = await manager.delegate({ prompt: '写文件', preset: 'explorer', delegationDepth: 0 });
    expect(result.stopReason).toBe('denied');
    expect(result.presetNarrowing).toBe('denied-unresolved');
    expect(result.diagnostic).toContain('unknown agent preset "explorer"');
  });

  it('BRIEF 判别性③：空白 preset 字符串也是「声明」→ 拒绝（不作为「未声明」放行全量面）', async () => {
    const registry = createDefaultPresetRegistry();
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider: new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'NEVER' } }], { model: 'child-model' }),
      model: 'child-model',
      policyArtifacts: artifacts(),
      tools: [writeToolSpec()],
      bus: new EventBus(),
      onWarn: () => {},
      presetLookup: (id) => registry.getPreset(id),
    });
    const result = await manager.delegate({ prompt: '写文件', preset: '   ', delegationDepth: 0 });
    expect(result.stopReason).toBe('denied');
    expect(result.presetNarrowing).toBe('denied-unresolved');
    expect(result.diagnostic).toContain('unknown agent preset');
  });

  it('负对照③：完全未声明 preset → 子代理继承父代理工具面（shrink-only），状态 none、无告警（正常用法不变）', async () => {
    const bus = new EventBus();
    const warn = warnTape();
    const provider: ChatProvider = new MockProvider(
      [
        { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'inherit.txt', content: 'I' } }] } },
        { when: /.*/, minToolResults: 1, response: { text: 'INHERIT-DONE' } },
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
      onWarn: warn.onWarn,
    });
    const result = await manager.delegate({ prompt: '写文件', delegationDepth: 0 });
    expect(result.stopReason).toBe('completed');
    expect(fs.existsSync(path.join(workspace, 'inherit.txt'))).toBe(true);
    expect(result.presetNarrowing).toBe('none');
    expect(result.diagnostic).toBeUndefined();
    expect(warn.warnings).toEqual([]);
  });
});

describe('agents/presets — preset 声明的 fail-closed 裁决（resolveDelegationPresetFace / 最严格面）', () => {
  it('未声明 preset → unclaimed（唯一允许继承父代理面的分支）', () => {
    const d = resolveDelegationPresetFace(undefined, undefined);
    expect(d).toEqual({ kind: 'unclaimed' });
    // 即使查找器已接线，未声明也仍是 unclaimed
    expect(resolveDelegationPresetFace(undefined, (id) => createDefaultPresetRegistry().getPreset(id))).toEqual({ kind: 'unclaimed' });
  });

  it('声明了 preset 但查找器未接线 → strictest-fallback（带可读 reason），绝不 unclaimed', () => {
    const d = resolveDelegationPresetFace('reviewer', undefined);
    expect(d.kind).toBe('strictest-fallback');
    if (d.kind !== 'strictest-fallback') throw new Error('unreachable');
    expect(d.presetId).toBe('reviewer');
    expect(d.reason).toContain('未接线 presetLookup');
    expect(d.reason).toContain('最严格面');
  });

  it('声明了 preset + 查找器命中 → applied（携带解析出的 preset）', () => {
    const registry = createDefaultPresetRegistry();
    const d = resolveDelegationPresetFace('reviewer', (id) => registry.getPreset(id));
    expect(d.kind).toBe('applied');
    if (d.kind !== 'applied') throw new Error('unreachable');
    expect(d.preset.id).toBe('reviewer');
    expect(d.preset.write).toBe(false);
  });

  it('声明了 preset + 查找器未命中（返回 undefined / 抛错）→ 两种形状都判 unresolved', () => {
    const registry = createDefaultPresetRegistry();
    const missUndefined = resolveDelegationPresetFace('ghost', (id) => (registry.hasPreset(id) ? registry.getPreset(id) : undefined));
    expect(missUndefined.kind).toBe('unresolved');
    expect(missUndefined.kind === 'unresolved' && missUndefined.reason).toContain('unknown agent preset "ghost"');

    const missThrow = resolveDelegationPresetFace('ghost', (id) => registry.getPreset(id));
    expect(missThrow.kind).toBe('unresolved');
    // 抛错形状保留原错误（含已注册列表），便于调用方自愈
    expect(missThrow.kind === 'unresolved' && missThrow.reason).toContain('registered presets: lead, developer, reviewer');
  });

  it('最严格面 = reviewer 只读面（复用既有映射，不新造工具面定义）且严格窄于全权面', () => {
    const tools = candidateTools();
    const reviewer = createDefaultPresetRegistry().getPreset('reviewer');
    const strictest = applyStrictestPresetFace(tools);
    expect(strictest.map((t) => t.name).sort()).toEqual(applyPresetToolFace(reviewer, tools).map((t) => t.name).sort());
    expect(strictest.map((t) => t.name).sort()).toEqual(['Glob', 'Read']);
    // 最严格面不放大：Write/Shell/Subagent 都被剔除
    expect(strictest.map((t) => t.name)).not.toContain('Write');
    expect(strictest.map((t) => t.name)).not.toContain('Shell');
    expect(strictest.map((t) => t.name)).not.toContain(SUBAGENT_TOOL_NAME);
    // 具名兜底面自身即 write:false + canDelegate:false（可审计的常量）
    expect(STRICTEST_PRESET_FACE.write).toBe(false);
    expect(STRICTEST_PRESET_FACE.canDelegate).toBe(false);
    expect(policyProfileForPreset(STRICTEST_PRESET_FACE)).toBe('read-only');
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
