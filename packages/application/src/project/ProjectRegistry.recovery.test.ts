import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectRegistry } from './ProjectRegistry.js';

/**
 * ProjectRegistry.recovery.test.ts — 索引损坏时「覆盖前先留档」的判别性用例。
 *
 * 缺陷（修复前）：`load()` 解析失败 → 静默 `projects.clear()`；随后 `open()` 的 `persist()`
 * 直接用空索引**覆盖** `projects.json` → 任何部分可恢复的索引被静默且不可恢复地丢弃
 * （无异常、无告警、无 quarantine 副本）。
 *
 * 补充决策（本卡）：留档**改名失败**时，旧行为是「只 warn 然后照常 persist」——原文件仍在
 * 原路径（可能仍可手工抢救），却被新索引**确定性覆盖**。现改为与
 * `apps/cli/src/usage/UsageStore.ts` 的 `suppressWrite` 同款：**抑制本次持久化写入**，
 * 原文件保持逐字不变（`open()` 仍不抛、仍返回 Project，内存索引仍可用）。
 * 留档**成功**与文件**不存在**（首次运行）均不受影响，照常落盘。
 *
 * 修复后不变量（本文件逐条锁死）：
 *   ① 损坏 → 原文件在覆盖前**改名留档**为 `projects.json.corrupted-<ts>`，留档内容**逐字**
 *      等于原坏内容（真副本，不是空占位、不是新建的空索引）；
 *   ② 损坏 → `console.warn` ≥1 条，且同时含留档路径与原路径；
 *   ③ 负对照：文件**不存在**（首次运行）→ 0 条 warn、无 `*.corrupted-*`、照常写盘、不误伤；
 *   ④ 正常索引 → 不产生留档、不告警，既有索引照常读回（回归）；
 *   ⑤ 留档改名失败（注入 EPERM）→ `open()` 仍不抛、有「留档失败」告警，且**抑制本次写入**：
 *      原文件**逐字保持不变**（决策：留档失败时宁可本次不落盘，也绝不用新索引覆盖它）；
 *   ⑥ 合法 JSON 但结构非法（projects 非数组）同样留档，而不是静默丢弃。
 *
 * 纪律：全部落在 `mkdtempSync(os.tmpdir(), 'cah-project-')`，绝不触碰真实 `~/.vessel`；
 * 断言一律「只读目录列举」，不做任何删除检查。
 */

// 注入「留档改名失败」用 `vi.mock('node:fs')` 而非 `vi.spyOn(fs, 'renameSync')`：node:fs 的
// ESM 命名空间导出 non-configurable，vitest 2.x 下 spyOn 会报 "Cannot redefine property"
// （同 packages/application/src/credential/dpapiArgv.test.ts 与 apps/cli/src/usage/
// UsageStore.recovery.test.ts 的注释与写法）。这里默认**原样委托**真实实现，只有
// `denyRename` 谓词命中（留档目标名含 `.corrupted-`）时才抛 EPERM ——
// `persist()` 走 `renameWithRetry(tmp, projects.json)`，目标名不含 `.corrupted-`，不受影响。
//
// 刻意用**普通函数**而非 `vi.fn()`：vi.restoreAllMocks()/clearAllMocks() 会遍历全局 mocks
// 集合，用 vi.fn 会被重置实现（连带打掉本文件的 fs 注入）；普通函数不在该集合内。
const fsHooks = vi.hoisted(() => ({ denyRename: null as null | ((dest: unknown) => boolean) }));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    renameSync: (oldPath: fs.PathLike, newPath: fs.PathLike): void => {
      if (fsHooks.denyRename?.(newPath)) {
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
      }
      actual.renameSync(oldPath, newPath);
    },
  };
});

/**
 * 静默捕获 `console.warn`（断言只看本文件；`mockClear` 逐例复位，**不**用 restoreAllMocks——
 * 那会顺手重置上面 fs 工厂里的实现）。
 */
const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

/** 与指挥实测同款坏内容：JSON 截断（也覆盖「尾部被截断」这一类损坏）。 */
const CORRUPT = '{ corrupt';

/** vesselHome 下的留档文件列举（`projects.json.corrupted-<ts>[-N]`）。 */
function corruptedFiles(home: string): string[] {
  if (!fs.existsSync(home)) return [];
  return fs.readdirSync(home).filter((n) => n.includes('.corrupted-'));
}

/** 读 `projects.json` 并取出其记录的 root 列表（断言用，避免手写路径转义）。 */
function indexedRoots(home: string): string[] {
  const raw = fs.readFileSync(path.join(home, 'projects.json'), 'utf8');
  const parsed = JSON.parse(raw) as { projects: { root: string }[] };
  return parsed.projects.map((p) => p.root);
}

/** 全部 warn 文本（拼接），断言内容用。 */
function warnText(): string {
  return consoleWarn.mock.calls.flat().join(' ');
}

describe('ProjectRegistry — 索引损坏时先留档再覆盖', () => {
  let dir: string;
  /** vesselHome（索引所在目录）。 */
  let home: string;
  /** 一个真实存在的工作区目录（`open()` 的唯一前置条件）。 */
  let ws: string;

  beforeEach(() => {
    consoleWarn.mockClear();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-project-'));
    home = path.join(dir, 'vessel-home');
    ws = path.join(dir, 'workspace');
    fs.mkdirSync(ws, { recursive: true });
  });

  afterEach(() => {
    fsHooks.denyRename = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('① 损坏索引 → 覆盖前改名留档，留档内容逐字等于原坏内容', () => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'projects.json'), CORRUPT, 'utf8');

    // 构造（load 失败）→ open（触发 persist 覆盖点）；修复前此处静默覆盖且无任何留档。
    const reg = new ProjectRegistry({ vesselHome: home });
    const opened = reg.open(ws);
    expect(opened.root).toBe(path.resolve(ws));

    const baks = corruptedFiles(home);
    expect(baks).toHaveLength(1);
    expect(baks[0]!.startsWith('projects.json.corrupted-')).toBe(true); // 留档命名形态
    // 判别核心：留档是**真副本**（逐字相等），不是空占位、不是新建的空索引
    expect(fs.readFileSync(path.join(home, baks[0]!), 'utf8')).toBe(CORRUPT);

    // 覆盖确实发生了 —— 所以这份留档是原内容唯一的残存（证明「先留档再覆盖」的时序）
    // 同时这是「留档**成功** → 照常持久化」的回归位：抑制条件若被写成「一律抑制」，此处必红。
    const current = fs.readFileSync(path.join(home, 'projects.json'), 'utf8');
    expect(current).not.toBe(CORRUPT);
    expect(indexedRoots(home)).toEqual([path.resolve(ws)]);
  });

  it('② 损坏索引 → warn ≥1 且同时含留档路径与原路径', () => {
    fs.mkdirSync(home, { recursive: true });
    const file = path.join(home, 'projects.json');
    fs.writeFileSync(file, CORRUPT, 'utf8');

    new ProjectRegistry({ vesselHome: home }).open(ws);

    expect(consoleWarn).toHaveBeenCalled();
    const bak = corruptedFiles(home)[0];
    expect(bak).toBeTruthy();
    expect(warnText()).toContain(path.join(home, bak!)); // 留档路径
    expect(warnText()).toContain(file); // 原路径
    expect(warnText()).toContain('空索引'); // 「已改用空索引继续」的人话提示
  });

  it('③ 负对照：索引文件不存在（首次运行）→ 0 条 warn、无留档、照常写盘', () => {
    const reg = new ProjectRegistry({ vesselHome: home });
    expect(reg.list()).toHaveLength(0);
    expect(reg.open(ws).root).toBe(path.resolve(ws));

    expect(consoleWarn).not.toHaveBeenCalled(); // 含「抑制写入」warn：首次运行绝不能被误抑制
    expect(corruptedFiles(home)).toEqual([]);
    // 负对照的另一半：抑制逻辑若被写成「一律抑制」，这里也会红（索引根本没写出去）
    expect(indexedRoots(home)).toEqual([path.resolve(ws)]);
  });

  it('④ 回归：正常索引照常读回，不产生留档、不告警', () => {
    fs.mkdirSync(home, { recursive: true });
    const prev = path.join(dir, 'prev-project');
    fs.mkdirSync(prev, { recursive: true });
    const openedAt = '2026-01-02T03:04:05.000Z';
    fs.writeFileSync(
      path.join(home, 'projects.json'),
      JSON.stringify({ projects: [{ root: path.resolve(prev), openedAt }] }, null, 2),
      'utf8',
    );

    const reg = new ProjectRegistry({ vesselHome: home });
    expect(reg.list()).toEqual([{ root: path.resolve(prev), openedAt }]);

    reg.open(ws);
    expect(corruptedFiles(home)).toEqual([]);
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(indexedRoots(home)).toEqual([path.resolve(prev), path.resolve(ws)]);
  });

  it('⑤ 留档改名失败（注入 EPERM）→ open() 仍不抛，抑制本次写入，原文件逐字不变', () => {
    fs.mkdirSync(home, { recursive: true });
    const file = path.join(home, 'projects.json');
    fs.writeFileSync(file, CORRUPT, 'utf8');
    fsHooks.denyRename = (dest) => String(dest).includes('.corrupted-');

    const reg = new ProjectRegistry({ vesselHome: home });
    const opened = reg.open(ws); // 不得因留档失败而抛
    expect(opened.root).toBe(path.resolve(ws)); // open() 语义不变：仍返回 Project
    expect(reg.list()).toHaveLength(1); // 内存索引仍可用

    expect(consoleWarn).toHaveBeenCalled();
    expect(warnText()).toContain('留档改名失败');
    expect(warnText()).toContain(file); // 告警必须点名原路径，便于人工抢救
    expect(corruptedFiles(home)).toEqual([]); // 确实没留下留档（改名失败）

    // 决策点：留档失败 ⇒ **抑制本次写入**（不再是旧行为的「照常覆盖」）。
    expect(warnText()).toContain('已抑制本次写入');
    // 判别核心：原文件**逐字未被修改**——修复前这里被新索引覆盖，本断言必红。
    expect(fs.readFileSync(file, 'utf8')).toBe(CORRUPT);
    // 抑制发生在任何磁盘 IO 之前：连 persist 的 tmp 都不该出现。
    expect(fs.readdirSync(home).filter((n) => n.includes('.tmp'))).toEqual([]);
  });

  it('⑥ 合法 JSON 但结构非法（projects 非数组）同样留档，而非静默丢弃', () => {
    fs.mkdirSync(home, { recursive: true });
    const bad = JSON.stringify({ projects: 'boom' });
    fs.writeFileSync(path.join(home, 'projects.json'), bad, 'utf8');

    const reg = new ProjectRegistry({ vesselHome: home });
    expect(reg.list()).toHaveLength(0); // 以空索引继续，不抛
    reg.open(ws);

    const baks = corruptedFiles(home);
    expect(baks).toHaveLength(1);
    expect(fs.readFileSync(path.join(home, baks[0]!), 'utf8')).toBe(bad);
    expect(consoleWarn).toHaveBeenCalled();
  });
});
