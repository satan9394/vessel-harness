import type { ChatProvider } from '@cah/shared';
import { classifyTask, type TaskCategory } from './taskCategory.js';

/**
 * llm/router — Agent/Model presets + TaskRouter (V0.4-M2; MISSION-V0.4 §3.2/§3.3).
 *
 * A task category maps to a preset: { agentPreset?, modelTier, description }.
 * The preset is DATA (config), not mechanism — 决策点 12 (roles are preset
 * configuration, mechanism first) + 决策点 13 (model differences live in
 * tiers/profiles, not per-vendor templates). Adding a category/preset requires
 * no core/agents code change.
 *
 * TaskRouter resolves a task prompt (or explicit RouterHints) to a concrete
 * (provider, model, agentPreset?). Explicit RouterHints (provider/model set by
 * the caller) always win — category inference is the fallback, so existing
 * SimpleRouter callers keep working unchanged.
 */

export type ModelTier = 'pro' | 'fast' | 'mini';

export interface AgentPresetRef {
  category: TaskCategory;
  /** optional agent preset name — consumed by agents/ preset machinery (决策点 12) */
  agentPreset?: string;
  /** model tier for this category — mapped to a concrete model by the provider map */
  modelTier: ModelTier;
  description: string;
}

/** default preset table — category → role/tier intent (config data). */
export const DEFAULT_PRESETS: Record<TaskCategory, AgentPresetRef> = {
  implementation: { category: 'implementation', agentPreset: 'developer', modelTier: 'pro', description: '功能实现：深度编码，用最强模型' },
  simple_fix: { category: 'simple_fix', agentPreset: 'developer', modelTier: 'fast', description: '简单修复：快模型即可' },
  search: { category: 'search', agentPreset: 'explorer', modelTier: 'fast', description: '代码库检索/探索：快模型' },
  review: { category: 'review', agentPreset: 'reviewer', modelTier: 'pro', description: '独立审查：用独立强模型（Gen/Eval 分离）' },
  planning: { category: 'planning', agentPreset: 'planner', modelTier: 'pro', description: '规划：用强模型' },
  architecture: { category: 'architecture', agentPreset: 'architect', modelTier: 'pro', description: '架构设计：用最强模型' },
  unknown: { category: 'unknown', modelTier: 'pro', description: '未分类：默认走 pro' },
};

/** tier → concrete (providerId, model) — the only place provider/model binding lives. */
export interface TierModelMap {
  pro: { providerId: string; model: string };
  fast: { providerId: string; model: string };
  mini: { providerId: string; model: string };
}

export interface TaskRouterOptions {
  providers: Record<string, ChatProvider>;
  /** tier → provider/model binding (config) */
  tierModel: TierModelMap;
  /** preset table override (defaults to DEFAULT_PRESETS) */
  presets?: Record<TaskCategory, AgentPresetRef>;
  /** classifier override (defaults to deterministic keyword rules) */
  classify?: (prompt: string) => TaskCategory;
  /** default fallback tier for unknown categories */
  defaultTier?: ModelTier;
}

export interface TaskRoute {
  provider: ChatProvider;
  model: string;
  category: TaskCategory;
  preset: AgentPresetRef;
  /** true when the route came from explicit hints rather than category inference */
  explicit: boolean;
}

export interface TaskRouteInput {
  /** user task prompt — used for category inference when no explicit provider/model */
  task?: string;
  provider?: string;
  model?: string;
  category?: TaskCategory;
}

/**
 * TaskRouter — resolve a task (or explicit hints) to provider/model/preset.
 * Explicit hints win; otherwise classify the task → preset → tier → model.
 */
export class TaskRouter {
  private readonly providers: Record<string, ChatProvider>;
  private readonly tierModel: TierModelMap;
  private readonly presets: Record<TaskCategory, AgentPresetRef>;
  private readonly classify: (prompt: string) => TaskCategory;

  constructor(opts: TaskRouterOptions) {
    this.providers = opts.providers;
    this.tierModel = opts.tierModel;
    this.presets = opts.presets ?? DEFAULT_PRESETS;
    this.classify = opts.classify ?? ((p) => classifyTask(p));
  }

  resolve(input: TaskRouteInput): TaskRoute {
    // explicit hints always win (backward compatible with SimpleRouter callers)
    const explicit = !!(input.provider || input.model);
    if (input.provider && !this.providers[input.provider]) {
      throw new Error(`unknown provider: ${input.provider} (available: ${Object.keys(this.providers).join(', ')})`);
    }

    let category: TaskCategory = 'unknown';
    if (input.category) {
      category = input.category;
    } else if (input.task) {
      category = this.classify(input.task);
    }

    const preset = this.presets[category] ?? this.presets.unknown!;
    const tier = (preset.modelTier ?? 'pro') as ModelTier;
    const binding = this.tierModel[tier] ?? this.tierModel.pro;

    const provider = input.provider ? this.providers[input.provider]! : this.providers[binding.providerId];
    if (!provider) {
      throw new Error(`no provider bound for tier "${tier}" (provider "${binding.providerId}" missing)`);
    }
    const model = input.model ?? binding.model;

    return { provider, model, category, preset, explicit };
  }
}
