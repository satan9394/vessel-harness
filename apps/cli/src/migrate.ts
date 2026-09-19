import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { vesselHome } from './envRoot.js';

/**
 * apps/cli/migrate — one-time migration of the user/state home dir from
 * `~/.dsh` to `~/.vessel` (task 033). V0.9 品牌已改为 Vessel，但历史版本把用户级
 * 状态目录硬编码为 `~/.dsh`（providers.json / current.json / usage.json /
 * memory / learned / skills）；本模块在检测到旧目录存在且新目录不存在时，把旧
 * 目录里已知的 Vessel 状态条目复制到 `~/.vessel/`，随后把旧 `~/.dsh/` 目录送进
 * 回收站（删除铁律：禁止任何永久删除）。
 *
 * 只迁移本仓库约定的已知状态条目（providers.json/current.json/usage.json/
 * memory/learned/skills），避免把 `~/.dsh` 里可能存在的其它软件数据（如原生 DSH
 * 安装的 profiles/sessions）一并搬走 → 不越权复制未知目录。
 *
 * **回收这一步有三种结局，本模块与调用方都必须分清（Round 13x 裁决）**：
 *  - `recycled === true`：旧目录已进回收站；
 *  - `recycleUnsupported === true`：**本平台没有**回收站实现（`RecycleUnsupportedError`，
 *    今日=非 Windows）⇒ 调用方退 **0** 但必须说清旧目录仍在、请手工处理；
 *  - `recycleError` 有值且 `recycleUnsupported` 为假：**尝试过但失败** ⇒ 调用方退 **1**。
 *  把前两者混为一谈会让 Linux/macOS 上**一次成功的迁移也退 1**（`vessel migrate && 下一步`
 *  就此停住），这正是本模块要防的事。
 *
 * 另一处（②）：「`~/.vessel` 已存在」这条短路**不再无条件结束**——旧根仍在时本次改为
 * **再尝试一次回收**（见 `runVesselMigration`），旧根不在时仍走 `'legacy-absent'` 不变。
 */

/** 已知的 Vessel 用户级状态条目（迁移的复制范围）。 */
export const KNOWN_STATE_ENTRIES = [
  'providers.json',
  'current.json',
  'usage.json',
  'sessions.json',
  'memory',
  'learned',
  'skills',
] as const;

export interface MigrationOptions {
  /** 旧用户级状态根目录（默认 ~/.dsh）。 */
  legacyRoot?: string;
  /** 新用户级状态根目录（默认 ~/.vessel）。 */
  vesselRoot?: string;
  /** 回收站删除器（测试注入 spy；默认走 Windows 回收站）。 */
  recycle?: (dir: string) => void | Promise<void>;
}

export interface MigrationResult {
  /** migrated = 本次真的做了复制；skipped = 没复制（原因见 reason）。 */
  status: 'migrated' | 'skipped';
  /**
   * - `'legacy-absent'`：旧根不存在 ⇒ 真正"无需迁移"（调用方文案/退出码不变）；
   * - `'vessel-present'`：新根已存在 ⇒ **不复制**；执行到这里旧根**必然仍在**
   *   （`'legacy-absent'` 已先判过）⇒ 本次改为**再尝试一次回收**，结局见
   *   `recycled` / `recycleUnsupported` / `recycleError`（② 裁决）；
   * - `'none'`：本次完成了复制（回收结局同样见后三个字段）。
   */
  reason: 'legacy-absent' | 'vessel-present' | 'none';
  legacyRoot?: string;
  vesselRoot?: string;
  /** 实际复制成功的文件/目录条目数。 */
  copiedCount: number;
  /** 旧目录是否已送进回收站。 */
  recycled: boolean;
  /**
   * 本平台**没有**回收站实现（`defaultRecycle` 抛 `RecycleUnsupportedError`）——
   * 语义是「**不支持**」而不是「尝试后失败」。只在 `recycled === false` 时有意义。
   */
  recycleUnsupported?: boolean;
  /** 回收失败的原因（`recycled === false` 时；「不支持」也会带上成因原文）。 */
  recycleError?: string;
}

/**
 * 「本平台没有标准回收站」——表示**不支持**自动回收，而不是「尝试回收后失败」。
 *
 * 两者必须分流（Round 13x 裁决）：非 Windows 上 `defaultRecycle` **恒抛**本错误，而
 * "数据已复制到 ~/.vessel"这件事与非 Windows 无关 ⇒ 若把它与"尝试后失败"混为一谈，
 * Linux/macOS 上**一次成功的迁移也会退 1**，脚本里的 `vessel migrate && 下一步` 就此停住。
 * 调用方（`cmdMigrate`）据此退 0，但**必须**在输出里说清旧目录仍在原处、需手工处理
 * （**不许**说成"已回收"）。
 */
export class RecycleUnsupportedError extends Error {
  constructor(dir: string, platform: string) {
    super(
      `[vessel migrate] 无法把 ${dir} 送进回收站（当前平台 ${platform} 无标准回收站）；` +
        `.vessel 数据已就绪，请手工把旧目录移入回收站，且不要永久删除。`,
    );
    this.name = 'RecycleUnsupportedError';
  }
}

/** 默认旧根：~/.dsh。 */
export function defaultLegacyRoot(home = os.homedir()): string {
  return path.join(home, '.dsh');
}

/** 默认新根：~/.vessel。 */
export function defaultVesselRoot(home = os.homedir()): string {
  return vesselHome(home);
}

/** 把 src 下已知状态条目复制到 dst（嵌套目录逐文件复制）。返回复制条目数。 */
export function copyKnownState(src: string, dst: string): number {
  let count = 0;
  for (const name of KNOWN_STATE_ENTRIES) {
    const s = path.join(src, name);
    if (!fs.existsSync(s)) continue;
    const d = path.join(dst, name);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      count += copyTree(s, d);
    } else if (stat.isFile()) {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
      count += 1;
    }
  }
  return count;
}

function copyTree(srcDir: string, dstDir: string): number {
  fs.mkdirSync(dstDir, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
      count += 1;
    }
  }
  return count;
}

/**
 * 默认回收站删除器：Windows 下用 PowerShell + Microsoft.VisualBasic 走回收站
 * （删除铁律）；非 Windows 无标准回收站，抛 `RecycleUnsupportedError`（绝不永久删除），
 * 由调用方按「**不支持**」分流（退 0 + 手工提示），而不是当作「尝试后失败」（退 1）。
 *
 * `platform` 显式可传（默认 `process.platform`）——这是①裁决要求的**平台判据注入缝**：
 * 测试不必依赖真实平台就能构造"非 Windows 语义"这条分支（`defaultRecycle(dir, 'linux')`），
 * 且生产路径零变化（不传参即 `process.platform`）。
 */
export async function defaultRecycle(dir: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== 'win32') {
    throw new RecycleUnsupportedError(dir, platform);
  }
  const escaped = dir.replace(/'/g, "''");
  const script =
    'Add-Type -AssemblyName Microsoft.VisualBasic; ' +
    `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'pipe',
    windowsHide: true,
    timeout: 30_000,
  });
}

/**
 * 回收尝试的**唯一**口径（三种结局只有一处判定，别在调用方复制一份）：
 *  - 成功 ⇒ `recycled: true`；
 *  - `RecycleUnsupportedError` ⇒ `recycleUnsupported: true`（**不支持**，不是失败）；
 *  - 其余异常 ⇒ `recycled: false` + `recycleError`（**尝试后失败**）。
 * 任何一种都不永久删除任何东西（数据已复制/早已在 `.vessel`，绝不回滚）。
 */
async function attemptRecycle(
  recycle: (dir: string) => void | Promise<void>,
  dir: string,
): Promise<{ recycled: boolean; recycleUnsupported?: boolean; recycleError?: string }> {
  try {
    await recycle(dir);
    return { recycled: true };
  } catch (err) {
    return {
      recycled: false,
      ...(err instanceof RecycleUnsupportedError ? { recycleUnsupported: true } : {}),
      recycleError: (err as Error).message,
    };
  }
}

/**
 * 执行一次性迁移。检测规则：旧根存在 且 新根不存在 才**复制**；否则跳过复制。
 * 复制成功后把旧根送进回收站（失败则保留数据、不永久删除，仅降级提示）。
 *
 * **② 裁决**：`~/.vessel` 已存在这条短路**不再无条件结束**——先把"旧根是否仍在"处理掉。
 * 执行到该分支时旧根**必然仍在**（上面刚判过 `legacy-absent`）⇒ 数据早已就绪、不复制，
 * 本次**只再尝试一次回收**：
 *  - 成功 ⇒ `reason:'vessel-present'` + `recycled:true`（调用方说清"本次完成的是回收"）；
 *  - 失败/不支持 ⇒ `recycleError` / `recycleUnsupported`，与复制路径**同一套**分流。
 * 旧根**不在**时（真正的"无需再迁"）仍走 `'legacy-absent'`，文案与退出码逐字不变。
 */
export async function runVesselMigration(opts: MigrationOptions = {}): Promise<MigrationResult> {
  const legacyRoot = opts.legacyRoot ?? defaultLegacyRoot();
  const vesselRoot = opts.vesselRoot ?? defaultVesselRoot();

  if (!fs.existsSync(legacyRoot)) {
    return { status: 'skipped', reason: 'legacy-absent', copiedCount: 0, recycled: false };
  }
  if (fs.existsSync(vesselRoot)) {
    // ②：短路前先看旧根是否仍在 —— 能走到这里说明它**刚刚**还在（上一行判过 legacy-absent）
    // ⇒ 不复制（数据早已在 ~/.vessel），本次补做的只有"回收"这一步。
    const outcome = await attemptRecycle(opts.recycle ?? defaultRecycle, legacyRoot);
    return { status: 'skipped', reason: 'vessel-present', copiedCount: 0, ...outcome };
  }

  fs.mkdirSync(vesselRoot, { recursive: true });
  const copiedCount = copyKnownState(legacyRoot, vesselRoot);

  const outcome = await attemptRecycle(opts.recycle ?? defaultRecycle, legacyRoot);

  return {
    status: 'migrated',
    reason: 'none',
    legacyRoot,
    vesselRoot,
    copiedCount,
    ...outcome,
  };
}