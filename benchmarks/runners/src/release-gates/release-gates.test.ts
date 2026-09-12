import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  GATE_DEFINITIONS,
  GATE_ORDER,
  DETERMINISTIC_BENCH_GATE_CRITERION,
  DETERMINISTIC_BENCH_SCENARIOS,
  L1_DETERMINISTIC_BENCH_SCENARIOS,
  PACKAGING_GATE_CRITERION,
  REAL_MODEL_BENCH_GATE_CRITERION,
  SAFETY_SCENARIOS,
  SAFETY_GATE_CRITERION,
  UX_SMOKE_GATE_CRITERION,
  UNIT_GATE_CRITERION,
  UNIT_TEST_ROOTS,
  buildReleaseGateExecutors,
  classifyScenarioRun,
  gateDefinition,
  judgeBuild,
  judgeBuildPair,
  judgeUnit,
  judgeUnitRoots,
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

  // 标题曾经写 "missing tooling" —— 对 ux-smoke 而言不成立：它探测的是**构建产物**是否在位，
  // 从不探测构建工具是否存在（工具缺失的表述属旧 criterion 的漂移，已改准）。
  it('judgeUxSmoke / judgePackagingProbe : 产物/工具不可用 → explicit pending (never silent pass)', () => {
    // probe failed → pending
    expect(judgeUxSmoke({ webDistPresent: false, probeFailed: true }).status).toBe('pending');
    expect(judgeUxSmoke({ webDistPresent: true, probeFailed: false }).status).toBe('pass');
    expect(judgePackagingProbe({ rootHasDist: false, entryExists: false, probeFailed: true }).status).toBe('pending');
    expect(judgePackagingProbe({ rootHasDist: true, entryExists: true, probeFailed: false }).status).toBe('pass');
    expect(judgePackagingProbe({ rootHasDist: true, entryExists: false, probeFailed: false }).status).toBe('fail');
    const pending = judgeUxSmoke({ webDistPresent: false, probeFailed: true });
    expect(pending.note).toBeTruthy(); // environment annotation required
    // 文案诚实性（与 ux-smoke 的 criterion 同口径，判别性）：note/summary 只能声称「探测产物」，
    // 不得暗示本 gate 跑过或将跑 web 测试/smoke —— 删掉这处措辞修复（回退成
    // 「web 套件/产物需在非受限环境跑」）⇒ 下面两条红。
    expect(pending.note).not.toContain('web 套件');
    expect(pending.note).toContain('不执行任何 web 测试');
    // pending 成因如实：产物缺失 / 探测失败（不是「构建工具缺失」——本 gate 从不探测构建工具）
    expect(pending.evidence.summary).not.toContain('构建工具');
    // pass 的 evidence 也只声称「产物在位」，不冒充「web 测试通过」
    const pass = judgeUxSmoke({ webDistPresent: true, probeFailed: false });
    expect(pass.evidence.summary).toContain('构建产物');
    expect(pass.evidence.summary).toContain('未执行任何 web 测试');
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

  it('deterministic-bench gate 文案与实跑事实一致：criterion 由 L1 清单插值，含三态且不声称都判定通过', () => {
    // 审计发现（与 gate 5 当初写死 "S001-S008" 是**同一类**）：criterion 曾写死
    // 「L1 可跑集（B001-B005 离线确定性 mock lane）全部 manifest 断言通过。」——
    // 而真实驱动（`run-release-gates.ts` 的 `buildDeterministicBenchExecutor`，
    // `runReleaseGates()` 用的就是它）跑的是 `L1_DETERMINISTIC_RUNNABLE_SET`（B001–B027），
    // 且文案里没有「整场景 indeterminate ⇒ pending」这条三态口径。
    // Round 130：默认装配（`buildReleaseGateExecutors()` 的 gate 3 分支）也从旧子集扩到同一份
    // 全量清单 ⇒ criterion 说的范围在**两种装配**下都成立；「判据点名的场景 == 实际请求的场景」
    // 的判别性守卫见本文件后面的 `gate 3 deterministic-bench：判据点名的场景 == ...`。
    const criterion = gateDefinition('deterministic-bench').criterion;

    // ①-a 清单同源：gates.ts 的镜像清单必须与**驱动侧**清单逐一相等
    //      （只改一边 ⇒ 本断言红，这正是「文案不得与实跑漂移」的机械保证）。
    expect([...L1_DETERMINISTIC_BENCH_SCENARIOS]).toEqual([...L1_DETERMINISTIC_RUNNABLE_SET]);
    // ①-b 数量与逐个点名都由清单插值（不写死）；criterion 改回旧串 ⇒ 下面两条红。
    expect(criterion).toContain(
      `当前 ${L1_DETERMINISTIC_RUNNABLE_SET.length} 个：${L1_DETERMINISTIC_RUNNABLE_SET.join(',')}`,
    );
    for (const id of L1_DETERMINISTIC_RUNNABLE_SET) expect(criterion).toContain(id);
    // ①-c 旧文案的写死范围表述不得残留（"B001-B005" 被 join(',') 的逐个点名取代）
    expect(criterion).not.toContain('B001-B005');
    // ①-d 注册表里挂的就是这条 criterion（改名/断线 ⇒ 红；与 gate 5 的 toBe 同款）
    expect(criterion).toBe(DETERMINISTIC_BENCH_GATE_CRITERION);

    // ② 三态写进文案：整场景 indeterminate ⇒ pending（不计通过、也不计失败、evidence 点名）；
    //    任一 assert fail ⇒ 判失败（能力缺口不得掩盖真失败）
    expect(criterion).toContain('indeterminate');
    expect(criterion).toContain('pending');
    expect(criterion).toContain('判失败');
    expect(criterion).toContain('掩盖真失败');

    // ③ 不得含「全部通过」四字连写：否则 ④ 的免责声明会把自己绊倒（gate 5 踩过的自相矛盾坑）
    expect(criterion).not.toContain('全部通过');
    // ④ 显式声明「不是清单内场景都判定通过」（pending 的场景保持未判定）
    expect(criterion).toContain('不声称清单内每个场景都判定通过');
  });

  it('ux-smoke gate 文案与实跑事实一致：criterion 只声称「探测 web 构建产物是否存在」，且声明本 gate 不跑 web 测试', () => {
    // 审计发现（与 gate 5 写死 "S001-S008"、gate 3 写死 "B001-B005" 是**同一类**漂移）：
    // 旧 criterion 是「web 套件或最小 smoke 通过；web 构建工具缺失时显式 pending。」——
    // 而实跑（gates.ts 的 ux-smoke executor）**只做一次 `fs.existsSync(apps/web/dist)`**：
    // 既不跑 web 测试、也不跑任何 smoke；pending 的成因是**产物缺失 / 探测失败**，
    // 不是「web 构建工具缺失」（本 gate 从不探测构建工具）。文案改了实跑没改 ⇒ 本用例红。
    const criterion = gateDefinition('ux-smoke').criterion;

    // ① 注册表里挂的就是这条 criterion（与 gate 5/3 的 `toBe` 同款；改回旧串 ⇒ 本条红）
    expect(criterion).toBe(UX_SMOKE_GATE_CRITERION);
    // ② 如实描述实跑动作：只探测**构建产物**是否存在，并点名默认路径与检出方式
    expect(criterion).toContain('apps/web/dist');
    expect(criterion).toContain('构建产物');
    expect(criterion).toContain('fs.existsSync');
    expect(criterion).toContain('不执行任何命令');
    // ③ 显式 pending：产物缺失 / 探测失败两条成因都写准（不再是「构建工具缺失」）
    expect(criterion).toContain('pending');
    expect(criterion).toContain('产物缺失');
    expect(criterion).toContain('探测本身失败');
    // ④ 显式免责：不执行任何 web 测试/smoke，pass ≠ 测试跑过
    expect(criterion).toContain('不执行任何 web 测试');
    expect(criterion).toContain('不代表');
    // ⑤ 旧文案的两个不成立说法不得残留（回退即红）：
    //    - `not.toContain('web 构建工具缺失')`：旧 pending 成因；
    //    - `not.toContain(<旧 criterion 全文>)`：回退标记。
    //    自相矛盾检查（gate 5 踩过的坑：免责声明里又写出被禁的串）：本 criterion 的正文与免责声明
    //    **都没有**出现这两串 —— 免责声明写的是「不执行任何 web 测试、也不执行任何 smoke 用例」，
    //    与「web 套件或最小 smoke 通过」逐字不同；而「构建工具」四字在本 criterion 里完全不出现
    //    （成因只写「产物缺失 / 探测本身失败」）。故 ⑤ 的两条与 ④ 的两条可在同一字符串上同时成立，
    //    由 ① 的 `toBe` 把整段文本钉死后，这四条的联立在编译期/运行期都可复核。
    //    注：这里**刻意不**禁裸片段「web 套件或最小 smoke 通过」—— 未来若有人把免责声明写成
    //    「不代表 web 套件或最小 smoke 通过」是**更清楚**的写法，不该被这条绊倒；禁全文足以抓住回退。
    expect(criterion).not.toContain('web 构建工具缺失');
    expect(criterion).not.toContain('web 套件或最小 smoke 通过；web 构建工具缺失时显式 pending。');
  });
});

/**
 * Gate 2（unit）「判据声称的范围 == executor 实跑的范围」判别性守卫（纪律 26 的后半句）。
 *
 * 背景（对抗评审 Round 110）：`package.json` 有 `test:all`（根 + `--root apps/web`），但
 * `.github/workflows/ci.yml` 跑 `npm test`（根）、本 gate 的 executor 也只跑根，而 criterion 却写
 * 「**全量** `npx vitest run`（root）」—— 命令存在、没有调用方，web 套件在 CI 与门禁里一次都不跑。
 * 本次修复把 criterion 与 executor 都接到同一份 `UNIT_TEST_ROOTS` 上，并在此加**可执行的**守卫：
 *
 *   ① `declaredUnitCommands()` 从 criterion **文本**里独立解析出它点名的 `npx vitest run …` 命令
 *      （不引用任何常量、不走被测函数），逐条比对 executor 经注入 `exec` **实际发出**的命令
 *      ⇒ 改判据不改 executor（或反过来）必红；
 *   ② 两边都必须覆盖 `apps/web` ⇒ 「删掉修复」（清单退回 root-only）必红；
 *   ③ criterion 不得再出现范围未定义的「全量」——纪律 26 的病灶词。
 *
 * 断言的是**结构性事实**（根集合相等），不是把某条命令的字面量钉成契约以外的实现选择。
 */
function declaredUnitCommands(criterion: string): string[] {
  const out: string[] = [];
  for (const m of criterion.matchAll(/`(npx vitest run[^`]*)`/g)) {
    const cmd = m[1];
    if (cmd !== undefined) out.push(cmd);
  }
  return out;
}

describe('gate 2 unit：判据声明的 root 集合 == executor 实跑的 root 集合（纪律 26 后半句的判别性守卫）', () => {
  it('判别性①：criterion 文本点名的命令逐条等于 executor 实际发出的命令，且两侧都覆盖 apps/web', async () => {
    const criterion = gateDefinition('unit').criterion;
    // 注册表里挂的就是这条 criterion（改名/断线 ⇒ 红；与 gate 3/5/7 的 `toBe` 同款）
    expect(criterion).toBe(UNIT_GATE_CRITERION);

    const invoked: string[] = [];
    const executors = buildReleaseGateExecutors();
    const unit = executors.find((e) => e.gate.id === 'unit')!;
    const verdict = await unit.run({
      repoRoot: os.tmpdir(),
      reportsDir: path.join(os.tmpdir(), 'rg-unit-roots'),
      exec: async (command: string, args: string[]) => {
        invoked.push([command, ...args].join(' '));
        return { code: 0, stdout: 'Test Files  1 passed (1 test)', stderr: '' };
      },
    });
    expect(verdict.status).toBe('pass');

    // ① 判据文本点名的命令集合 == executor 实际发出的命令集合（多/少一条都必红）
    const declared = declaredUnitCommands(criterion);
    expect(declared.length).toBeGreaterThan(0); // 解析本身必须有效，否则下面两条会变成空集互等
    expect([...declared].sort()).toEqual([...invoked].sort());
    // ② 两侧都必须覆盖 web root —— 旧实现（判据只写根、executor 只跑根）下这两条必红
    expect(declared).toContain('npx vitest run --root apps/web');
    expect(invoked).toContain('npx vitest run --root apps/web');
    expect(UNIT_TEST_ROOTS.map((r) => r.label)).toContain('apps/web');
    // ③ 判据不得再用范围未定义的「全量」（纪律 26 的病灶词）：范围必须逐条点名
    expect(criterion).not.toContain('全量');
  });

  it('判别性②：只有 web root 失败（根全绿）⇒ gate 必红，且 evidence 指向 apps/web', async () => {
    // 旧 executor 只跑根 ⇒ 这个「web 红」输入**完全不可观测**，gate 会判 pass（本用例即红）。
    const executors = buildReleaseGateExecutors();
    const unit = executors.find((e) => e.gate.id === 'unit')!;
    const v = await unit.run({
      repoRoot: os.tmpdir(),
      reportsDir: path.join(os.tmpdir(), 'rg-unit-web-only-fail'),
      exec: async (_command: string, args: string[]) =>
        args.includes('--root')
          ? { code: 1, stdout: 'Test Files  1 failed | 3 passed (4)\n     Tests  2 failed | 94 passed (96)', stderr: '' }
          : { code: 0, stdout: 'Test Files  193 passed (1932 tests)', stderr: '' },
    });
    expect(v.status).toBe('fail');
    expect(`${v.evidence.summary} ${(v.evidence.detail ?? []).join(' ')}`).toContain('apps/web');
  });

  it('判别性③：命令探测失败（未执行）⇒ 显式 pending，不冒充 pass、也不冒充 fail', async () => {
    const executors = buildReleaseGateExecutors();
    const unit = executors.find((e) => e.gate.id === 'unit')!;
    const v = await unit.run({
      repoRoot: os.tmpdir(),
      reportsDir: path.join(os.tmpdir(), 'rg-unit-probe-fail'),
      exec: async () => {
        throw new Error('spawn EPERM');
      },
    });
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.status).not.toBe('pass');
    expect(v.note).toContain('UNIT_TEST_ROOTS');
  });

  it('judgeUnitRoots：任一 root fail ⇒ fail；全部 exit 0 + 汇总行干净 ⇒ pass；探测失败 ⇒ pending', () => {
    const green = { code: 0, stdout: 'Test Files  10 passed (100 tests)', stderr: '' };
    expect(judgeUnitRoots([{ label: 'root', outcome: green }, { label: 'apps/web', outcome: green }]).status).toBe('pass');
    // 汇总行报 failed（即使 exit 0 的防御分支）也判 fail
    expect(
      judgeUnitRoots([
        { label: 'root', outcome: green },
        { label: 'apps/web', outcome: { code: 1, stdout: 'Tests  1 failed | 95 passed (96)', stderr: '' } },
      ]).status,
    ).toBe('fail');
    // 未执行（探测失败）既不算 pass 也不算该 root 的 fail
    expect(judgeUnitRoots([{ label: 'root', outcome: { code: -1, stdout: '', stderr: '' }, probeFailed: true }]).status).toBe('pending');
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

// ===========================================================================
// Round 130（本卡）：三处「**判据文本声称的范围 > executor 实跑的范围**」的判别性守卫。
//
// 三处的处置各不相同（理由见 `gates.ts` 各自的常量注释）：
//   - gate 3 deterministic-bench → **(i) 让执行为真**：默认 executor 从 B001–B005 子集扩到
//     L1 全量清单（与发布驱动覆盖后的范围一致）；
//   - gate 4 real-model-bench → **(ii) 让判据为真**：判据如实缩到「逐行三态」
//     （L3 指标的判定语义在本仓没有口径，凭空造阈值等于新增未验证的判据）；
//   - gate 8 packaging → **(ii) 让判据为真**：判据如实缩到「探测两个路径存在」
//     （真正的发布物形状校验由发布驱动换成 `buildPublishArtifactExecutor()` 承担）。
//
// 纪律（照 gate 2 的先例 + 纪律 23）：**期望值一律从判据文本里正则解析**得到，
// 绝不与被测模块共用同一个常量同时「生成判据」与「生成期望」——那是同义反复，
// 证明不了「判据 == 实跑」。每条守卫的注释都写明「删掉修复里的哪一行会红」。
// ===========================================================================

/** 从 gate 3 criterion 文本里解析它点名的场景 id（`B\d{3}`）——不引用任何常量。 */
function declaredBenchScenarioIds(criterion: string): string[] {
  const out: string[] = [];
  for (const m of criterion.matchAll(/\bB\d{3}\b/g)) {
    const id = m[0];
    if (id !== undefined && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 从 gate 4 criterion 文本里解析它声明的「判定输入」状态集合——不引用任何常量。 */
function declaredLaneJudgedStatuses(criterion: string): string[] {
  const m = /判定输入[^（(]*[（(]([^）)]*)[）)]/.exec(criterion);
  const seg = m?.[1] ?? '';
  const out: string[] = [];
  for (const t of seg.matchAll(/`([^`]+)`/g)) {
    const s = t[1];
    if (s !== undefined && !out.includes(s)) out.push(s);
  }
  return out;
}

/** 从 gate 8 criterion 文本里解析它点名的 npm 命令——不引用任何常量。 */
function declaredPackagingCommands(criterion: string): string[] {
  const out: string[] = [];
  for (const m of criterion.matchAll(/`(npm pack[^`]*)`/g)) {
    const c = m[1];
    if (c !== undefined) out.push(c);
  }
  return out;
}

/** 从 gate 8 criterion 文本里解析它点名的两个探测路径（相对 `<repoRoot>`）——不引用任何常量。 */
function declaredPackagingProbePaths(criterion: string): string[] {
  const out: string[] = [];
  for (const m of criterion.matchAll(/`<repoRoot>\/([^`]+)`/g)) {
    const p = m[1];
    if (p !== undefined) out.push(p);
  }
  return out;
}

describe('gate 3 deterministic-bench：判据点名的场景 == 两种装配实际请求的场景（判别性守卫）', () => {
  it('判别性①：criterion 文本解析出的场景集合 == 默认装配与发布驱动覆盖下 runner 实际收到的 scenarioId', async () => {
    const criterion = gateDefinition('deterministic-bench').criterion;
    // 注册表里挂的就是这条 criterion（改名/断线 ⇒ 红；与 gate 2/5/7 的 toBe 同款）
    expect(criterion).toBe(DETERMINISTIC_BENCH_GATE_CRITERION);
    // 判据必须**自己写明**它对两种装配都成立（否则 (i) 的修复就没落到文案上）
    expect(criterion).toContain('默认装配');
    expect(criterion).toContain('发布驱动');

    // 期望：从 criterion **文本**里解析（不引用任何清单常量 ⇒ 不是同义反复）
    const declared = declaredBenchScenarioIds(criterion);
    expect(declared.length).toBeGreaterThan(0); // 解析本身必须有效，否则下面会退化成空集互等

    // ① 默认装配：buildReleaseGateExecutors() 的 deterministic-bench 分支
    const defaultRequested: string[] = [];
    const defaultExec = buildReleaseGateExecutors({
      offlineScenarioRunner: async ({ scenarioId }) => {
        defaultRequested.push(scenarioId);
        return fakePass();
      },
    }).find((e) => e.gate.id === 'deterministic-bench')!;
    expect((await defaultExec.run(offlineGateCtx())).status).toBe('pass');

    // ② 发布驱动覆盖后：run-release-gates.ts 的 buildDeterministicBenchExecutor（同一条 gate）
    const driverRequested: string[] = [];
    const driverExec = await buildDeterministicBenchExecutor(null, async ({ scenarioId }) => {
      driverRequested.push(scenarioId);
      return fakePass();
    });
    expect((await driverExec.run(offlineGateCtx())).status).toBe('pass');

    // 判据点名的集合 == 两种装配实际请求的集合（多一条、少一条、或两边不一致 ⇒ 必红）。
    // 「删掉修复就红」：把 gates.ts 的 gate 3 分支改回子集常量（B001–B005）⇒ 第一条必红；
    // 把 criterion 改回写死范围（少点名 B016–B027）⇒ 两条都红。
    expect([...defaultRequested].sort()).toEqual([...declared].sort());
    expect([...driverRequested].sort()).toEqual([...declared].sort());
    // 更强的判别点：默认装配必须覆盖 L1 两端的代表性场景（旧子集只有 B001–B005 ⇒ 必红）
    for (const id of ['B001', 'B005', 'B016', 'B027']) expect(defaultRequested).toContain(id);
    // 旧子集常量不得再是子集（有人把它退回 5 个 ⇒ 必红）。
    // **独立期望（对抗评审 A6 修正）**：此处原写 `toEqual([...L1_DETERMINISTIC_BENCH_SCENARIOS])`，
    // 而 `DETERMINISTIC_BENCH_SCENARIOS` 正是 `L1_DETERMINISTIC_BENCH_SCENARIOS` 的**同一引用**
    // ⇒ 左右恒等、这条断言**删不出红**（纪律 24）。改为与**字面量清单**比对：谁改别名指向、
    // 或改 L1 集合，都必须在此做一次**有意识的**更新。
    expect([...DETERMINISTIC_BENCH_SCENARIOS]).toEqual([
      'B001', 'B002', 'B003', 'B004', 'B005',
      'B016', 'B017', 'B018', 'B019', 'B020',
      'B021', 'B022', 'B023', 'B024', 'B025', 'B026', 'B027',
    ]);
  });
});

describe('gate 4 real-model-bench：判据声明的判定输入 == executor 实际判定输入（L3 指标不参与）', () => {
  it('判别性①：文本声明的判定输入恰好是逐行三态，且明说 `skipped` 与 §15 L3 指标不参与判定', () => {
    const criterion = gateDefinition('real-model-bench').criterion;
    expect(criterion).toBe(REAL_MODEL_BENCH_GATE_CRITERION);

    // 期望：从 criterion 文本里解析出「判定输入」的状态集合（不引用任何常量）
    const declared = declaredLaneJudgedStatuses(criterion);
    expect(declared).toEqual(['passed', 'failed', 'pending-environment']);
    // `skipped` 必须被**显式排除**（点名 + 写明不参与判定），不得沉默不提、更不得冒充判据
    expect(criterion).toContain('`skipped`');
    expect(criterion).toMatch(/`skipped`[^。]*不参与判定/);
    // 旧文案的病灶（「收集到 §15 L3 指标」当作判据）不得残留，必须如实声明「不解析、不判定」
    expect(criterion).not.toContain('收集到 §15 L3 指标');
    expect(criterion).toContain('不解析、不判定');
    expect(criterion).toContain('不等于');
  });

  it('判别性②：executor 实跑的 evidence 只由文本声明的三态计数构成，且不含任何 L3 指标字段', async () => {
    const criterion = gateDefinition('real-model-bench').criterion;
    const declared = declaredLaneJudgedStatuses(criterion);
    // 文本点名的状态 → 判定输入里的计数器名（**映射写在测试里**，不来自被测模块）
    const counterOf: Record<string, string> = {
      passed: 'passed=',
      failed: 'failed=',
      'pending-environment': 'pendingEnv=',
    };
    const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-rg-real-'));
    try {
      const { MockProvider } = await import('@vessel/llm');
      const models = [{ id: 'm', displayName: 'M', tier: 'flash' as const, defaultModel: 'm' }];
      const ctx = {
        repoRoot: os.tmpdir(),
        reportsDir,
        exec: async () => ({ code: 0, stdout: '', stderr: '' }),
      };

      // a) 无 provider / 无凭据 ⇒ 显式 pending（不静默通过）：evidence 里出现三态计数
      const noKey = buildReleaseGateExecutors({ providerResolver: async () => null, models })
        .find((e) => e.gate.id === 'real-model-bench')!;
      const vNoKey = await noKey.run(ctx);
      expect(vNoKey.status).toBe('pending');
      expect(vNoKey.pending).toBe(true);

      // b) 有 provider ⇒ 真跑 082 lane（repoRoot=os.tmpdir() 下 fixture 缺失 ⇒ runnable 行全 failed）
      const withKey = buildReleaseGateExecutors({
        providerResolver: async () =>
          new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'G' } }], { model: 'm' }),
        models,
      }).find((e) => e.gate.id === 'real-model-bench')!;
      const vWithKey = await withKey.run(ctx);
      expect(vWithKey.status).toBe('fail');

      const detail = [
        vNoKey.evidence.summary,
        ...(vNoKey.evidence.detail ?? []),
        vWithKey.evidence.summary,
        ...(vWithKey.evidence.detail ?? []),
      ].join('\n');

      // 文本声明的每个判定输入，都必须在 executor 真实产出的 evidence 里有对应计数器
      for (const status of declared) {
        const counter = counterOf[status];
        expect(counter, `criterion 声明了判定输入 ${status}，但测试没有它的计数器映射`).toBeDefined();
        expect(detail).toContain(counter!);
      }
      // 反向①：§15 L3 指标字段一个都不许出现在本 gate 的判定证据里（文本声明「不解析、不判定」）
      for (const key of ['wallTimeMs', 'toolCalls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'costUsd', 'modelSummaries']) {
        expect(detail).not.toContain(key);
      }
      // 反向②：`skipped` 不参与判定 —— 它既没有自己的计数器，也进不了 passed/failed 之外的三态
      expect(detail).not.toContain('skipped=');
    } finally {
      fs.rmSync(reportsDir, { recursive: true, force: true });
    }
  });
});

describe('gate 8 packaging：判据点名的命令/探测路径 == executor 实发命令/实际判定路径（判别性守卫）', () => {
  it('判别性①：文本点名的 npm 命令逐条等于实发命令；按文本点名的路径搭布局，判定与文本三态一致', async () => {
    const criterion = gateDefinition('packaging').criterion;
    expect(criterion).toBe(PACKAGING_GATE_CRITERION);

    // 期望：全部从 criterion **文本**里解析（不引用任何常量 ⇒ 不是同义反复）
    const declaredCmds = declaredPackagingCommands(criterion);
    const declaredPaths = declaredPackagingProbePaths(criterion);
    expect(declaredCmds).toEqual(['npm pack --dry-run --json']);
    expect(declaredPaths).toEqual(['dist', 'dist/index.js']);
    // 旧文案的病灶词（「存在且完整」+「工具缺失」）不得残留；新文案必须自认不校验完整性
    expect(criterion).not.toContain('存在且完整');
    expect(criterion).not.toContain('等价产物）存在');
    expect(criterion).toContain('不校验');

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-rg-pkg-'));
    try {
      const invoked: string[] = [];
      const pkg = buildReleaseGateExecutors().find((e) => e.gate.id === 'packaging')!;
      const ctx = {
        repoRoot: root,
        reportsDir: path.join(root, 'reports'),
        exec: async (command: string, args: string[]) => {
          invoked.push([command, ...args].join(' '));
          return { code: 0, stdout: '', stderr: '' };
        },
      };

      // 布局 A：两个路径都不存在 ⇒ pending（文本①）。实发命令必须逐条等于文本点名的命令。
      // 「删掉修复就红」：把 criterion 改回旧串（不再点名 `npm pack --dry-run --json`）⇒
      // declaredCmds 为空/不等 ⇒ 本守卫红；把 executor 的命令改掉而文案不动 ⇒ 同样红。
      expect((await pkg.run(ctx)).status).toBe('pending');
      expect([...invoked]).toEqual(declaredCmds);

      // 布局 B：只有文本点名的第一个路径存在 ⇒ fail（文本③）
      fs.mkdirSync(path.join(root, ...declaredPaths[0]!.split('/')), { recursive: true });
      expect((await pkg.run(ctx)).status).toBe('fail');
      expect(invoked).toHaveLength(declaredCmds.length * 2);

      // 布局 C：文本点名的两个路径都在 ⇒ pass（文本②）
      const entry = path.join(root, ...declaredPaths[1]!.split('/'));
      fs.mkdirSync(path.dirname(entry), { recursive: true });
      fs.writeFileSync(entry, '// entry\n', 'utf8');
      expect((await pkg.run(ctx)).status).toBe('pass');
      expect(invoked).toHaveLength(declaredCmds.length * 3);

      // 布局 D：命令探测失败（exec 抛出）⇒ pending（文本①后半句）
      expect(
        (
          await pkg.run({
            ...ctx,
            exec: async () => {
              throw new Error('spawn EPERM');
            },
          })
        ).status,
      ).toBe('pending');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

/**
 * 负对照：本卡只动了三道 gate —— gate 3（默认 executor 对齐判据）、gate 4 / gate 8（判据文本如实化）；
 * 其余 5 道 §21 gate 的 criterion 字面量、judge、executor **逐字未动**。
 *
 * 核对方式（两层）：
 *  ① 机械层：下面把两道**纯内联字面量**判据（gate 1 build / gate 6 resume）按改动前的原文钉死
 *     —— 谁在本卡范围外改它们，这里立刻红；
 *  ② 结构层：gate 2/5/7 的判据由导出常量插值持有（gate 2 插 `UNIT_TEST_ROOTS`、gate 5 插
 *     `SAFETY_SCENARIOS`），本卡未编辑那三个常量，另有 `toBe(CONSTANT)` 与专门用例锁着接线，
 *     故这里只复核「注册表仍挂同一常量」这一条接线事实。
 */
describe('负对照：其它 5 道 gate 的判据逐字未动（本卡只动 gate 3/4/8）', () => {
  it('gate 1 build / gate 6 resume 的 criterion 与改动前逐字一致', () => {
    expect(gateDefinition('build').criterion).toBe(
      '类型构建 `tsc -b tsconfig.json` 与 `apps/web` 类型检查（`tsc -p apps/web/tsconfig.json`）均完成且退出码 0（无类型错误）。',
    );
    expect(gateDefinition('resume').criterion).toBe(
      '063/064 可跑集（068 soak 小规模）resume 不变量成立：暂停/续跑、workspace 零残留、从 handoff 续跑留痕。',
    );
  });

  it('gate 2/5/7 的注册表接线仍指向各自（未被本卡编辑的）导出常量', () => {
    expect(gateDefinition('unit').criterion).toBe(UNIT_GATE_CRITERION);
    expect(gateDefinition('safety').criterion).toBe(SAFETY_GATE_CRITERION);
    expect(gateDefinition('ux-smoke').criterion).toBe(UX_SMOKE_GATE_CRITERION);
    // 结构性锚点：证明这几条判据仍是改动前的口径（gate 2 覆盖两个 vitest root、gate 5 覆盖 8 个
    // 安全场景、gate 7 只探产物且不跑 web 测试）—— 与「未改这些 gate」互为佐证。
    expect(gateDefinition('unit').criterion).toContain('--root apps/web');
    expect(gateDefinition('safety').criterion).toContain(SAFETY_SCENARIOS.join(','));
    expect(gateDefinition('ux-smoke').criterion).toContain('不执行任何 web 测试');
  });
});