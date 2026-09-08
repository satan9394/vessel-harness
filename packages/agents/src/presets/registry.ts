/**
 * agents/presets — AgentPreset 注册/校验/查取（task 054）。
 *
 * registry 提供注册（id 唯一、失败即抛带 id 的清晰错误）、查取（get/list/has）。
 * 校验对未知字段 fail loud（防止 yaml/JSON 配置里写 snake_case 的 model_tier/can_delegate
 * 静默失效）；校验与规范化独立可复用，供 055（Lead/Developer/Reviewer 三角色实例）、
 * 056（TaskRouter Auto 用 preset 选型）与未来配置载入路径调用。
 *
 * 能力映射点（本卡只定义形状与文档，不接线）：
 * - tools        → 会话工具可见性收窄（SubagentManager.toolFilter shrink-only / 构造时的工具集合）
 * - write        → file_write 工具族可见性 + ToolSpec.requiredPermission（workspace-write）决策面
 * - canDelegate  → Subagent 工具是否注册 + SubagentManager.canDelegate（maxDepth/maxConcurrent）
 * - modelTier    → llm/router ModelTier + TierModelMap（056/provider 层绑定）
 */
import {
  AGENT_ROLES,
  DEFAULT_MODEL_TIER,
  type AgentPreset,
  type AgentPresetInput,
  type AgentRole,
  type ModelTier,
} from './types.js';

/** preset 允许的字段（校验未知字段用；新增字段须同步此处与 types.ts 的接口）。 */
export const PRESET_SCHEMA_FIELDS: readonly string[] = [
  'id',
  'role',
  'modelTier',
  'tools',
  'write',
  'canDelegate',
  'description',
];

const ROLE_SET: ReadonlySet<string> = new Set(AGENT_ROLES);
const MAX_ID_LENGTH = 64;

/** preset 校验失败 —— 携带 presetId（id 本身非法时为 undefined）与逐条 issues。 */
export class PresetValidationError extends Error {
  readonly presetId?: string;
  readonly issues: readonly string[];

  constructor(presetId: string | undefined, issues: readonly string[]) {
    const label = presetId !== undefined ? `"${presetId}"` : '(unknown id)';
    super(`invalid agent preset ${label}: ${issues.join('; ')}`);
    this.name = 'PresetValidationError';
    this.presetId = presetId;
    this.issues = issues;
  }
}

/** 查取未知 preset —— 携带 presetId 与已注册列表（便于调用方自愈）。 */
export class PresetNotFoundError extends Error {
  readonly presetId: string;

  constructor(presetId: string, registered: readonly string[]) {
    const hint = registered.length > 0 ? `registered presets: ${registered.join(', ')}` : 'no presets registered';
    super(`unknown agent preset "${presetId}" (${hint})`);
    this.name = 'PresetNotFoundError';
    this.presetId = presetId;
  }
}

/**
 * 校验任意输入（典型来源：内联 TS 对象或反序列化的配置）是否为合法 AgentPresetInput。
 * 非法即抛 PresetValidationError（带 id + issues）；合法返回清洗后的输入对象。
 */
export function validatePreset(raw: unknown): AgentPresetInput {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PresetValidationError(undefined, ['preset must be a plain object']);
  }
  const input = raw as Record<string, unknown>;
  const issues: string[] = [];

  const known = new Set<string>(PRESET_SCHEMA_FIELDS);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      issues.push(`unknown field "${key}" (schema fields: ${PRESET_SCHEMA_FIELDS.join(', ')})`);
    }
  }

  // id —— 必填、非空、不含空白、≤64 字符
  const rawId = input['id'];
  let id: string | undefined;
  if (typeof rawId !== 'string' || rawId.trim().length === 0) {
    issues.push('id must be a non-empty string');
  } else if (/\s/.test(rawId)) {
    issues.push(`id must not contain whitespace (got "${rawId}")`);
  } else if (rawId.length > MAX_ID_LENGTH) {
    issues.push(`id must be at most ${MAX_ID_LENGTH} chars (got ${rawId.length})`);
  } else {
    id = rawId;
  }
  // 错误归属用原始 id（即使非法也尽量带上，便于定位）
  const label = typeof rawId === 'string' ? rawId : undefined;

  // role —— 判别值之一
  const rawRole = input['role'];
  if (typeof rawRole !== 'string' || !ROLE_SET.has(rawRole)) {
    issues.push(`role must be one of ${AGENT_ROLES.join('|')} (got ${JSON.stringify(rawRole)})`);
  }

  // modelTier —— 可选、非空、不含空白
  let modelTier: ModelTier | undefined;
  const rawTier = input['modelTier'];
  if (rawTier !== undefined) {
    if (typeof rawTier !== 'string' || rawTier.trim().length === 0) {
      issues.push('modelTier must be a non-empty string when provided');
    } else if (/\s/.test(rawTier)) {
      issues.push(`modelTier must not contain whitespace (got "${rawTier}")`);
    } else {
      modelTier = rawTier;
    }
  }

  // tools —— 可选、string[]、无重复
  let tools: string[] | undefined;
  const rawTools = input['tools'];
  if (rawTools !== undefined) {
    if (!Array.isArray(rawTools)) {
      issues.push('tools must be an array of tool names when provided');
    } else {
      const list: string[] = [];
      rawTools.forEach((t, i) => {
        if (typeof t !== 'string' || t.trim().length === 0) {
          issues.push(`tools[${i}] must be a non-empty string`);
        } else {
          list.push(t);
        }
      });
      if (list.length > 0 && new Set(list).size !== list.length) {
        const dupes = [...new Set(list.filter((t, i) => list.indexOf(t) !== i))];
        issues.push(`tools must not contain duplicates (${dupes.join(', ')})`);
      } else {
        tools = list.length > 0 ? list : [];
      }
    }
  }

  // write / canDelegate —— 可选、boolean
  let write: boolean | undefined;
  if (input['write'] !== undefined) {
    if (typeof input['write'] !== 'boolean') {
      issues.push('write must be a boolean when provided');
    } else {
      write = input['write'];
    }
  }
  let canDelegate: boolean | undefined;
  if (input['canDelegate'] !== undefined) {
    if (typeof input['canDelegate'] !== 'boolean') {
      issues.push('canDelegate must be a boolean when provided');
    } else {
      canDelegate = input['canDelegate'];
    }
  }

  // description —— 可选、string
  let description: string | undefined;
  if (input['description'] !== undefined) {
    if (typeof input['description'] !== 'string') {
      issues.push('description must be a string when provided');
    } else {
      description = input['description'];
    }
  }

  if (issues.length > 0) {
    throw new PresetValidationError(label, issues);
  }

  const out: AgentPresetInput = {
    id: id!,
    role: rawRole as AgentRole,
    modelTier,
  };
  if (tools !== undefined) out.tools = tools;
  if (write !== undefined) out.write = write;
  if (canDelegate !== undefined) out.canDelegate = canDelegate;
  if (description !== undefined) out.description = description;
  return out;
}

/**
 * 规范化：校验 + 补默认值（modelTier → DEFAULT_MODEL_TIER）+ 冻结（防调用方经返回值篡改 registry）。
 * 仅把显式声明的可选字段落到结果上 —— 未声明即缺省（继承运行时默认），便于下游做差集判断。
 */
export function normalizePreset(input: AgentPresetInput): AgentPreset {
  const preset: AgentPreset = {
    id: input.id,
    role: input.role,
    modelTier: input.modelTier ?? DEFAULT_MODEL_TIER,
  };
  if (input.tools !== undefined) preset.tools = [...input.tools];
  if (input.write !== undefined) preset.write = input.write;
  if (input.canDelegate !== undefined) preset.canDelegate = input.canDelegate;
  if (input.description !== undefined) preset.description = input.description;
  freezePreset(preset);
  return preset;
}

function freezePreset(preset: AgentPreset): void {
  if (preset.tools !== undefined) Object.freeze(preset.tools);
  Object.freeze(preset);
}

/**
 * PresetRegistry —— 进程内 preset 注册表（插入序；同 id 唯一）。
 * 054 默认集为空，Lead/Developer/Reviewer 三角色实例由 055 注册。
 */
export class PresetRegistry {
  private readonly byId = new Map<string, AgentPreset>();

  /** 可一次性播种多个 preset；任一非法即抛 PresetValidationError（含该 preset 的 id）。 */
  constructor(seed?: readonly AgentPresetInput[]) {
    if (seed !== undefined) {
      for (const preset of seed) this.registerPreset(preset);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  /** 注册（校验 + 规范化 + 查重）；返回冻结后的规范化形状。 */
  registerPreset(input: AgentPresetInput): AgentPreset {
    const valid = validatePreset(input);
    if (this.byId.has(valid.id)) {
      throw new PresetValidationError(valid.id, [`preset "${valid.id}" is already registered (use a unique id)`]);
    }
    const preset = normalizePreset(valid);
    this.byId.set(preset.id, preset);
    return preset;
  }

  hasPreset(id: string): boolean {
    return this.byId.has(id);
  }

  /** 查取；未知 id 抛 PresetNotFoundError（带 id + 已注册列表）。 */
  getPreset(id: string): AgentPreset {
    const preset = this.byId.get(id);
    if (preset === undefined) {
      throw new PresetNotFoundError(id, [...this.byId.keys()]);
    }
    return preset;
  }

  /** 已注册 preset（插入序）。 */
  listPresets(): readonly AgentPreset[] {
    return [...this.byId.values()];
  }

  /** 已注册 id（插入序）。 */
  ids(): readonly string[] {
    return [...this.byId.keys()];
  }
}
