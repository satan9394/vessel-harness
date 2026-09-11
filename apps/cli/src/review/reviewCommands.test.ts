import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cmdReview } from './reviewCommands.js';
import { ReviewHandoffStore } from '@vessel/application';
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
});
