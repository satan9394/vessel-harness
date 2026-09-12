/**
 * task 084 — Release Gates runner: sequential gate execution（§21 注册表 8 道 +
 * 可选第 9 道 install-smoke）→ aggregate
 * release-report.json (schemaVersion + per-gate result/evidence/duration +
 * overall verdict) + release-report.md (human-readable).
 *
 * Overall verdict (§21 / task card):
 *  - all gates `pass`            → `ready`
 *  - at least one gate `fail`    → `blocked`
 *  - otherwise (some `pending`, none fail) → `partial`
 *
 * The runner is injectable: callers pass the ordered GateExecutor[] (tests
 * substitute mocks) and an injected RunCommand (tests fake the spawn seam).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GATE_ORDER } from './gates.js';
import type {
  GateExecutor,
  GateId,
  GateVerdictStatus,
  ReleaseContext,
  RunCommand,
} from './types.js';

export interface ReleaseGateResult {
  id: GateId;
  name: string;
  position: number;
  criterion: string;
  status: GateVerdictStatus;
  evidence: { summary: string; detail?: string[]; artifacts?: string[] };
  durationMs: number;
  note?: string;
}

export type ReleaseStatus = 'ready' | 'blocked' | 'partial';

/** The complete, JSON-serializable release report (084 output). */
export interface ReleaseReport {
  schemaVersion: 1;
  version?: string;
  generatedAt: string;
  status: ReleaseStatus;
  /** per-gate results, ordered by gate.position（§21 注册表 1..8；装了可选第 9 道时如实多一行）。 */
  gates: ReleaseGateResult[];
  /** machine summary counts. */
  totals: { pass: number; fail: number; pending: number; durationMs: number };
}

/** Overall verdict: pass-only → ready; any fail → blocked; else partial. */
export function releaseStatus(gates: ReleaseGateResult[]): ReleaseStatus {
  if (gates.some((g) => g.status === 'fail')) return 'blocked'; // 有 fail = blocked（即使还有 pending）
  if (gates.some((g) => g.status === 'pending')) return 'partial'; // 无 fail 但有 pending = partial
  return 'ready'; // 全 pass = ready
}

const STATUS_LABEL: Record<GateVerdictStatus, string> = {
  pass: '✅ PASS',
  fail: '❌ FAIL',
  pending: '⏸ PENDING',
};

/** Render the release report as a human-readable markdown doc. */
export function renderReleaseMarkdown(report: ReleaseReport): string {
  const line = (s = ''): string => (s.length > 0 ? `${s}\n` : '\n');
  const o: string[] = [];
  o.push(line(`# Release Report — ${report.version ?? 'v-unset'}`));
  o.push(line(`> 任务卡：tasks/084-release-gates.md；权威需求：docs/Vessel路线 §21（L1946-1974，注册表 8 道常驻 release gate）+ 第 9 道「安装态冒烟」（install-smoke）为**可选**：VESSEL_GATE_INSTALL_SMOKE=1 才真跑，未启用时如实记 pending（不静默通过）。`));
  o.push(line(`> 生成于 ${report.generatedAt}；schema ${report.schemaVersion}；总判定：**${reportStatusLabel(report.status)}**`));
  o.push(line(`> 判定规则：全 pass=ready / 有 fail=blocked / 有 pending 无 fail=partial（不以自证为证）。`));
  o.push(line());

  // 标题的「N 道」由**实际收到的 gate 行数**推导（§21 注册表 8 道 + 可选第 9 道 install-smoke），
  // 不得写死 —— 否则启用第 9 道时表格 9 行会与标题「8 道」自相矛盾。
  o.push(line(`## 发布门禁（${report.gates.length} 道）`));
  o.push(line('| # | gate | status | duration(ms) | criterion | evidence |'));
  o.push(line('| --- | --- | --- | ---: | --- | --- |'));
  for (const g of report.gates) {
    const ev = g.evidence.summary + (g.note ? ` — ${g.note}` : '');
    o.push(line(`| ${g.position} | ${g.name} | ${STATUS_LABEL[g.status]} | ${g.durationMs} | ${g.criterion} | ${ev} |`));
  }
  o.push(line());

  o.push(line('## 总体'));
  o.push(line(`| status | pass | fail | pending | 总时长(ms) |`));
  o.push(line(`| --- | ---: | ---: | ---: | ---: |`));
  o.push(line(`| ${report.status} | ${report.totals.pass} | ${report.totals.fail} | ${report.totals.pending} | ${report.totals.durationMs} |`));
  o.push(line());

  o.push(line('## 环境注解'));
  // pending 的 gate **一律**列出：有 note 用 note；没有 note 也如实列（缺 note 不得让该 gate
  // 从注解里消失）—— 下方脚注写的是「逐条见上方环境注解」，注解漏行会让那句话不成立。
  for (const g of report.gates) {
    if (g.status !== 'pending') continue;
    o.push(line(`- ${g.name}：${g.note ?? '（pending，未附 note；判据情况见上表 evidence）'}`));
  }
  if (!report.gates.some((g) => g.status === 'pending')) {
    o.push(line('_（无 pending，全部判据已执行）_'));
  }
  o.push(line());
  // pending 的 gate 名单**由本次结果动态生成**，绝不写死。
  // 旧文案把可能 pending 的 gate 写死成「real model / UX / packaging」——三态归约落地后
  // gate 5（safety）也**合法地可能 pending**（清单里某场景在 manifest 声明了能力缺口
  // `type: indeterminate`），旧句因此既不完整又会误导（读者会以为 safety 变 pending 是异常）。
  // 现在只有一条结构性表述：pending 的成因是三类（环境不可用 / 无凭据 / 场景声明能力缺口），
  // 具体是哪几道由 `report.gates` 里 `status === 'pending'` 的行如实列出（无 pending 时明说没有）。
  const pendingGates = report.gates.filter((g) => g.status === 'pending');
  o.push(
    line(
      pendingGates.length > 0
        ? `> 说明：本次 pending 的 gate = ${pendingGates.map((g) => g.name).join(' / ')}（共 ${pendingGates.length} 道，逐条见上方「环境注解」）。` +
            'pending 的成因是**结构性的、不限于某个固定名单**：① 该 gate 所需环境/工具/产物不可用；② 无凭据；' +
            '③ 场景在 manifest 里**声明了能力缺口**（assert 全为 `type: indeterminate` ⇒ 离线 mock 判不了，既非通过也非失败）。' +
            '需在可判定环境下补齐后再判 ready；本报告不因 pending 静默通过。'
        : '> 说明：本次**无 pending 的 gate**（全部 gate 均已判定，逐条见上方「环境注解」）。' +
            '本句的 pending 名单由本次结果动态生成、不写死：任何 gate（含 safety）若因环境不可用 / 无凭据 / ' +
            '场景声明能力缺口而 pending，都会在此被逐个点名。本报告不因 pending 静默通过。',
    ),
  );
  return o.join('');
}

function reportStatusLabel(s: ReleaseStatus): string {
  return s === 'ready' ? 'READY' : s === 'blocked' ? 'BLOCKED' : 'PARTIAL';
}

/** Persist release-report.md + release-report.json to `<reportsDir>/release-report.*`. */
export function writeReleaseReportFiles(report: ReleaseReport, reportsDir: string): { mdPath: string; jsonPath: string } {
  fs.mkdirSync(reportsDir, { recursive: true });
  const mdPath = path.join(reportsDir, 'release-report.md');
  const jsonPath = path.join(reportsDir, 'release-report.json');
  fs.writeFileSync(mdPath, renderReleaseMarkdown(report), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  return { mdPath, jsonPath };
}

/**
 * Run all gates in §21 order, sequntially, aggregating into a ReleaseReport.
 * Executors are injected (array order is honoured but each result is re-sorted
 * by gate.position for the report). A gate executor that throws is surfaced as
 * a `fail` verdict with the error as evidence — never swallowed or treated as
 * a silent pass.
 */
export async function runReleaseGates(
  executors: GateExecutor[],
  ctx: ReleaseContext,
  runCommand: RunCommand,
): Promise<ReleaseReport> {
  const startedAt = new Date();
  const results: ReleaseGateResult[] = [];
  const execCtx = { ...ctx, exec: runCommand };

  for (const ex of executors) {
    const gateStarted = Date.now();
    let status: GateVerdictStatus;
    let evidence: ReleaseGateResult['evidence'];
    let note: string | undefined;
    try {
      const v = await ex.run(execCtx);
      status = v.status;
      evidence = {
        summary: v.evidence.summary,
        detail: v.evidence.detail,
        artifacts: v.evidence.artifacts,
      };
      note = v.note;
    } catch (err) {
      status = 'fail';
      evidence = { summary: `gate ${ex.gate.id} 执行抛异常`, detail: [String(err)] };
    }
    const durationMs = Date.now() - gateStarted;
    results.push({
      id: ex.gate.id,
      name: ex.gate.name,
      position: ex.gate.position,
      criterion: ex.gate.criterion,
      status,
      evidence,
      durationMs,
      note,
    });
  }

  results.sort((a, b) => a.position - b.position);
  const report: ReleaseReport = {
    schemaVersion: 1,
    version: ctx.version,
    generatedAt: new Date().toISOString(),
    status: releaseStatus(results),
    gates: results,
    totals: {
      pass: results.filter((g) => g.status === 'pass').length,
      fail: results.filter((g) => g.status === 'fail').length,
      pending: results.filter((g) => g.status === 'pending').length,
      durationMs: Date.now() - startedAt.getTime(),
    },
  };
  return report;
}

/** Ordering helper — the canonical §21 gate order the runner enforces. */
export function orderedGateExecutors<T extends GateExecutor>(executors: T[]): T[] {
  const byId = new Map(executors.map((e) => [e.gate.id, e]));
  return GATE_ORDER.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
}