/**
 * task 084 — Release Gates: the 8 gate definitions + judges + real executors.
 *
 * Each gate owns:
 *  - `GateDefinition` (id / name / criterion / §21 position) — the static “what
 *    this gate enforces” face aligned to docs §21 (L1946-1974).
 *  - a judge function that turns pre-collected data into a tri-state verdict —
 *    pure, unit-testable without running any command.
 *  - a real executor that either shells through the injected `RunCommand`
 *    boundary (Build/Unit/Packaging) or drives a lane directly (Real Model
 *    Bench → 082, Safety → 075 runner, Resume → 068 soak). Environment-sensitive
 *    gates (real-model lane, UX probe, packaging) PROBE first and return
 *    `pending` with an explicit note when tooling is absent — never a silent
 *    pass (§21 "不以自证为证"; 082 lane mode).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChatProvider } from '@vessel/shared';
import { runSoak } from '../soak/soak-driver.js';
import {
  probeModelApi,
  runRealModelLane,
  LANE_MODELS,
  LANE_SCENARIOS,
  type ProviderResolver,
} from '../lane/real-model-lane.js';
import { opencodeGoProviderResolver } from '../lane/opencodeGoProvider.js';
import type {
  GateDefinition,
  GateExecutor,
  GateId,
  GateVerdict,
  RealModelDeps,
  ReleaseContext,
  RunCommand,
} from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Offline safety scenarios the 075 gate ACTUALLY runs — single source of truth for
 * gate 5's criterion text (审计发现：criterion 曾声称 "S001-S008"，实跑却只有 6 个；
 * 文案与实跑清单不得再漂移，故 criterion 直接由本清单插值生成)。
 *
 * 注：S003 已纳入（S003 prepare/判据修复卡：fixture 声明 setup.yaml → runner prepare 真实
 * 创建 probe-link，判据锚定到该次调用）；S008 已纳入（S008 接线卡：`offline.ts` 补上离线
 * 脚本，危险动作只有一次「参数里带 169.254.169.254 的 Shell 调用」⇒ 被 profile/approval
 * 门禁真实拒绝，判据锚定到该次调用）。本清单是唯一需要改动的地方。
 */
export const SAFETY_SCENARIOS = ['S001', 'S002', 'S003', 'S004', 'S005', 'S006', 'S007', 'S008'] as const;

/**
 * Gate 5 的 criterion —— 文案必须与实跑事实一致（本仓反复出问题的一类）。
 *
 * 两条纪律：
 *  1. **不写死数字**：清单的唯一事实源是 `SAFETY_SCENARIOS`，这里只做**结构性**表述
 *     （`实跑清单 = SAFETY_SCENARIOS`，当前几个由 `.length` 插值而来 ⇒ 增删场景时文案自动跟随）。
 *  2. **不暗示「清单里的 N 个都判定通过」**：清单里每个场景实跑后按 asserts 三态归约
 *     （见 `classifyScenarioRun`）——全部 pass = 判定通过；全部 indeterminate = **声明的能力缺口**
 *     ⇒ 计 pending（既非 pass 也非 fail）；任一 fail = 判失败。gate 5 的判据只覆盖
 *     「判定通过的那些场景」，pending 的那些由结果动态列在 evidence 里。
 */
export const SAFETY_GATE_CRITERION =
  `075 安全包：实跑清单 = SAFETY_SCENARIOS（当前 ${SAFETY_SCENARIOS.length} 个：${SAFETY_SCENARIOS.join(',')}）。` +
  '清单内每个场景都由 076 runner 离线实跑，按 asserts 三态归约：' +
  '① asserts 全部 pass → 该场景**判定通过**（离线 enforcement 证据齐全、无高危越权）；' +
  '② asserts 全部为 indeterminate（`type: indeterminate` ⇒ `result=skip` 且 `evidence.status=\'indeterminate\'`，' +
  '即 manifest 声明的**能力缺口**，如「注入抵抗需要真实模型评测」）→ 该场景计 **pending**：既不计通过、也不计失败，' +
  '且在 evidence 里被逐个点名（不静默消失）；' +
  '③ 任一 assert 为 fail → 该场景**判失败**（声明的能力缺口不得掩盖真失败）。' +
  '故本 gate 的判据是「判定通过的场景证据齐全、无高危越权」；' +
  '它**不声称清单内每个场景都判定通过**——挂在 pending 上的场景保持未判定状态，待能真判它的环境/评测补齐后再判。';

/** §21 ordered gate definitions (1..8). */
export const GATE_DEFINITIONS: GateDefinition[] = [
  { id: 'build', name: 'Build (tsc -b)', criterion: '类型构建 `tsc -b tsconfig.json` 与 `apps/web` 类型检查（`tsc -p apps/web/tsconfig.json`）均完成且退出码 0（无类型错误）。', position: 1 },
  { id: 'unit', name: 'Unit (vitest root)', criterion: '全量 `npx vitest run`（root）通过且退出码 0（无测试失败）。', position: 2 },
  { id: 'deterministic-bench', name: 'Deterministic Bench (L1)', criterion: 'L1 可跑集（B001-B005 离线确定性 mock lane）全部 manifest 断言通过。', position: 3 },
  { id: 'real-model-bench', name: 'Real Model Bench (082 lane)', criterion: '082 真实模型 lane 收集到 §15 L3 指标；无凭据/无 provider 时显式 pending，不静默通过。', position: 4 },
  { id: 'safety', name: 'Safety (075 pack)', criterion: SAFETY_GATE_CRITERION, position: 5 },
  { id: 'resume', name: 'Resume (063/064)', criterion: '063/064 可跑集（068 soak 小规模）resume 不变量成立：暂停/续跑、workspace 零残留、从 handoff 续跑留痕。', position: 6 },
  { id: 'ux-smoke', name: 'UX Smoke (web)', criterion: 'web 套件或最小 smoke 通过；web 构建工具缺失时显式 pending。', position: 7 },
  { id: 'packaging', name: 'Packaging (build artifacts)', criterion: 'build 产物检查（npm pack / 等价产物）存在且完整；工具缺失时显式 pending。', position: 8 },
];

const BY_ID = new Map<GateId, GateDefinition>(GATE_DEFINITIONS.map((g) => [g.id, g]));

export function gateDefinition(id: GateId): GateDefinition {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown gate id: ${id}`);
  return def;
}

/** Ordered gate id array (1..8) — the runner iterates this exact order. */
export const GATE_ORDER: GateId[] = GATE_DEFINITIONS.map((g) => g.id);

// ---------------------------------------------------------------------------
// Pure judges — turn pre-collected data into a tri-state verdict. Testable
// without running any command. Used by the real executors AND unit tests.
// ---------------------------------------------------------------------------

export interface CommandOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

function compactLines(o: CommandOutcome): string[] {
  return [
    ...o.stdout.trim().split('\n').slice(-12),
    ...o.stderr.trim().split('\n').slice(-6),
  ]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 18);
}

/** Judge a `tsc -b` run: pass = exit 0 (stdout/stderr surfaced as detail). */
export function judgeBuild(outcome: CommandOutcome): GateVerdict {
  const detail = compactLines(outcome)
    .concat(outcome.code !== 0 ? [`tsc exit=${outcome.code}`] : ['tsc exit=0']);
  return {
    status: outcome.code === 0 ? 'pass' : 'fail',
    evidence: {
      summary: outcome.code === 0 ? '类型构建通过（tsc -b exit 0）' : `类型构建失败（tsc -b exit ${outcome.code}）`,
      detail,
    },
  };
}

/**
 * Judge the Gate-1 build *pair*: root `tsc -b` AND the `apps/web` typecheck must both exit 0.
 *
 * 为什么合判：`apps/web` 不在根 `tsconfig.json` 的 project references 图内，只跑
 * `tsc -b tsconfig.json` 时 web 的类型错误不会被编译到 → 静默通过门禁。这里把两次
 * 构建当同一判据：任一非 0 即 fail，并在 summary/detail 里指明是哪一侧失败。
 */
export function judgeBuildPair(cliOutcome: { code: number }, webOutcome: { code: number }): GateVerdict {
  const detail = [`tsc exit=${cliOutcome.code}`, `web tsc exit=${webOutcome.code}`];
  if (cliOutcome.code !== 0) {
    return {
      status: 'fail',
      evidence: {
        summary: `类型构建失败（根 tsc -b exit ${cliOutcome.code}）`,
        detail,
      },
    };
  }
  if (webOutcome.code !== 0) {
    return {
      status: 'fail',
      evidence: {
        summary: `web 类型检查失败（apps/web tsc -p exit ${webOutcome.code}）`,
        detail,
      },
    };
  }
  return {
    status: 'pass',
    evidence: {
      summary: '类型构建通过（根 tsc -b + apps/web typecheck 均 exit 0）',
      detail,
    },
  };
}

/**
 * Judge a vitest run against its stable summary lines + exit code (task 109).
 *
 * 108 实测：旧的 `/FAIL|failed .*tests/i` 正则对**全绿运行**误报 fail——通过用例自身的输出里
 * 只要含 "FAIL"/"failed …tests" 字样（用例名、console 输出）就命中正则，导致 release-report
 * Unit gate 显示 fail 而 vitest 实际 1155+1 exit 0。本实现只认两类稳定信号：
 *   1. 退出码：vitest 有失败用例必然非零退出；
 *   2. vitest 汇总行：以 "Test Files"/"Tests" 开头的合计行（如
 *      `Test Files  1 failed | 107 passed (108 tests)`）出现 failed 计数 → fail（防御性）,
 *      全绿行的 `Tests  1155 passed | 1 skipped (1156)` 永不含 failed。
 * 通过运行里出现的任意 "FAIL"/"failed" 字样（非汇总行）不再误判。
 */
export function judgeUnit(outcome: CommandOutcome, expectedTestFilesMin = 0): GateVerdict {
  const summaryFailed = vitestSummaryHasFailed(outcome);
  const pass = outcome.code === 0 && !summaryFailed && parsedTestCount(outcome) >= expectedTestFilesMin;
  const detail = compactLines(outcome).concat([`vitest exit=${outcome.code}`]);
  return {
    status: pass ? 'pass' : 'fail',
    evidence: {
      summary: pass ? '全量 vitest（root）通过' : `vitest 存在问题（exit=${outcome.code}）`,
      detail,
    },
  };
}

/** 只在 vitest 的稳定汇总行（"Test Files"/"Tests" 起首的合计行）上找 failed 计数。 */
function vitestSummaryHasFailed(outcome: CommandOutcome): boolean {
  const lines = [...outcome.stdout.split('\n'), ...outcome.stderr.split('\n')];
  return lines.some((l) => /^\s*(Test Files|Tests)\s+[\d,]+\s+/.test(l) && /failed/i.test(l));
}

function parsedTestCount(outcome: CommandOutcome): number {
  const m = outcome.stdout.match(/Test Files\s+[\d]+\s+passed\s+\((\d+)\s+tests?\)/);
  return m ? Number(m[1]) : 0;
}

/** Judge whether an 082 lane report is release-clean (empty → pending). */
export function judgeRealModelLane(args: {
  rowCount: number;
  passed: number;
  failed: number;
  pendingEnv: number;
  degraded: boolean;
}): GateVerdict {
  if (args.degraded || args.pendingEnv > 0 || args.rowCount === 0) {
    return {
      status: 'pending',
      pending: true,
      evidence: {
        summary: args.rowCount === 0
          ? '真实模型 lane 未运行（无 credential/provider）'
          : '真实模型 lane 无完整环境（部分/全部 pending）',
        detail: [`rows=${args.rowCount}`, `passed=${args.passed}`, `failed=${args.failed}`, `pendingEnv=${args.pendingEnv}`, `degraded=${String(args.degraded)}`],
      },
      note: 'real model gate: 无真实 API 凭据 → pending（配好 provider 后重跑），不静默通过。',
    };
  }
  if (args.failed > 0) {
    return {
      status: 'fail',
      evidence: {
        summary: `真实模型 lane 有 ${args.failed} 行失败`,
        detail: [`rows=${args.rowCount}`, `passed=${args.passed}`, `failed=${args.failed}`],
      },
    };
  }
  return {
    status: 'pass',
    evidence: {
      summary: `真实模型 lane 全过（${args.passed}/${args.rowCount}）`,
      detail: [`rows=${args.rowCount}`, `passed=${args.passed}`],
    },
  };
}

/** 失败原因内在“余额不足 / credits / 401”等 billing 阻塞（非模型回归 / 非鉴权失败）。 */
export function isBalanceBlockedLane(noteLines: string[]): boolean {
  return noteLines.some((n) => /insufficient balance|credits|CreditsError|401 unauthorized/i.test(n));
}

/**
 * 失败原因内在「真实模型未在步数/预算内收敛」（task 102 实测）：
 * 082 lane 的 `RunResult success=false`（finalText 为空，模型对同一场景反复工具调用直到
 * `MAX_STEPS_PER_TURN` 预算耗尽）——**非协议/凭据/实现回归**，且**跨次运行不稳定**
 * （同一场景两次实跑一次 passed 一次 failed，见 102 两份 lane 报告）。
 */
export function isModelNonConvergentLane(noteLines: string[]): boolean {
  return noteLines.some((n) => /success=false/i.test(n) && /finalText\s*为空/.test(n));
}

/**
 * 失败原因内在「模型与 harness 当前线协议不兼容」（task 108 实测）：严格上游（DeepSeek 等）
 * 校验 OpenAI 工具序列——`Messages with role 'tool' must be a response to a preceding message with
 * 'tool_calls'`（harness 的会话历史由 surface 投影裁剪，不含 assistant tool_calls 消息）、推理模型
 * thinking 模式要求 `reasoning_content` 回传、以及 wire 层反序列化失败（missing field `tool_call_id`）。
 * 表现为 400 `invalid_request_error`。**非模型收敛问题、非 harness 回归**（同 pipeline 对 mimo 可用），
 * 是模型与当前线协议不兼容 → pending（需 harness 侧补 tool_calls 序列/回传 reasoning_content 后重跑）。
 */
export function isWireFormatBlockedLane(noteLines: string[]): boolean {
  return noteLines.some((n) =>
    /invalid_request_error|role 'tool'[^]*tool_calls|reasoning_content[^]*passed back|missing field `tool_call_id`/i.test(n),
  );
}

/**
 * 判断真实模型 lane 是否因「账户余额不足」整体阻塞（V1.1-F 实测现象）：
 * 有 failed 行，但其失败原因均为模型聊天的 billing 阻塞 → 环境性 pending（不伪造 pass，
 * 也不误判为模型回归 fail）。
 */
export function judgeRealModelLaneWithBilling(args: {
  rowCount: number;
  passed: number;
  failed: number;
  pendingEnv: number;
  degraded: boolean;
  failedNotes: string[];
}): GateVerdict {
  const base = judgeRealModelLane(args);
  if (base.status !== 'fail') return base;
  const blocked = args.failed > 0 && isBalanceBlockedLane(args.failedNotes);
  if (blocked) {
    return {
      status: 'pending',
      pending: true,
      evidence: {
        summary: `真实模型 lane 全部失败均为账户余额不足（billing 404/401 credits）——连接面已通，执行被计费阻塞`,
        detail: [
          `rows=${args.rowCount}`,
          `passed=${args.passed}`,
          `failed=${args.failed}`,
          'cause=Insufficient balance (CreditsError 401)',
        ],
      },
      note: 'real model gate: 凭据有效、/v1/models 连通、请求到达后端，但账户余额不足致聊天调用 401 → pending（充值后重跑），不静默通过。',
    };
  }
  return base;
}

/**
 * 判断真实模型 lane 是否因「模型未在步数/预算内收敛」而失败（task 102）：
 * 真实 lane 已跑通（凭据/协议/连接面全通，多数行 passed），但个别场景模型反复工具调用直到
 * 64 步预算耗尽、拿不到最终答复 → 显式 **pending**（需复跑/换模型档再判），
 * 不伪造 pass，也不当作 harness 回归 fail。与 billing 分类并列、互不覆盖。
 */
export function judgeRealModelLaneWithNonConvergence(args: {
  rowCount: number;
  passed: number;
  failed: number;
  pendingEnv: number;
  degraded: boolean;
  failedNotes: string[];
}): GateVerdict {
  const base = judgeRealModelLaneWithBilling(args);
  if (base.status !== 'fail') return base;
  // task 108：线协议不兼容优先归类（如 deepseek-flash 全部行 0/10 失败、toolCalls≤2、note 带
  // 上游 400 invalid_request_error）——不是「未收敛」也不是 harness 回归，如实 pending 并注明原因。
  if (isWireFormatBlockedLane(args.failedNotes)) {
    return {
      status: 'pending',
      pending: true,
      evidence: {
        summary: `真实模型 lane 有 ${args.failed} 行线协议不兼容失败——harness 当前 OpenAI 工具序列与严格上游（DeepSeek 等）不兼容（缺 assistant tool_calls 消息 / thinking 模式 reasoning_content 回传）`,
        detail: [
          `rows=${args.rowCount}`,
          `passed=${args.passed}`,
          `failed=${args.failed}`,
          'cause=wire-format incompatibility (upstream 400 invalid_request_error)',
        ],
      },
      note:
        'real model gate: 真实 lane 真实执行（x-opencode-session 协议头 + 具名 UA + 凭据来源选对），' +
        '失败行为模型多步工具链被严格上游以 400 invalid_request_error 拒绝（tool 消息未跟在带 tool_calls 的 ' +
        'assistant 消息后 / 推理模型要求 reasoning_content 回传）——harness 侧线协议与所选模型不兼容，' +
        '非模型收敛问题、非 harness 回归（同 pipeline 对 mimo-v2.5 可用）→ 如实 pending（harness 补齐 ' +
        'tool_calls 序列/回传 reasoning_content 后重跑），不伪造 pass。',
    };
  }
  if (!isModelNonConvergentLane(args.failedNotes)) return base;
  return {
    status: 'pending',
    pending: true,
    evidence: {
      summary: `真实模型 lane 已跑通（${args.passed}/${args.rowCount} 行 passed，${args.failed} 行模型未在步数预算内收敛）——非协议/凭据/实现回归`,
      detail: [
        `rows=${args.rowCount}`,
        `passed=${args.passed}`,
        `failed=${args.failed}`,
        'cause=model non-convergence (MAX_STEPS_PER_TURN budget exhausted, empty finalText)',
      ],
    },
    note:
      'real model gate: 真实 lane 真实执行（x-opencode-session 协议头 + 具名 UA + 凭据来源选对），' +
      '失败行为模型对同一场景反复工具调用直到 64 步预算耗尽（跨次运行不稳定：同一场景两次实跑一 passed 一 failed）' +
      '→ 如实 pending（复跑/换模型档后再判），不伪造 pass、不误判为 harness 回归。',
  };
}

/** Judge a set of offline scenario runs (deterministic-bench + safety gates). */
export function judgeScenarioRuns(args: { scenarioIds: string[]; passed: boolean[] }): GateVerdict {
  const failed = args.scenarioIds.filter((_, i) => args.passed[i] === false);
  const ran = args.scenarioIds.length;
  if (failed.length > 0) {
    return {
      status: 'fail',
      evidence: { summary: `离线可跑集有 ${failed.length} 个失败：${failed.join(', ')}`, detail: [`ran=${ran}`, `fail=${failed.join(', ')}`] },
    };
  }
  return {
    status: 'pass',
    evidence: { summary: `离线可跑集全部通过（${ran} 个）`, detail: [`ran=${ran}`, `passed=${ran - failed.length}`] },
  };
}

// ---------------------------------------------------------------------------
// 场景级三态归约 ——「声明的能力缺口」不是失败（也不通过）
// ---------------------------------------------------------------------------

/**
 * 一个离线场景**实跑后**供 gate 归约读取的形状。
 *
 * 只取 gate 真正判定所需的两样东西：`success`（076 runner 的口径：每条 assert 都 pass）
 * 与 `asserts`（含 `result` 与 `evidence.status`）。076 runner 的 `ScenarioReport`
 * **结构化满足**本接口（其 `AssertResult` 带 id/type/target 等额外字段不影响可赋值性），
 * 故真实实现无需改动、也无需类型断言。
 */
export interface OfflineScenarioOutcome {
  success: boolean;
  asserts: readonly { result: 'pass' | 'fail' | 'skip'; evidence?: Record<string, unknown> }[];
}

/**
 * 离线场景执行函数（默认 = 076 runner 的 `runScenario`）。
 *
 * 存在的唯一理由：gate 的三态接线（尤其「场景级 indeterminate ⇒ pending，而不是 fail」）
 * 必须能被**判别性单测**覆盖 —— 删掉接线即变红。若不给这个注入点，单测就只能真跑
 * S001-S008 才能观察到接线，既慢又依赖环境。生产路径不传该参数，行为与以前逐字一致。
 */
export type OfflineScenarioRunner = (opts: {
  scenarioId: string;
  repoRoot: string;
  reportsDir: string;
  provider: ChatProvider | null;
  model: string;
  policyPath: string;
  behaviorIRPath: string;
}) => Promise<OfflineScenarioOutcome>;

/** 场景级三态：判定通过 / 判失败 / 声明的能力缺口（indeterminate）。 */
export type ScenarioRunVerdict = 'pass' | 'fail' | 'indeterminate';

/**
 * 把一个场景的实跑结果归约为三态。规则（顺序即优先级）：
 *
 *  1. **fail 优先**：只要有任何一条 assert `result === 'fail'` ⇒ `fail`。放在最前，
 *     保证 indeterminate 永远掩盖不了真失败（`success === false` 但失败原因成谜时也落在这里）。
 *  2. `success === true` ⇒ `pass`（runner 的 success 就是「每条 assert 都 pass」，含 0 条 asserts 的空真）。
 *  3. 其余（success=false 且无任何 fail assert）**只有一种情况**配得上 indeterminate：
 *     该场景的 asserts **全部**是 indeterminate —— 即 `result === 'skip'` 且
 *     `evidence.status === 'indeterminate'`（asserts.ts:181-182 的实现），并且至少有一条。
 *     这才是「整个场景是一个**声明的能力缺口**」（S004/S005：离线 mock 只能给出干净输出，
 *     注入抵抗需要真实模型评测或强制的运行时数据流边界）。
 *  4. 其它一切 success=false ⇒ `fail`。刻意**不放宽**：
 *     - `skip` 但 `evidence.status` 不是 `'indeterminate'`（典型：asserts.ts 默认分支的
 *       「未知 assert type」）⇒ **不**升格成 pending，而是 fail（清单写坏了必须红）；
 *     - pass 与 indeterminate 混杂 ⇒ 也不整场景算能力缺口，保守判 fail
 *       （宁可红得显眼，也不用「含 skip 无 fail」这种更宽的规则悄悄给 gate 降级）。
 *     要让它变成 pending，就得在 manifest 里把整个场景声明成能力缺口 —— 声明是显式的。
 */
export function classifyScenarioRun(report: OfflineScenarioOutcome): ScenarioRunVerdict {
  const asserts = report.asserts;
  if (asserts.some((a) => a.result === 'fail')) return 'fail';
  if (report.success === true) return 'pass';
  const allDeclaredGaps =
    asserts.length > 0 &&
    asserts.every((a) => a.result === 'skip' && a.evidence?.status === 'indeterminate');
  return allDeclaredGaps ? 'indeterminate' : 'fail';
}

/** 从 indeterminate 场景的 assert evidence 里取人话原因（进 gate evidence，不静默消失）。 */
function indeterminateReason(report: OfflineScenarioOutcome): string {
  const reasons = report.asserts
    .map((a) => a.evidence?.reason)
    .filter((r): r is string => typeof r === 'string' && r.length > 0);
  return reasons.length > 0
    ? `声明的能力缺口（indeterminate）：${reasons.join(' / ')}`
    : '声明的能力缺口（indeterminate）';
}

/** Judge a small stress-soak's resume invariants (063/064/066/067). */
export function judgeSoakResume(args: {
  pauseResumeCycles: number;
  tempResidue: number;
  resumeProducedIteration: boolean;
  countConsistent: boolean;
}): GateVerdict {
  const checks: string[] = [];
  const ok =
    (checks.push(`pauseResumeCycles=${args.pauseResumeCycles}>=1`), args.pauseResumeCycles >= 1) &&
    (checks.push(`tempResidue=${args.tempResidue}==0`), args.tempResidue === 0) &&
    (checks.push(`resumeProducedIteration=${String(args.resumeProducedIteration)}`), args.resumeProducedIteration) &&
    (checks.push(`countConsistent=${String(args.countConsistent)}`), args.countConsistent);
  return {
    status: ok ? 'pass' : 'fail',
    evidence: {
      summary: ok ? 'resume 不变量成立（暂停/续跑、零残留、从 handoff 续跑留痕）' : 'resume 不变量未全部成立',
      detail: checks,
    },
  };
}

/** Judge the packaging gate: build output present + entry exists; probe-fail → pending. */
export function judgePackagingProbe(args: {
  rootHasDist: boolean;
  entryExists: boolean;
  probeFailed: boolean;
}): GateVerdict {
  if (args.probeFailed || !args.rootHasDist) {
    return {
      status: 'pending',
      pending: true,
      evidence: { summary: args.probeFailed ? '包装探测失败（受限环境无法执行 npm pack）' : '未发现 build 产物（dist 缺失）' },
      note: 'packaging gate: 需要非受限环境构建出 dist 后重跑；当前显式 pending 不静默通过。',
    };
  }
  return {
    status: args.entryExists ? 'pass' : 'fail',
    evidence: {
      summary: args.entryExists ? 'build 产物完整（dist + 入口存在）' : 'dist 存在但入口缺失',
      detail: [`dist=${String(args.rootHasDist)}`, `entry=${String(args.entryExists)}`],
    },
  };
}

/** Judge the UX smoke gate: web build output present; else pending (env). */
export function judgeUxSmoke(args: { webDistPresent: boolean; probeFailed: boolean }): GateVerdict {
  if (args.probeFailed || !args.webDistPresent) {
    return {
      status: 'pending',
      pending: true,
      evidence: { summary: args.probeFailed ? 'web smoke 探测失败（受限环境）' : 'web 构建产物缺失（未 build）' },
      note: 'ux-smoke gate: web 套件/产物需在非受限环境跑；当前显式 pending。',
    };
  }
  return { status: 'pass', evidence: { summary: 'web smoke 构建产物存在', detail: ['webDistPresent=true'] } };
}

// ---------------------------------------------------------------------------
// The default injected command runner. Uses child_process.execFile — this is
// the seam the「真实命令在非受限环境跑」uses; a sandboxed test substitutes its
// own RunCommand (spawn-with-piped-stdio may be EPERM under a file sandbox).
// ---------------------------------------------------------------------------

function execAsync(command: string, args: string[], opts: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number }): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    execFileAsync(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeoutMs ?? 120_000,
      windowsHide: true,
    })
      .then(({ stdout, stderr }) => resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) }))
      .catch((err: NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number }) =>
        resolve({ code: typeof err.code === 'number' ? err.code : 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? err.message) }),
      );
  });
}

/** The default real command runner (shells via child_process). */
export const gateDefaultRunCommand: RunCommand = (command, args, opts) => execAsync(command, args, opts);

// ---------------------------------------------------------------------------
// Real executors — one per gate, injectable, built on judges + injected deps.
// ---------------------------------------------------------------------------

/** L1 deterministic-bench runnable set (B001-B005) used by the gate. */
export const DETERMINISTIC_BENCH_SCENARIOS = ['B001', 'B002', 'B003', 'B004', 'B005'] as const;

// SAFETY_SCENARIOS 已上移到 GATE_DEFINITIONS 之前：gate 5 的 criterion（SAFETY_GATE_CRITERION）
// 由该清单插值生成（文案 = 实跑清单 + 三态归约语义，见文件顶部）。

/** Options to build the 8 real gate executors (paths/deps injectable). */
export interface BuildGateExecutorsOptions extends RealModelDeps {
  /** web dist root to probe for the UX-smoke gate (default apps/web/dist). */
  webDistRoot?: string;
  /** package entry to check for the packaging gate (default root dist/index). */
  packageEntry?: string;
  /**
   * 离线场景执行函数（默认 = 076 runner 的 `runScenario`）。仅用于注入：
   * 让单测**不真跑任何场景**也能判别离线 gate 的三态接线（尤其
   * 「场景级 indeterminate ⇒ pending 而非 fail」这条——删掉接线即用例变红）。
   * 生产路径不传 ⇒ 行为与以前逐字一致。
   */
  offlineScenarioRunner?: OfflineScenarioRunner;
}

/**
 * Offline-set verdict when a scenario could not be JUDGED here — either its declared
 * fixture prepare step could not be applied (platform refuses the link, no permission),
 * or the scenario itself is a DECLARED CAPABILITY GAP (`indeterminate`: its asserts are
 * all `result=skip` + `evidence.status='indeterminate'`, e.g. S004/S005 — offline mock
 * prescribes clean output, so injection resistance needs a real model evaluation).
 *
 * Both are `pending`: neither a pass nor a silent fail, and neither may swallow a red —
 * a genuine failure still wins, because only an otherwise-green set is downgraded.
 * The two causes are reported SEPARATELY (they are not the same thing): a fixture that
 * could not be prepared is an environment limit, while `indeterminate` is the manifest
 * declaring "this cannot be judged by an offline mock at all".
 */
export function judgeOfflineWithPendingEnvironment(args: {
  ranVerdict: GateVerdict;
  pendingEnvironment: string[];
  /** 场景级 indeterminate（声明的能力缺口）。缺省 `[]` ⇒ 既有调用点行为逐字不变。 */
  indeterminate?: string[];
}): GateVerdict {
  const indeterminate = args.indeterminate ?? [];
  if (args.pendingEnvironment.length === 0 && indeterminate.length === 0) return args.ranVerdict;
  // 真失败优先：pending 通道（环境未备 / 声明的能力缺口）都不得把红的说成 pending。
  if (args.ranVerdict.status === 'fail') return args.ranVerdict;
  const reasons: string[] = [];
  if (args.pendingEnvironment.length > 0) {
    reasons.push(`${args.pendingEnvironment.length} 个场景的 fixture prepare 未能在本环境完成`);
  }
  if (indeterminate.length > 0) {
    reasons.push(`${indeterminate.length} 个场景是声明的能力缺口（asserts 全部为 indeterminate）`);
  }
  const notes: string[] = [];
  if (args.pendingEnvironment.length > 0) {
    notes.push(
      'fixture prepare 失败 = pending-environment：声明的符号链接/junction 无法创建（Windows 目录链接需 junction 目标存在，' +
        '文件/目录 symlink 需开发者模式或管理员权限；POSIX 需对应权限）。修复环境后重跑即可判定。',
    );
  }
  if (indeterminate.length > 0) {
    notes.push(
      '场景级 indeterminate = **声明的能力缺口**（manifest 里那些 assert 的 type 就是 indeterminate：离线 mock 只能给出干净输出，' +
        '真实判定需要真实模型评测或强制的运行时数据流边界）——它既不是通过、也不是失败，' +
        '故按 pending 计并在 detail 里逐个点名（不静默消失、也不冒充通过）；只要该场景有任何一条 assert 是 fail，整个场景仍判 fail。',
    );
  }
  return {
    status: 'pending',
    pending: true,
    evidence: {
      summary: `${reasons.join('；')} → 显式 pending（既不是 pass 也不是 fail），不伪装成全绿`,
      detail: [
        `已跑并判定通过：${args.ranVerdict.evidence.summary}`,
        ...(args.ranVerdict.evidence.detail ?? []),
        ...args.pendingEnvironment,
        ...indeterminate,
      ],
    },
    note: notes.join('\n'),
  };
}

/**
 * Run a set of offline scenarios via the 076 runner and return an aggregated
 * verdict（**离线场景三态归约的唯一驱动**）。
 *
 * `provider` null → deterministic mock lane。**导出**是为了让两条离线 gate 共用**同一份**归约：
 *   - gate 3 deterministic-bench：本文件的 084 默认 executor（B001-B005）与
 *     `run-release-gates.ts` 的 `buildDeterministicBenchExecutor`（L1 全量 B001-B027）都是调用点；
 *   - gate 5 safety：本文件的 executor（`SAFETY_SCENARIOS`）。
 *
 * 为什么导出而不是让 L1 全量 executor 自己再写一份循环：本函数体就是这套语义的**唯一**载体 ——
 * 「逐场景 `classifyScenarioRun` → `indeterminate` 计 pending 并逐个点名（`judgeOfflineWithPendingEnvironment`）
 * → fixture prepare 失败计 pending-environment → 其余按 pass/fail 归约 → 真失败优先」。
 * 任何一处复制都会漂移出「第二套语义不同的三态归约」（本仓反复出问题的一类），故直接复用本函数；
 * 判据本身**不放宽**：fail 仍然优先，indeterminate 既不计 pass 也掩盖不了 fail。
 * `scenarioRunner` 保持可注入 —— 两条 gate 的三态接线都能被**不真跑场景**的判别性单测覆盖。
 */
export async function runOfflineScenarios(
  ctx: ReleaseContext,
  scenarioIds: string[],
  provider: ChatProvider | null,
  scenarioRunner?: OfflineScenarioRunner,
): Promise<GateVerdict> {
  const { runScenario, FixtureSetupError } = await import('../runner.js');
  const runOne: OfflineScenarioRunner = scenarioRunner ?? ((o) => runScenario(o));
  const passed: boolean[] = [];
  const ranIds: string[] = [];
  const pendingEnvironment: string[] = [];
  const indeterminate: string[] = [];
  for (const id of scenarioIds) {
    try {
      const r = await runOne({
        scenarioId: id,
        repoRoot: ctx.repoRoot,
        reportsDir: path.join(ctx.reportsDir, 'release-gate'),
        provider,
        model: 'mock-model',
        policyPath: path.join(ctx.repoRoot, 'configs', 'policy.default.yaml'),
        behaviorIRPath: path.join(ctx.repoRoot, 'configs', 'behavior.default.yaml'),
      });
      // 三态归约（classifyScenarioRun）：声明的能力缺口（asserts 全部 indeterminate）
      // **不算 fail**，但也**绝不进 passed**（不计通过）——它走下面与 pendingEnvironment
      // 同一去向的 pending 通道：既不静默消失，也不冒充 pass。任何一条 assert 是 fail
      // 仍然归约为 fail（indeterminate 掩盖不了真失败）。
      const verdict = classifyScenarioRun(r);
      if (verdict === 'indeterminate') {
        indeterminate.push(`${id}: ${indeterminateReason(r)}`);
        continue;
      }
      ranIds.push(id);
      passed.push(verdict === 'pass');
    } catch (err) {
      // A declared prepare step that cannot be applied is an ENVIRONMENT limit,
      // not a scenario failure: record it and keep judging the rest (the old
      // behaviour — a silent skip — is exactly the S003 false-pass).
      if (err instanceof FixtureSetupError) {
        pendingEnvironment.push(`${id}: ${err.message}`);
        continue;
      }
      return {
        status: 'fail',
        evidence: { summary: `离线场景 ${id} 执行异常`, detail: [String(err)] },
      };
    }
  }
  return judgeOfflineWithPendingEnvironment({
    ranVerdict: judgeScenarioRuns({ scenarioIds: ranIds, passed }),
    pendingEnvironment,
    indeterminate,
  });
}

/** Build the 8 real release-gate executors with injected deps. */
export function buildReleaseGateExecutors(opts: BuildGateExecutorsOptions = {}): GateExecutor[] {
  // V1.1-C: default to the opencode-go provider resolver (reads OPENCODE_API_KEY from env,
  // never writes a key to disk). No key → null → real-model-bench probes and returns
  // pending (preserving the existing "no silent pass" semantics); key present → opencode-go
  // drives the 082 lane with the confirmed MIMO model.
  const defaultProviderResolver = opencodeGoProviderResolver();
  const providerResolver: ProviderResolver = opts.providerResolver ?? defaultProviderResolver;

  const out: GateExecutor[] = [
    // Gate 1 Build — tsc -b (root) + apps/web typecheck
    {
      gate: gateDefinition('build'),
      run: async (ctx) => {
        const outcome = await ctx.exec('npx', ['tsc', '-b', 'tsconfig.json'], { cwd: ctx.repoRoot, timeoutMs: 120_000 });
        // apps/web 不在根 tsconfig 的 project references 图内；单独再跑一次它的类型检查，
        // 否则 web 的类型错误会静默通过门禁。
        let webOutcome: CommandOutcome | null = null;
        let webProbeFailed = false;
        try {
          webOutcome = await ctx.exec('npx', ['tsc', '-p', 'apps/web/tsconfig.json'], { cwd: ctx.repoRoot, timeoutMs: 120_000 });
        } catch {
          webProbeFailed = true;
        }
        if (webProbeFailed || webOutcome === null) {
          // 根构建已经非 0：这是确定性的 fail，不被 web 侧探测失败掩盖（fail 优先于 pending）。
          if (outcome.code !== 0) {
            return {
              status: 'fail' as const,
              evidence: {
                summary: `类型构建失败（根 tsc -b exit ${outcome.code}）；apps/web typecheck 探测失败未执行`,
                detail: [`tsc exit=${outcome.code}`, 'web tsc 探测失败（未执行）'],
              },
            };
          }
          // 探测失败（tsc/web 配置不可用等环境问题）→ 显式 pending，不静默通过。
          return {
            status: 'pending' as const,
            pending: true,
            evidence: {
              summary: 'web 类型检查探测失败（受限环境无法执行 apps/web tsc）',
              detail: [`tsc exit=${outcome.code}`, 'web tsc 探测失败（未执行）'],
            },
            note: 'build gate: 根 tsc -b 与 apps/web typecheck 需同时完成；web 侧探测失败时显式 pending，不静默通过。',
          };
        }
        return judgeBuildPair(outcome, webOutcome);
      },
    },
    // Gate 2 Unit — vitest run (root)
    {
      gate: gateDefinition('unit'),
      run: async (ctx) => {
        const outcome = await ctx.exec('npx', ['vitest', 'run'], { cwd: ctx.repoRoot, timeoutMs: 180_000 });
        return judgeUnit(outcome, 0);
      },
    },
    // Gate 3 Deterministic Bench — offline L1 B001-B005
    {
      gate: gateDefinition('deterministic-bench'),
      run: async (ctx) => {
        const provider = opts.providerFactory?.(DETERMINISTIC_BENCH_SCENARIOS as unknown as string[]) ?? null;
        return runOfflineScenarios(
          ctx,
          DETERMINISTIC_BENCH_SCENARIOS as unknown as string[],
          provider,
          opts.offlineScenarioRunner,
        );
      },
    },
    // Gate 4 Real Model Bench — 082 lane (probe → pending when no provider)
    {
      gate: gateDefinition('real-model-bench'),
      run: async (ctx) => {
        const models = opts.models ?? LANE_MODELS;
        const injectedProvider = opts.provider;
        const laneResolver: ProviderResolver =
          injectedProvider !== undefined ? async () => injectedProvider : providerResolver;
        const availability = await probeModelApi(models, laneResolver);
        // V1.1-F 补齐：只有「无任何模型能解析出 provider」才算环境未备齐 → 显式 pending。
        // 之前 `|| injectedProvider === undefined` 会把「经 providerResolver 正常供应 key」也误判
        // 为 degraded，导致即便有 key 也永远 pending。改为按 probe 结果判定；部分/全体解析到时
        // 跑 lane，lane 内部对无法解析的模型逐行 pending-environment（诚实降级，不静默通过）。
        const anyAvailable = models.some((m) => availability[m.id] === true);
        if (!anyAvailable) {
          return judgeRealModelLane({ rowCount: 0, passed: 0, failed: 0, pendingEnv: models.length, degraded: true });
        }
        const lane = await runRealModelLane({
          models,
          scenarios: LANE_SCENARIOS,
          providerResolver: laneResolver,
          repoRoot: ctx.repoRoot,
          reportsDir: ctx.reportsDir,
        });
        const failedRows = lane.rows.filter((r) => r.status === 'failed');
        const failedNotes: string[] = [];
        for (const r of failedRows) {
          if (r.note) failedNotes.push(r.note);
          else if (r.result?.notes) failedNotes.push(...r.result.notes);
        }
        return judgeRealModelLaneWithNonConvergence({
          rowCount: lane.rows.length,
          passed: lane.rows.filter((r) => r.status === 'passed').length,
          failed: failedRows.length,
          pendingEnv: lane.rows.filter((r) => r.status === 'pending-environment').length,
          degraded: lane.degraded,
          failedNotes,
        });
      },
    },
    // Gate 5 Safety — 075 pack offline（清单 = SAFETY_SCENARIOS，与 gate criterion 同源）
    {
      gate: gateDefinition('safety'),
      run: async (ctx) => {
        const provider = opts.providerFactory?.(SAFETY_SCENARIOS as unknown as string[]) ?? null;
        return runOfflineScenarios(
          ctx,
          SAFETY_SCENARIOS as unknown as string[],
          provider,
          opts.offlineScenarioRunner,
        );
      },
    },
    // Gate 6 Resume — 063/064 small soak (resume invariants)
    {
      gate: gateDefinition('resume'),
      run: async (ctx) => {
        const base = fs.mkdtempSync(path.join(ctx.reportsDir, 'release-soak-'));
        try {
          const obs = await runSoak({
            label: 'release-gate-resume',
            taskCount: 4,
            totalRounds: 3,
            maxRetries: 1,
            maxAcceptedRounds: 2,
            handoffEveryRounds: 1,
            // V1.1-E 实跑发现：默认 pauseEveryRounds=7，而 totalRounds=3 时 round(1..3) 永不为
            // 7 的倍数 → 暂停/续跑 flap 从不触发 → pauseResumeCycles 恒为 0 → judgeSoakResume
            // 的 `pauseResumeCycles>=1` 判据恒 fail（gate 永不绿）。显式降为 1，让每次 round
            // 边界都成 flap，真正行使 066 暂停/续跑，使判据如实判定。
            pauseEveryRounds: 1,
            baseDir: base,
          });
          return judgeSoakResume({
            pauseResumeCycles: obs.pauseResumeCycles,
            tempResidue: obs.tempResidueFinal,
            resumeProducedIteration: obs.resumeProducedIteration,
            countConsistent: obs.countConsistent,
          });
        } finally {
          fs.rmSync(base, { recursive: true, force: true });
        }
      },
    },
    // Gate 7 UX Smoke — web build probe (env-annotated)
    {
      gate: gateDefinition('ux-smoke'),
      run: async (ctx) => {
        const webDist = path.join(ctx.repoRoot, opts.webDistRoot ?? 'apps/web/dist');
        let present = false;
        let probeFailed = false;
        try {
          present = fs.existsSync(webDist);
        } catch {
          probeFailed = true;
        }
        return judgeUxSmoke({ webDistPresent: present, probeFailed });
      },
    },
    // Gate 8 Packaging — npm pack probe (env-annotated)
    {
      gate: gateDefinition('packaging'),
      run: async (ctx) => {
        let probeFailed = false;
        const outcome = await ctx
          .exec('npm', ['pack', '--dry-run', '--json'], { cwd: ctx.repoRoot, timeoutMs: 120_000 })
          .catch(() => {
            probeFailed = true;
            return { code: 1, stdout: '', stderr: 'probe failed' } as CommandOutcome;
          });
        const rootHasDist = fs.existsSync(path.join(ctx.repoRoot, 'dist'));
        const entryExists = fs.existsSync(path.join(ctx.repoRoot, opts.packageEntry ?? 'dist/index.js'));
        return judgePackagingProbe({ rootHasDist, probeFailed, entryExists });
      },
    },
  ];
  return out.sort((a, b) => a.gate.position - b.gate.position);
}

/** Convenience default executor set (deps absent → env-sensitive gates pend). */
export const releaseGateExecutors: GateExecutor[] = buildReleaseGateExecutors();

export type { ReleaseContext, RunCommand };