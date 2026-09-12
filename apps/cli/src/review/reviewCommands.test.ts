import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cmdReview } from './reviewCommands.js';
import { ReviewHandoffStore, defaultReviewsRoot } from '@vessel/application';
import { main } from '../cli.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cli-review-'));
}

/** capture cmdReview 输出（log/error seam） */
function capture() {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    opts: {
      log: (s: string) => logs.push(s),
      error: (s: string) => errors.push(s),
    },
  };
}

describe('apps/cli review — `vessel review` 命令族（task 059）', () => {
  let root: string;
  let ws: string;
  let reqFile: string;
  beforeEach(() => {
    root = tempDir();
    ws = tempDir();
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    reqFile = path.join(ws, 'review-request.json');
    fs.writeFileSync(
      reqFile,
      JSON.stringify(
        {
          task: '实现 computeFee 导出（CLI 评审示例）',
          acceptance: ['src/fee.js 导出 computeFee', 'CLI 冒烟全绿'],
          changedFiles: ['src/fee.js', 'tests/fee.test.js'],
          diffSummary: 'src/fee.js +12 computeFee；tests +20',
          testResults: 'vitest run: 2 passed',
          constraints: ['TS + Node', '不加依赖'],
        },
        null,
        2,
      ),
      'utf8',
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('review handoff <request.json> → 生成 handoff + 打印 id/路径（exit 0）', async () => {
    const c = capture();
    const code = await cmdReview(['handoff', reqFile], new Map([['root', root]]), c.opts);
    expect(code).toBe(0);
    expect(c.logs[0]).toContain('handoff 已生成: review_');
    const m = /review_\d+_[0-9a-f]{8}/.exec(c.logs.join('\n'))![0];
    const store = new ReviewHandoffStore({ reviewsRoot: root });
    expect(store.handoffPath(m)).toBe(path.join(root, m, 'handoff.md'));
    expect(fs.existsSync(store.handoffPath(m))).toBe(true);
    expect(store.get(m)?.status).toBe('pending');
  });

  it('review import <id> <result> → 外部结果落库、状态 imported、verdict 打印（exit 0）', async () => {
    const store = new ReviewHandoffStore({ reviewsRoot: root });
    const rec = store.createHandoff({
      task: '任务',
      acceptance: ['a1'],
      changedFiles: ['src/x.js'],
      diffSummary: 'x.js +1',
      testResults: '1 passed',
    });
    const resultFile = path.join(ws, 'result.json');
    fs.writeFileSync(resultFile, '{"verdict":"not_met","unmet":["a1"],"reason":"导出缺失"}', 'utf8');
    const c = capture();
    const code = await cmdReview(['import', rec.id, resultFile], new Map([['root', root]]), c.opts);
    expect(code).toBe(0);
    expect(c.logs.join('\n')).toContain('verdict: not_met');
    expect(store.get(rec.id)?.status).toBe('imported');
    expect(store.get(rec.id)?.results[0]?.source).toBe('external');
  });

  it('review import --source internal 可写入内部结论（来源区分）', async () => {
    const store = new ReviewHandoffStore({ reviewsRoot: root });
    const rec = store.createHandoff({ task: '任务', changedFiles: [] });
    const resultFile = path.join(ws, 'internal.json');
    fs.writeFileSync(resultFile, '{"verdict":"met","reason":"内部评审通过"}', 'utf8');
    const c = capture();
    const code = await cmdReview(
      ['import', rec.id, resultFile],
      new Map([
        ['root', root],
        ['source', 'internal'],
      ]),
      c.opts,
    );
    expect(code).toBe(0);
    expect(store.get(rec.id)?.results[0]?.source).toBe('internal');
  });

  it('review list 列出 reviews（含状态与结果数）', async () => {
    const store = new ReviewHandoffStore({ reviewsRoot: root });
    const a = store.createHandoff({ task: 'AAA' });
    const b = store.createHandoff({ task: 'BBB' });
    store.importResult(a.id, { source: 'external', text: '{"verdict":"met","reason":"ok"}' });
    const c = capture();
    const code = await cmdReview(['list'], new Map([['root', root]]), c.opts);
    expect(code).toBe(0);
    const out = c.logs.join('\n');
    expect(out).toContain(a.id);
    expect(out).toContain(b.id);
    expect(out).toContain('[imported]');
    expect(out).toContain('[pending]');
    expect(out).toContain('external:met');
  });

  it('参数/读取错误返回非 0（缺结果文件 / 未知子命令）', async () => {
    const store = new ReviewHandoffStore({ reviewsRoot: root });
    const rec = store.createHandoff({ task: '任务' });
    const c1 = capture();
    const code1 = await cmdReview(['import', rec.id], new Map([['root', root]]), c1.opts);
    expect(code1).toBe(2);

    const c2 = capture();
    const code2 = await cmdReview(['bogus'], new Map([['root', root]]), c2.opts);
    expect(code2).toBe(2);
    expect(c2.errors.join('\n')).toContain('未知子命令');
  });

  it('import 到未知 review id → exit 1（fail loud）', async () => {
    const c = capture();
    const resultFile = path.join(ws, 'r.json');
    fs.writeFileSync(resultFile, '{"verdict":"met"}', 'utf8');
    const code = await cmdReview(['import', 'review_nope_00000000', resultFile], new Map([['root', root]]), c.opts);
    expect(code).toBe(1);
    expect(c.errors.join('\n')).toContain('unknown review id');
  });

  it('main() 分发 `vessel review ...`（review 子命令经 CLI 入口可达）', async () => {
    // G-10 兜底：本用例驱动的是 CLI 入口 `main()`（默认 store 的汇聚点）。review 分支当前
    // 不构造 SessionRegistry，但仍把会话登记根钉在临时 root——入口一旦长出新默认路径，
    // 这里也不会写真实 ~/.vessel/sessions.json（AGENTS.md §8）。
    const savedSessionRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_SESSION_ROOT = root;
    try {
      const logs: string[] = [];
      const spy = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
      const code = await main(['review', 'list', '--root', root]);
      spy.mockRestore();
      expect(code).toBe(0);
      expect(logs.join('\n')).toContain('暂无 reviews');
    } finally {
      if (savedSessionRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
      else process.env.VESSEL_SESSION_ROOT = savedSessionRoot;
    }
  });

  /**
   * 状态根口径（`VESSEL_REVIEWS_ROOT`）—— 唯一口径：
   * `--root`/`opts.root` > `envRoot('VESSEL_REVIEWS_ROOT')` > 默认根 `~/.vessel/reviews`；
   * **空/纯空白一律按未设置**（显式传参与 env 同口径），其余 trim / 逐字使用。
   *
   * 判别性（「删掉修复就红」）：旧实现是 `opts.root ?? process.env.VESSEL_REVIEWS_ROOT` +
   * 真值判断 `override ? path.resolve(override) : undefined`：
   *   - `'   '` 是真值 ⇒ `path.resolve('   ')` = **进程 CWD**（第三种口径）；
   *   - `''` 虽被判成未设置，但「未设置」分支交回 `new ReviewHandoffStore()`，该类又用
   *     `process.env.VESSEL_REVIEWS_ROOT ?? …` 复读了同一个变量 ⇒ 同样漏成 CWD。
   *
   * 隔离（AGENTS.md §8）：`os.homedir()` 指到临时家目录（`HOME`/`USERPROFILE`），并把
   * `process.cwd()` 也钉到临时目录——这样即使跑在**修复前**的代码上（会漏到 CWD），
   * 写入也只会落在临时目录里，绝不碰真实 `~/.vessel` 或仓库工作区。
   */
  describe('状态根口径（VESSEL_REVIEWS_ROOT 空/纯空白 ⇒ 未设置）', () => {
    let home: string;
    let fakeCwd: string;
    let savedHome: string | undefined;
    let savedUserProfile: string | undefined;
    let savedReviews: string | undefined;

    beforeEach(() => {
      home = tempDir();
      fakeCwd = tempDir();
      savedHome = process.env.HOME;
      savedUserProfile = process.env.USERPROFILE;
      savedReviews = process.env.VESSEL_REVIEWS_ROOT;
      process.env.HOME = home; // POSIX：os.homedir() 读 HOME
      process.env.USERPROFILE = home; // Windows：os.homedir() 读 USERPROFILE
      vi.spyOn(process, 'cwd').mockReturnValue(fakeCwd);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (savedHome === undefined) delete process.env.HOME;
      else process.env.HOME = savedHome;
      if (savedUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = savedUserProfile;
      if (savedReviews === undefined) delete process.env.VESSEL_REVIEWS_ROOT;
      else process.env.VESSEL_REVIEWS_ROOT = savedReviews;
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(fakeCwd, { recursive: true, force: true });
    });

    const defaultRoot = (): string => path.resolve(path.join(home, '.vessel', 'reviews'));

    /** 跑一次 `review handoff`（不传 --root），回传退出码与打印出的记录目录。 */
    async function handoffDir(opts: { root?: string } = {}): Promise<{ code: number; dir: string }> {
      const c = capture();
      const code = await cmdReview(['handoff', reqFile], new Map(), { ...c.opts, ...opts });
      const line = c.logs.find((l) => l.includes('目录:')) ?? '';
      return { code, dir: line.slice(line.indexOf('目录:') + '目录:'.length).trim() };
    }

    it('① 判别性：env 纯空白 ⇒ 默认根 ~/.vessel/reviews，不是 CWD（旧真值判断 ⇒ 必红）', async () => {
      process.env.VESSEL_REVIEWS_ROOT = '   ';
      const { code, dir } = await handoffDir();
      expect(code).toBe(0);
      expect(dir.startsWith(defaultRoot())).toBe(true);
      expect(dir.startsWith(fakeCwd)).toBe(false);
      expect(fs.existsSync(dir)).toBe(true);
    });

    it('①-b 判别性：env 空串 ⇒ 默认根（旧实现经 ReviewHandoffStore 的 `??` 再漏一次 CWD）', async () => {
      process.env.VESSEL_REVIEWS_ROOT = '';
      const { code, dir } = await handoffDir();
      expect(code).toBe(0);
      expect(dir.startsWith(defaultRoot())).toBe(true);
      expect(dir.startsWith(fakeCwd)).toBe(false);
    });

    it('② 负对照：env 有值（含首尾空白）⇒ trim 后即根，行为逐字不变', async () => {
      const explicit = tempDir();
      try {
        process.env.VESSEL_REVIEWS_ROOT = `  ${explicit}  `;
        const { code, dir } = await handoffDir();
        expect(code).toBe(0);
        expect(dir.startsWith(path.resolve(explicit))).toBe(true);
      } finally {
        fs.rmSync(explicit, { recursive: true, force: true });
      }
    });

    it('②-b 钉死两份口径：env 未设置 ⇒ CLI 默认根 === packages/application 的 defaultReviewsRoot()', async () => {
      delete process.env.VESSEL_REVIEWS_ROOT;
      const { code, dir } = await handoffDir();
      expect(code).toBe(0);
      // 同一个 (mock 过的) HOME 下，包侧唯一实现给出的默认根必须与 CLI 的实际落点一致。
      expect(path.resolve(defaultReviewsRoot())).toBe(defaultRoot());
      expect(dir.startsWith(path.resolve(defaultReviewsRoot()))).toBe(true);
    });

    it('④ 负对照：opts.root 显式传入优先于 env；env 未设置 ⇒ 仍回落默认根', async () => {
      const explicit = tempDir();
      try {
        process.env.VESSEL_REVIEWS_ROOT = path.join(fakeCwd, 'env-root');
        const viaOpts = await handoffDir({ root: explicit });
        expect(viaOpts.code).toBe(0);
        expect(viaOpts.dir.startsWith(path.resolve(explicit))).toBe(true);

        delete process.env.VESSEL_REVIEWS_ROOT;
        const viaDefault = await handoffDir();
        expect(viaDefault.code).toBe(0);
        expect(viaDefault.dir.startsWith(defaultRoot())).toBe(true);
      } finally {
        fs.rmSync(explicit, { recursive: true, force: true });
      }
    });
  });

  /**
   * 第 3 条（N1）：**第三份默认根字面量**已删除，CLI 侧复用 `@vessel/application` 的
   * `defaultReviewsRoot()`。
   *
   * 判别性（「删掉修复就红」）：把 `reviewCommands.ts` 里重新写回上一版那份
   * `function defaultReviewsRootForCli() { return path.join(os.homedir(), '.vessel', 'reviews'); }`
   * 并把 `resolveRoot` 的兜底改回调它 ⇒ 本用例立即红（命中 `defaultReviewsRootForCli` /
   * 代码里的 `os.homedir()` / `'.vessel'` 字面量）。
   *
   * 为什么必须是**源码**断言：两份字面量取值**相同**时，「复用」与「各存一份」在行为上
   * 无法区分（②-b 与④ 只钉住「当前值一致」）；要等某一侧单独改动才会漂移，而那时的症状
   * 正是「默认根被静默拆成两处」。断言前先剥掉注释，避免文档里引用的历史写法造成假红。
   */
  it('N1：默认 reviews 根只有一份实现（复用 defaultReviewsRoot()，本文件不再存字面量）', () => {
    const src = fs.readFileSync(path.join(fileURLToPath(new URL('.', import.meta.url)), 'reviewCommands.ts'), 'utf8');
    // 剥注释（块注释 + 行注释）后再断言「代码里」没有第二份默认根字面量
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(src).toContain('import { ReviewHandoffStore, defaultReviewsRoot,');
    expect(code).toContain('defaultReviewsRoot()');
    expect(code).not.toContain('defaultReviewsRootForCli');
    expect(code).not.toMatch(/os\.homedir\(\)/);
    expect(code).not.toContain("'.vessel'");
    expect(code).not.toMatch(/import \* as os from 'node:os'/);
  });
});
