/**
 * agents/presets — AgentPreset 规格（task 054；权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8.1-8.3）。
 *
 * 角色 = preset/profile 配置，不是新的 runtime primitive（决策点 12：机制先于角色）。
 * preset 只声明 modelTier（档位意图），不绑定具体模型 —— 角色与模型解绑；
 * tier → (provider, model) 的解析归 056 / provider 层（参照 llm/router ModelTier + TierModelMap）。
 *
 * 能力字段（tools/write/canDelegate）本层只定义形状与语义，映射到既有运行时开关的点位
 * （工具可见性收窄 / file_write 族权限 / Subagent 工具可见性与深度并发上限）见
 * docs/AGENT-PRESETS.md 与 registry.ts 头注释；实际接线在 055/056/057。
 */

/** 角色判别 —— 与 §8.1 语义一一对应：lead=orchestrator / developer=generator / reviewer=evaluator。 */
export type AgentRole = 'orchestrator' | 'generator' | 'evaluator';

/** 已知角色集合（校验用；扩展角色须同步扩展判别语义方有意义，055 三角色已全覆盖）。 */
export const AGENT_ROLES: readonly AgentRole[] = ['orchestrator', 'generator', 'evaluator'];

/**
 * 模型档位意图（开放字符串，本层不做枚举锁定）。
 * 已知档位语汇：pro / fast / review（§8.1）与 llm/router 的 pro/fast/mini；
 * tier 只表达档位意图，具体模型绑定在 provider 层（056 / llm/router TierModelMap）。
 */
export type ModelTier = string;

/** 默认 modelTier —— 与 llm/router DEFAULT_PRESETS 的 `preset.modelTier ?? 'pro'` 兜底一致。 */
export const DEFAULT_MODEL_TIER: ModelTier = 'pro';

/** preset 语义字段（不含默认值处理）。 */
export interface AgentPresetFields {
  /** 稳定唯一标识（registry 内唯一；建议小写 kebab-case，如 lead/developer/reviewer）。 */
  id: string;
  /** 角色判别：orchestrator(编排/可委派) | generator(产出/可写) | evaluator(评估/只读)。 */
  role: AgentRole;
  /**
   * 工具名 allow-list（对子代理/角色会话的可见性收窄，只收窄不放大的 shrink-only 语义，
   * 对应 SubagentManager toolFilter / 会话构造时的工具集合）。缺省 = 不额外收窄（继承默认面）。
   */
  tools?: string[];
  /**
   * 是否允许写文件：false = 只读面（reviewer 语义）；true = 允许写。缺省 = 未指定，继承运行时默认。
   * 映射点：file_write 工具族可见性 + ToolSpec.requiredPermission（workspace-write）决策面。
   */
  write?: boolean;
  /**
   * 是否允许委派子代理（orchestrator 语义）。缺省 = 未指定，继承运行时默认。
   * 映射点：Subagent 工具是否注册 + SubagentManager.canDelegate（maxDepth/maxConcurrent 服务端上限）。
   */
  canDelegate?: boolean;
  /** 人类可读说明（文档/遥测用）。 */
  description?: string;
}

/** 注册输入形状：modelTier 可省，注册时补默认 DEFAULT_MODEL_TIER（见 normalizePreset）。 */
export interface AgentPresetInput extends AgentPresetFields {
  modelTier?: ModelTier;
}

/** 已注册/规范化形状：modelTier 必有值，其余可选字段仅在显式声明时存在。 */
export interface AgentPreset extends AgentPresetFields {
  modelTier: ModelTier;
}
