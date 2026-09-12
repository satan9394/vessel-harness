import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  runVesselMigration,
  defaultRecycle,
  RecycleUnsupportedError,
  KNOWN_STATE_ENTRIES,
  defaultLegacyRoot,
  defaultVesselRoot,
} from './migrate.js';

function tmpHome(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('vessel migrate — one-time ~/.dsh -> ~/.vessel (task 033)', () => {
  let home: string;
  let legacy: string;
  let vessel: string;

  beforeEach(() => {
    home = tmpHome('cah-migrate-');
    legacy = path.join(home, '.dsh');
    vessel = path.join(home, '.vessel');
  });

  afterEach(() => {
    // 迁移测试绝不做任何永久删除之外的操作：清理只走 tests 的临时目录（vitest 自带回收）。
    for (const d of [home]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('copies known state entries from ~/.dsh to ~/.vessel and recycles the legacy dir', async () => {
    // build a fake legacy home with the known state entries
    fs.mkdirSync(path.join(legacy, 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\n---\nbody\n', 'utf8');
    fs.mkdirSync(path.join(legacy, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'memory', 'note.md'), '# n\n', 'utf8');
    fs.mkdirSync(path.join(legacy, 'learned', 's'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'learned', 's', 'sug.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(legacy, 'providers.json'), JSON.stringify([{ id: 'x' }]), 'utf8');
    fs.writeFileSync(path.join(legacy, 'current.json'), JSON.stringify({ id: 'mock' }), 'utf8');
    fs.writeFileSync(path.join(legacy, 'usage.json'), '{}', 'utf8');
    // an unrelated dir that must NOT be migrated (not in KNOWN_STATE_ENTRIES)
    fs.mkdirSync(path.join(legacy, 'unrelated'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'unrelated', 'junk.txt'), 'junk', 'utf8');

    const recycle = vi.fn().mockResolvedValue(undefined);
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });

    expect(res.status).toBe('migrated');
    expect(res.legacyRoot).toBe(legacy);
    expect(res.vesselRoot).toBe(vessel);
    expect(res.recycled).toBe(true);
    expect(recycle).toHaveBeenCalledTimes(1);
    expect(recycle).toHaveBeenCalledWith(legacy);

    // data present in .vessel
    expect(JSON.parse(fs.readFileSync(path.join(vessel, 'providers.json'), 'utf8'))).toEqual([{ id: 'x' }]);
    expect(JSON.parse(fs.readFileSync(path.join(vessel, 'current.json'), 'utf8'))).toEqual({ id: 'mock' });
    expect(fs.existsSync(path.join(vessel, 'usage.json'))).toBe(true);
    expect(fs.existsSync(path.join(vessel, 'memory', 'note.md'))).toBe(true);
    expect(fs.existsSync(path.join(vessel, 'learned', 's', 'sug.json'))).toBe(true);
    expect(fs.readFileSync(path.join(vessel, 'skills', 'demo', 'SKILL.md'), 'utf8')).toContain('name: demo');
    // unlisted top-level dir is NOT migrated
    expect(fs.existsSync(path.join(vessel, 'unrelated'))).toBe(false);

    // copiedCount counts files (skills 1 + memory 1 + learned 1 + providers 1 + current 1 + usage 1 = 6)
    expect(res.copiedCount).toBe(6);
  });

  it('skips when ~/.dsh does not exist (legacy-absent)', async () => {
    const recycle = vi.fn();
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('legacy-absent');
    expect(fs.existsSync(vessel)).toBe(false);
    expect(recycle).not.toHaveBeenCalled();
  });

  /**
   * 本卡②裁决**改写了本用例的旧断言**（逐条论证见交付说明④）：
   *  - 旧：`vessel-present` ⇒ `recycle` **一次都不调**、什么也不做；
   *  - 新：旧根仍在 ⇒ **再尝试一次回收**（`recycle` 恰好调一次、实参=旧根），因为旧实现
   *    "旧目录还躺着却退 0 且不提示"正是②要修的缺陷（用户再也不知道旧目录还在）。
   *
   * 不放宽的部分（比旧断言更严）：`.vessel` 里**已有**的 `providers.json` 仍必须是 `'new'`
   * （短路分支**不得**顺手复制/覆盖 → 旧实现在这一点上与新实现一致，断言逐字保留），
   * `.dsh` 里的 `'keep'` 也必须原样（注入的 recycle 是 mock，谁都不许真删）。
   * 删掉 `runVesselMigration` 里 `vessel-present` 分支的 `attemptRecycle` 调用 ⇒ 第一、二条断言 RED。
   */
  it('②：~/.vessel 已存在但 ~/.dsh 仍在 ⇒ 再尝试一次回收（不复制、不覆盖、不删除）', async () => {
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'providers.json'), 'keep', 'utf8');
    fs.mkdirSync(vessel, { recursive: true });
    fs.writeFileSync(path.join(vessel, 'providers.json'), 'new', 'utf8');

    const recycle = vi.fn().mockResolvedValue(undefined);
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('vessel-present');
    // ② 的新行为：短路**不再跳过回收**，且只尝试一次、实参就是旧根
    expect(recycle).toHaveBeenCalledTimes(1);
    expect(recycle).toHaveBeenCalledWith(legacy);
    expect(res.recycled).toBe(true);
    // 短路分支**不得**复制（copiedCount 0）——旧数据不能被"新"数据顶掉
    expect(res.copiedCount).toBe(0);
    // .dsh untouched, .vessel keeps its own content
    expect(fs.readFileSync(path.join(legacy, 'providers.json'), 'utf8')).toBe('keep');
    expect(fs.readFileSync(path.join(vessel, 'providers.json'), 'utf8')).toBe('new');
  });

  it('keeps the copy and reports recycled=false when the recycle step fails (never permanent-deletes)', async () => {
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'providers.json'), 'boo', 'utf8');

    const recycle = vi.fn().mockRejectedValue(new Error('no recycle bin on this platform'));
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });
    expect(res.status).toBe('migrated');
    expect(res.recycled).toBe(false);
    expect(res.recycleError).toContain('no recycle bin');
    // ① 的分流判据在**这一处**落地：普通异常 = 「尝试后失败」，**不是**「平台不支持」
    // （删掉 `attemptRecycle` 里那句 `instanceof RecycleUnsupportedError` 的判据 ⇒ 本行仍绿、
    //  但下面①-a 那条会红——两条合起来才钉死"三种结局必须分开"）。
    expect(res.recycleUnsupported).toBeUndefined();
    // data still copied and preserved (legacy not permanently deleted by us)
    expect(fs.readFileSync(path.join(vessel, 'providers.json'), 'utf8')).toBe('boo');
  });

  it('default roots point at ~/.dsh and ~/.vessel under the given home', () => {
    expect(defaultLegacyRoot('fake')).toBe(path.join('fake', '.dsh'));
    expect(defaultVesselRoot('fake')).toBe(path.join('fake', '.vessel'));
    // sanity: the default ~/.vessel follows the brand
    expect(KNOWN_STATE_ENTRIES).toContain('providers.json');
    expect(KNOWN_STATE_ENTRIES).toContain('skills');
  });

  /**
   * 本卡① —— 「**平台不支持**回收」与「**尝试回收后失败**」必须分开。
   *
   * 复现（改前，**静态可核**，行号指改动前的 `migrate.ts`）：
   *   - `defaultRecycle`（旧 :102-118）在 `process.platform !== 'win32'` 时**恒抛**一个普通
   *     `Error`；`runVesselMigration`（旧 :141-148）把它吞成 `recycled:false` + `recycleError`
   *     两个字段 —— **没有任何字段能区分"平台没有回收站"与"有实现但抛错"**；
   *   - `cmdMigrate`（旧 cli.ts:2421-2438）只看 `res.recycled === false` ⇒ **恒退 1**。
   *   ⇒ 在 Linux/macOS 上，**一次数据已成功迁移的 `vessel migrate` 也退 1**。
   *
   * 本用例的构造方式（**不依赖真实平台**，如实声明）：用①裁决给出的**平台判据注入缝**——
   * `defaultRecycle(dir, 'linux')`（第二个参数默认 `process.platform`，显式传入即模拟非 Windows），
   * 把它作为 `recycle` 注进 `runVesselMigration`。本机是 win32，所以这条**绝不会**真的去调
   * PowerShell 回收站；生产路径仍是 `defaultRecycle`（不传第二参）。
   *
   * 判别性（"删哪行会红"）：
   *   - `defaultRecycle` 的 `throw new RecycleUnsupportedError(...)` 改回 `throw new Error(...)`
   *     ⇒ 第一条 `toBeInstanceOf` 与第三条 `toBe(true)` 同时 RED；
   *   - `attemptRecycle` 里删掉 `instanceof RecycleUnsupportedError` 那个三元（不再置
   *     `recycleUnsupported`）⇒ 第三条 RED（`undefined` ≠ `true`）；
   *   - 负对照（**不得回退**）：普通异常仍必须**不**带这个标志（上一条用例已断言）。
   */
  it('①-a（判别性）：非 Windows（注入 defaultRecycle(dir,"linux")）⇒ 回收标记为「不支持」而非「失败」', async () => {
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'providers.json'), 'kept-on-linux', 'utf8');

    // 平台判据的**注入点**：生产里不传第二参（= process.platform），这里显式 'linux'
    const res = await runVesselMigration({
      legacyRoot: legacy,
      vesselRoot: vessel,
      recycle: (d) => defaultRecycle(d, 'linux'),
    });

    // 直接钉住判据本体：这个异常是**类型化**的，不是靠 message 文案猜
    await expect(defaultRecycle(legacy, 'darwin')).rejects.toBeInstanceOf(RecycleUnsupportedError);
    await expect(defaultRecycle(legacy, 'linux')).rejects.toThrow(/无标准回收站/);
    await expect(defaultRecycle(legacy, 'linux')).rejects.toThrow(/当前平台 linux/); // 成因带平台，不吞

    // 迁移主体照旧成功：数据已复制、旧目录**没有被删**（绝不永久删除）
    expect(res.status).toBe('migrated');
    expect(res.copiedCount).toBe(1);
    expect(fs.readFileSync(path.join(vessel, 'providers.json'), 'utf8')).toBe('kept-on-linux');
    expect(fs.readFileSync(path.join(legacy, 'providers.json'), 'utf8')).toBe('kept-on-linux');

    // ① 的两个判据：recycled=false（没回收）**且** recycleUnsupported=true（不支持，不是失败）
    expect(res.recycled).toBe(false);
    expect(res.recycleUnsupported).toBe(true);
    expect(res.recycleError).toContain('无标准回收站'); // 成因不吞（cmdMigrate 的手工提示要用它）
  });

  /**
   * 本卡① 的**负对照**（Windows 语义不许回退）：同一个 `runVesselMigration`，
   * 注入"有实现且成功"⇒ `recycled:true` 且**没有**「不支持」标志；注入"有实现但抛错"
   * ⇒ `recycleError` 有值、**仍然没有**「不支持」标志。
   *
   * 判别性：把 `attemptRecycle` 的 `recycled: true` 写反、或在成功分支也置
   * `recycleUnsupported` ⇒ 第一条 RED；把普通异常也当成「不支持」⇒ 第二条 RED
   * （那会让真正的回收失败退 0，正是①要防的反向回归）。
   */
  it('①-b（负对照）：有实现时成功/失败都不带「不支持」标志（Windows 语义逐字不变）', async () => {
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'providers.json'), 'x', 'utf8');

    const ok = await runVesselMigration({
      legacyRoot: legacy,
      vesselRoot: vessel,
      recycle: vi.fn().mockResolvedValue(undefined),
    });
    expect(ok.recycled).toBe(true);
    expect(ok.recycleUnsupported).toBeUndefined();
    expect(ok.recycleError).toBeUndefined();

    // 第二种结局：换一个新的临时 home（否则 vessel 已建好会走 vessel-present 短路）
    const home2 = tmpHome('cah-migrate-2-');
    const legacy2 = path.join(home2, '.dsh');
    try {
      fs.mkdirSync(legacy2, { recursive: true });
      fs.writeFileSync(path.join(legacy2, 'providers.json'), 'y', 'utf8');
      const bad = await runVesselMigration({
        legacyRoot: legacy2,
        vesselRoot: path.join(home2, '.vessel'),
        recycle: vi.fn().mockRejectedValue(new Error('powershell exit 1')),
      });
      expect(bad.recycled).toBe(false);
      expect(bad.recycleError).toBe('powershell exit 1');
      expect(bad.recycleUnsupported).toBeUndefined(); // ← 「尝试后失败」不是「不支持」
    } finally {
      fs.rmSync(home2, { recursive: true, force: true }); // 测试自建且在 os.tmpdir() 下
    }
  });

  /**
   * 本卡②的**迁移侧**判别性用例（cli 侧文案/退出码在 `cli.test.ts` 的「②-a/②-b/②-c」）。
   *
   * 复现（改前，**静态可核**）：旧 `runVesselMigration` 在 `fs.existsSync(vesselRoot)` 时
   * **直接** `return { status:'skipped', reason:'vessel-present', copiedCount:0, recycled:false }`
   * ——`recycle` 一次都不调、也不看旧根。删掉新的 `attemptRecycle` 调用 ⇒ 本用例第一条 RED。
   */
  it('②（迁移侧）：~/.vessel 已存在 + 旧根仍在 ⇒ 回收被真的尝试（成功 outcome 如实回传）', async () => {
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(vessel, { recursive: true });
    const recycle = vi.fn().mockResolvedValue(undefined);
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });
    expect(recycle).toHaveBeenCalledTimes(1);
    expect(recycle).toHaveBeenCalledWith(legacy);
    expect(res.reason).toBe('vessel-present');
    expect(res.status).toBe('skipped');
    expect(res.copiedCount).toBe(0);
    expect(res.recycled).toBe(true);
  });

  it('②（迁移侧）：~/.vessel 已存在 + 旧根仍在 + 回收失败 ⇒ 失败 outcome 如实回传（不是「不支持」）', async () => {
    fs.mkdirSync(legacy, { recursive: true });
    fs.mkdirSync(vessel, { recursive: true });
    const res = await runVesselMigration({
      legacyRoot: legacy,
      vesselRoot: vessel,
      recycle: vi.fn().mockRejectedValue(new Error('recycle bin full')),
    });
    expect(res.reason).toBe('vessel-present');
    expect(res.recycled).toBe(false);
    expect(res.recycleError).toBe('recycle bin full');
    expect(res.recycleUnsupported).toBeUndefined();
    expect(fs.existsSync(legacy)).toBe(true); // 谁都不许永久删除（回收站铁律）
  });

  it('②（负对照）：旧根**不在**时短路逐字不变——即使 ~/.vessel 已存在也只报 legacy-absent、不碰回收', async () => {
    fs.mkdirSync(vessel, { recursive: true });
    const recycle = vi.fn();
    const res = await runVesselMigration({ legacyRoot: legacy, vesselRoot: vessel, recycle });
    expect(res.status).toBe('skipped');
    expect(res.reason).toBe('legacy-absent'); // 顺序未变：旧根判据仍先于新根判据
    expect(res.copiedCount).toBe(0);
    expect(res.recycled).toBe(false);
    expect(recycle).not.toHaveBeenCalled();
    expect(fs.existsSync(vessel)).toBe(true);
  });
});