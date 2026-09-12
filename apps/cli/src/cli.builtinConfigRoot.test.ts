import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinConfigRoot, pricingSyncMismatchWarning, warnMissingBuiltinConfig } from './cli.js';

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

/**
 * 3) 开发态**零回归**：`createUsageStore`（usage/成本）、`cmdModels`、`cmdPricing` 三条
 *    读路径本卡起统一取 `builtinConfigRoot()` 再拼 `configs/{pricing,model-catalog}.json`
 *    （改动前是 `repoRoot()`，从 **cwd** 上溯）。开发态 `builtinConfigRoot()` 的 ③ 步命中
 *    仓库根，与 `repoRoot()` **同值**；这里用**真实仓库根**断言两条解析结果逐字一致，
 *    并断言两文件**真实存在**（存在 ⇒ `loadPricing`/`loadModelCatalog` 不会静默降级）。
 *    注：三条读路径是模块内私有函数，无法直接单测调用点，故断言它们共用的解析根。
 */
function canon(p: string): string {
  try {
    return fs.realpathSync(p); // Windows 短路径名（USER~1）与长名归一，避免盘符/短名差异误红
  } catch {
    return path.resolve(p);
  }
}

describe('读路径配置根 = builtinConfigRoot()（开发态与改动前 repoRoot() 同值 + 缺失告警）', () => {
  it('3) 开发态解析到真实仓库根，pricing.json / model-catalog.json 都在（与改动前逐字相同）', () => {
    const root = builtinConfigRoot();
    const before = repoRootFromCwd(); // 改动前 repoRoot() 的口径（独立重算，不共用实现）
    expect(canon(root)).toBe(canon(before));
    for (const name of ['pricing.json', 'model-catalog.json']) {
      const file = path.join(root, 'configs', name);
      expect(fs.existsSync(file)).toBe(true); // 存在 ⇒ 本轮不会新增告警（既有测试的 warn 断言不受影响）
      expect(canon(file)).toBe(canon(path.join(before, 'configs', name)));
    }
  });

  it('4) 默认路径缺失 → warn 含期望路径与提示；不抛、不失败；文件存在 → 负对照不 warn', () => {
    const absent = path.join(tmp, 'no-configs');
    fs.mkdirSync(absent, { recursive: true });
    const seen: string[] = [];
    const warn = (message: string): void => void seen.push(message);
    expect(() => warnMissingBuiltinConfig(absent, 'pricing.json', '价目表降级为兜底价（成本可能算错）。', warn)).not.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(path.join(absent, 'configs', 'pricing.json')); // 期望路径
    expect(seen[0]).toContain('configs 未随包安装'); // 「可能是未安装 configs / 非仓库目录运行」提示
    expect(seen[0]).toContain('命令继续执行');

    const present = seedConfigs(path.join(tmp, 'has-configs'));
    fs.writeFileSync(path.join(present, 'configs', 'pricing.json'), '{"models":{"default":{"input":0.5,"output":1.5}}}', 'utf8');
    const quiet: string[] = [];
    warnMissingBuiltinConfig(present, 'pricing.json', 'x', (message) => void quiet.push(message));
    expect(quiet).toEqual([]); // 负对照：存在即静默
  });
});

/**
 * 5) 写目标判据（Round 20 改语义）：读路径是「**用户态 catalog 优先** →
 *    回落 `builtinConfigRoot()/configs`」，而 `pricing sync` 的**默认写目标**就是用户态目录
 *    （`resolveUsageRoot()`，缺省 `~/.vessel`）。所以判据是「写目录 == 用户态目录吗」：
 *    相同 → 0 条（默认路径零噪音）；不同 → 1 条（写进去最多只是回落层）。
 *    本文件只做**纯函数**表驱动断言（两侧判等 + 文案），不动 `main()`、不起服务。
 *
 *    注意（EVALUATION-REPORT-24 B-⑤ 修正的旧说法）：这里**不是**「真跑 `pricing sync` 必须联网」——
 *    `cli.test.ts` 的 pricing sync 用例用**本地 loopback 替身**当 models.dev，零真实网络。
 *    因此 `cmdPricingSync` 里的**调用点**（写盘前 `if (mismatch !== null) console.warn(mismatch)`）
 *    已由 `cli.test.ts`「pricing sync 调用点：--catalog 与用户态目录不同 → 写盘前恰 1 条 warn；
 *    默认目标 → 0 条」在真跑路径上锁定；本文件的纯函数断言只是判据侧的另一半，**不可**再被
 *    当作「调用点无法覆盖」的理由（否则删掉那两行仍会全绿）。
 */
describe('pricing sync 写目标 vs 用户态目录：相同 → 0 条 warn；不同 → 1 条（Round 20）', () => {
  it('5) 默认目标（用户态目录）→ null；--catalog 指向他处（含包内 configs）→ 文案含两侧路径与补救', () => {
    const userRoot = path.join(tmp, 'user-root'); // 模拟 VESSEL_USAGE_ROOT / ~/.vessel
    fs.mkdirSync(userRoot, { recursive: true });
    const defaultTarget = path.join(userRoot, 'model-catalog.json');
    // 删掉「与用户态目录比较」把它改回「与 builtinConfigRoot()/configs 比较」→ 这条变非 null → RED
    expect(pricingSyncMismatchWarning(defaultTarget, userRoot)).toBeNull(); // 默认路径：写得到就读得到

    const otherTarget = path.join(tmp, 'elsewhere', 'model-catalog.json'); // 目标目录尚不存在（realpathSync 会抛）
    const msg = pricingSyncMismatchWarning(otherTarget, userRoot);
    expect(msg).not.toBeNull();
    expect(msg).toContain(path.resolve(otherTarget)); // 写入的绝对路径
    expect(msg).toContain(userRoot); // 用户态（最高优先级）目录
    expect(msg).toContain('不会被读到'); // 后果
    expect(msg).toContain('--catalog'); // 补救一
    expect(msg).toContain('pricing override'); // 补救二（文案里的旧指引"写入 node_modules 才生效"已删除）

    // 旧判据的"同目录即静默"盲点：写到包内 configs/ 时旧实现判 null，新判据必须 warn
    // （用户态已有 catalog 时，那份包内写入读不到 → 删掉本条即丢失该判别力）
    const builtinTarget = path.join(builtinConfigRoot(), 'configs', 'model-catalog.json');
    expect(pricingSyncMismatchWarning(builtinTarget, userRoot)).not.toBeNull();

    if (process.platform === 'win32') {
      expect(pricingSyncMismatchWarning(defaultTarget, userRoot.toUpperCase())).toBeNull(); // 大小写/短路径归一
    }
  });
});
