import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { TelemetryCounters } from '@vessel/telemetry';
import { runAssert, IMPLEMENTED_METRICS, type AssertContext } from './asserts.js';
import { loadManifest } from './manifest.js';
import type { AssertionSpec } from './types.js';

/**
 * BRIEF-C —— `metricValue()` 对**未知指标**走 `default: return 0`：判据静默失效。
 *
 * 病灶：`metricValue()` 只认 8 个指标名（M02/M03/M04/M05/M09/M12/M13/M14），其余一律返回 0，
 * 于是 `metric_le` 对任何**写错的指标名**恒真（`0 <= limit`）、`metric_ge` 恒假
 * （`0 >= limit`，`limit: 0` 时甚至恒真）—— **红绿都不带原因**：判据没了判别力，报告里也看不出
 * "这个指标名根本没实现"。本卡把它改成 fail-loud（返回 `null` ⇒ 调用点显式判 fail 并把指标名
 * 写进 evidence），并逐条钉住"既有指标名行为逐字不变"。
 *
 * 「删哪行会红」：
 *   - 把 `metricValue` 的 `default: return null` 改回 `return 0`（或删掉 `value === null` 分支）
 *     ⇒ ①② 红（① 改前正是"静默 pass"）；
 *   - 把未知指标的证据删掉（不再点名指标名/已实现集合）⇒ ①② 红；
 *   - 给某个已实现指标换了 `TelemetryCounters` 字段 ⇒ ③ 红；
 *   - 新增/删除一个 `case 'M..'` 而不改 `IMPLEMENTED_METRICS` ⇒ ④ 红；
 *   - 线上场景用了一个未实现的指标名 ⇒ ⑤ 红（今天唯一用到的是 B002 的 M04）。
 */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ASSERTS_SRC = fileURLToPath(new URL('./asserts.ts', import.meta.url));
const SCENARIOS_DIR = path.join(REPO_ROOT, 'benchmarks', 'scenarios');

/**
 * 计数快照：每个字段取**互不相同**的值，这样"某个指标读错了字段"必然改变结果，
 * 不会因为两个字段恰好同值而被掩盖。
 */
const COUNTERS: TelemetryCounters = {
  turns: 3, steps: 5, toolCalls: 7, retries: 2, invalidArgs: 1, denials: 4,
  compactions: 6, evaluatorRejects: 8, approvalAsks: 9, steers: 11, interrupts: 12,
  inputTokens: 100, outputTokens: 50, cacheReadTokens: 25,
};

/** 独立字面量（不由实现反推）：指标名 → `COUNTERS` 里该指标**应当**取到的值。 */
const EXPECTED: Record<string, number> = {
  M02: 3, M03: 7, M04: 1, M05: 2, M09: 6, M12: 4, M13: 8, M14: 9,
};

const CTX: AssertContext = {
  workspace: REPO_ROOT, sessionRecords: [], counters: COUNTERS,
  finalText: '', snapshotBefore: new Map(),
};

const run = (type: 'metric_le' | 'metric_ge', metric: string, limit: number) =>
  runAssert({ type, metric, limit } as AssertionSpec, CTX, 0);

describe('asserts — metric_le/metric_ge 对未知指标 fail-loud（BRIEF-C）', () => {
  it('① 复现：`metric_le` 用未实现的指标名 ⇒ 改前恒真（静默 pass），现在必须是显式红', async () => {
    // 改前：metricValue('M99') === 0 ⇒ `0 <= 0` ⇒ **pass**（判据静默失效的典型形状：
    // 判据本身写得"看起来更严"，实际任何情况都为真）。
    const r = await run('metric_le', 'M99', 0);
    expect(r.result, JSON.stringify(r.evidence)).toBe('fail');
    expect(r.evidence.value).toBeNull(); // 不再是"测得 0"
    expect(String(r.evidence.error)).toContain('M99'); // 证据点名**那个**指标
    expect(String(r.evidence.error)).toContain('unknown metric');
    expect(String(r.evidence.error)).toContain('M12'); // 并给出已实现集合，一眼看出是拼写/未实现
  });

  it('② `metric_ge` 用未实现的指标名 ⇒ limit:0 时改前是**假绿**，现在显式红', async () => {
    // 改前：0 >= 0 ⇒ pass（比 ① 更糟：判据号称"至少 0 次"，恒真的同时还没人看得见）；
    // 0 >= 1 ⇒ fail（但证据里只有 {metric, value:0, limit:1}，与"真跑了且计数为 0"无法区分）。
    const silentPass = await run('metric_ge', 'M99', 0);
    expect(silentPass.result, JSON.stringify(silentPass.evidence)).toBe('fail');
    const silentFail = await run('metric_ge', 'M99', 1);
    expect(silentFail.result).toBe('fail');
    for (const r of [silentPass, silentFail]) {
      expect(r.evidence.value).toBeNull();
      expect(String(r.evidence.error)).toContain('M99');
    }
  });

  it('③ 负对照：8 个已实现指标名的判据行为与证据形状**逐字不变**', async () => {
    for (const [metric, value] of Object.entries(EXPECTED)) {
      expect(IMPLEMENTED_METRICS).toContain(metric);
      // metric_le：值本身 pass、值-1 fail（边界取等号 ⇒ 值即 pass）
      const leOk = await run('metric_le', metric, value);
      expect(leOk.result, `metric_le ${metric} ${value}`).toBe('pass');
      const leTight = await run('metric_le', metric, value - 1);
      expect(leTight.result, `metric_le ${metric} ${value - 1}`).toBe('fail');
      // metric_ge：值本身 pass、值+1 fail
      const geOk = await run('metric_ge', metric, value);
      expect(geOk.result, `metric_ge ${metric} ${value}`).toBe('pass');
      const geTight = await run('metric_ge', metric, value + 1);
      expect(geTight.result, `metric_ge ${metric} ${value + 1}`).toBe('fail');
      // 证据形状逐字不变（未知指标才会多出 error 字段）
      expect(Object.keys(leOk.evidence).sort()).toEqual(['limit', 'metric', 'value']);
      expect(leOk.evidence).toEqual({ metric, value, limit: value });
      expect(geOk.evidence).toEqual({ metric, value, limit: value });
    }
    // 未被取值的其余计数器不影响判据（新分支不得引入串味）
    expect((await run('metric_le', 'M13', 0)).evidence.value).toBe(8);
  });

  it("④ 代码⇄表：metricValue 的 case 集合 == IMPLEMENTED_METRICS；不得再有 default: return 0", () => {
    const src = fs.readFileSync(ASSERTS_SRC, 'utf8');
    const cases = [...src.matchAll(/case '(M\d+)': return/g)].map((m) => m[1]!);
    expect(cases.length).toBeGreaterThan(0); // 负对照：扫描确实读到了 switch
    expect(new Set(cases)).toEqual(new Set(IMPLEMENTED_METRICS));
    expect(src).toContain('default: return null;');
    expect(src).not.toContain('default: return 0;');
  });

  it('⑤ 线上场景不会有判据因本改动变红：所有 metric_le/metric_ge 的指标名都在已实现集合里', () => {
    const ids = fs
      .readdirSync(SCENARIOS_DIR)
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace(/\.yaml$/, ''));
    expect(ids.length).toBeGreaterThan(0); // 负对照：确实枚举到了场景
    const used: { id: string; metric: string }[] = [];
    for (const id of ids) {
      for (const spec of loadManifest(REPO_ROOT, id).pass) {
        if (spec.type !== 'metric_le' && spec.type !== 'metric_ge') continue;
        used.push({ id, metric: spec.metric ?? '' });
      }
    }
    // 今天唯一一条是 B002 的 `metric_le M04`（M04 已实现 ⇒ 行为不变）；这一断言把它钉住，
    // 将来有人加了未实现指标名的判据，本用例先红，而不是让那条判据在报告里静默失真。
    expect(used).toContainEqual({ id: 'B002', metric: 'M04' });
    const unknown = used.filter((u) => !IMPLEMENTED_METRICS.includes(u.metric));
    expect(unknown, `这些线上判据用的是未实现指标名：${JSON.stringify(unknown)}`).toEqual([]);
    // `measured` 只是采集声明、不驱动判据（manifest.ts 原样透传），故本改动不触及它；
    // 其中 M01/M08/M11 既不在 metricValue 也不在 Telemetry.metrics() 的取值面上（另记只报告项）。
  });
});
