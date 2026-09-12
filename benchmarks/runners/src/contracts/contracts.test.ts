import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { ChatProvider, ChatResponse } from '@vessel/shared';
import { runScenario, loadManifest } from '../index.js';
import {
  vesselAdapter,
  runVesselFixture,
  VESSEL_ADAPTER_ID,
  VESSEL_ADAPTER_VERSION,
  vesselCapabilities,
} from './vessel.js';
import {
  assertValidRunResult,
  validateRunResult,
  validateRunResultMetrics,
  validateHarnessAdapter,
} from './validate.js';
import type { HarnessFixture, RunResult } from './types.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONFIG_DIR = path.join(REPO_ROOT, 'configs'); // policy/behavior/pricing live here
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-contracts-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

/** Build a self-contained fixture dir with a trivial task.md. */
function makeFixture(id: string, dedentTask: string): string {
  const dir = path.join(tmpRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), dedentTask, 'utf8');
  return dir;
}

const MOCK_CHAT = new MockProvider(
  [{ when: /.*/, ifNoToolResult: true, response: { text: 'CONTRACTS-GOLDEN-ANSWER' } }],
  { model: 'mock-model' },
);

function validFixture(id = 'X001'): HarnessFixture {
  return {
    id,
    workspaceRoot: makeFixture(id, 'Return the answer.'),
    options: {
      provider: MOCK_CHAT,
      model: 'mock-model',
      configRoot: REPO_ROOT,
    },
  };
}

function validResultFields(): RunResult['metrics'] {
  return {
    success: true,
    wallTimeMs: 301,
    toolCalls: 2,
    invalidCalls: 0,
    retries: 1,
    inputTokens: 120,
    outputTokens: 40,
    cacheReadTokens: 10,
    costUsd: 0.001,
    contextPeak: 130,
    compactions: 0,
    humanIntervention: 0,
    policyViolations: 0,
    resumeSuccess: false,
  };
}

/** test helper — erase a typed object to permissively mutate it. */
function asRec<T>(m: T): Record<string, unknown> {
  return m as unknown as Record<string, unknown>;
}

describe('contracts/validate — RunResult validation', () => {
  it('accepts a fully-formed metrics record', () => {
    const issues = validateRunResultMetrics(validResultFields());
    expect(issues).toEqual([]);
  });

  it('rejects missing / wrong-typed / negative / NaN metric fields', () => {
    const base = validResultFields();
    const cases: Array<{ mutate: (m: RunResult['metrics']) => void; on: string }> = [
      { mutate: (m) => delete asRec(m).toolCalls, on: 'toolCalls missing' },
      { mutate: (m) => asRec(m).wallTimeMs = 'fast', on: 'wallTimeMs wrong type' },
      { mutate: (m) => asRec(m).retries = -1, on: 'retries negative' },
      { mutate: (m) => asRec(m).contextPeak = Number.NaN, on: 'contextPeak NaN' },
      { mutate: (m) => asRec(m).costUsd = -0.5, on: 'costUsd negative' },
      { mutate: (m) => asRec(m).success = 'yes', on: 'success non-boolean' },
      { mutate: (m) => asRec(m).resumeSuccess = 'yep', on: 'resumeSuccess invalid' },
    ];
    for (const c of cases) {
      const m = validResultFields();
      c.mutate(m);
      const issues = validateRunResultMetrics(m);
      expect(issues.length, c.on).toBeGreaterThan(0);
    }
  });

  it('rejects a full RunResult with bad adapter/timestamp/artifacts', () => {
    const r: RunResult = {
      adapterId: 'vessel',
      adapterVersion: '0.0.0',
      fixtureId: 'X0',
      metrics: validResultFields(),
      startedAt: 'not-a-date',
      artifacts: [{ kind: 'session', path: '' }, { kind: 'bogus' } as never],
    };
    const issues = validateRunResult(r);
    expect(issues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['startedAt', 'artifacts[]']),
    );
  });

  it('assertValidRunResult throws on invalid result, passes on valid', () => {
    expect(() => {
      const bad = validResultFields();
      asRec(bad).inputTokens = -3;
      assertValidRunResult({ adapterId: 'vessel', adapterVersion: '0', fixtureId: 'x', metrics: bad, startedAt: new Date().toISOString() });
    }).toThrow(/invalid RunResult/);
    expect(() =>
      assertValidRunResult({
        adapterId: 'vessel', adapterVersion: '0', fixtureId: 'x',
        metrics: validResultFields(), startedAt: new Date().toISOString(),
      }),
    ).not.toThrow();
  });

  it('validateHarnessAdapter rejects a broken adapter surface', () => {
    const ok = validateHarnessAdapter(vesselAdapter);
    expect(ok).toEqual([]);
    const broken = validateHarnessAdapter({
      id: 'x', version: '', run: 42,
    } as unknown as typeof vesselAdapter);
    expect(broken.length).toBeGreaterThan(0);
  });
});

describe('contracts/vessel — Vessel self-adapter run', () => {
  it('produces a valid RunResult with all §15 L3 metrics via runVesselFixture', async () => {
    const result = await runVesselFixture(validFixture());
    expect(validateRunResult(result)).toEqual([]);
    expect(result.metrics.success).toBe(true);
    expect(result.adapterId).toBe(VESSEL_ADAPTER_ID);
    expect(result.adapterVersion).toBe(VESSEL_ADAPTER_VERSION);
    expect(result.metrics.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.toolCalls).toBeGreaterThanOrEqual(0);
    expect(validateRunResultMetrics(result.metrics)).toEqual([]);
    // all §15 L3 fields present
    for (const key of [
      'success', 'wallTimeMs', 'toolCalls', 'invalidCalls', 'retries',
      'inputTokens', 'outputTokens', 'cacheReadTokens', 'costUsd',
      'contextPeak', 'compactions', 'humanIntervention', 'policyViolations', 'resumeSuccess',
    ]) {
      expect(result.metrics).toHaveProperty(key);
    }
  }, 60_000);

  it('adapter.run cleans up its temp workspace by default', async () => {
    const fixture = validFixture('X002');
    const result = await vesselAdapter.run(fixture);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    expect(ws).toBeDefined();
    expect(fs.existsSync(ws!)).toBe(false); // cleaned by adapter.run
  }, 60_000);

  it('reports metrics.success=false on a fixture whose run errored (does not throw)', async () => {
    // a provider that throws on the first model call → harness.loop throws
    const dir = makeFixture('XBAD', 'Do something impossible.');
    const throwing: ChatProvider = {
      id: 'throwing',
      async chat() {
        throw new Error('provider exploded');
      },
    };
    const result = await vesselAdapter.run({
      id: 'XBAD',
      workspaceRoot: dir,
      options: { provider: throwing, model: 'mock-model', configRoot: REPO_ROOT },
    });
    expect(result.metrics.success).toBe(false);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(result.notes?.join('')).toContain('provider exploded');
    // the RunResult is still contract-valid so the runner can aggregate it
    expect(validateRunResult(result)).toEqual([]);
  }, 60_000);

  /**
   * 证据层诚实性（契约侧）：本函数过去只取 `res.finalText`（vessel.ts 旧 :150），
   * 于是熔断器打死的回合（core AgentLoop.ts:334-338：kind='error'，err.message 写进
   * finalText 后正常 return）带着**非空** finalText 走到
   * `success = runError === null && finalText.trim().length > 0` ⇒ success=true。
   * 真实模型 lane（real-model-lane.ts:340 → vesselAdapter.run → 本函数）正走这条路，
   * 行状态由 metrics.success 决定 ⇒「被打死」在报告里会变成「passed」。
   * 本卡只让它在 notes 里**可见**；success 口径不动（改口径会失真历史对比）。
   */
  it('证据层诚实性：被熔断打死的回合在 notes 里可见（success 口径不变，旧实现必红）', async () => {
    const dir = makeFixture('XDENY', 'Do something impossible.');
    // 每一步都发完全相同的调用 ⇒ 同一 intent 第 3 次被拒 ⇒ DenialLimitError ⇒ kind='error'
    const sameIntent: ChatProvider = {
      id: 'same-intent-denied',
      async chat(): Promise<ChatResponse> {
        return {
          content: '',
          toolCalls: [{ id: 'tc_same_intent', name: 'Shell', arguments: { command: 'rm -rf subdir' } }],
          finishReason: 'tool_calls',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const result = await vesselAdapter.run({
      id: 'XDENY',
      workspaceRoot: dir,
      options: { provider: sameIntent, model: 'mock-model', configRoot: REPO_ROOT },
    });
    // 旧实现：notes === undefined（丢 kind）⇒ 本行必红。
    expect(result.notes?.join(' | ')).toContain('turn ended kind=error');
    expect(result.notes?.join(' | ')).toContain('same intent denied');
    // 口径未变：finalText 非空 ⇒ success=true（是否据此降级由指挥侧裁决，本卡不改判）
    expect(result.metrics.success).toBe(true);
    expect(validateRunResult(result)).toEqual([]);
  }, 60_000);

  it('负对照：kind=success ⇒ notes 仍为 undefined（既有字段逐字不变）', async () => {
    const result = await vesselAdapter.run(validFixture('XOK'));
    expect(result.metrics.success).toBe(true);
    expect(result.notes).toBeUndefined(); // 改动前是 `runError ? [...] : undefined` —— success 路径同一取值
    expect(validateRunResult(result)).toEqual([]);
  }, 60_000);

  it('capabilities declare the engine surface (tool_calls/exec/policy/subagent...)', () => {
    const caps = vesselCapabilities();
    expect(caps.matrix).toBe(true);
    expect(caps.policy).toBe(true);
    expect(caps.resume).toBe(false);
    expect(caps.file_edit).toBe(true);
  });
});

/**
 * 「有类型、无数据」形态的守卫（本卡 A）—— `RunResultMetrics.resumeSuccess` 在**自家 arm** 上
 * **不可判定**。
 *
 * 病灶（复核证据在 `vessel.ts` 的 `resumeSuccess` 注释里逐条列出）：这一格过去是**字面量 `false`**，
 * 而 `runVesselFixture()` 根本没有续跑通路（`vesselCapabilities().resume === false`，从不 seed
 * handoff、不重放既有会话）⇒ 它永远不会变，却同时被契约（`types.ts`）、校验（`validate.ts`）
 * 与报告（`report/report.ts`）**当成真实数据**消费。本仓确实有"从 handoff 续跑"这条事实与判据
 * （`runner.ts` 的 `manifest.harness?.resume` 分支 + `resume_seen` 断言 / B027），但它住在 runner
 * 的 manifest 车道，不在本适配器这条"一个 fixture 一次隔离 run"的车道上。
 *
 * 处置：`null`（本契约里 `boolean | null` 的既有 N/A 编码，外部适配器在拿不到该量时也用 `null`）
 * + 本节两个用例把"不可判定"钉成可执行事实。
 *
 * 「删哪行会红」：
 *   - 把 `const resumeSuccess: boolean | null = null;` 写回布尔常量（`false`/`true`）⇒ ①② 红；
 *   - 让它变成任何"算出来的值"（正则匹配不到 `null`）⇒ ② 红（逼接线的人先改本守卫与注释）；
 *   - 删掉 `vesselCapabilities()` 的 `resume: false`（声明侧与取值侧不再互相印证）⇒ ① 红。
 * 负对照：其余 §15 L3 字段与既有用例（`success`/`notes`/`validateRunResult`）**逐字不变**——
 * 上一节 `contracts/vessel — Vessel self-adapter run` 的五个用例改动前后同为绿。
 */
describe('contracts/vessel — resumeSuccess 在自家 arm 不可判定（有类型、无数据守卫）', () => {
  it('① 两次真实 run（正常收尾 / provider 抛错）都取 N/A：resumeSuccess === null，绝不是布尔', async () => {
    // 用 `vesselAdapter.run`（而非 runVesselFixture）：它按契约清理临时工作区，不留垃圾。
    const ok = await vesselAdapter.run(validFixture('XRES_OK'));
    expect(ok.metrics.success).toBe(true); // 负对照：这一格仍由真实链路决定
    expect(ok.metrics.resumeSuccess).toBeNull(); // 改前：字面量 false ⇒ 本行红

    // 失败路径同样不该"测出 false"：本车道连"续跑过没有"都没有观测面。
    const throwing: ChatProvider = {
      id: 'throwing-resume-guard',
      async chat(): Promise<ChatResponse> {
        throw new Error('provider exploded (resume guard)');
      },
    };
    const bad = await vesselAdapter.run({
      id: 'XRES_BAD',
      workspaceRoot: makeFixture('XRES_BAD', 'Do something impossible.'),
      options: { provider: throwing, model: 'mock-model', configRoot: REPO_ROOT },
    });
    expect(bad.metrics.success).toBe(false); // 负对照：错的就是错的
    expect(bad.metrics.resumeSuccess).toBeNull();

    // N/A 仍是契约合法值（validate 只要求 boolean | null）——本改动不放宽任何校验。
    expect(validateRunResult(ok)).toEqual([]);
    expect(validateRunResult(bad)).toEqual([]);

    // 声明⇄取值互相印证：本适配器声明没有 resume 能力 ⇒ 这一格只能是 N/A。
    // （将来真接了续跑驱动，必须同时改这里与 vessel.ts 的注释。）
    expect(vesselCapabilities().resume).toBe(false);
  }, 60_000);

  it('② 结构性绊线：vessel.ts 里 resumeSuccess 的取值只允许是 N/A 常量', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./vessel.ts', import.meta.url)), 'utf8');
    // 只看那一处**赋值**（`const resumeSuccess… = <值>;`），不是"文件里出现过 false/true"——
    // 后者会被注释或别的字段误伤，正是"断言写错却看起来正确"的典型。
    const assigned = /const resumeSuccess\b[^=\n]*=\s*([^;\n]+);/.exec(src);
    expect(
      assigned,
      'vessel.ts 里找不到 `const resumeSuccess = <值>;` 的赋值 —— 字段被删/改名/换成对象字面量写法？请同步本守卫与注释',
    ).not.toBeNull();
    expect(assigned![1]!.trim()).toBe('null');
  });
});

describe('contracts — coexistence with the existing runner', () => {
  it('loads an existing L1 manifest alongside the contracts exports', async () => {
    const manifest = loadManifest(REPO_ROOT, 'B001');
    expect(manifest.id).toBe('B001');
    expect(vesselAdapter.id).toBe('vessel'); // both surfaces import cleanly
  });

  it('runScenario (existing runner) still passes B001 offline — no regression', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-contract-reports-'));
    try {
      const report = await runScenario({
        scenarioId: 'B001',
        repoRoot: REPO_ROOT,
        reportsDir: reports,
        provider: null,
        model: 'mock-model',
        policyPath: path.join(CONFIG_DIR, 'policy.default.yaml'),
        behaviorIRPath: path.join(CONFIG_DIR, 'behavior.default.yaml'),
      });
      expect(report.success).toBe(true);
      expect(report.metrics.M01).toBe(1);
    } finally {
      fs.rmSync(reports, { recursive: true, force: true });
    }
  }, 60_000);
});