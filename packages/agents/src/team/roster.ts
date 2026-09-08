/**
 * agents/team — roster 组合与校验纯函数（task 057）。
 *
 * - phaseForRole：role（preset 判别）→ 阶段（顺序驱动骨架的节拍词汇）
 * - composeRosterFromRoute：056 route.roles + roleModels → TeamRoster
 *   （route.roles 已是 §8.2 的复杂度→角色计划产物 —— 本层不重复复杂度表，
 *    只把 preset id 列表翻译成带 model/providerId 的成员计划；未知 preset fail loud）
 * - resolveRoster：校验 + 补默认 + 解析 preset/role/phase → ResolvedTeamMember[]
 */
import type { AgentRole } from '../presets/types.js';
import { PresetRegistry } from '../presets/registry.js';
import type { TeamPhaseName } from '@vessel/shared';
import type { ResolvedTeamMember, TeamMemberSpec, TeamRoster, TeamRouteLike } from './types.js';

/** role（preset 判别）→ §8.2/本卡阶段节拍（orchestrator→orchestrate / generator→generate / evaluator→evaluate）。 */
export function phaseForRole(role: AgentRole): TeamPhaseName {
  switch (role) {
    case 'orchestrator':
      return 'orchestrate';
    case 'generator':
      return 'generate';
    case 'evaluator':
      return 'evaluate';
  }
}

/** preset id → 阶段（经 registry 解析 role；未知 preset 抛 PresetNotFoundError）。 */
export function phaseForPresetId(presetId: string, registry: PresetRegistry): TeamPhaseName {
  return phaseForRole(registry.getPreset(presetId).role);
}

/**
 * 056 route → roster：roles[i] 与 roleModels[i] 一一对应（roleModels[i].model /
 * providerId 为该角色已解析模型）。roles/roleModels 长度不一致或缺 model/providerId
 * 时 fail loud（给指引：显式阵容可自行指定）。
 */
export function composeRosterFromRoute(route: TeamRouteLike, registry: PresetRegistry): TeamRoster {
  if (route.roles.length === 0) {
    throw new Error('team error: route.roles is empty (no roster to compose)');
  }
  if (route.roleModels.length !== route.roles.length) {
    throw new Error(
      `team error: route.roleModels (${route.roleModels.length}) must align with route.roles (${route.roles.length}) ` +
        '— every role needs a resolved model/providerId (or pass an explicit roster)',
    );
  }
  return route.roles.map((presetId, i) => {
    // fail loud on presets unknown to the registry (labels must resolve to role specs)
    registry.getPreset(presetId);
    const rm = route.roleModels[i]!;
    if (!rm.model || !rm.providerId) {
      throw new Error(
        `team error: role "${presetId}" has no resolved model/providerId (roleModels[${i}]) — ` +
          'configure the route binding or pass an explicit roster',
      );
    }
    return { memberId: presetId, presetId, model: rm.model, providerId: rm.providerId, tier: rm.tier };
  });
}

/** roster 行规范化：memberId 缺省补 presetId；空/空白/重复校验。 */
export function normalizeRoster(roster: TeamRoster): TeamRoster {
  if (roster.length === 0) {
    throw new Error('team error: roster is empty (nothing to run)');
  }
  const seen = new Map<string, number>();
  return roster.map((spec, i) => {
    const presetId = spec.presetId.trim();
    const memberId = (spec.memberId?.trim() || presetId) as string;
    if (!presetId) throw new Error(`team error: roster[${i}].presetId must be a non-empty string`);
    if (!memberId) throw new Error(`team error: roster[${i}].memberId must be a non-empty string`);
    if (!spec.model.trim() || !spec.providerId.trim()) {
      throw new Error(`team error: roster[${i}] ("${memberId}") needs model + providerId (route resolution or explicit)`);
    }
    const prev = seen.get(memberId);
    if (prev !== undefined) {
      throw new Error(`team error: duplicate memberId "${memberId}" at roster[${prev}] and roster[${i}]`);
    }
    seen.set(memberId, i);
    return {
      memberId,
      presetId,
      model: spec.model.trim(),
      providerId: spec.providerId.trim(),
      tier: spec.tier,
    };
  });
}

/** 解析成员计划：preset 查 registry（未知抛 PresetNotFoundError）+ role/phase 派生。 */
export function resolveRoster(roster: TeamRoster, registry: PresetRegistry): ResolvedTeamMember[] {
  return normalizeRoster(roster).map((spec) => {
    const preset = registry.getPreset(spec.presetId);
    return {
      memberId: spec.memberId!,
      presetId: spec.presetId,
      preset,
      role: preset.role,
      phase: phaseForRole(preset.role),
      tier: spec.tier,
      model: spec.model,
      providerId: spec.providerId,
    };
  });
}
