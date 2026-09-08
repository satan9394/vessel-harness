/**
 * agents/presets — Lead / Developer / Reviewer 三角色默认实例（task 055；权威来源：
 * docs/Vessel_后续开发方向与产品化路线_v1.0.md §8.1-8.3 + docs/AGENT-PRESETS.md §3）。
 *
 * 角色 = 配置，不是新 runtime primitive（决策点 12）。本文件只声明三个 AgentPreset 数据实例
 * （camelCase、可序列化），语义对齐 §8.1：
 * - lead      → orchestrator / modelTier 'pro' / canDelegate:true   （编排：可委派）
 * - developer → generator    / modelTier 'pro' / write:true         （产出：可写）
 * - reviewer  → evaluator    / modelTier 'review' / write:false     （评估：只读）
 *
 * modelTier 是档位意图，不绑定具体模型（角色与模型解绑）：lead/developer 默认 'pro'；
 * developer 在 §8.3 的语义是「按任务复杂度可在 pro/fast 间浮动」——具体档位由 056 TaskRouter
 * 按任务选（本实例只注册默认档 'pro'，不把 'pro|fast' 塞进单值档位字段）；reviewer 用 'review'
 * 档位意图，tier→(provider,model) 的绑定归 056/provider 层（llm/router TierModelMap 现仅
 * pro/fast/mini，review 档绑定由 056 扩展）。
 *
 * 能力字段（tools/write/canDelegate）在此未声明的保持缺省（继承运行时默认面）；显式声明的
 * write/canDelegate 语义通过 presets/capabilities.ts 映射到既有运行时开关（写文件族可见性、
 * Subagent 工具/委派开关），接线点在 SubagentManager.delegate 与未来 057 的角色会话构造。
 */
import type { AgentPreset, AgentPresetInput } from './types.js';
import { normalizePreset, PresetRegistry } from './registry.js';

/** §8.1 三个默认角色 id（registry 内唯一、小写 kebab-case）。 */
export const LEAD_PRESET_ID = 'lead';
export const DEVELOPER_PRESET_ID = 'developer';
export const REVIEWER_PRESET_ID = 'reviewer';

/** Lead —— orchestrator：pro 档、可委派（§8.1/§8.3）。 */
export const LEAD_PRESET_INPUT: AgentPresetInput = {
  id: LEAD_PRESET_ID,
  role: 'orchestrator',
  modelTier: 'pro',
  canDelegate: true,
  description: 'Lead（编排者）：pro 档 + 可委派子代理；tools/write 缺省（继承运行时默认面）',
};

/** Developer —— generator：pro 档（简单任务可由 056 路由降 fast）、可写（§8.1/§8.3）。 */
export const DEVELOPER_PRESET_INPUT: AgentPresetInput = {
  id: DEVELOPER_PRESET_ID,
  role: 'generator',
  modelTier: 'pro',
  write: true,
  description: 'Developer（产出者）：pro 档（按任务复杂度可降 fast）+ 允许写文件',
};

/** Reviewer —— evaluator：review 档、强只读 write:false（Generator 不得自证完成，§8.1）。 */
export const REVIEWER_PRESET_INPUT: AgentPresetInput = {
  id: REVIEWER_PRESET_ID,
  role: 'evaluator',
  modelTier: 'review',
  write: false,
  description: 'Reviewer（评审者）：review 档 + 只读证据面（write:false，独立评估）',
};

/** 默认三角色集合（插入序：lead → developer → reviewer，与 §8.1 yaml 顺序一致）。 */
export const DEFAULT_AGENT_PRESETS: readonly AgentPresetInput[] = [
  LEAD_PRESET_INPUT,
  DEVELOPER_PRESET_INPUT,
  REVIEWER_PRESET_INPUT,
];

/** 规范化的默认三角色（冻结；每个 = normalizePreset(对应 INPUT)）。 */
export const DEFAULT_LEAD_PRESET: AgentPreset = normalizePreset(LEAD_PRESET_INPUT);
export const DEFAULT_DEVELOPER_PRESET: AgentPreset = normalizePreset(DEVELOPER_PRESET_INPUT);
export const DEFAULT_REVIEWER_PRESET: AgentPreset = normalizePreset(REVIEWER_PRESET_INPUT);

/** 播种三角色默认集的进程内 registry（任意自定义 registry 也可自行 registerPreset 播种）。 */
export function createDefaultPresetRegistry(): PresetRegistry {
  return new PresetRegistry(DEFAULT_AGENT_PRESETS);
}

/** 把默认三角色播种进既有 registry；返回规范化后的已注册实例（插入序）。 */
export function seedDefaultPresets(registry: PresetRegistry): readonly AgentPreset[] {
  for (const input of DEFAULT_AGENT_PRESETS) {
    registry.registerPreset(input);
  }
  return registry.listPresets();
}
