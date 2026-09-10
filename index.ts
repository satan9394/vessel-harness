/**
 * Composable Agent Harness — 根包发布入口（task 112）。
 *
 * 根包是 private 壳包（不发布），但必须有真实的最小分发面：本文件经
 * `npm run build:release`（`tsc -p tsconfig.release.json`）单文件编译为根
 * `dist/index.js` + `dist/index.d.ts`——**不是伪造空壳**：
 *  - `version` / `packageMetadata` 运行时读根 package.json（createRequire），版本号诚实对齐，
 *    不硬编码；
 *  - `cliEntry` 引用真实 CLI 包 `@vessel/cli`（bin=vessel），`cliEntryReady()` 运行时探测
 *    dev 源 / build 产物是否存在，供工具链判断 CLI 是否可就绪启动。
 *
 * 意义：packaging gate（npm pack --dry-run + 根 dist/ + dist/index.js）因此如实通过；
 * 潜在的 monorepo 根发布 / 工具链也得到确定性入口契约。保持自包含（仅 node: 内置模块），
 * 单文件 tsc 编译不拉子包依赖图。
 *
 * 实现注：版本/元数据用 `fs` 运行时读取根 package.json（不用 `require('../package.json')`——
 * vitest（vite-node）的 module runner 不能 require 不在模块图里的 JSON；fs 读写兼容
 * 源码态与 dist 构建态两种形态）。
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 根包元数据（与根 package.json 字段一一对应）。 */
export interface RootPackageMetadata {
  name: string;
  version: string;
  description: string;
  private: boolean;
}

interface RootPackageJsonLike {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  private?: unknown;
}

/**
 * 运行时读取根 package.json：源码态 index.ts 与 package.json 同目录；
 * 构建态 dist/index.js 的上级目录即仓库根。
 */
function loadRootPackageJson(): RootPackageMetadata {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, 'package.json'), path.join(here, '..', 'package.json')];
  for (const file of candidates) {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as RootPackageJsonLike;
      return {
        name: String(raw.name ?? ''),
        version: String(raw.version ?? ''),
        description: String(raw.description ?? ''),
        private: raw.private === true,
      };
    }
  }
  throw new Error(`root package.json not found (searched: ${candidates.join(', ')})`);
}

const pkg: RootPackageMetadata = loadRootPackageJson();

/** 根包元数据（运行时读取，非硬编码）。 */
export const packageMetadata: RootPackageMetadata = {
  name: String(pkg.name ?? ''),
  version: String(pkg.version ?? ''),
  description: String(pkg.description ?? ''),
  private: pkg.private === true,
};

/** 语义版本号（与根 package.json version 保持一致，运行时读取）。 */
export const version: string = packageMetadata.version;

/**
 * CLI 入口引用（真实包 @vessel/cli，bin=vessel）：
 * - `devSource`：开发态入口（`npx tsx apps/cli/src/cli.ts`）；
 * - `builtArtifact`：`npm run build`（tsc -b）后的构建态产物（dist/cli.js）。
 */
export const cliEntry = {
  package: '@vessel/cli',
  bin: 'vessel',
  devSource: 'apps/cli/src/cli.ts',
  builtArtifact: 'apps/cli/dist/cli.js',
} as const;

export type CliEntry = typeof cliEntry;

/** 仓库根绝对路径：本模块所在目录含 package.json（源码态=根）→ 根；否则（dist 构建态）取上级。 */
function resolveRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return existsSync(path.join(here, 'package.json')) ? here : path.resolve(here, '..');
}

/**
 * CLI 入口就绪检查：dev 源或 build 产物至少一个存在（真实文件系统探测）。
 * @returns ready=是否可就绪；checked=探测过的绝对路径清单（供诊断）。
 */
export function cliEntryReady(): { ready: boolean; checked: string[] } {
  const root = resolveRepoRoot();
  const checked = [
    path.join(root, cliEntry.devSource),
    path.join(root, cliEntry.builtArtifact),
  ];
  return { ready: checked.some((c) => existsSync(c)), checked };
}