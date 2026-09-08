import type { LoopTask } from './LoopEngine.js';
import { classifyTask, type TaskCategory } from '@vessel/llm';
import { DEFAULT_PRESETS, type AgentPresetRef, type TaskRouter } from '@vessel/llm';

/**
 * engine/selection — V0.5-M2 Task Selection (task 011; MISSION-V0.5 §三.2).
 * Decides HOW a candidate task runs: task → category → preset (→ tier), which
 * determines the Generator's execution config (agentPreset/modelTier refs).
 *
 * Semantics reused from V0.4 llm/router (taskCategory.ts + TaskRouter.ts) —
 * no re-invention (MISSION-V0.5 §六.4). The preset is DATA (config), not
 * mechanism (决策点 12/13), and is looked up from DEFAULT_PRESETS unless the
 * caller injects a custom table or a full TaskRouter.
 *
 * Pure + injectable: `selectTaskFor` is deterministic and offline-testable;
 * TaskRouter itself needs providers, so it is injected rather than constructed
 * here (loop-engine stays free of provider wiring).
 */

/** Minimal ExecutionRoute — what the Generator needs from selection. */
export interface TaskSelection {
  task: LoopTask;
  category: TaskCategory;
  /** resolved preset ref (agentPreset?/modelTier/description) — config data */
  preset: AgentPresetRef;
  /** model tier for execution ('pro' | 'fast' | 'mini') */
  tier: AgentPresetRef['modelTier'];
  /** resolved concrete model, when a router was injected */
  model?: string;
}

/** Category classifier seam — pure `(goal) => category`; inject to override. */
export type TaskClassifier = (goal: string) => TaskCategory;

/** Preset table lookup seam — inject to override; defaults to DEFAULT_PRESETS. */
export type PresetResolver = (category: TaskCategory) => AgentPresetRef;

/** Router seam — a full TaskRouter (providers needed) or any router-like object. */
export type RouterLike = Pick<TaskRouter, 'resolve'>;

export interface SelectionDeps {
  /** defaults to deterministic classifyTask */
  classify?: TaskClassifier;
  /** defaults to a DEFAULT_PRESETS lookup */
  presets?: PresetResolver;
  /** optional full TaskRouter (or router-like) for concrete provider/model */
  router?: RouterLike;
}

/**
 * Pure task → execution-config selection. Category comes from the goal via
 * classifyTask (default) or the injected classifier; preset/tier from the
 * preset table; model only when a router is injected (needs providers).
 */
export function selectTaskFor(task: LoopTask, deps: SelectionDeps = {}): TaskSelection {
  const classify = deps.classify ?? classifyTask;
  const category = classify(task.goal);

  // Router (when injected) resolves category → preset → tier → concrete model.
  if (deps.router) {
    const route = deps.router.resolve({ task: task.goal, category });
    return {
      task,
      category: route.category,
      preset: route.preset,
      tier: route.preset.modelTier,
      model: route.model,
    };
  }

  // Provider-free path: preset table lookup only (DEFAULT_PRESETS by default).
  const preset = deps.presets ? deps.presets(category) : DEFAULT_PRESETS[category] ?? DEFAULT_PRESETS.unknown;
  return { task, category, preset, tier: preset.modelTier, model: undefined };
}

/**
 * Preset-only selector — a convenience wrapper that never needs providers.
 * Goal → category (classifyTask) → preset from DEFAULT_PRESETS; the returned
 * TaskSelection has no concrete model (provider binding stays in llm/router).
 */
export function classifyTaskFor(task: LoopTask): TaskSelection {
  return selectTaskFor(task);
}
