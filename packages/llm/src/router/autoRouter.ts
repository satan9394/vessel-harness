/**
 * llm/router — TaskRouter 默认产品路径：用户只选 Auto / Fast / Pro（task 056；
 * 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §10 L1140-1182 + §8.2 L1040-1051）。
 *
 * 用户不再手动选模型。默认 'auto'，内部解析链（每一步都是可注入、可单测的纯函数）：
 *
 *   Task
 *   → classify category      （现有 taskCategory 机制 / 注入分类器）
 *   → choose role            （§8.2：小 → Single Agent；中 → Developer+Reviewer；
 *                              复杂 → Lead+Developer+Reviewer —— 复杂度由类别经配置表派生）
 *   → choose tier            （§8.3：lead=pro；developer 小=fast/中、复杂=pro；reviewer=review）
 *   → resolve provider/model （tier → { providerId, model } 绑定，provider/config 层提供；
 *                              未配置的 tier 清晰回落默认档 + hints 提示）
 *
 * 显式 Fast / Pro 绕过 classify，直达对应 tier（route.category='unknown'、无复杂度）。
 * Pin for this session：pinCurrent() 后本会话的 Auto 解析不再重判（锁定实际选择）；
 * 显式 Fast/Pro 永远是用户最新意图，不因 pin 被吞。
 *
 * 分层（054/055 侦察结论）：本模块只依赖 @vessel/shared 类型 + taskCategory 分类机制；
 * tier → model 的绑定（bindings）由调用方（provider/config 层）注入，本层不写死任何模型名。
 * 角色只以 preset id 字符串（lead/developer/reviewer，与 agents/presets registry 对齐）
 * 作为数据出参，本层不 import agents —— 角色 → AgentPreset 规格解析归 057 / agents 消费方。
 *
 * 与 V0.4 TaskRouter（TaskRouter.ts）的关系：后者保持原语义（类别 preset 表 + 显式 hints 优先，
 * engine/selection 等既有消费方不回退）；本模块是其产品化包装层 —— 默认 Auto 的选择器。
 */

import type { ChatProvider } from '@vessel/shared';
import { classifyTask, type TaskCategory } from './taskCategory.js';

/* ======================================================================== *
 * 1. 用户选择词汇：Auto / Fast / Pro（默认 Auto）
 * ======================================================================== */

export type RouteMode = 'auto' | 'fast' | 'pro';

export const ROUTE_MODES: readonly RouteMode[] = ['auto', 'fast', 'pro'];

export const DEFAULT_ROUTE_MODE: RouteMode = 'auto';

export function isRouteMode(v: unknown): v is RouteMode {
  return v === 'auto' || v === 'fast' || v === 'pro';
}

/* ======================================================================== *
 * 2. 复杂度词汇（§8.2 三档）+ 类别 → 复杂度配置表
 * ======================================================================== */

export type TaskComplexity = 'small' | 'medium' | 'complex';

export const TASK_COMPLEXITIES: readonly TaskComplexity[] = ['small', 'medium', 'complex'];

/**
 * 类别 → §8.2 复杂度档（config data，可注入覆盖）。
 * 设计：unknown 落 'medium'（主档 pro 与 V0.4 DEFAULT_PRESETS.unknown→pro 兜底等价，
 * 但角色面给出 Developer+Reviewer —— 保守但可配）。映射与 V0.4 preset 表的主档等价：
 * small→fast（simple_fix/search）、medium→pro（implementation/review/planning）、
 * complex→pro（architecture），保证 compose/bench 既有路由行为不回退。
 */
export const DEFAULT_CATEGORY_COMPLEXITY: Readonly<Record<TaskCategory, TaskComplexity>> = {
  simple_fix: 'small',
  search: 'small',
  implementation: 'medium',
  review: 'medium',
  planning: 'medium',
  architecture: 'complex',
  unknown: 'medium',
};

/** 第 2 步纯函数：category → complexity（默认表可注入）。 */
export function complexityForCategory(
  category: TaskCategory,
  table: Readonly<Record<TaskCategory, TaskComplexity>> = DEFAULT_CATEGORY_COMPLEXITY,
): TaskComplexity {
  return table[category] ?? 'medium';
}

/* ======================================================================== *
 * 3. §8.2 角色计划：复杂度 → 角色（preset id）有序集
 * ======================================================================== */

/**
 * 复杂度 → 角色计划（§8.2 原文：小任务 → Single Agent；中任务 → Developer+Reviewer；
 * 复杂任务 → Lead+Developer+Reviewer）。角色 id 与 agents/presets registry 的
 * lead/developer/reviewer 对齐（本层仅数据透传，规格解析归 057）。
 */
export const DEFAULT_COMPLEXITY_ROLES: Readonly<Record<TaskComplexity, readonly string[]>> = {
  small: ['developer'],
  medium: ['developer', 'reviewer'],
  complex: ['lead', 'developer', 'reviewer'],
};

/** 第 3 步纯函数：complexity → 有序角色计划。 */
export function rolesForComplexity(
  complexity: TaskComplexity,
  table: Readonly<Record<TaskComplexity, readonly string[]>> = DEFAULT_COMPLEXITY_ROLES,
): readonly string[] {
  return table[complexity] ?? DEFAULT_COMPLEXITY_ROLES.medium!;
}

/* ======================================================================== *
 * 4. §8.3 档位意图：角色 × 复杂度 → tier（开放字符串；'review' 档由本卡扩展语汇）
 * ======================================================================== */

/**
 * 角色 × 复杂度 → 档位（config data）。lead 恒 pro（§8.3「Lead → Pro」）；
 * developer 小任务降 fast、中/复杂 pro（「Flash / Pro（由任务复杂度决定）」）；
 * reviewer 恒 review 档意图（「Reviewer → Internal Flash」→ review_internal，
 * 绑定具体模型仍由 bindings 决定，未绑定则回落默认档 + hints）。
 */
export const DEFAULT_ROLE_TIERS: Readonly<Record<string, Readonly<Record<TaskComplexity, string>>>> = {
  lead: { small: 'pro', medium: 'pro', complex: 'pro' },
  developer: { small: 'fast', medium: 'pro', complex: 'pro' },
  reviewer: { small: 'review', medium: 'review', complex: 'review' },
};

/** 第 4 步纯函数：角色在某复杂度下的档位；未知角色/复杂度回落默认档。 */
export function roleTierFor(
  role: string,
  complexity: TaskComplexity,
  table: Readonly<Record<string, Readonly<Record<TaskComplexity, string>>>> = DEFAULT_ROLE_TIERS,
  defaultTier = 'pro',
): string {
  const byComplexity = table[role];
  if (!byComplexity) return defaultTier;
  return byComplexity[complexity] ?? defaultTier;
}

/* ======================================================================== *
 * 5. tier → provider/model 绑定（provider/config 层注入；未配置给清晰默认 + 提示）
 * ======================================================================== */

export interface TierBinding {
  providerId: string;
  model: string;
}

/** 开放档位绑定表（config data；键 pro/fast/mini/review… 由配置方决定）。 */
export type TierBindings = Readonly<Record<string, TierBinding>>;

export interface TierResolution {
  binding: TierBinding;
  /** false = 请求档未配置，已回落 defaultTier 兜底（此时 hints 含说明） */
  configured: boolean;
  hint?: string;
}

/** 第 5 步纯函数：tier → 绑定；未配置 → defaultTier 兜底 + 说明 hint。 */
export function resolveTierBinding(
  tier: string,
  bindings: TierBindings,
  defaultTier = 'pro',
): TierResolution {
  const direct = bindings[tier];
  if (direct) return { binding: direct, configured: true };
  const fallback = bindings[defaultTier];
  if (fallback) {
    return {
      binding: fallback,
      configured: false,
      hint: `tier "${tier}" has no model binding — fell back to default tier "${defaultTier}" ` +
        `(${fallback.providerId}/${fallback.model}); configure bindings["${tier}"] to pin a dedicated model`,
    };
  }
  const configured = Object.keys(bindings);
  throw new Error(
    `tier "${tier}" and fallback tier "${defaultTier}" have no model binding ` +
      `(configured tiers: ${configured.length > 0 ? configured.join(', ') : 'none'})`,
  );
}

/* ======================================================================== *
 * AutoRoute —— 解析结果（每一步的选择都可展示、可 pin、可被 057 消费）
 * ======================================================================== */

export interface ResolvedRoleModel {
  /** 角色 preset id（lead/developer/reviewer；agents/presets registry 对齐） */
  role: string;
  /** 该角色实际执行的档位 */
  tier: string;
  providerId: string;
  model: string;
  /** false = tier 未配置回落默认档（见 route.hints） */
  configured: boolean;
}

export interface AutoRoute {
  /** 用户选择（本次解析实际生效的模式） */
  mode: RouteMode;
  /** 分类结果；显式 Fast/Pro 绕过 classify → 'unknown'（不分类） */
  category: TaskCategory;
  /** §8.2 复杂度；显式 Fast/Pro 无（绕过 classify） */
  complexity?: TaskComplexity;
  /** 本次解析的角色计划（§8.2 有序角色 preset id） */
  roles: readonly string[];
  /** 与 roles 一一对应的每角色模型解析 */
  roleModels: readonly ResolvedRoleModel[];
  /** 主执行角色（会话主 agent）—— roleModels[0]，UI 显示「Auto → <model>」即此项 */
  primary: ResolvedRoleModel;
  /** 未配置提示等（如 tier 回落） */
  hints: readonly string[];
  /** true = 本次结果来自 pin（未重新分类/解析） */
  pinned: boolean;
}

/** 展示字符串：`Auto → deepseek-chat`（§10 UI 实际选择样式）。 */
export function routeSelectionLabel(route: AutoRoute): string {
  return `${route.mode} → ${route.primary.model}`;
}

export interface AutoResolveInput {
  /** 用户任务文本 —— auto 模式分类依据（缺省/空 → 'unknown'） */
  task?: string;
  /** 本次模式覆盖（缺省用 router 会话默认，再缺省 'auto'） */
  mode?: RouteMode;
  /** 显式类别覆盖（跳过分类；与 V0.4 显式 hints 语义一致） */
  category?: TaskCategory;
}

export interface AutoTaskRouterOptions {
  providers: Record<string, ChatProvider>;
  /** tier → { providerId, model } 绑定（provider/config 层注入；本层不写死模型名） */
  bindings: TierBindings;
  /** 请求档未配置时的回落档（默认 'pro'） */
  defaultTier?: string;
  /** 会话级用户模式默认（默认 'auto'） */
  mode?: RouteMode;
  /** 分类器 seam（默认确定性 classifyTask） */
  classify?: (prompt: string) => TaskCategory;
  /** 类别 → 复杂度表覆盖 */
  categoryComplexity?: Readonly<Record<TaskCategory, TaskComplexity>>;
  /** 复杂度 → 角色计划表覆盖 */
  complexityRoles?: Readonly<Record<TaskComplexity, readonly string[]>>;
  /** 角色 × 复杂度 → 档位表覆盖 */
  roleTiers?: Readonly<Record<string, Readonly<Record<TaskComplexity, string>>>>;
}

/**
 * AutoTaskRouter —— 默认 Auto 的 TaskRouter（056）。
 * resolve() 每步（classify → complexity → roles → tiers → bindings）都有对应纯函数可独立测；
 * pinCurrent() 后本会话 Auto 不再重判（返回锁定选择）；显式 Fast/Pro 绕过 classify 直达档位。
 */
export class AutoTaskRouter {
  private readonly providers: Record<string, ChatProvider>;
  private readonly bindings: TierBindings;
  private readonly defaultTier: string;
  private readonly sessionMode: RouteMode;
  private readonly classify: (prompt: string) => TaskCategory;
  private readonly categoryComplexity: Readonly<Record<TaskCategory, TaskComplexity>>;
  private readonly complexityRoles: Readonly<Record<TaskComplexity, readonly string[]>>;
  private readonly roleTiers: Readonly<Record<string, Readonly<Record<TaskComplexity, string>>>>;

  /** 最近一次 Auto 解析结果 —— pinCurrent() 的锁定对象 */
  private lastAutoRoute: AutoRoute | undefined;
  /** 会话级 pin：锁定最近一次 Auto 解析（不再自动重判） */
  private pinnedRoute: AutoRoute | undefined;

  constructor(opts: AutoTaskRouterOptions) {
    this.providers = opts.providers;
    this.bindings = opts.bindings;
    this.defaultTier = opts.defaultTier ?? 'pro';
    this.sessionMode = opts.mode ?? DEFAULT_ROUTE_MODE;
    this.classify = opts.classify ?? ((p) => classifyTask(p));
    this.categoryComplexity = opts.categoryComplexity ?? DEFAULT_CATEGORY_COMPLEXITY;
    this.complexityRoles = opts.complexityRoles ?? DEFAULT_COMPLEXITY_ROLES;
    this.roleTiers = opts.roleTiers ?? DEFAULT_ROLE_TIERS;
  }

  /** 第 1 步（分类）。显式类别优先；否则 task → classify；均无 → 'unknown'。 */
  classifyCategory(input: AutoResolveInput): TaskCategory {
    if (input.category) return input.category;
    if (input.task && input.task.trim().length > 0) return this.classify(input.task);
    return 'unknown';
  }

  /**
   * 解析一个任务（或显式 Fast/Pro）。
   * - 显式 fast/pro：绕过 classify 直达对应 tier（roles=['developer'] 单执行角色）。
   * - auto：classify → complexity → roles（§8.2）→ 每角色 tier（§8.3）→ 绑定解析。
   * - pin 语义：会话已 pin 且本次又是 auto（需要自动重判的场景）→ 直接返回锁定选择；
   *   显式 fast/pro 是用户最新意图，永远现场解析（覆盖 pin）。
   */
  resolve(input: AutoResolveInput = {}): AutoRoute {
    const mode = input.mode ?? this.sessionMode;

    // pinned auto route is served without re-classification (session lock)
    if (mode === 'auto' && this.pinnedRoute) {
      return { ...this.pinnedRoute, pinned: true };
    }

    if (mode === 'fast' || mode === 'pro') {
      return this.resolveExplicit(mode);
    }

    return this.resolveAuto(input);
  }

  /** Pin for this session：锁定最近一次 Auto 解析结果（无结果时抛错带指引）。 */
  pinCurrent(): AutoRoute {
    if (this.pinnedRoute) return { ...this.pinnedRoute, pinned: true };
    if (!this.lastAutoRoute) {
      throw new Error('no auto route to pin — call resolve({ task }) (auto mode) first');
    }
    this.pinnedRoute = this.lastAutoRoute;
    return { ...this.pinnedRoute, pinned: true };
  }

  isPinned(): boolean {
    return this.pinnedRoute !== undefined;
  }

  /** 解 pin：解除会话锁定，后续 Auto 重新解析。 */
  unpin(): void {
    this.pinnedRoute = undefined;
  }

  private resolveExplicit(mode: 'fast' | 'pro'): AutoRoute {
    // Fast/Pro bypass classify: single working agent at the pinned tier
    const tier = mode;
    const hints: string[] = [];
    const { binding, configured, hint } = resolveTierBinding(tier, this.bindings, this.defaultTier);
    if (hint) hints.push(hint);
    this.lookupProvider(binding.providerId); // fail loud on unknown provider id
    const model: ResolvedRoleModel = {
      role: 'developer',
      tier,
      providerId: binding.providerId,
      model: binding.model,
      configured,
    };
    const route: AutoRoute = {
      mode,
      category: 'unknown',
      roles: ['developer'],
      roleModels: [model],
      primary: model,
      hints,
      pinned: false,
    };
    return route;
  }

  private resolveAuto(input: AutoResolveInput): AutoRoute {
    const category = this.classifyCategory(input);
    const complexity = complexityForCategory(category, this.categoryComplexity);
    const roles = rolesForComplexity(complexity, this.complexityRoles);
    const hints: string[] = [];

    const roleModels: ResolvedRoleModel[] = roles.map((role) => {
      const tier = roleTierFor(role, complexity, this.roleTiers, this.defaultTier);
      const { binding, configured, hint } = resolveTierBinding(tier, this.bindings, this.defaultTier);
      if (hint) hints.push(hint);
      this.lookupProvider(binding.providerId); // fail loud on unknown provider id
      return { role, tier, providerId: binding.providerId, model: binding.model, configured };
    });

    const route: AutoRoute = {
      mode: 'auto',
      category,
      complexity,
      roles,
      roleModels,
      primary: roleModels[0]!,
      hints,
      pinned: false,
    };
    this.lastAutoRoute = route;
    return route;
  }

  private lookupProvider(providerId: string): ChatProvider {
    const provider = this.providers[providerId];
    if (!provider) {
      throw new Error(
        `no provider bound for tier binding "${providerId}" (available providers: ${Object.keys(this.providers).join(', ') || 'none'})`,
      );
    }
    return provider;
  }
}
