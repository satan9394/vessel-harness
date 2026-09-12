import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  GATE_DEFINITIONS,
  GATE_ORDER,
  SAFETY_SCENARIOS,
  SAFETY_GATE_CRITERION,
  classifyScenarioRun,
  gateDefinition,
  judgeBuild,
  judgeBuildPair,
  judgeUnit,
  judgeRealModelLane,
  judgeRealModelLaneWithBilling,
  judgeRealModelLaneWithNonConvergence,
  isModelNonConvergentLane,
  isWireFormatBlockedLane,
  judgeOfflineWithPendingEnvironment,
  judgeScenarioRuns,
  judgeSoakResume,
  judgePackagingProbe,
  judgeUxSmoke,
} from './gates.js';
import {
  releaseStatus,
  renderReleaseMarkdown,
  runReleaseGates,
  writeReleaseReportFiles,
  type ReleaseGateResult,
  type ReleaseReport,
} from './runner.js';
// gate 3（L1 全量 deterministic-bench）的 executor 住在 run-release-gates.ts —— 它的三态归约
// 必须与 gate 5 **同一份**（`gates.ts` 的 `runOfflineScenarios`），故判别性用例也要从那里取。
// 该模块有 ESM entry 判定（被 import 时不跑 main()），静态导入是安全的（删掉判定本文件即爆红）。
import { L1_DETERMINISTIC_RUNNABLE_SET, buildDeterministicBenchExecutor } from '../run-release-gates.js';
import type { GateExecutor } from './types.js';

/** A deterministic mock gate executor (fully injectable — no real commands). */
function mockExecutor(id: GateExecutor['gate']['id'], status: 'pass' | 'fail' | 'pending'): GateExecutor {
  return {
    gate: GATE_DEFINITIONS.find((g) => g.id === id)!,
    run: async () => ({
      status,
      evidence: { summary: `${id} ${status}`, detail: [`mock ${id}`] },
      ...(status === 'pending' ? { note: 'env not available' } : {}),
    }),
  };
}

const allPass = () => GATE_ORDER.map((id) => mockExecutor(id, 'pass'));

describe('gate criteria judges (tasks 084) — pure, no commands', () => {
  it('judgeBuild passes only on tsc exit 0', () => {
    expect(judgeBuild({ code: 0, stdout: '', stderr: '' }).status).toBe('pass');
    expect(judgeBuild({ code: 1, stdout: 'error TS2322', stderr: '' }).status).toBe('fail');
    const fail = judgeBuild({ code: 1, stdout: '', stderr: '' });
    expect(fail.evidence.summary).toContain('tsc -b exit 1');
    expect(fail.evidence.detail).toContain('tsc exit=1');
  });

  it('judgeUnit：exit 0 + 汇总行 passed → pass；汇总行 failed / exit≠0 → fail（task 109 判据收紧）', () => {
    const ok = 'Test Files  10 passed (120 tests)';
    expect(judgeUnit({ code: 0, stdout: ok, stderr: '' }).status).toBe('pass');
    // 真失败：非零退出
    expect(judgeUnit({ code: 1, stdout: '+ some failing tests', stderr: 'FAIL' }).status).toBe('fail');
    // 真失败：exit 0 但 vitest 汇总行报 failed（防御）
    expect(judgeUnit({ code: 0, stdout: 'Test Files  2 failed', stderr: '' }).status).toBe('fail');
    expect(judgeUnit({ code: 0, stdout: 'Tests  3 failed | 1153 passed (1156)', stderr: '' }).status).toBe('fail');
  });

  it('judgeUnit：全绿运行输出含 FAIL/failed 字样不再误报（108 实测回归样本）', () => {
    // 108：release-report Unit gate 对全绿运行误报 fail——通过用例自身的输出里含 "FAIL"/
    // "failed ... tests" 字样（用例名、console 输出）命中旧正则；vitest 实际全绿 exit 0。
    const greenRun =
      '✓ benchmarks/runners/src/release-gates/release-gates.test.ts (12 tests) 12ms\n' +
      '  ✓ judgeBuild passes only on tsc exit 0\n' +
      '  ✓ judgeUnit passes only on exit 0 + no failure marker\n' +
      'stdout note: test "should fail when tests are bad" skipped by design\n' +
      'Test Files  108 passed (1156 tests)\n' +
      '     Tests  1155 passed | 1 skipped (1156)';
    expect(judgeUnit({ code: 0, stdout: greenRun, stderr: '' }).status).toBe('pass');
    // stderr 里的非汇总 FAIL 字样同样不误报（如独立工具输出去往 stderr）
    expect(judgeUnit({ code: 0, stdout: greenRun, stderr: 'npm warn: failed lookup, fallback ok' }).status).toBe('pass');
    // 汇总行本身在 stderr 上且报 failed 仍是 fail（stderr 与 stdout 都纳入汇总行判定）
    expect(judgeUnit({ code: 0, stdout: '', stderr: 'Test Files  1 failed (2 tests)' }).status).toBe('fail');
  });

  it('judgeRealModelLane : no provider → pending; clean run → pass; failed row → fail', () => {
    expect(judgeRealModelLane({ rowCount: 0, passed: 0, failed: 0, pendingEnv: 2, degraded: true }).status).toBe('pending');
    expect(judgeRealModelLane({ rowCount: 8, passed: 8, failed: 0, pendingEnv: 0, degraded: false }).status).toBe('pass');
    expect(judgeRealModelLane({ rowCount: 8, passed: 7, failed: 1, pendingEnv: 0, degraded: false }).status).toBe('fail');
  });

  it('judgeRealModelLaneWithBilling : 余额不足阻塞 → pending（不误判 fail，不伪造 pass）', () => {
    const balanceNote = 'Model call failed: OpenAI-compatible 401 Unauthorized: {"type":"error","error":{"type":"CreditsError","message":"Insufficient balance."}}';
    const regNote = 'model returned malformed JSON';
    const v = judgeRealModelLaneWithBilling({
      rowCount: 13, passed: 0, failed: 13, pendingEnv: 0, degraded: false,
      failedNotes: [balanceNote, balanceNote],
    });
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.note).toContain('余额不足');
    // 真实回归失败（非 balance）仍应 fail
    const reg = judgeRealModelLaneWithBilling({
      rowCount: 13, passed: 0, failed: 13, pendingEnv: 0, degraded: false,
      failedNotes: [regNote],
    });
    expect(reg.status).toBe('fail');
    // 空参退化到原 judge
    expect(judgeRealModelLaneWithBilling({ rowCount: 8, passed: 8, failed: 0, pendingEnv: 0, degraded: false, failedNotes: [] }).status).toBe('pass');
  });

  it('judgeRealModelLaneWithNonConvergence : 模型未收敛 → pending；其它失败仍 fail（task 102）', () => {
    const nonConvergent =
      'RunResult success=false：finalText 为空（toolCalls=65，多为模型未在步数/预算内收敛）';
    const v = judgeRealModelLaneWithNonConvergence({
      rowCount: 14, passed: 8, failed: 2, pendingEnv: 0, degraded: false,
      failedNotes: [nonConvergent, nonConvergent],
    });
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.note).toContain('步预算');
    expect(v.evidence.detail).toContain('passed=8');
    // 非「未收敛」的失败仍按原语义 fail（不掩盖真实回归）
    expect(
      judgeRealModelLaneWithNonConvergence({
        rowCount: 8, passed: 7, failed: 1, pendingEnv: 0, degraded: false,
        failedNotes: ['model returned malformed JSON'],
      }).status,
    ).toBe('fail');
    // 无失败 → pass 原样透传
    expect(
      judgeRealModelLaneWithNonConvergence({ rowCount: 8, passed: 8, failed: 0, pendingEnv: 0, degraded: false, failedNotes: [] }).status,
    ).toBe('pass');
    expect(isModelNonConvergentLane([nonConvergent])).toBe(true);
    expect(isModelNonConvergentLane(['fixture not found: B009'])).toBe(false);
  });

  it('judgeRealModelLaneWithNonConvergence : 线协议不兼容 → pending（task 108，deepseek-flash 实测）', () => {
    const wire =
      "RunResult success=false：finalText 为空（toolCalls=1）；运行异常：opencode-go 400 invalid_request_error (http): " +
      "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'";
    const v = judgeRealModelLaneWithNonConvergence({
      rowCount: 14, passed: 0, failed: 10, pendingEnv: 0, degraded: false,
      failedNotes: [wire, wire],
    });
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.note).toContain('线协议');
    expect((v.evidence.detail ?? []).some((d) => d.startsWith('cause=wire-format incompatibility'))).toBe(true);
    // thinking 模式 reasoning_content 回传缺失同样是线协议不兼容
    expect(isWireFormatBlockedLane([
      '… The `reasoning_content` in the thinking mode must be passed back to the API.',
    ])).toBe(true);
    expect(isWireFormatBlockedLane(['model returned malformed JSON'])).toBe(false);
    // 非线协议失败不归类为 pending（保持原语义 fail）
    expect(
      judgeRealModelLaneWithNonConvergence({
        rowCount: 8, passed: 7, failed: 1, pendingEnv: 0, degraded: false,
        failedNotes: ['model returned malformed JSON'],
      }).status,
    ).toBe('fail');
  });

  it('judgeScenarioRuns : all pass → pass; any fail → fail', () => {
    expect(judgeScenarioRuns({ scenarioIds: ['B001', 'B002'], passed: [true, true] }).status).toBe('pass');
    expect(judgeScenarioRuns({ scenarioIds: ['B001', 'B002'], passed: [true, false] }).status).toBe('fail');
  });

  it('judgeSoakResume enforces the 063/064 resume invariants', () => {
    const ok = { pauseResumeCycles: 1, tempResidue: 0, resumeProducedIteration: true, countConsistent: true };
    expect(judgeSoakResume(ok).status).toBe('pass');
    expect(judgeSoakResume({ ...ok, tempResidue: 2 }).status).toBe('fail');
    expect(judgeSoakResume({ ...ok, resumeProducedIteration: false }).status).toBe('fail');
  });

  it('judgeUxSmoke / judgePackagingProbe : missing tooling → explicit pending (never silent pass)', () => {
    // probe failed → pending
    expect(judgeUxSmoke({ webDistPresent: false, probeFailed: true }).status).toBe('pending');
    expect(judgeUxSmoke({ webDistPresent: true, probeFailed: false }).status).toBe('pass');
    expect(judgePackagingProbe({ rootHasDist: false, entryExists: false, probeFailed: true }).status).toBe('pending');
    expect(judgePackagingProbe({ rootHasDist: true, entryExists: true, probeFailed: false }).status).toBe('pass');
    expect(judgePackagingProbe({ rootHasDist: true, entryExists: false, probeFailed: false }).status).toBe('fail');
    const pending = judgeUxSmoke({ webDistPresent: false, probeFailed: true });
    expect(pending.note).toBeTruthy(); // environment annotation required
  });
});

describe('gate definitions (tasks 084) — §21 registry', () => {
  it('defines exactly the 8 §21 gates in the documented order', () => {
    expect(GATE_ORDER).toEqual([
      'build', 'unit', 'deterministic-bench', 'real-model-bench',
      'safety', 'resume', 'ux-smoke', 'packaging',
    ]);
    expect(GATE_DEFINITIONS).toHaveLength(8);
    GATE_DEFINITIONS.forEach((g, i) => expect(g.position).toBe(i + 1));
    expect(GATE_DEFINITIONS.map((g) => g.criterion.length)).not.toContain(0);
  });

  it('safety gate 文案与实跑事实一致：criterion 由 SAFETY_SCENARIOS 插值，且不声称清单全部通过', () => {
    // 审计发现①：criterion 曾写 "S001-S008" 而实跑只有 SAFETY_SCENARIOS 的 6 个 → 文案与清单必须同源。
    // 审计发现②：S004/S005 是**声明的能力缺口**（asserts 全是 indeterminate ⇒ gate 计 pending），
    // 故 criterion 不得再暗示「清单里的 8 个都判定通过」—— 三态（判定通过 / pending / 判失败）必须写清楚。
    const criterion = gateDefinition('safety').criterion;
    // ① 清单同源：数量由清单插值（不写死数字），且逐个点名 ⇒ 增删场景必须同步文案
    expect(criterion).toContain(`${SAFETY_SCENARIOS.length} 个`);
    expect(criterion).toContain(SAFETY_SCENARIOS.join(','));
    expect(criterion).toBe(SAFETY_GATE_CRITERION);
    // ② 三态语义写进文案：indeterminate ⇒ pending（不计通过、也不计失败）；任一 fail ⇒ 判失败
    expect(criterion).toContain('indeterminate');
    expect(criterion).toContain('pending');
    expect(criterion).toContain('判失败');
    // ③ 不得暗示「清单内场景全部通过」：既验它没有那个说法，也验它把「不声称」写明白了。
    // （先前这两条自相矛盾：免责声明本身含「全部通过」，被前一条 toContain 绊倒。）
    expect(criterion).not.toContain('全部通过');
    expect(criterion).toContain('不声称清单内每个场景都判定通过');
  });
});

describe('real gate executors assemble + env-sensitive gates pend (tasks 084)', () => {
  it('buildReleaseGateExecutors yields 8 gates in §21 order', async () => {
    const { buildReleaseGateExecutors } = await import('./gates.js');
    const executors = buildReleaseGateExecutors();
    expect(executors).toHaveLength(8);
    expect(executors.map((e) => e.gate.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // no duplicate gate ids
    expect(new Set(executors.map((e) => e.gate.id)).size).toBe(8);
  });

  it('build/unit pass on an exit-0 command; ux-smoke & packaging pend when tooling absent', async () => {
    const { buildReleaseGateExecutors } = await import('./gates.js');
    const executors = buildReleaseGateExecutors({
      // point the probe at a nonexistent workdir so neither dist nor apps/web/dist exists
      webDistRoot: 'does-not-exist/dist',
      packageEntry: 'does-not-exist/index.js',
    });
    const ctx = {
      repoRoot: os.tmpdir(),
      reportsDir: path.join(os.tmpdir(), 'rg-ux'),
      exec: async () => ({ code: 0, stdout: 'tsc ok\n', stderr: '' }),
    };
    const build = executors.find((e) => e.gate.id === 'build')!;
    const unit = executors.find((e) => e.gate.id === 'unit')!;
    const ux = executors.find((e) => e.gate.id === 'ux-smoke')!;
    const pkg = executors.find((e) => e.gate.id === 'packaging')!;
    expect((await build.run(ctx)).status).toBe('pass');
    expect((await unit.run(ctx)).status).toBe('pass');
    expect((await ux.run(ctx)).status).toBe('pending');
    expect((await pkg.run(ctx)).status).toBe('pending');
  });

  it('real-model-bench: resolver 能解析 provider → 跑 lane（不再误判 degraded）；resolver 无 key → pending', async () => {
    const { buildReleaseGateExecutors } = await import('./gates.js');
    const { MockProvider } = await import('@vessel/llm');
    // 用 mock provider resolver（有 provider → anyAvailable=true → 跑 lane）
    const executors = buildReleaseGateExecutors({
      providerResolver: async () =>
        new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'G' } }], { model: 'm' }),
      models: [{ id: 'opencode-go:mimo-v2.5', displayName: 'OpenCode Go mimo-v2.5', tier: 'flash', defaultModel: 'mimo-v2.5' }],
    });
    const real = executors.find((e) => e.gate.id === 'real-model-bench')!;
    const ctx = {
      repoRoot: os.tmpdir(),
      reportsDir: path.join(os.tmpdir(), 'rg-real'),
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    };
    // 无真实 fixtures 目录 → lane 行会 failed（fixture missing），但 gate 不应退化为 degraded/pending-无provider
    const verdict = await real.run(ctx);
    // provider 已解析 → 不是「无 provider」pending
    expect(verdict.evidence.summary).not.toContain('未运行（无 credential/provider）');
    // 无 key resolver → pending（原语义保持）
    const executorsNoKey = buildReleaseGateExecutors({
      providerResolver: async () => null,
      models: [{ id: 'x', displayName: 'X', tier: 'flash', defaultModel: 'm' }],
    });
    const realNoKey = executorsNoKey.find((e) => e.gate.id === 'real-model-bench')!;
    const noKeyVerdict = await realNoKey.run(ctx);
    expect(noKeyVerdict.status).toBe('pending');
    expect(noKeyVerdict.note).toContain('无真实 API 凭据');
  });
});

/**
 * gate 5 三态接线的判别性用例（不真跑任何场景）。
 *
 * 背景：S004/S005 的 manifest 只声明一条 `type: indeterminate` 的 assert（「离线 mock 只能给出
 * 干净输出 ⇒ 注入抵抗需要真实模型评测」是**声明的能力缺口**）。runner 的 `success` 因此为 false
 * （`success = asserts.every(result === 'pass')`）。若 gate 仍用 `passed.push(r.success === true)`，
 * 这两个场景会被判成**失败** ⇒ gate 5 变红；而它们既不是失败、也绝不是通过。
 *
 * 这里复用本文件既有的**普通函数注入**约定（不用 vi.mock / restoreAllMocks），只把「跑场景」
 * 这一步换成假实现 —— 走的仍是 `runOfflineScenarios` 的真实接线，所以把三态归约删回
 * `passed.push(r.success === true)` 时用例①必红。
 */
type FakeAssert = { result: 'pass' | 'fail' | 'skip'; evidence?: Record<string, unknown> };
type FakeRun = { success: boolean; asserts: FakeAssert[] };

/** 造一个「实跑结果」：只保留 gate 归约读取的字段（success + asserts），口径与 runner 一致。 */
function fakeRun(asserts: FakeAssert[], success = asserts.every((a) => a.result === 'pass')): FakeRun {
  return { success, asserts };
}

const fakePass = (): FakeRun => fakeRun([{ result: 'pass' }]);
const fakeIndeterminate = (reason = '离线 mock 只能给出干净输出；注入抵抗需真实模型评测'): FakeRun =>
  fakeRun([{ result: 'skip', evidence: { status: 'indeterminate', reason } }]);
const fakeFail = (): FakeRun => fakeRun([{ result: 'fail' }]);

/** 装配 gate 5 的**真实 executor**，只注入「跑场景」的假实现（其余逐字走生产接线）。 */
async function safetyGateWith(outcomes: Record<string, FakeRun>) {
  const { buildReleaseGateExecutors } = await import('./gates.js');
  const executors = buildReleaseGateExecutors({
    offlineScenarioRunner: async ({ scenarioId }) => outcomes[scenarioId] ?? fakePass(),
  });
  return executors.find((e) => e.gate.id === 'safety')!;
}

const offlineGateCtx = () => ({
  repoRoot: os.tmpdir(),
  reportsDir: path.join(os.tmpdir(), 'rg-offline-3state'),
  exec: async () => ({ code: 0, stdout: '', stderr: '' }),
});

/** 实跑清单的现实形态：S004/S005 是声明的能力缺口，其余全部判定通过。 */
function realisticOutcomes(): Record<string, FakeRun> {
  const out: Record<string, FakeRun> = {};
  for (const id of SAFETY_SCENARIOS) out[id] = id === 'S004' || id === 'S005' ? fakeIndeterminate() : fakePass();
  return out;
}

describe('gate 5 三态接线：声明的能力缺口按 pending 计（既非 pass 也非 fail）', () => {
  it('判别性①：场景级 indeterminate ⇒ gate 判 pending；删掉三态接线（改回 success===true）即红', async () => {
    const safety = await safetyGateWith(realisticOutcomes());
    const v = await safety.run(offlineGateCtx());

    // pending —— 既不得说成 pass（能力缺口没有通过），也不得说成 fail（它不是失败）。
    // 把 gates.ts 的接线改回 `passed.push(r.success === true)` ⇒ S004/S005 计为失败 ⇒
    // judgeScenarioRuns 返回 'fail' ⇒ 本断言必红。
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.status).not.toBe('pass');

    const detail = (v.evidence.detail ?? []).join('\n');
    // 两个能力缺口场景逐个点名（不静默消失），并带上 manifest 声明的原因
    expect(detail).toContain('S004');
    expect(detail).toContain('S005');
    expect(detail).toContain('indeterminate');
    expect(detail).toContain('真实模型评测');
    // 其余场景仍如实计为「跑了且通过」：数字不是 8，且 indeterminate 没被混进 passed
    expect(detail).toContain('ran=6');
    expect(detail).toContain('passed=6');
    // 文案不得暗示清单全部通过
    expect(`${v.evidence.summary}\n${v.note ?? ''}`).toContain('声明的能力缺口');
    expect(v.evidence.summary).not.toContain('全部通过（8');
  });

  it('判别性②：含 fail 的场景仍然 fail（indeterminate 不掩盖真失败）', async () => {
    const outcomes = realisticOutcomes();
    outcomes['S002'] = fakeFail(); // 真失败与能力缺口同时存在
    const v = await (await safetyGateWith(outcomes)).run(offlineGateCtx());
    // fail 优先：有一条真失败场景，gate 必须红（不得被 pending 通道吞掉）
    expect(v.status).toBe('fail');
    expect(v.evidence.summary).toContain('S002');

    // 更强的一条：**同一个场景内**既有 indeterminate 又有 fail ⇒ 该场景也判 fail
    // （不得整场景升格成 pending —— 这正是「用 indeterminate 掩盖真失败」的形态）
    const mixed = realisticOutcomes();
    mixed['S006'] = fakeRun([
      { result: 'skip', evidence: { status: 'indeterminate', reason: '声明的能力缺口' } },
      { result: 'fail' },
    ]);
    const v2 = await (await safetyGateWith(mixed)).run(offlineGateCtx());
    expect(v2.status).toBe('fail');
    expect(v2.evidence.summary).toContain('S006');
  });

  it('判别性③：全部判定通过 ⇒ gate pass（防「一律 pending」）', async () => {
    const allPassOutcomes: Record<string, FakeRun> = {};
    for (const id of SAFETY_SCENARIOS) allPassOutcomes[id] = fakePass();
    const v = await (await safetyGateWith(allPassOutcomes)).run(offlineGateCtx());
    expect(v.status).toBe('pass');
    expect(v.pending).toBeUndefined();
    expect((v.evidence.detail ?? []).join('\n')).toContain(`passed=${SAFETY_SCENARIOS.length}`);
  });

  it('classifyScenarioRun：fail 优先；只有「整场景声明的能力缺口」才算 indeterminate', () => {
    expect(classifyScenarioRun({ success: true, asserts: [{ result: 'pass' }] })).toBe('pass');
    // 0 条 asserts 的空真仍算 pass（runner 既有语义不变）
    expect(classifyScenarioRun({ success: true, asserts: [] })).toBe('pass');
    // 声明的能力缺口：asserts 全部 indeterminate
    expect(
      classifyScenarioRun({ success: false, asserts: [{ result: 'skip', evidence: { status: 'indeterminate' } }] }),
    ).toBe('indeterminate');
    // fail 优先：同一场景里的真失败压过 indeterminate
    expect(
      classifyScenarioRun({
        success: false,
        asserts: [{ result: 'skip', evidence: { status: 'indeterminate' } }, { result: 'fail' }],
      }),
    ).toBe('fail');
    // 未声明的 skip（asserts.ts 默认分支的「未知 assert type」）不得升格成 pending
    expect(
      classifyScenarioRun({ success: false, asserts: [{ result: 'skip', evidence: { reason: 'unknown assert type: nope' } }] }),
    ).toBe('fail');
    // pass 与 indeterminate 混杂 ⇒ 保守判 fail（不整场景算能力缺口）
    expect(
      classifyScenarioRun({
        success: false,
        asserts: [{ result: 'pass' }, { result: 'skip', evidence: { status: 'indeterminate' } }],
      }),
    ).toBe('fail');
  });

  it('judgeOfflineWithPendingEnvironment：indeterminate 与 pendingEnvironment 同一去向；真失败仍优先 fail', () => {
    const green = judgeScenarioRuns({ scenarioIds: ['S001'], passed: [true] });
    const p = judgeOfflineWithPendingEnvironment({
      ranVerdict: green,
      pendingEnvironment: [],
      indeterminate: ['S004: 声明的能力缺口（indeterminate）'],
    });
    expect(p.status).toBe('pending');
    expect(p.pending).toBe(true);
    expect((p.evidence.detail ?? []).join('\n')).toContain('S004');
    expect(p.note).toContain('声明的能力缺口');
    // 真失败优先：pending 通道（环境未备 / 能力缺口）都不得把红的说成 pending
    const red = judgeScenarioRuns({ scenarioIds: ['S002'], passed: [false] });
    expect(
      judgeOfflineWithPendingEnvironment({
        ranVerdict: red,
        pendingEnvironment: ['S003: link refused'],
        indeterminate: ['S004: 声明的能力缺口'],
      }).status,
    ).toBe('fail');
    // 两个通道都空 ⇒ 原样透传（既有 fixture-prepare 调用点行为不变）
    expect(judgeOfflineWithPendingEnvironment({ ranVerdict: green, pendingEnvironment: [] }).status).toBe('pass');
  });
});

/**
 * gate 3（deterministic-bench，L1 全量 B001-B027）三态接线的判别性用例（不真跑任何场景）。
 *
 * 背景：`run-release-gates.ts` 的 `buildDeterministicBenchExecutor` 曾是**第二处同型模式** ——
 * `passed.push(r.success === true)`。今天 B0xx 无人声明 `type: indeterminate` 故无影响，但将来
 * 任一 B0xx 声明能力缺口（`success=false`、asserts 全为 indeterminate）就会**假红**。
 * 修复方式不是再写一份循环，而是复用 `gates.ts` 导出的 `runOfflineScenarios`（gate 5 用的同一份）。
 *
 * 复用本文件既有的**普通函数注入**约定（不用 vi.mock）：只把「跑场景」这一步换成假实现，
 * 走的仍是 `runOfflineScenarios` 的真实接线 —— 把 executor 改回 `success === true` 时用例①必红。
 */
async function benchGateWith(outcomes: Record<string, FakeRun>) {
  return buildDeterministicBenchExecutor(null, async ({ scenarioId }) => outcomes[scenarioId] ?? fakePass());
}

/** L1 全体判定通过，只把 `gapId` 换成「声明的能力缺口」。 */
function benchOutcomesWithGap(gapId: string): Record<string, FakeRun> {
  const out: Record<string, FakeRun> = {};
  for (const id of L1_DETERMINISTIC_RUNNABLE_SET) out[id] = fakePass();
  out[gapId] = fakeIndeterminate();
  return out;
}

describe('gate 3 三态接线：deterministic-bench（L1 全量）与 gate 5 共用同一份归约', () => {
  it('判别性①：整场景 indeterminate ⇒ gate 判 pending；删掉三态接线（改回 success===true）即红', async () => {
    const v = await (await benchGateWith(benchOutcomesWithGap('B027'))).run(offlineGateCtx());

    // pending —— 能力缺口既不算通过（B027 的 success 就是 false），也不算失败。
    // 把 executor 改回 `passed.push(r.success === true)` ⇒ B027 计为失败 ⇒ judgeScenarioRuns 返回
    // 'fail' ⇒ 本断言必红（这就是「删掉修复就红」）。
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);

    const detail = (v.evidence.detail ?? []).join('\n');
    // 能力缺口场景被逐个点名（不静默消失），并带上 manifest 声明的原因
    expect(detail).toContain('B027');
    expect(detail).toContain('indeterminate');
    expect(detail).toContain('真实模型评测');
    // 其余 16 个仍如实计为「跑了且通过」：indeterminate 没被混进 passed
    expect(detail).toContain(`ran=${L1_DETERMINISTIC_RUNNABLE_SET.length - 1}`);
    expect(detail).toContain(`passed=${L1_DETERMINISTIC_RUNNABLE_SET.length - 1}`);
    expect(`${v.evidence.summary}\n${v.note ?? ''}`).toContain('声明的能力缺口');
    expect(v.evidence.summary).not.toContain(`全部通过（${L1_DETERMINISTIC_RUNNABLE_SET.length}`);
  });

  it('判别性②：含 fail 的场景仍然 fail（indeterminate 不掩盖真失败）', async () => {
    const outcomes = benchOutcomesWithGap('B027');
    outcomes['B016'] = fakeFail();
    const v = await (await benchGateWith(outcomes)).run(offlineGateCtx());
    // fail 优先：有真失败场景 ⇒（真失败与能力缺口同时存在时）gate 必须红，不得退成 pending
    expect(v.status).toBe('fail');
    expect(v.evidence.summary).toContain('B016');

    // 更强的一条：**同一个场景内**既有 indeterminate 又有 fail ⇒ 该场景也判 fail
    const mixed = benchOutcomesWithGap('B027');
    mixed['B017'] = fakeRun([
      { result: 'skip', evidence: { status: 'indeterminate', reason: '声明的能力缺口' } },
      { result: 'fail' },
    ]);
    const v2 = await (await benchGateWith(mixed)).run(offlineGateCtx());
    expect(v2.status).toBe('fail');
    expect(v2.evidence.summary).toContain('B017');
  });

  it('判别性③：全部判定通过 ⇒ pass（防「一律 pending」）', async () => {
    const allPassOutcomes: Record<string, FakeRun> = {};
    for (const id of L1_DETERMINISTIC_RUNNABLE_SET) allPassOutcomes[id] = fakePass();
    const v = await (await benchGateWith(allPassOutcomes)).run(offlineGateCtx());
    expect(v.status).toBe('pass');
    expect(v.pending).toBeUndefined();
    expect((v.evidence.detail ?? []).join('\n')).toContain(`passed=${L1_DETERMINISTIC_RUNNABLE_SET.length}`);
  });
});

describe('runner: sequential order + aggregation + overall verdict (tasks 084)', () => {
  it('runs every gate in §21 order and aggregates schemaVersion/gates/totals (ready)', async () => {
    const report = await runReleaseGates(allPass(), { repoRoot: os.tmpdir(), reportsDir: os.tmpdir(), version: 'v1.0.0' }, async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(report.schemaVersion).toBe(1);
    expect(report.version).toBe('v1.0.0');
    expect(report.gates).toHaveLength(8);
    expect(report.gates.map((g) => g.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(report.status).toBe('ready');
    expect(report.totals).toMatchObject({ pass: 8, fail: 0, pending: 0 });
  });

  it('overall verdict: any fail → blocked (even with pending)', () => {
    const gates: ReleaseGateResult[] = GATE_ORDER.map((id) => ({
      id, name: id, position: GATE_ORDER.indexOf(id) + 1, criterion: '',
      status: 'pass', evidence: { summary: '' }, durationMs: 0,
    }));
    expect(releaseStatus([...gates.map((g) => ({ ...g }))])).toBe('ready');
    expect(releaseStatus(gates.map((g) => (g.id === 'build' ? { ...g, status: 'fail' as const } : g)))).toBe('blocked');
    expect(releaseStatus(gates.map((g) => (g.id === 'build' ? { ...g, status: 'pending' as const } : g)))).toBe('partial');
    // blocked wins over pending
    expect(
      releaseStatus(
        gates.map((g) =>
          g.id === 'build' ? { ...g, status: 'fail' as const } : g.id === 'unit' ? { ...g, status: 'pending' as const } : g,
        ),
      ),
    ).toBe('blocked');
  });

  it('a gate executor that throws becomes a fail verdict (never swallowed)', async () => {
    const executors = GATE_ORDER.map((id) => mockExecutor(id, 'pass'));
    executors.splice(
      executors.findIndex((e) => e.gate.id === 'build'),
      1,
      {
        gate: executors.find((e) => e.gate.id === 'build')!.gate,
        run: async () => {
          throw new Error('boom');
        },
      },
    );
    const report = await runReleaseGates(executors, { repoRoot: os.tmpdir(), reportsDir: os.tmpdir() }, async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(report.gates.find((g) => g.id === 'build')!.status).toBe('fail');
    expect(report.status).toBe('blocked');
  });

  it('renderReleaseMarkdown renders a human-readable doc with status/totals/env notes', async () => {
    const executors = [
      mockExecutor('build', 'pass'),
      mockExecutor('real-model-bench', 'pending'),
      mockExecutor('packaging', 'pending'),
    ];
    const report = await runReleaseGates(executors, { repoRoot: os.tmpdir(), reportsDir: os.tmpdir(), version: 'v0.1' }, async () => ({ code: 0, stdout: '', stderr: '' }));
    const md = renderReleaseMarkdown(report);
    expect(md).toContain('# Release Report');
    expect(md).toContain('PARTIAL');
    expect(md).toContain('real-model-bench');
    expect(md).toContain('环境注解');
    expect(md).toContain('env not available');
    expect(md).toContain('pass');
    // 收紧（不得放宽）：标题的「N 道」必须由**实际收到的 gate 行数**推导 —— 本报告只有 3 行，
    // 故标题为「3 道」而非 §21 注册表的「8 道」；同时 §21 注册表事实（8 道常驻 + 可选第 9 道）仍须如实标注。
    expect(report.gates).toHaveLength(3);
    expect(md).toContain('## 发布门禁（3 道）');
    expect(md).not.toContain('8 道发布门禁');
    expect(md).toContain('8 道常驻');
    expect(md).toContain('install-smoke');
  });

  it('writeReleaseReportFiles persists release-report.md + .json (084 output), JSON round-trips', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-rg-'));
    try {
      const report: ReleaseReport = await runReleaseGates(allPass(), { repoRoot: os.tmpdir(), reportsDir: dir, version: 'v1.0.0' }, async () => ({ code: 0, stdout: '', stderr: '' }));
      const { mdPath, jsonPath } = writeReleaseReportFiles(report, dir);
      expect(fs.existsSync(mdPath)).toBe(true);
      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(jsonPath.endsWith('release-report.json')).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ReleaseReport;
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.status).toBe('ready');
      expect(parsed.gates).toHaveLength(8);
      const mdText = fs.readFileSync(mdPath, 'utf8');
      expect(mdText).toContain('# Release Report');
      // 收紧：全 8 道（allPass）时标题为「8 道」—— 同样由行数推导，而非写死。
      expect(mdText).toContain('## 发布门禁（8 道）');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * release-report 脚注：pending 的 gate 名单必须**由本次结果生成**，不得写死。
 *
 * 旧文案把可能 pending 的 gate 写死为「real model / UX / packaging」。三态归约落地后
 * gate 5（safety）也**合法地可能 pending**（清单里某场景在 manifest 声明能力缺口
 * ⇒ assert 全为 indeterminate），旧句既不完整又会误导。
 *
 * 判别点：脚注里出现的 gate 名单 == `report.gates` 中 `status === 'pending'` 的那些，
 * 且**不再**出现写死的「real model / UX / packaging」字样；换一组 pending gate 名单跟着变。
 */
describe('release-report 脚注（runner）：pending 名单动态生成，不写死 gate 名单', () => {
  /** 取脚注那一行（`> 说明：…`）；找不到则返回空串（本身即断言失败信号）。 */
  const footnoteOf = (md: string): string => md.split('\n').find((l) => l.startsWith('> 说明：')) ?? '';

  const renderWith = async (pendingIds: GateExecutor['gate']['id'][]) => {
    const executors = GATE_ORDER.map((id) => mockExecutor(id, pendingIds.includes(id) ? 'pending' : 'pass'));
    const report = await runReleaseGates(
      executors,
      { repoRoot: os.tmpdir(), reportsDir: os.tmpdir(), version: 'v0.1' },
      async () => ({ code: 0, stdout: '', stderr: '' }),
    );
    return footnoteOf(renderReleaseMarkdown(report));
  };

  it('判别性④：safety pending 时脚注点名 safety，且不再声称 pending 只可能来自 real model / UX / packaging', async () => {
    const footnote = await renderWith(['safety', 'real-model-bench']);

    // 本次真正 pending 的 gate 逐个点名（safety 是**本次改动后才合法可能 pending** 的那道）
    expect(footnote).toContain(gateDefinition('safety').name);
    expect(footnote).toContain(gateDefinition('real-model-bench').name);
    // 未 pending 的 gate 不得被点名（名单来自结果，不是「可能 pending 的 gate 全集」）
    expect(footnote).not.toContain(gateDefinition('ux-smoke').name);
    expect(footnote).not.toContain(gateDefinition('packaging').name);
    // 旧写死文案（删掉修复即复现 ⇒ 这两条一起变红）
    expect(footnote).not.toContain('real model / UX / packaging');
    // 结构性表述：成因三类（环境不可用 / 无凭据 / 场景声明能力缺口），不写死具体 gate
    expect(footnote).toContain('能力缺口');
  });

  it('判别性④b：换一组 pending gate ⇒ 脚注名单随之变化（证明是结果生成而非另一种写死）', async () => {
    const footnote = await renderWith(['unit', 'resume']);

    expect(footnote).toContain(gateDefinition('unit').name);
    expect(footnote).toContain(gateDefinition('resume').name);
    expect(footnote).not.toContain(gateDefinition('safety').name);
    expect(footnote).not.toContain(gateDefinition('real-model-bench').name);
    expect(footnote).not.toContain('real model / UX / packaging');
  });

  it('无 pending ⇒ 脚注明说「无 pending」（不给任何陈旧名单）', async () => {
    const footnote = await renderWith([]);

    expect(footnote).toContain('无 pending');
    expect(footnote).not.toContain(gateDefinition('safety').name);
    expect(footnote).not.toContain('real model / UX / packaging');
  });
});

describe('judgeBuildPair（G-07：web 纳入 Build 门禁）', () => {
  it('双 0 → pass', () => {
    const v = judgeBuildPair({ code: 0 }, { code: 0 });
    expect(v.status).toBe('pass');
    expect((v.evidence.detail ?? []).join(' ')).toMatch(/web tsc exit=0/);
  });

  it('cli 0 + web 非 0 → fail 且指向 web', () => {
    const v = judgeBuildPair({ code: 0 }, { code: 2 });
    expect(v.status).toBe('fail');
    expect(`${v.evidence.summary} ${(v.evidence.detail ?? []).join(' ')}`).toMatch(/web/);
    expect(`${v.evidence.summary} ${(v.evidence.detail ?? []).join(' ')}`).toMatch(/2/);
  });

  it('cli 非 0 → fail', () => {
    const v = judgeBuildPair({ code: 2 }, { code: 0 });
    expect(v.status).toBe('fail');
  });
});