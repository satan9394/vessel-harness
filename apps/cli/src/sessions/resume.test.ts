/**
 * apps/cli/src/sessions/resume.test.ts — `vessel sessions list` 与 `vessel resume`
 * 目标解析的行为验收（G-10 / BRIEF-09）。
 *
 * 断言一律按**两个模块的真实实现**对齐（读源码后写，不按理想设计臆造）：
 * - `cmdSessionsList` 不调 `process.exit`，返回码由调用方决定：登记表为空 → 0，
 *   构造/列举抛错（如根目录被同名文件挡路、mkdir 失败）→ 1（错误走 stderr）；
 * - `SessionRegistry.load()` **吞错**：`sessions.json` 内容非法时 `catch` 里
 *   `sessions.clear()` 后静默继续（不打日志、不抛），所以损坏内容只会得到
 *   「空登记表 → 退出码 0 → 暂无历史会话」，**不是** 1（用例 3a/3b 分开锁死这两条路径）；
 * - `resolveResumeTarget` 的失败分支固定 `exitCode: 2`：登记表读失败是 1，其余是 2；
 * - `Session.open` 对任意 id 都会建目录，所以「id 不存在」「日志文件不存在」必须在
 *   进入 harness 前拦住，且**绝不凭空新建**（用例 7 用 existsSync 反向锁死）。
 *
 * 隔离纪律（AGENTS.md §8 同款）：每个用例都把 `vesselHome` 指向
 * `mkdtempSync(os.tmpdir(), 'vessel-sessions-')` 下的临时目录，并顺带把
 * `VESSEL_SESSION_ROOT` 也钉到同一临时目录作为兜底——任何漏注入的默认路径
 * 都只会落到 tmp，绝不读写真实 `~/.vessel`。afterEach 清理临时目录。
 *
 * 实现细节提示：`SessionRegistry.put()` 会用「当前时刻」覆盖 `updatedAt`
 * （同一毫秒内的两条会拿到完全相同的时间戳），因此用例在 put 之后把活动时间
 * 回写到磁盘（见 `seedSessions`），否则「最近活动在前」的断言会退化成
 * 「按 id 倒序」而变得不确定。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRegistry, type SessionMeta } from '@vessel/application';

import { cmdSessionsList } from './commands.js';
import { resolveResumeTarget, sessionFileFor, type ResumeTarget, type ResumeTargetOk, type ResumeTargetErr } from './resume.js';

/** 早/晚两个活动时间：ISO 字符串，倒序排序键就是它。 */
const T_OLDER = '2024-01-01T00:00:00.000Z';
const T_NEWER = '2024-06-01T00:00:00.000Z';

const OLDER_ID = 'sess_older';
const NEWER_ID = 'sess_newer';

/** 构造字段齐全的 `SessionMeta`（id/workspaceRoot/provider/model/permission/createdAt/updatedAt）。 */
function metaOf(id: string, workspaceRoot: string, updatedAt: string): SessionMeta {
  return {
    id,
    workspaceRoot,
    provider: 'mock',
    model: 'mock-model',
    permission: 'workspace-write',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt,
  };
}

/**
 * 经真实 `put()` 写入登记表（`put` 是登记表唯一写入路径），随后把 `updatedAt`
 * 回写成用例指定的值并在磁盘上钉住：`put()` 用 `new Date()` 覆盖 updatedAt，
 * 连续两次 put 极可能落在同一毫秒 → 时间戳相同 → 排序退化为「按 id 倒序」，
 * 会让「最近活动在前」的断言变成偶然。除 updatedAt 外其余字段原样保留。
 */
function seedSessions(home: string, metas: SessionMeta[]): void {
  const reg = new SessionRegistry({ vesselHome: home });
  for (const m of metas) reg.put(m);

  const file = path.join(home, 'sessions.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { sessions: SessionMeta[] };
  const pinned = new Map(metas.map((m) => [m.id, m.updatedAt]));
  for (const s of data.sessions) {
    const ts = pinned.get(s.id);
    if (ts !== undefined) s.updatedAt = ts;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

/** 收集输出行（替代 console.log / console.error）。 */
function capture(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: (line: string) => lines.push(line) };
}

/** 在 workspace 下补出会话日志文件（resume 只读它、不创建它）。 */
function touchSessionLog(workspaceRoot: string, id: string): string {
  const file = path.join(workspaceRoot, '.harness', 'sessions', id, 'session.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '', 'utf8');
  return file;
}

/** 成功分支的窄化断言：失败时抛出可读原因，而不是让后续断言静默跑偏。 */
function expectOk(target: ResumeTarget): ResumeTargetOk {
  if (!target.ok) throw new Error(`期望解析成功，实际失败（exitCode=${target.exitCode}）：${target.message}`);
  return target;
}

/** 失败分支的窄化断言。 */
function expectErr(target: ResumeTarget): ResumeTargetErr {
  if (target.ok) throw new Error(`期望解析失败，实际成功：${target.sessionFile}`);
  return target;
}

describe('sessions — list 渲染 与 resume 目标解析（G-10 / BRIEF-09）', () => {
  /** 临时 vessel home（登记表根）：`<tmp>/sessions.json`。 */
  let tmp: string;
  /** 临时 workspace（会话绑定的工作区）：日志落在 `<ws>/.harness/sessions/<id>/session.jsonl`。 */
  let ws: string;
  let savedRoot: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-sessions-'));
    ws = path.join(tmp, 'workspace');
    fs.mkdirSync(ws, { recursive: true });
    // 兜底隔离：即使某个用例漏传 vesselHome，默认根也只落到 tmp，不碰真实 ~/.vessel。
    savedRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_SESSION_ROOT = tmp;
  });

  afterEach(() => {
    if (savedRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = savedRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('1) 空登记表 → 返回 0，输出含「暂无历史会话」', () => {
    const out = capture();
    const err = capture();

    const code = cmdSessionsList({ vesselHome: tmp, log: out.write, error: err.write });

    expect(code).toBe(0);
    expect(out.lines.join('\n')).toContain('暂无历史会话');
    expect(err.lines).toEqual([]); // 空表不是错误路径，stderr 不该有任何输出
  });

  it('2) 两条会话 → 返回 0，两条 id 都出现，且最近活动的在前', () => {
    // put 顺序故意「先旧后新」：排序必须由 updatedAt 决定，而不是写入顺序。
    seedSessions(tmp, [metaOf(OLDER_ID, ws, T_OLDER), metaOf(NEWER_ID, ws, T_NEWER)]);

    const out = capture();
    const code = cmdSessionsList({ vesselHome: tmp, log: out.write, error: () => {} });

    expect(code).toBe(0);
    const text = out.lines.join('\n');
    expect(text).toContain('历史会话（2）'); // 表头条数正确
    expect(text).toContain(OLDER_ID);
    expect(text).toContain(NEWER_ID);
    expect(text).toContain('mock/mock-model'); // provider/model 一并渲染

    // 关键断言：最近活动（T_NEWER）那条必须出现在更早那条之前。
    const idxNewer = out.lines.findIndex((l) => l.includes(NEWER_ID));
    const idxOlder = out.lines.findIndex((l) => l.includes(OLDER_ID));
    expect(idxNewer).toBeGreaterThanOrEqual(0);
    expect(idxOlder).toBeGreaterThanOrEqual(0);
    expect(idxNewer).toBeLessThan(idxOlder);
  });

  it('3a) 登记表内容非法 → load() 吞错置空表：不抛、返回 0、输出「暂无历史会话」', () => {
    fs.writeFileSync(path.join(tmp, 'sessions.json'), '{oops', 'utf8');

    const out = capture();
    const err = capture();
    let code = -1;
    expect(() => {
      code = cmdSessionsList({ vesselHome: tmp, log: out.write, error: err.write });
    }).not.toThrow(); // JSON.parse 失败在 load() 内部被吞掉，不上抛

    expect(code).toBe(0); // 实际实现是「损坏即空表」，所以不是 1
    expect(out.lines.join('\n')).toContain('暂无历史会话');
    expect(err.lines).toEqual([]); // 吞错是静默的：不打印「读取会话登记表失败」
  });

  it('3b) 登记根不可创建（同名文件挡路）→ 返回 1，stderr 含「读取会话登记表失败」', () => {
    // mkdirSync(home) 抛错时才会走到 cmdSessionsList 的 catch → 1（唯一能拿到 1 的路径）。
    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, 'not a directory', 'utf8');
    const badHome = path.join(blocker, 'nested');

    const out = capture();
    const err = capture();
    const code = cmdSessionsList({ vesselHome: badHome, log: out.write, error: err.write });

    expect(code).toBe(1);
    expect(out.lines).toEqual([]); // 失败路径不打印列表/空表提示
    expect(err.lines.join('\n')).toContain('读取会话登记表失败');
  });

  it('4) --last → 命中最近活动的一条，sessionFile 指向它的日志', () => {
    seedSessions(tmp, [metaOf(OLDER_ID, ws, T_OLDER), metaOf(NEWER_ID, ws, T_NEWER)]);
    // 先建日志文件（否则会被「日志不存在」拦下，见用例 7）。
    const newerLog = touchSessionLog(ws, NEWER_ID);

    const target = expectOk(resolveResumeTarget([], { last: true, vesselHome: tmp }));

    expect(target.meta.id).toBe(NEWER_ID); // 最近活动者，而不是写入顺序里的最后一条
    expect(target.sessionFile).toBe(newerLog);
  });

  it('5) 指定 id 命中 → sessionFile = <workspaceRoot>/.harness/sessions/<id>/session.jsonl', () => {
    seedSessions(tmp, [metaOf(OLDER_ID, ws, T_OLDER), metaOf(NEWER_ID, ws, T_NEWER)]);
    const olderLog = touchSessionLog(ws, OLDER_ID);

    const target = expectOk(resolveResumeTarget([OLDER_ID], { vesselHome: tmp }));

    expect(target.meta.id).toBe(OLDER_ID); // 给 id 时按 id 取，不回退到最近一条
    expect(target.sessionFile).toBe(olderLog);
    expect(target.sessionFile).toBe(path.join(ws, '.harness', 'sessions', OLDER_ID, 'session.jsonl'));
    expect(target.sessionFile).toBe(sessionFileFor(target.meta)); // 与共享派生函数同口径
  });

  it('6) id 不在登记表 → ok=false、exitCode 2、message 含「未找到会话」', () => {
    seedSessions(tmp, [metaOf(NEWER_ID, ws, T_NEWER)]); // 登记表非空，只是没有这个 id

    const target = expectErr(resolveResumeTarget(['nope'], { vesselHome: tmp }));

    expect(target.exitCode).toBe(2);
    expect(target.message).toContain('未找到会话');
    expect(target.message).toContain('nope'); // 报错点明是哪个 id
  });

  it('7) 登记表命中但日志缺失 → ok=false、exitCode 2、message 含「日志不存在」，且绝不凭空新建目录', () => {
    seedSessions(tmp, [metaOf(NEWER_ID, ws, T_NEWER)]);
    const sessionDir = path.join(ws, '.harness', 'sessions', NEWER_ID);
    expect(fs.existsSync(sessionDir)).toBe(false); // 前置条件：确实还没有任何日志目录

    const target = expectErr(resolveResumeTarget([NEWER_ID], { vesselHome: tmp }));

    expect(target.exitCode).toBe(2);
    expect(target.message).toContain('日志不存在');
    // 关键回归保护：解析失败不得留下任何磁盘痕迹（Session.open 会建目录，这里必须提前拦住）。
    expect(fs.existsSync(sessionDir)).toBe(false);
    expect(fs.existsSync(path.join(sessionDir, 'session.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(ws, '.harness'))).toBe(false);
  });

  it('8) 空登记表 + --last → ok=false、exitCode 2', () => {
    const target = expectErr(resolveResumeTarget([], { last: true, vesselHome: tmp }));

    expect(target.exitCode).toBe(2);
    expect(target.message).toContain('暂无历史会话');
    expect(fs.existsSync(path.join(ws, '.harness'))).toBe(false); // 失败路径不建任何目录
  });
});
