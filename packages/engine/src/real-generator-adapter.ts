import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { ChatProvider, PolicyArtifacts, TeamMemberSummary, ToolSpec } from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import { TeamRuntime } from '@vessel/agents';
import { DEVELOPER_PRESET_ID, createDefaultPresetRegistry, type PresetRegistry } from '@vessel/agents';
import type { GenerateContext, GeneratorOutput } from './LoopEngine.js';
import { DEFAULT_HISTORY_LIMIT, RingHistory } from './bounded-history.js';

/**
 * engine/RealGeneratorAdapter — task 061（V1.3 Goal Loop 真接线，docs/Vessel…§11）。
 *
 * 把 054-058 建的 preset 化 Developer Agent（generator，经 TeamRuntime 单成员阵容）接到
 * LoopEngine 的 Generator seam（`LoopEngineDeps.generate`）上，不重写 LoopEngine、不写 core、
 * 不新造 Agent primitive：
 *
 *   任务（goal + acceptance）→ 隔离 workspace（由 LoopEngine workspaceFactory 注入）
 *     → TeamRuntime 单成员 developer 会话（preset=developer/generator，source 'team'）
 *     → 产出文本 + 磁盘证据（scanWorkspaceFiles 前后 diff —— 只信盘上改动，不信自述）
 *     → GeneratorRunRecord 可回读（taskId/teamRunId/developer session/output/artifactPaths）。
 *
 * 默认自治受限（§11.1）：本 adapter 每次 generate() 只跑 ONE 个有界的 developer 运行
 * （单回合单成员，无内部 retry/iteration 循环）；maxIterations=1 / maxRetries=1 由 LoopEngine
 * 默认选项实施（本文件不重复实现循环），Goal/Loop 模式放宽留 066。
 *
 * 分层纪律：engine 已有对 agents 的引用（LoopEngine 类型 import EvaluatorVerdict；selection.ts
 * 亦 import @vessel/llm 值），本文件把 agents 的 TeamRuntime 作为注入的「真实 Generator」实现
 * 组合进来 —— 与 ARCHITECTURE §V0.5 行一致：LoopEngine = 编排层，Generator = 调用方注入的单会话
 * 运行；adapter 就是那个「调用方真实实现」。
 *
 * Generator/Evaluator 分离：output/artifactPaths 是 Evaluator（062 RealEvaluatorAdapter）要核验的
 * 数据，不是自证；acceptance 只透传（任务输入形状对齐 LoopTask.acceptance），不进 developer 自评。
 */

/** 默认扫描排除目录（session 状态/版本库/依赖 —— 不算 developer 的改动证据）。 */
export const DEFAULT_EXCLUDE_DIRS: readonly string[] = ['.git', '.harness', '.vessel', 'node_modules'];

export interface RealGeneratorAdapterOptions {
  /** providerId → ChatProvider（developer 会话查表；未知 fail loud） */
  providers: Record<string, ChatProvider>;
  /** policy 产物（TeamRuntime/隔离会话共用；workspace-write 档 + 审批策略由调用方编译） */
  policyArtifacts: PolicyArtifacts;
  /** 开发者会话可见工具面（TeamRuntime 按 preset 能力面 shrink-only 收窄） */
  tools: ToolSpec[];
  /** developer preset id（registry 内 role=generator；默认 DEVELOPER_PRESET_ID） */
  developerPresetId?: string;
  /** developer 会话的 providers 表键 */
  developerProviderId: string;
  /** developer 会话模型 */
  developerModel: string;
  /** 档位意图（展示/审计；显式阵容） */
  developerTier?: string;
  /** preset registry（缺省 seed 默认三角色的 createDefaultPresetRegistry()） */
  presetRegistry?: PresetRegistry;
  /** team EventBus（TeamProjection 挂接点）；缺省 TeamRuntime 自建 */
  bus?: EventBus;
  stableSections?: string[];
  policyGuidance?: string[];
  /** 有界 developer 回合（AgentLoop maxSteps；缺省 = AgentLoop 默认机械硬顶） */
  maxSteps?: number;
  /** workspace 改动扫描排除目录（缺省 DEFAULT_EXCLUDE_DIRS） */
  excludeDirs?: readonly string[];
  /**
   * history 有界上限（V1.1-B）：adapter 内存内保最近 N 条运行记录（FIFO 覆盖最旧；计数走 total，
   * 覆盖不清零）。缺省 100 —— 约 6KB/record，内存上界 ≈600KB，杜绝 soak 观察到的 13.5→24.3MB
   * 单调上行。`lastRun` 恒在环内可得；`runs` 返回最近 N 条。IterationStore 不做全量 history 扫描
   * （append 时 lastRun 整记录即时入参），故有界不破坏迭代完整性。传 0 或负数 → fail loud。
   */
  historyLimit?: number;
}

/** 一次 developer 运行的输入（任务对象形状 —— 与 engine LoopTask 同构）。 */
export interface GeneratorRunRequest {
  id: string;
  goal: string;
  /** 验收标准（透传/回读用；Evaluator 侧 062 消费，不进 developer 自评） */
  acceptance?: readonly string[];
  /** 本次运行的隔离 workspace 根（LoopEngine workspaceFactory / 064 worktree 提供） */
  workspaceRoot: string;
  /** engine 迭代/尝试编号（generate seam 传入；独立调用缺省 1） */
  iteration?: number;
  attempt?: number;
}

/** 一次 developer 运行的完整记录 —— 结论可回读（比 GeneratorOutput 契约更全）。 */
export interface GeneratorRunRecord {
  taskId: string;
  goal: string;
  acceptance?: readonly string[];
  /** developer 产出文本（自述；Evaluator 核验对象） */
  output: string;
  /** 磁盘证据：运行期间新建/改动的文件（相对 workspace；只信盘上事实） */
  artifactPaths: readonly string[];
  /** developer 成员摘要（sessionId/stopReason/durationMs —— 会话级结论可回读） */
  developer: TeamMemberSummary | null;
  teamRunId: string;
  workspaceRoot: string;
  iteration: number;
  attempt: number;
  startedAt: number;
  durationMs: number;
}

function fail(message: string): never {
  throw new Error(`RealGeneratorAdapter: ${message}`);
}

function rel(root: string, p: string): string {
  return path.relative(root, p).replace(/\\/g, '/');
}

/**
 * 证据扫描：递归列出 root 下的全部文件（相对路径 → sha256）。跳过排除目录（任意深度）、
 * 符号链接（防逃逸 root）与非普通文件。纯函数 —— 测试直接断言。
 */
export function scanWorkspaceFiles(root: string, excludeDirs: readonly string[] = DEFAULT_EXCLUDE_DIRS): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 目录被并发删除等 —— 该分支跳过（证据扫描容错，不 fail loud）
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (excludeDirs.includes(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        const full = path.join(dir, e.name);
        try {
          const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
          out.set(rel(root, full), hash);
        } catch {
          // 读失败（权限/竞态）—— 不纳入证据（宁缺毋假）
        }
      }
      // symlink / socket 等一律忽略
    }
  };
  walk(root);
  return out;
}

/**
 * 改动 diff：after 中相对 before 新建的、或内容哈希变化的文件（相对路径，排序稳定）。
 * 只信盘上事实：before==after（无改动）→ []，不把 developer 的自述当证据。
 */
export function diffWorkspaceSnapshots(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const [relPath, sha] of after) {
    const prev = before.get(relPath);
    if (prev === undefined || prev !== sha) changed.push(relPath);
  }
  changed.sort();
  return changed;
}

/**
 * RealGeneratorAdapter —— LoopEngine Generator seam 的真实实现（task 061）。
 *
 * 用法（引擎侧接线）：
 * ```ts
 * const generator = new RealGeneratorAdapter({
 *   providers, policyArtifacts, tools,
 *   developerProviderId: 'pro', developerModel: 'deepseek-v4',
 * });
 * const engine = new LoopEngine({ selectTask, generate: (ctx) => generator.generate(ctx), evaluate, persist, workspaceFactory, disposeWorkspace });
 * ```
 * 每次 generate() = 一次有界 developer 运行（默认上限 1/1 由 LoopEngine 选项实施，§11.1）。
 */
export class RealGeneratorAdapter {
  private readonly opts: RealGeneratorAdapterOptions;
  private readonly registry: PresetRegistry;
  private readonly excludeDirs: readonly string[];
  private readonly history: RingHistory<GeneratorRunRecord>;
  /** history 有界上限（= options.historyLimit ?? DEFAULT_HISTORY_LIMIT）。 */
  readonly historyLimit: number;

  constructor(opts: RealGeneratorAdapterOptions) {
    if (!opts.developerProviderId || !opts.developerProviderId.trim()) {
      fail('options.developerProviderId must be a non-empty string');
    }
    if (!opts.developerModel || !opts.developerModel.trim()) {
      fail('options.developerModel must be a non-empty string');
    }
    if (!opts.providers[opts.developerProviderId]) {
      const available = Object.keys(opts.providers);
      fail(
        `developer provider "${opts.developerProviderId}" is not bound ` +
          `(available providers: ${available.length > 0 ? available.join(', ') : 'none'})`,
      );
    }
    if (!opts.policyArtifacts) fail('options.policyArtifacts is required');
    if (!opts.tools) fail('options.tools is required (may be an empty list)');
    this.opts = opts;
    this.registry = opts.presetRegistry ?? createDefaultPresetRegistry();
    // generator-side 守卫：developer preset 必须是 generator 角色（reviewer/lead 会产出错位阶段）
    const presetId = opts.developerPresetId ?? DEVELOPER_PRESET_ID;
    const preset = this.registry.getPreset(presetId);
    if (preset.role !== 'generator') {
      fail(`preset "${presetId}" has role "${preset.role}" — RealGeneratorAdapter is generator-side, use a generator preset (e.g. "${DEVELOPER_PRESET_ID}")`);
    }
    this.excludeDirs = opts.excludeDirs ?? DEFAULT_EXCLUDE_DIRS;
    this.historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.history = new RingHistory<GeneratorRunRecord>(this.historyLimit);
  }

  get presetId(): string {
    return this.opts.developerPresetId ?? DEVELOPER_PRESET_ID;
  }

  /**
   * 已完成的运行记录（按调用序，保最近 historyLimit 条）—— 结论可回读。
   * 有界环：超过上限后最旧条目被覆盖（计数看 totalRuns），lastRun 恒在环内。
   */
  get runs(): readonly GeneratorRunRecord[] {
    return this.history.items;
  }

  /** 单调已产生运行总数（覆盖不清零 —— 计数消费方不因有界环失真）。 */
  get totalRuns(): number {
    return this.history.total;
  }

  get lastRun(): GeneratorRunRecord | undefined {
    return this.history.last;
  }

  /**
   * LoopEngine Generator seam：一次有界 developer 运行 → GeneratorOutput
   * （output = 产出文本；artifactPaths = 盘上改动证据）。每次调用新起一个 TeamRuntime
   * 单成员阵容（developer），成员会话收尾即关 —— 无跨调用状态泄漏。
   */
  async generate(ctx: GenerateContext): Promise<GeneratorOutput> {
    const rec = await this.run({
      id: ctx.task.id,
      goal: ctx.task.goal,
      acceptance: ctx.task.acceptance,
      workspaceRoot: ctx.workspace.root,
      iteration: ctx.iteration,
      attempt: ctx.attempt,
    });
    return { output: rec.output, artifactPaths: [...rec.artifactPaths] };
  }

  /**
   * 直接入口（不经 engine ctx；供队列/测试/062 复用同一形状）：
   * 任务（含验收标准）→ developer 产出 → 完整记录回读。
   */
  async run(req: GeneratorRunRequest): Promise<GeneratorRunRecord> {
    if (!req.id || !req.goal) {
      fail(`task needs id + goal (got ${JSON.stringify({ id: req.id, goal: req.goal })})`);
    }
    const workspaceRoot = path.resolve(req.workspaceRoot);
    if (!req.workspaceRoot || !fs.existsSync(workspaceRoot)) {
      fail(`run requires an existing isolated workspace root (task 064 worktree / TempDirWorkspaceFactory); got "${req.workspaceRoot ?? ''}"`);
    }
    const presetId = this.presetId;
    const startedAt = Date.now();

    // 证据基线：developer 运行前的 workspace 快照（.git/.harness/.vessel/node_modules 排除）
    const before = scanWorkspaceFiles(workspaceRoot, this.excludeDirs);

    // TeamRuntime 单成员阵容（developer —— generator 角色；不配 orchestrator → 不走 delegate）
    const runtime = new TeamRuntime({
      workspaceRoot,
      providers: this.opts.providers,
      policyArtifacts: this.opts.policyArtifacts,
      tools: this.opts.tools,
      presetRegistry: this.registry,
      bus: this.opts.bus,
      stableSections: this.opts.stableSections,
      policyGuidance: this.opts.policyGuidance,
      maxSteps: this.opts.maxSteps,
    });

    const summary = await runtime.runTeam({
      task: req.goal,
      acceptance: req.acceptance,
      roster: [
        {
          memberId: presetId,
          presetId,
          model: this.opts.developerModel,
          providerId: this.opts.developerProviderId,
          tier: this.opts.developerTier,
        },
      ],
    });

    if (summary.outcome !== 'completed') {
      // developer 会话失败 —— fail loud（运行失败是返回态不是成功产出；不静默转 output）
      fail(`developer run failed: ${summary.error ?? 'unknown phase error'}`);
    }

    const developer =
      summary.members.find((m) => m.memberId === presetId && m.phase === 'generate' && m.status === 'completed') ??
      summary.members[0] ??
      null;
    if (!developer || typeof developer.output !== 'string' || developer.output.trim() === '') {
      fail(`developer member produced no output (members=${summary.members.length})`);
    }

    // 磁盘证据：运行后快照 diff —— 只信盘上新建/改动，不信 developer 自述文件清单
    const after = scanWorkspaceFiles(workspaceRoot, this.excludeDirs);
    const artifactPaths = diffWorkspaceSnapshots(before, after);

    const record: GeneratorRunRecord = {
      taskId: req.id,
      goal: req.goal,
      acceptance: req.acceptance ? [...req.acceptance] : undefined,
      output: developer.output,
      artifactPaths,
      developer,
      teamRunId: summary.teamRunId,
      workspaceRoot,
      iteration: req.iteration ?? 1,
      attempt: req.attempt ?? 1,
      startedAt,
      durationMs: Date.now() - startedAt,
    };
    this.history.push(record);
    return record;
  }
}
