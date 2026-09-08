import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

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
 */

/** 已知的 Vessel 用户级状态条目（迁移的复制范围）。 */
export const KNOWN_STATE_ENTRIES = [
  'providers.json',
  'current.json',
  'usage.json',
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
  /** migrated = 已复制 + 已回收；skipped = 无需迁移。 */
  status: 'migrated' | 'skipped';
  reason: 'legacy-absent' | 'vessel-present' | 'none';
  legacyRoot?: string;
  vesselRoot?: string;
  /** 实际复制成功的文件/目录条目数。 */
  copiedCount: number;
  /** 旧目录是否已送进回收站。 */
  recycled: boolean;
  recycleError?: string;
}

/** 默认旧根：~/.dsh。 */
export function defaultLegacyRoot(home = os.homedir()): string {
  return path.join(home, '.dsh');
}

/** 默认新根：~/.vessel。 */
export function defaultVesselRoot(home = os.homedir()): string {
  return path.join(home, '.vessel');
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
 * （删除铁律）；非 Windows 无标准回收站，直接抛错（绝不永久删除），由调用方降级
 * 提示人工处理。
 */
export async function defaultRecycle(dir: string): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error(
      `[vessel migrate] 无法把 ${dir} 送进回收站（当前平台 ${process.platform} 无标准回收站）；` +
        `.vessel 数据已就绪，请手工把旧目录移入回收站，且不要永久删除。`,
    );
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
 * 执行一次性迁移。检测规则：旧根存在 且 新根不存在 才迁移；否则跳过。
 * 复制成功后把旧根送进回收站（失败则保留数据、不永久删除，仅降级提示）。
 */
export async function runVesselMigration(opts: MigrationOptions = {}): Promise<MigrationResult> {
  const legacyRoot = opts.legacyRoot ?? defaultLegacyRoot();
  const vesselRoot = opts.vesselRoot ?? defaultVesselRoot();

  if (!fs.existsSync(legacyRoot)) {
    return { status: 'skipped', reason: 'legacy-absent', copiedCount: 0, recycled: false };
  }
  if (fs.existsSync(vesselRoot)) {
    return { status: 'skipped', reason: 'vessel-present', copiedCount: 0, recycled: false };
  }

  fs.mkdirSync(vesselRoot, { recursive: true });
  const copiedCount = copyKnownState(legacyRoot, vesselRoot);

  const recycle = opts.recycle ?? defaultRecycle;
  let recycled = false;
  let recycleError: string | undefined;
  try {
    await recycle(legacyRoot);
    recycled = true;
  } catch (err) {
    // 数据已复制到 .vessel；回收失败时绝不永久删除，只降级提示。
    recycled = false;
    recycleError = (err as Error).message;
  }

  return {
    status: 'migrated',
    reason: 'none',
    legacyRoot,
    vesselRoot,
    copiedCount,
    recycled,
    ...(recycleError !== undefined ? { recycleError } : {}),
  };
}