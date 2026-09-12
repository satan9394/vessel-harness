import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinConfigRoot } from './cli.js';

/**
 * cli.builtinConfigRoot.test.ts — 内置配置根**查找顺序**的判别性用例：
 * ① 模块目录 ② 模块目录上一级 ③ 模块位置上溯 6 级 ④ 回落 repoRoot()（cwd 上溯）。
 * 安装态 `node_modules/@vessel/cli/dist/cli.js` 曾在 ③④ 全落空后拼出 cwd 下的假路径；
 * 这里用注入的 startDir 构造临时目录树，断言优先级与回落（且不误命中临时目录）。
 */
/** 独立重算「从 cwd 上溯找 configs/policy.default.yaml，否则 cwd」——与实现同口径、不共用代码。 */
function repoRootFromCwd(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'configs', 'policy.default.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** 在 dir 下放一份最小可用策略文件，返回 dir。 */
function seedConfigs(dir: string): string {
  const file = path.join(dir, 'configs', 'policy.default.yaml');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'policy:\n  version: "0.1"\n', 'utf8');
  return dir;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-config-root-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('builtinConfigRoot 查找顺序（包内优先 → 上溯 6 级 → repoRoot 回落）', () => {
  it('1) 模块目录与祖辈目录都有 configs 时，模块目录优先（= 安装态命中包内 dist/configs）', () => {
    const moduleDir = seedConfigs(path.join(tmp, 'pkg')); // 模块目录：自己就带 configs
    seedConfigs(tmp); // 祖辈目录：项目根也有一份（必须输给模块目录）
    expect(builtinConfigRoot(moduleDir)).toBe(moduleDir);
  });

  it('2) 模块目录不带 configs 时走上溯；上溯 6 级内全无则回落 repoRoot()，绝不误命中 cwd 下的假路径', () => {
    const moduleDir = path.join(tmp, 'pkg', 'nested'); // ① ② 落空，靠 ③ 上溯命中
    seedConfigs(tmp);
    expect(builtinConfigRoot(moduleDir)).toBe(tmp);

    // 比 6 级更深、且 6 级内一级都没有 configs → 回落 repoRoot()（= cwd 上溯结果）
    const deep = path.join(tmp, 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7');
    fs.mkdirSync(deep, { recursive: true });
    const fallback = builtinConfigRoot(deep);
    expect(fallback).toBe(repoRootFromCwd());
    expect(fallback.startsWith(tmp)).toBe(false);
  });
});
