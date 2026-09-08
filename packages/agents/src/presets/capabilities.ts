/**
 * agents/presets — AgentPreset 能力映射（task 055）。
 *
 * 054 只在 registry 定义了形状并留下映射点；本文件把 preset 的能力字段翻译成既有运行时开关
 * 的具体指令（纯函数，无副作用），映射方式记录如下（对应 docs/AGENT-PRESETS.md §5 映射表）：
 *
 * | preset 字段 | 运行时开关 | 本映射 |
 * |---|---|---|
 * | `tools` | 工具可见性收窄（shrink-only，只收窄不放宽） | 显式声明的 allow-list：只保留名单内工具（intersection） |
 * | `write:false` | file_write 族 / 写权限工具的可见性 | 只保留 `requiredPermission === 'read'` 的工具（Read/Glob/Grep 等）；
 *                                                         等价既有 EvaluatorAgent 只读面先例 createReadOnlyExplorationTools |
 * | `write:false` | policy profile（降档 workspace-write → read-only） | `policyProfileForPreset` 输出 'read-only' 意图，由接线方
 *                                                         （057 会话构造 / EvaluatorAgent / compose permission 档）落到 PolicyEngine artifacts |
 * | `canDelegate:false` | Subagent 工具是否注册 | 从可见面剔除名为 'Subagent' 的工具（对应「不注册 Subagent 工具」）；
 *                                                         SubagentManager 服务端 maxDepth/maxConcurrent 上限仍权威裁决（fail-closed） |
 * | `canDelegate:true` | Subagent 工具可见性 | 不因 preset 剔除 Subagent 工具（是否注册由接线方的委派基建决定） |
 *
 * 语义约束：preset 只收窄、不放宽；write/canDelegate 未声明（undefined）= 继承运行时默认，
 * 本模块只对显式声明施加过滤。本文件不修改任何运行时文件——接线点见 SubagentManager.delegate
 * （presetRegistry 可选注入，委派时按角色面收窄子代理工具）与未来 057 的角色会话构造。
 */
import type { ToolSpec } from '@vessel/shared';
import type { AgentPreset } from './types.js';

/** Subagent 工具名（createSubagentTool.ts / SubagentManager.ts 中的既有字面量）。 */
export const SUBAGENT_TOOL_NAME = 'Subagent';

/** 单条 preset 的能力决定（write/canDelegate 的显式状态）。 */
export interface PresetCapabilityDirective {
  /** preset.tools 显式声明时的 allow-list；undefined = 未声明（不额外收窄）。 */
  toolAllowList: readonly string[] | undefined;
  /** preset.write === false 时表示强只读面（只保留 read 权限工具）。 */
  readOnly: boolean;
  /** preset.canDelegate === false 时表示该角色会话不应注册 Subagent 工具。 */
  delegateForbidden: boolean;
}

/** 提取 preset 的显式能力决定（缺省字段不臆造默认值）。 */
export function presetCapabilityDirective(preset: AgentPreset): PresetCapabilityDirective {
  return {
    toolAllowList: preset.tools,
    readOnly: preset.write === false,
    delegateForbidden: preset.canDelegate === false,
  };
}

/**
 * 把 preset 的能力面施加到一组候选工具上（shrink-only，顺序：allow-list → write → delegate）。
 * - tools 显式声明：只保留 allow-list 内的工具（intersection，不新增不存在的工具）。
 * - write:false：只保留 requiredPermission === 'read' 的工具（剔除 file_write 族/写权限/exec/Subagent）。
 * - canDelegate:false：剔除名为 subagentToolName 的工具（默认 'Subagent'）。
 * 未声明的字段不施加过滤（继承候选面）。
 */
export function applyPresetToolFace(
  preset: AgentPreset,
  tools: readonly ToolSpec[],
  opts: { subagentToolName?: string } = {},
): ToolSpec[] {
  const subagentName = opts.subagentToolName ?? SUBAGENT_TOOL_NAME;
  const directive = presetCapabilityDirective(preset);
  let out: ToolSpec[] = [...tools];
  if (directive.toolAllowList !== undefined) {
    const allow = new Set(directive.toolAllowList);
    out = out.filter((t) => allow.has(t.name));
  }
  if (directive.readOnly) {
    out = out.filter((t) => t.requiredPermission === 'read');
  }
  if (directive.delegateForbidden) {
    out = out.filter((t) => t.name !== subagentName);
  }
  return out;
}

/**
 * write:false → policy profile 降档意图 'read-only'（对应 PolicyEngine 的 profile compare 与
 * compose 的 permission 档）。未声明或 write:true → undefined（继承运行时默认 profile）。
 * 输出是意图数据；实际落到 PolicyArtifacts.profile 的接线在会话构造方（EvaluatorAgent / 057）。
 */
export function policyProfileForPreset(preset: AgentPreset): 'read-only' | undefined {
  return preset.write === false ? 'read-only' : undefined;
}
