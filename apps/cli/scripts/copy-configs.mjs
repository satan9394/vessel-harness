#!/usr/bin/env node
/**
 * copy-configs.mjs — 把**仓库根** `configs/` 整份复制进**包内** `apps/cli/dist/configs/`。
 *
 * 为什么需要：`builtinConfigRoot()`（apps/cli/src/cli.ts）在安装态（`node_modules/@vessel/cli/
 * dist/cli.js`）向上 6 级也找不到 `configs/`（它只存在于仓库根），默认 policy / behavior IR /
 * pricing / model-catalog 会退化成 cwd 下的假路径。把 configs 随 dist 一起入包（`files: ["dist"]`）
 * 后，① 号查找分支即可命中「包内自带的那份」，与 cwd 无关。
 *
 * 约束与性质：
 *   - **零依赖**：只用 node: 内置模块，不读 package.json、不装包；
 *   - **与 cwd 无关**：全部路径由 `import.meta.url`（本脚本位置）相对推导
 *     （scripts/ → apps/cli → apps → 仓库根）；
 *   - **幂等**：`cpSync(..., { recursive: true, force: true })` 覆盖式复制，重复跑不报错、
 *     结果一致（**不删除** dist/configs 下的多余文件，不做任何永久删除）；
 *   - 成功打印一行摘要 + 逐个文件清单；仓库根缺 `configs/policy.default.yaml` 时 fail loud（exit 1）。
 *
 * 调用点：`apps/cli/package.json` 的 `build`（tsc -b 之后）与 `prepack`（打 tarball 之前）。
 * 注意：仓库根的总构建 `npx tsc -b tsconfig.json` **不经过**本包的 `build` 脚本，若要保证
 * 「整仓构建 → npm pack」也带上 configs，需在根 package.json 的 build 里显式串联本脚本。
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url)); // <repo>/apps/cli/scripts
const packageDir = resolve(scriptDir, '..'); // <repo>/apps/cli
const repoRootDir = resolve(packageDir, '..', '..'); // <repo>
const sourceDir = join(repoRootDir, 'configs'); // <repo>/configs
const targetDir = join(packageDir, 'dist', 'configs'); // <repo>/apps/cli/dist/configs

/** 递归列出文件，返回相对 sourceDir 的 POSIX 风格路径（跨平台稳定的摘要口径）。 */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

if (!existsSync(join(sourceDir, 'policy.default.yaml'))) {
  console.error(`[copy-configs] 找不到仓库内置配置目录：${sourceDir}（期望含 policy.default.yaml）`);
  process.exit(1);
}

const files = listFiles(sourceDir).sort();
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });

const show = (p) => relative(repoRootDir, p).split(sep).join('/');
console.log(`[copy-configs] 已复制 ${files.length} 个文件：${show(sourceDir)}/ → ${show(targetDir)}/（幂等，可重复执行）`);
for (const file of files) console.log(`  · ${file}`);
