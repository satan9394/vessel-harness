/**
 * Round 14 / task 113 加固 —— `run-release-gates.ts` 的 unit 门禁注记（`deriveUnitFailureNote`）单测。
 *
 * 加固背景（Round 14 独立验收三条建议，均已在实现侧落地）：
 *  ① 旧实现用 `path.endsWith('process-tree.test.ts')` 判「是不是 process-tree」→
 *     `foo-process-tree.test.ts` 这类**同后缀的其它文件**也会命中，而注记文案里**硬编码**了
 *     `packages/runtime/src/sandbox/backend/process-tree.test.ts` → 把别人的失败写成 process-tree flaky。
 *  ② 分支 A 把「非回归 / 11-11 / 环境性 flaky」当**既定事实**断言（那是历史记录，不是本次证据）；
 *     若该文件真的回归，仍会被写成 flaky。
 *  ③ 该函数模块私有、**零单测**（违反 AGENTS.md §7），正确性只靠一次 423s 手工复跑背书
 *     （EVALUATION-REPORT-18 覆盖缺口）。
 *
 * 隔离说明（约束 5「不要真跑门禁」）：
 *  本文件**静态导入** `./run-release-gates.js`。该模块顶层原本无条件执行 `main()` —— 一 import 就会
 *  真跑 8 道门禁（含递归 vitest / 真网络 / 凭据读取），这也是本函数长期零单测的直接原因。
 *  实现侧已加 ESM entry 判定（`shouldRunAsScript()`）：只有被当脚本直接执行时才跑 `main()`。
 *  因此这里导入是安全的（不触发任何真实命令 / 网络 / 凭据读取）；反之，**若有人删掉该 entry 判定，
 *  本文件在 import 阶段就会真跑门禁并失败**（该判定自带判别力）。
 *
 * 判别性（每条断言都有对应的「退步」杀手）：
 *  - 把 `isProcessTreeTestFile()` 改回 `endsWith('process-tree.test.ts')` → 「后缀陷阱」用例（分支 A 误命中）
 *    与谓词表的「后缀陷阱 / 同 basename 异目录」行变红；
 *  - 去掉分支 A 的条件语（改回「非回归 / 按项目惯例视为环境性 flaky」的既定事实文案）→ 条件语断言变红；
 *  - 删掉分支 A 的计数守卫（`failedFileCount === 1` / `failedTestFiles.length === 1`）→「两个文件失败」
 *    与「计数守卫」两条用例变红。
 */
import { describe, it, expect } from 'vitest';
import {
  PROCESS_TREE_TEST_FILE,
  annotateUnitFailureNote,
  deriveUnitFailureNote,
  extractUnitFailureFacts,
  isProcessTreeTestFile,
  normalizeTestFilePath,
} from './run-release-gates.js';
import type { ReleaseGateResult } from './release-gates/index.js';

/**
 * 最小 `ReleaseGateResult`-形状对象：只填 `id`/`status`/`evidence`，其余给稳定默认值。
 * 不构造真实 report、不触发任何 IO。
 */
function gate(
  evidence: { summary: string; detail?: string[] },
  overrides: Partial<ReleaseGateResult> = {},
): ReleaseGateResult {
  return {
    id: 'unit',
    name: 'Unit tests (vitest root)',
    position: 2,
    criterion: 'vitest 全绿',
    status: 'fail',
    evidence,
    durationMs: 0,
    ...overrides,
  };
}

/** 唯一的「失败行只命中 process-tree」证据（分支 A 的输入）。 */
const ONLY_PROCESS_TREE_EVIDENCE = {
  summary: 'unit gate 失败（vitest exit 1）',
  detail: [
    `FAIL  ${PROCESS_TREE_TEST_FILE} > sandbox backend > kills the whole process tree on timeout`,
    'AssertionError: expected 1 to be 2',
    'Test Files  1 failed | 128 passed (129)',
    'Tests  1 failed | 1387 passed (1388)',
  ],
};

/** 两个文件失败的证据（分支 B）。 */
const TWO_FAILED_FILES_EVIDENCE = {
  summary: 'unit gate 失败（vitest exit 1）',
  detail: [
    'FAIL  packages/shared/src/schema.test.ts > schema > validates',
    `FAIL  ${PROCESS_TREE_TEST_FILE} > sandbox backend > timeout`,
    'Test Files  2 failed | 127 passed (129)',
    'Tests  3 failed | 1385 passed (1388)',
  ],
};

/** detail 被 compactLines 截断到只剩汇总行（无任何 `*.test.ts` 路径）。 */
const SUMMARY_ONLY_EVIDENCE = {
  summary: 'unit gate 失败（vitest exit 1）',
  detail: ['Test Files  1 failed | 128 passed (129)'],
};

/** 后缀陷阱：`foo-process-tree.test.ts` 是**另一个文件**，绝不能命中分支 A。 */
const SUFFIX_TRAP_EVIDENCE = {
  summary: 'unit gate 失败（vitest exit 1）',
  detail: [
    'FAIL  benchmarks/runners/src/foo-process-tree.test.ts > foo > fails hard',
    'AssertionError: boom',
    'Test Files  1 failed | 128 passed (129)',
  ],
};

interface NoteCase {
  name: string;
  evidence: { summary: string; detail?: string[] };
  mustContain: string[];
  mustNotContain: string[];
}

/**
 * 表驱动：5 支注记判别（分支 A / 两文件失败 / 计数守卫 / 只有汇总行 / 后缀陷阱）。
 * `mustNotContain` 是判别性的核心 —— 退步时它们会一起变红。
 */
const NOTE_CASES: NoteCase[] = [
  {
    name: '分支 A：失败行只命中 process-tree + Test Files 1 failed → 条件式 flaky 注解（含文件路径与条件语）',
    evidence: ONLY_PROCESS_TREE_EVIDENCE,
    mustContain: [
      PROCESS_TREE_TEST_FILE,
      'vitest 汇总行「Test Files  1 failed | 128 passed (129)」',
      // 条件语（加固点 ②：不得再把「非回归」当既定事实）
      '若该文件除本门禁外单跑通过',
      '视为环境性 flaky',
      '若单跑同样失败',
      '真实回归',
      '必须修复',
    ],
    mustNotContain: [
      '未自动归因', // 分支 A 不应出现「未归因」
      '非 V1.1-E 回归', // 旧文案的既定事实断言
      '非回归',
    ],
  },
  {
    name: '分支 B：两个文件失败 → 只列证据 + 未自动归因（不得出现 flaky 归因断言）',
    evidence: TWO_FAILED_FILES_EVIDENCE,
    mustContain: [
      '未自动归因',
      'vitest 汇总行：Test Files  2 failed | 127 passed (129)',
      'packages/shared/src/schema.test.ts',
      '失败行出现的测试文件',
    ],
    mustNotContain: ['flaky', '唯一失败', '环境性', '11/11'],
  },
  {
    name: '计数守卫：汇总行 Test Files 2 failed 但尾部失败行只剩 process-tree 一条 → 不得写 flaky',
    evidence: {
      summary: 'unit gate 失败（vitest exit 1）',
      detail: [
        // compactLines 只留 stdout 末 12 行 → 2 个失败文件里可能只剩 1 条 FAIL 行：
        // 尾部截取不足以支撑「唯一失败」结论，必须以汇总行的计数为准。
        `FAIL  ${PROCESS_TREE_TEST_FILE} > sandbox backend > timeout`,
        'Test Files  2 failed | 127 passed (129)',
      ],
    },
    mustContain: ['未自动归因', 'vitest 汇总行：Test Files  2 failed | 127 passed (129)'],
    // 删掉 `failedFileCount === 1` 守卫就会退回分支 A → 这三条一起变红
    mustNotContain: ['flaky', '11/11', '唯一失败'],
  },
  {
    name: '分支 B/C：只有汇总行、无任何 *.test.ts 路径（detail 被截断）→ 只给 stats + 未自动归因',
    evidence: SUMMARY_ONLY_EVIDENCE,
    mustContain: [
      '未自动归因',
      'vitest 汇总行：Test Files  1 failed | 128 passed (129)',
      'evidence.detail 未出现任何 *.test.ts 路径',
      '失败用例数=未能提取',
    ],
    mustNotContain: ['flaky', '唯一失败', '11/11'],
  },
  {
    name: '后缀陷阱：foo-process-tree.test.ts 不得命中分支 A（回归保护 / 本次加固核心判别点）',
    evidence: SUFFIX_TRAP_EVIDENCE,
    mustContain: [
      '未自动归因',
      'benchmarks/runners/src/foo-process-tree.test.ts',
      '失败行出现的测试文件',
    ],
    mustNotContain: [
      PROCESS_TREE_TEST_FILE, // 绝不能把「别人的失败」写成 process-tree（旧 endsWith 实现会命中）
      'flaky',
      '11/11',
      '唯一失败',
    ],
  },
];

describe('deriveUnitFailureNote — unit 门禁注记（Round 14 加固，纯函数零 IO）', () => {
  it.each(NOTE_CASES)('$name', ({ evidence, mustContain, mustNotContain }) => {
    const note = deriveUnitFailureNote(gate(evidence));
    for (const s of mustContain) expect(note).toContain(s);
    for (const s of mustNotContain) expect(note).not.toContain(s);
  });

  it('分支 A 的文案不得把历史记录写成本次事实（11/11 只能以「历史记录」出现）', () => {
    const note = deriveUnitFailureNote(gate(ONLY_PROCESS_TREE_EVIDENCE));
    // 历史信息仍保留，但必须明确标注为历史事实、非本次证据
    expect(note).toContain('11/11');
    expect(note).toContain('历史事实，非本次证据');
    // 旧实现把「非回归」当既定事实断言 → 该断言在退步时变红
    expect(note).not.toMatch(/非\s*V?1?\.?1?-?E?\s*回归/);
    expect(note).not.toContain('未改动');
  });
});

/**
 * 谓词表：`isProcessTreeTestFile` 必须是**归一化后的仓库相对路径全等**（非 basename 全等、
 * 更不是旧 `endsWith('process-tree.test.ts')`）。改回 endsWith 时「后缀陷阱」两行必红。
 */
const PROCESS_TREE_PREDICATE_CASES: Array<{ name: string; input: string; expected: boolean }> = [
  { name: '仓库相对路径（正斜杠）', input: PROCESS_TREE_TEST_FILE, expected: true },
  { name: 'Windows 反斜杠写法', input: PROCESS_TREE_TEST_FILE.replace(/\//g, '\\'), expected: true },
  { name: '带 ./ 前缀', input: `./${PROCESS_TREE_TEST_FILE}`, expected: true },
  {
    name: '绝对路径（以 /<仓库相对路径> 结尾，vitest 可能这样打印）',
    input: `C:/work/Vessel_Harness/${PROCESS_TREE_TEST_FILE}`,
    expected: true,
  },
  {
    name: '后缀陷阱：benchmarks/runners/src/foo-process-tree.test.ts',
    input: 'benchmarks/runners/src/foo-process-tree.test.ts',
    expected: false,
  },
  { name: '后缀陷阱：裸文件名 foo-process-tree.test.ts', input: 'foo-process-tree.test.ts', expected: false },
  {
    name: '同 basename 异目录（证明未采用 basename 全等）',
    input: 'packages/shared/src/process-tree.test.ts',
    expected: false,
  },
  { name: '无关文件', input: 'packages/shared/src/schema.test.ts', expected: false },
];

describe('isProcessTreeTestFile — 归一化全等（加固点 ①）', () => {
  it.each(PROCESS_TREE_PREDICATE_CASES)('$name', ({ input, expected }) => {
    expect(isProcessTreeTestFile(input)).toBe(expected);
  });

  it('normalizeTestFilePath：反斜杠归一 + 去 ./ 前缀（收集与判定共用的同一规则）', () => {
    expect(normalizeTestFilePath(`.\\${PROCESS_TREE_TEST_FILE.replace(/\//g, '\\')}`)).toBe(
      PROCESS_TREE_TEST_FILE,
    );
  });
});

describe('extractUnitFailureFacts — 事实提取（无副作用，导出以便单测）', () => {
  it('反斜杠 / 正斜杠写法去重归一，并解析 vitest 汇总行计数', () => {
    const facts = extractUnitFailureFacts(
      gate({
        summary: 'unit gate 失败（vitest exit 1）',
        detail: [
          `FAIL  ${PROCESS_TREE_TEST_FILE.replace(/\//g, '\\')} > sandbox backend`,
          `FAIL  ${PROCESS_TREE_TEST_FILE} > sandbox backend`,
          'Test Files  1 failed | 128 passed (129)',
          'Tests  1 failed | 1,387 passed (1,388)',
        ],
      }),
    );
    expect(facts.failedTestFiles).toEqual([PROCESS_TREE_TEST_FILE]);
    expect(facts.failedFileCount).toBe(1);
    expect(facts.failedTestCount).toBe(1);
    expect(facts.passedTestCount).toBe(1387); // 千分位兼容
  });
});

describe('annotateUnitFailureNote — 只有 fail + unit 才写 note（不碰 status/判据）', () => {
  it('pass 状态的 gate 不得被写 note', () => {
    const passGate = gate(
      { summary: 'Test Files  129 passed (129)', detail: ['Tests  1388 passed (1388)'] },
      { status: 'pass' },
    );
    annotateUnitFailureNote(passGate);
    expect(passGate.note).toBeUndefined();
  });

  it('fail 但非 unit 的 gate（如 build）不得被写 note', () => {
    const buildGate = gate(
      { summary: 'tsc -b exit 2', detail: ['error TS2322'] },
      { id: 'build', status: 'fail' },
    );
    annotateUnitFailureNote(buildGate);
    expect(buildGate.note).toBeUndefined();
  });

  it('fail + unit → 写入推导注记；既有 note 保留并在其后追加（不覆盖）', () => {
    const unitGate = gate(SUMMARY_ONLY_EVIDENCE, { note: 'executor 原有注解。' });
    annotateUnitFailureNote(unitGate);
    expect(unitGate.note).toBeDefined();
    expect(unitGate.note!.startsWith('executor 原有注解。 ')).toBe(true);
    expect(unitGate.note).toContain('未自动归因');
  });

  it('注记只写 note，不改动 status / criterion / evidence（判据语义不变）', () => {
    const unitGate = gate(ONLY_PROCESS_TREE_EVIDENCE);
    const before = { ...unitGate, evidence: { ...unitGate.evidence } };
    annotateUnitFailureNote(unitGate);
    expect(unitGate.status).toBe(before.status);
    expect(unitGate.criterion).toBe(before.criterion);
    expect(unitGate.evidence).toEqual(before.evidence);
  });
});
