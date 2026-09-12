import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReviewHandoffStore, defaultReviewsRoot, newReviewId, defaultReviewChecklist, renderHandoffMarkdown } from './ReviewHandoffStore.js';
import type { ReviewHandoffRecord } from './ExternalReviewHandoff.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-review-handoff-'));
}

const EIGHT_SECTIONS = [
  'Task',
  'Acceptance Criteria',
  'Changed Files',
  'Diff Summary',
  'Test Results',
  'Architecture Constraints',
  'Review Checklist',
  'Required Output Schema',
];

/** §9.1 载荷齐全的 create 输入（任务 + 验收 + 改动 + diff + 测试）。 */
function fullInput(overrides: Partial<Parameters<ReviewHandoffStore['createHandoff']>[0]> = {}) {
  return {
    task: '实现 computeFee 导出',
    acceptance: ['src/fee.js 导出 computeFee', '隐藏测试全绿'],
    changedFiles: ['src/fee.js', 'tests/fee.test.js'],
    diffSummary: 'src/fee.js +12 新增 computeFee；tests/fee.test.js +20 覆盖边界',
    testResults: 'vitest run: 2 passed（fee.test.js）',
    constraints: ['TS + Node', '不新增依赖', '删除走回收站'],
    workspaceRoot: path.join(os.tmpdir(), 'fake-workspace'),
    ...overrides,
  };
}

describe('application/review — default root / id 约定（task 059）', () => {
  it('defaultReviewsRoot 指向 ~/.vessel/reviews（env 可覆盖；与既有 ~/.vessel 约定一致）', () => {
    const before = process.env.VESSEL_REVIEWS_ROOT;
    try {
      delete process.env.VESSEL_REVIEWS_ROOT;
      expect(defaultReviewsRoot('fake-home')).toBe(path.join('fake-home', '.vessel', 'reviews'));
      process.env.VESSEL_REVIEWS_ROOT = path.join('env', 'root');
      expect(defaultReviewsRoot('fake-home')).toBe(path.join('env', 'root'));
    } finally {
      if (before === undefined) delete process.env.VESSEL_REVIEWS_ROOT;
      else process.env.VESSEL_REVIEWS_ROOT = before;
    }
  });

  it('newReviewId 沿用 <kind>_<ts>_<hex> 约定（sess_/team_/sub_ 同款）且可区分', () => {
    const a = newReviewId(1000, 'aabbccdd');
    expect(a).toBe('review_1000_aabbccdd');
    const b = newReviewId();
    const c = newReviewId();
    expect(b).toMatch(/^review_\d+_[0-9a-f]{8}$/);
    expect(b).not.toBe(c);
  });
});

/**
 * 状态根口径（`VESSEL_REVIEWS_ROOT`）—— 唯一实现 `envRoot()`：未设置/空串/纯空白 ⇒
 * **未设置**（回落 `~/.vessel/reviews`），其余 trim。
 *
 * 判别性（「删掉修复就红」）：旧实现是 `process.env.VESSEL_REVIEWS_ROOT ?? path.join(home, …)`，
 * `??` 只挡 `undefined` ⇒ `''`/`'   '` 直接当根 ⇒ 构造里的 `path.resolve('')` = **进程 CWD**。
 * 生产调用点 `apps/local-server/src/server.ts` 的 `new ReviewHandoffStore()`（无参）正是这条路
 * —— 空值会让 reviews 落到**服务进程的工作目录**，而同一次运行的 usage/凭据仍在 `~/.vessel`
 * （状态根被静默拆成两处）。把 `defaultReviewsRoot()` 里的 `envRoot(...)` 换回 `??` ⇒
 * ①② 立即红（`createHandoff` 的落盘断言也一并红）。
 *
 * 隔离（AGENTS.md §8 与卡④）：`HOME`/`USERPROFILE` 指到 `os.tmpdir()` 下的临时家目录，
 * 并把 `process.cwd()` 钉到临时目录——即使跑在**修复前**的代码上（会漏到 CWD），读写也只
 * 落在临时目录里，绝不碰真实 `~/.vessel` 或仓库工作区。
 */
describe('application/review — 状态根口径（VESSEL_REVIEWS_ROOT 空/纯空白 ⇒ 未设置）', () => {
  let home: string;
  let fakeCwd: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;
  let savedReviews: string | undefined;
  let cwdSpy: { mockRestore: () => void };

  beforeEach(() => {
    home = tempDir();
    fakeCwd = tempDir();
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    savedReviews = process.env.VESSEL_REVIEWS_ROOT;
    process.env.HOME = home; // POSIX：os.homedir() 读 HOME
    process.env.USERPROFILE = home; // Windows：os.homedir() 读 USERPROFILE
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(fakeCwd);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    if (savedReviews === undefined) delete process.env.VESSEL_REVIEWS_ROOT;
    else process.env.VESSEL_REVIEWS_ROOT = savedReviews;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(fakeCwd, { recursive: true, force: true });
  });

  /** 修复后期望的默认根（真实 `os.homedir()` 已被指到临时家目录）。 */
  const defaultRoot = (): string => path.resolve(path.join(home, '.vessel', 'reviews'));

  it('① 判别性：env 空串 ⇒ 默认根 ~/.vessel/reviews，不是进程 CWD（旧 `??` ⇒ 必红）', () => {
    process.env.VESSEL_REVIEWS_ROOT = '';
    const store = new ReviewHandoffStore();
    expect(store.root).toBe(defaultRoot());
    expect(store.root).not.toBe(fakeCwd);
    // 行为面：记录真的落在默认根下（而不是进程 CWD）
    const rec = store.createHandoff({ task: '口径用例：空串 env' });
    expect(fs.existsSync(path.join(defaultRoot(), rec.id, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(fakeCwd, rec.id))).toBe(false);
  });

  it('①-b 判别性：env 纯空白 ⇒ 默认根（旧 `??` 同样漏成 CWD）', () => {
    process.env.VESSEL_REVIEWS_ROOT = '   ';
    const store = new ReviewHandoffStore();
    expect(store.root).toBe(defaultRoot());
    expect(store.root).not.toBe(fakeCwd);
  });

  it('② 负对照：env 有值（含首尾空白）⇒ trim 后即该根，行为逐字不变', () => {
    const explicit = tempDir();
    try {
      process.env.VESSEL_REVIEWS_ROOT = `  ${explicit}  `;
      expect(defaultReviewsRoot()).toBe(path.resolve(explicit));
      const store = new ReviewHandoffStore();
      expect(store.root).toBe(path.resolve(explicit));
      expect(store.root).not.toBe(defaultRoot());
    } finally {
      fs.rmSync(explicit, { recursive: true, force: true });
    }
  });

  it('③ 负对照：显式 opts.reviewsRoot 优先于 env；env 未设置 ⇒ 仍回落默认根', () => {
    const explicit = tempDir();
    try {
      process.env.VESSEL_REVIEWS_ROOT = path.join(fakeCwd, 'env-root');
      const viaOpts = new ReviewHandoffStore({ reviewsRoot: explicit });
      expect(viaOpts.root).toBe(path.resolve(explicit));

      delete process.env.VESSEL_REVIEWS_ROOT;
      expect(defaultReviewsRoot()).toBe(path.join(os.homedir(), '.vessel', 'reviews'));
      expect(new ReviewHandoffStore().root).toBe(defaultRoot());
    } finally {
      fs.rmSync(explicit, { recursive: true, force: true });
    }
  });
});

describe('application/review — ReviewHandoffStore（task 059）', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function store(): ReviewHandoffStore {
    return new ReviewHandoffStore({ reviewsRoot: root });
  }

  it('create 生成 .vessel 目录布局：<root>/<review-id>/handoff.md + meta.json，元数据齐（id/状态/时间戳/来源）', () => {
    const s = store();
    const rec = s.createHandoff(fullInput());
    expect(rec.id).toMatch(/^review_\d+_[0-9a-f]{8}$/);
    expect(rec.status).toBe('pending');
    expect(rec.source).toBe('external');
    expect(rec.createdAt).toBeTruthy();
    expect(rec.updatedAt).toBe(rec.createdAt);
    expect(rec.results).toEqual([]);
    expect(s.dirFor(rec.id)).toBe(path.join(root, rec.id));
    expect(fs.existsSync(s.handoffPath(rec.id))).toBe(true);
    expect(fs.existsSync(s.metaPath(rec.id))).toBe(true);
    // §9.1 指定文件名
    expect(fs.existsSync(path.join(s.dirFor(rec.id), 'handoff.md'))).toBe(true);
  });

  it('handoff.md 含 §9.1 八个 section（Task…Required Output Schema 全齐）', () => {
    const rec = store().createHandoff(fullInput());
    const md = fs.readFileSync(store().handoffPath(rec.id), 'utf8');
    for (const section of EIGHT_SECTIONS) {
      expect(md).toContain(`## ${section}`);
    }
    expect(md).toContain(rec.id);
    expect(md).toContain('src/fee.js');
    expect(md).toContain('computeFee');
    expect(md).toContain('隐藏测试全绿');
  });

  it('checklist 缺省生成默认评审清单；显式 checklist 优先', () => {
    const dflt = store().createHandoff(fullInput());
    expect(dflt.checklist.length).toBeGreaterThanOrEqual(1);
    expect(dflt.checklist).toEqual(defaultReviewChecklist());
    const custom = store().createHandoff(fullInput({ checklist: ['只核验验收标准'] }));
    expect(custom.checklist).toEqual(['只核验验收标准']);
  });

  it('import 外部结果（external）：met 结论落库，状态 → imported，来源可区分', () => {
    const s = store();
    const rec = s.createHandoff(fullInput());
    const imported = s.importResult(rec.id, {
      source: 'external',
      text: '{"verdict":"met","evidence":["src/fee.js 导出存在"],"reason":"验收通过","unmet":[],"suggestions":[]}',
    });
    expect(imported.status).toBe('imported');
    expect(imported.updatedAt >= imported.createdAt).toBe(true);
    expect(imported.results).toHaveLength(1);
    const r = imported.results[0]!;
    expect(r.source).toBe('external');
    expect(r.conclusion.verdict).toBe('met');
    expect(r.conclusion.reason).toBe('验收通过');
    // 持久化：新 store 实例读回
    const reread = store().get(rec.id);
    expect(reread?.status).toBe('imported');
    expect(reread?.results[0]?.source).toBe('external');
  });

  it('import 文本含叙述 + 结论 JSON（模型常见输出）也能解析；非 JSON → verdict error（如实暴露）', () => {
    const s = store();
    const rec = s.createHandoff(fullInput());
    s.importResult(rec.id, { source: 'external', text: '评审意见：代码符合要求。\n{"verdict":"met","reason":"ok"}' });
    const afterNarrative = store().get(rec.id);
    expect(afterNarrative?.results[0]?.conclusion.verdict).toBe('met');

    s.importResult(rec.id, { source: 'external', text: '整体看起来可以，建议补测试。' });
    const afterGarbage = store().get(rec.id);
    const last = afterGarbage!.results[afterGarbage!.results.length - 1]!;
    expect(last.conclusion.verdict).toBe('error');
    expect(last.raw).toContain('整体看起来可以');
  });

  it('not_met 结论：unmet/suggestions 与 058 内部评审结论同型落库（形状兼容）', () => {
    const s = store();
    const rec = s.createHandoff(fullInput());
    s.importResult(rec.id, {
      source: 'external',
      text: '{"verdict":"not_met","unmet":["隐藏测试全绿"],"suggestions":["补边界用例"],"reason":"测试覆盖不足","evidence":["tests/fee.test.js"]}',
    });
    const r = store().get(rec.id)!.results[0]!;
    expect(r.conclusion).toEqual({
      verdict: 'not_met',
      unmet: ['隐藏测试全绿'],
      suggestions: ['补边界用例'],
      reason: '测试覆盖不足',
      evidence: ['tests/fee.test.js'],
    });
    expect(r.conclusion.verdict).toBe('not_met');
  });

  it('同型写入内部结论（internal）与外部结果并存，results 来源可区分 external vs internal', () => {
    const s = store();
    const rec = s.createHandoff(fullInput());
    s.importResult(rec.id, { source: 'external', text: '{"verdict":"met","reason":"ok"}' });
    s.importResult(rec.id, {
      source: 'internal',
      conclusion: { verdict: 'not_met', reason: '058 内部评审未过', unmet: ['x'], suggestions: ['y'], evidence: [] },
    });
    const rec2 = store().get(rec.id)!;
    expect(rec2.results.map((r) => r.source)).toEqual(['external', 'internal']);
    expect(rec2.results[1]!.conclusion.verdict).toBe('not_met');
    // 来源筛选可作为 UI/回读区分依据
    const externals = rec2.results.filter((r) => r.source === 'external');
    const internals = rec2.results.filter((r) => r.source === 'internal');
    expect(externals).toHaveLength(1);
    expect(internals).toHaveLength(1);
  });

  it('路径与持久化：meta.json 可跨实例 round-trip；list 按 createdAt 倒序', () => {
    const s = store();
    const first = s.createHandoff(fullInput({ task: 'A 任务' }));
    const second = s.createHandoff(fullInput({ task: 'B 任务' }));
    expect(first.id).not.toBe(second.id);
    const list = store().list();
    expect(list.map((r) => r.id).sort()).toEqual([first.id, second.id].sort());
    // createdAt 倒序（最新在前；同一毫秒创建时允许并列）
    expect(list[0]!.createdAt >= list[1]!.createdAt).toBe(true);
    expect(store().get('review_missing_00000000')).toBeUndefined();
  });

  it('导入到未知 id fail loud；task 为空 create fail loud', () => {
    expect(() => store().importResult('review_nope_00000000', { source: 'external', text: '{}' })).toThrow(
      /unknown review id/,
    );
    expect(() => store().createHandoff({ task: '   ' })).toThrow(/task is required/);
  });

  it('renderHandoffMarkdown 可独立渲染（含空字段占位，八节结构不塌）', () => {
    const rec: ReviewHandoffRecord = {
      id: 'review_1_aabbccdd',
      status: 'pending',
      source: 'external',
      createdAt: 't',
      updatedAt: 't',
      task: '仅任务文本',
      acceptance: [],
      changedFiles: [],
      diffSummary: '',
      testResults: '',
      constraints: [],
      checklist: defaultReviewChecklist(),
      outputSchema: '{"verdict":"met|not_met"}',
      results: [],
    };
    const md = renderHandoffMarkdown(rec);
    for (const section of EIGHT_SECTIONS) expect(md).toContain(`## ${section}`);
    expect(md).toContain('未提供验收标准');
    expect(md).toContain('未提供测试结果');
  });
});
