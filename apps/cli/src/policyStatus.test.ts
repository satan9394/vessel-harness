import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectPolicyLayers } from '@vessel/policy';
import { main } from './cli.js';

/**
 * policyStatus.test.ts — 策略层次只读检视 + 「部分装载」告警的命令侧验收
 * （Round 15 / BRIEF-15 AC2–AC4，AGENTS.md §7：新功能必须有 Vitest 测试）。
 *
 * 本轮落地了两样东西，此前**零覆盖**：
 *   ① `packages/policy/src/risk/PolicyLoader.ts` 的 `inspectPolicyLayers(opts)`——纯查询，
 *      固定返回 system / project 两项（合成顺序），**绝不抛**；`hash` = 文件真实字节
 *      sha256 十六进制**前 12 位**（AC2：改内容 → 哈希必须变）。
 *   ② `apps/cli/src/cli.ts` 的 `cmdPolicyStatus(flags)`（`--json` 走 `emitJson`）与
 *      `warnPartialPolicyLoad(flags)`（判据 `partialPolicyLayers`：**至少一层
 *      declarationCount > 0 且至少一层 = 0** 才告警；`console.warn` 到 stderr，**不阻断**运行）。
 *
 * **退出码（本卡改判，取代此前的「恒 0」）**：`cmdPolicyStatus` 的判据只有一条 ——
 * `compiled === false`（`compileError` 出现，`vessel run` 在同一组候选路径下会装载失败）
 * ⇒ **退出码 1**；`compiled === true` ⇒ **0**。两类失败（「层文件缺失 / 存在但解析失败」与
 * 「合成后编译失败」）的区别**由 body/文案承载**（逐层诊断行 + `missing` / `invalid` /
 * `compileError`），**不由退出码区分**。改动前两个出口都写死 `return 0` —— 本文件里所有
 * 断言 `toBe(0)` 的**失败场景**用例正是"锁住缺陷"的那几条，本轮按新语义翻转（见各用例注释）。
 *
 * 判别性要点（每条用例都要能真的失败，禁止假绿）：
 *   1. 纯函数四态：缺省/不存在 → `exists:false, 0 条`；合法文件 → `exists:true, ≥1 条, 12 位十六进制 hash`
 *      （并与测试侧独立算出的 sha256 前 12 位**逐字相等**，证明哈希来自真实字节）；
 *      **AC2 判别点**：同一路径写两份不同内容 → `hash1 !== hash2`，再写回第一份 → 哈希**回到** `h1`
 *      （同时排除「哈希是时间戳/随机数」的假实现）；
 *      YAML 非法 / 结构非法 → `exists:true, 0 条, 有 hash` 且 `expect(...).not.toThrow()`。
 *   2. AC3：`main(['policy','status','--json'])` 的 stdout 是一段可解析 JSON，`layers.length === 2`，
 *      且 `effectiveOrder` / `missing` 与**同一份** `layers[].declarationCount` 自洽（自洽断言 +
 *      受控场景的绝对值断言双保险：两层齐备 → `['system','project']` / `[]` 且退出码 0；
 *      两层全缺 → `[]` / `['system','project']` 且 `compiled:false` ⇒ 退出码 1 + 信封同源）。
 *   3. 人类模式：两层路径都出现，且有「生效层序」。
 *   4. **AC4 判别性（带负对照）**：`run` 在「system 缺失（`--policy` 指向不存在的路径）+
 *      project 有声明」时 stderr（warn 通道）出现「部分装载」且**退出码 0**（不阻断，回合照跑）；
 *      **负对照**：不传 `--policy`（两层齐备）时**不出现**「部分装载」——证明该断言不是恒定值。
 *   5. 信封纯净性：`--json` 的 stdout 恰好一段 JSON（首字符 `{`、末字符 `}`、能 `JSON.parse`、
 *      不含人类文案）；`policy <未知子命令>` 走 stderr 信封、非 JSON 走人类文案。
 *   6. **本卡判别点（退出码）**：`compiled:false` ⇒ 非 0，且**失败时 stdout 不缩水**
 *      （仍恰好一段 JSON / 仍含全部逐层诊断行）、`--json` 信封 `code` 与退出码**同源**；
 *      **负对照**：`compiled:true` ⇒ 0，且人类输出**逐字**等于改动前那 6 行、stderr 为空
 *      （证明新判据只加退出码，成功路径一个字节都没动）。
 *
 * 隔离纪律（AGENTS.md §8，照抄 jsonCommands.test.ts / jsonErrorExits.test.ts）：`beforeEach` 建
 * `mkdtempSync` 临时根并把四个状态根指向它，`afterEach` 还原 + 清理——**绝不碰真实 `~/.vessel`**。
 * 额外注入 `VESSEL_MCP_ROOT`（`cmdRun` 会读 `mcp.json`，不隔离就有可能在真实配置有效时真 spawn
 * MCP 子进程）；全程**零网络**（mock 供应商 + `--prompt`，既不读 stdin 也不发请求）。
 */

/**
 * 合法策略（= `configs/policy.default.yaml` 的最小可用子集）：`parsePolicyYaml` 只要求
 * 「能解析出对象」，但 `run` 那条路径会继续走 `compilePolicy`（version/profile/approval 必填），
 * 故这里给全三个字段，保证同一份文本在纯函数与 `run` 两侧都成立。
 */
const POLICY_A = ['policy:', '  version: "0.1"', '  profile: workspace-write', '  approval: never', ''].join('\n');

/** 与 POLICY_A 只差一条 guidance 的**另一份**合法策略——AC2「改内容 → 哈希变」的对照内容。 */
const POLICY_B = [
  'policy:',
  '  version: "0.1"',
  '  profile: workspace-write',
  '  approval: never',
  '  guidance:',
  '    - "B 版策略：比 A 版多一条 guidance（内容变了，哈希必须跟着变）"',
  '',
].join('\n');

/** 语法非法 YAML（未闭合的 flow mapping，js-yaml 必抛）。 */
const INVALID_YAML = '{oops';

/**
 * G-18 判别用策略：逐层解析**完全合法**（1 条声明、无 `error`），但 `shell.deny` 的类别
 * 只有**编译器**认得出是假的 —— `mergeScopes` 会把它并进合成结果，`compilePolicy` 随即抛
 * `policy compile error: unknown shell.deny category "not-a-real-category"`。
 * 即：`inspectPolicyLayers` 说「该层有效」，`loadPolicyArtifacts` 当场炸 —— 这就是口径分裂。
 */
const BAD_SHELL_DENY_POLICY = [
  'policy:',
  '  version: "0.1"',
  '  shell:',
  '    deny: [not-a-real-category]',
  '',
].join('\n');

/** 语法合法但**结构**非法（顶层不是 `policy:` 映射）——走 `parsePolicyYaml` 的同一条 throw 路径。 */
const NOT_A_POLICY_MAPPING = '这只是一个标量，不是 policy 映射';

const ROOT_ENV = [
  'VESSEL_PROVIDER_ROOT',
  'VESSEL_USAGE_ROOT',
  'VESSEL_SETTINGS_ROOT',
  'VESSEL_SESSION_ROOT',
  'VESSEL_MCP_ROOT',
] as const;

/**
 * 仓库内置 system 层的**预期**路径（`apps/cli/src` 上溯三级 = 仓库根）。
 *
 * 仅用于第 8 条（负对照）的 `it.skipIf` 守卫：那条用例刻意**不传** `--policy`，依赖
 * `builtinConfigRoot()/configs/policy.default.yaml` 真实存在。它只在「仓库被剥离 configs/」
 * 这种环境下才需要跳过；守卫条件写死在此，避免静默假绿。
 *
 * 注意：这里**不**用 `process.cwd()` 推导——`builtinConfigRoot()` 是从 CLI 模块自身位置上溯的，
 * 与 cwd 无关；测试文件与 cli.ts 同在 `apps/cli/src`，上溯结果一致。
 */
const DEFAULT_SYSTEM_POLICY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'configs',
  'policy.default.yaml',
);
const HAS_BUILTIN_SYSTEM_POLICY = fs.existsSync(DEFAULT_SYSTEM_POLICY_PATH);

/** `policy status --json` 的文档形状（断言只认这些键，不做多余展开）。 */
interface PolicyStatusDoc {
  layers: { layer: string; path: string; exists: boolean; declarationCount: number; hash?: string }[];
  effectiveOrder: string[];
  missing: string[];
  /** G-18 追加的**合成后可编译性**（additive；既有键的形状/语义不变）。 */
  compiled?: boolean;
  compileError?: string;
}

let tmpRoot: string;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-polstatus-'));
  for (const key of ROOT_ENV) {
    saved.set(key, process.env[key]);
    process.env[key] = tmpRoot;
  }
});

afterEach(() => {
  for (const key of ROOT_ENV) {
    const prev = saved.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * 收集 stdout / stderr / warn（口径照抄 jsonCommands.test.ts）：断言一律用整段文本，
 * `clear()` 让同一用例内的多次 `main()` 调用可以分别断言。
 */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const warn: string[] = [];
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => out.push(a.join(' ')));
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => err.push(a.join(' ')));
  const spyWarn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => warn.push(a.join(' ')));
  return {
    out: () => out.join('\n'),
    err: () => err.join('\n'),
    warn: () => warn.join('\n'),
    clear: () => {
      out.length = 0;
      err.length = 0;
      warn.length = 0;
    },
    restore: () => {
      spyLog.mockRestore();
      spyErr.mockRestore();
      spyWarn.mockRestore();
    },
  };
}

/** 独立地按「文件真实字节」算 sha256 前 12 位（与实现同口径，用来给 hash 断言做交叉验证）。 */
function sha12(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
}

/** 写文件（父目录不存在则建），全部落在临时根内。 */
function writeText(target: string, text: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, 'utf8');
}

describe('policy status / 部分装载（BRIEF-15 AC2–AC4）：走真实 main()', () => {
  it('1) inspectPolicyLayers 纯函数：两路径缺省或不存在 → 两项 exists:false、0 条、无 hash', () => {
    // ① 完全缺省（opts 为空）：仍固定返回 system、project 两项，路径为空串
    const none = inspectPolicyLayers();
    expect(none).toHaveLength(2);
    expect(none.map((l) => l.layer)).toEqual(['system', 'project']);
    expect(none.map((l) => l.path)).toEqual(['', '']);
    expect(none.map((l) => l.exists)).toEqual([false, false]);
    expect(none.map((l) => l.declarationCount)).toEqual([0, 0]);
    expect(none.every((l) => l.hash === undefined)).toBe(true);

    // ② 显式给了路径但文件不存在：路径**如实保留**（便于提示「补齐到哪」），其余同上
    const ghostSystem = path.join(tmpRoot, 'ghost-system.yaml');
    const ghostProject = path.join(tmpRoot, 'ghost-project.yaml');
    const explicit = inspectPolicyLayers({ systemPath: ghostSystem, projectPath: ghostProject });
    expect(explicit.map((l) => l.path)).toEqual([ghostSystem, ghostProject]);
    expect(explicit.map((l) => l.exists)).toEqual([false, false]);
    expect(explicit.map((l) => l.declarationCount)).toEqual([0, 0]);
    expect(explicit.every((l) => l.hash === undefined)).toBe(true);
  });

  it('2) 合法策略文件 → exists:true、declarationCount>=1、hash 为 12 位十六进制且与真实字节同源', () => {
    const sysPath = path.join(tmpRoot, 'sys-policy.yaml');
    const projPath = path.join(tmpRoot, 'ws', '.harness', 'policy.yaml');
    writeText(sysPath, POLICY_A);
    writeText(projPath, POLICY_B);

    const layers = inspectPolicyLayers({ systemPath: sysPath, projectPath: projPath });
    expect(layers.map((l) => l.exists)).toEqual([true, true]);
    expect(layers.map((l) => l.path)).toEqual([sysPath, projPath]);
    // 一个层文件 = 一个 PolicyDeclaration，故合法文件恒为 1 条
    expect(layers.map((l) => l.declarationCount)).toEqual([1, 1]);
    for (const l of layers) expect(l.hash).toMatch(/^[0-9a-f]{12}$/);
    // 交叉验证：哈希确实由文件**真实字节**算出（换实现/换编码都会 RED）
    expect(layers[0]!.hash).toBe(sha12(sysPath));
    expect(layers[1]!.hash).toBe(sha12(projPath));
    // 两份内容不同 → 两个哈希不同（顺带证明哈希不是常量）
    expect(layers[0]!.hash).not.toBe(layers[1]!.hash);
  });

  it('3) 【AC2 判别点】改内容 → hash 变；内容写回原样 → hash 回到原值', () => {
    const target = path.join(tmpRoot, 'mutable-policy.yaml');

    writeText(target, POLICY_A);
    const h1 = inspectPolicyLayers({ systemPath: target })[0]!.hash;
    expect(h1).toMatch(/^[0-9a-f]{12}$/);

    writeText(target, POLICY_B);
    const h2 = inspectPolicyLayers({ systemPath: target })[0]!.hash;
    expect(h2).toMatch(/^[0-9a-f]{12}$/);

    // 判别力前提校验：两份内容确实不同（否则「哈希变」无从谈起）
    expect(POLICY_A).not.toBe(POLICY_B);
    expect(fs.readFileSync(target, 'utf8')).toBe(POLICY_B);

    // 核心判别点：改内容 → 哈希必变（哈希若被实现成常量 / 路径哈希，这里 RED）
    expect(h1).not.toBe(h2);

    // 反向锁：写回第一份内容 → 哈希**回到** h1（排除「哈希掺了 mtime / 随机数」的假实现）
    writeText(target, POLICY_A);
    expect(inspectPolicyLayers({ systemPath: target })[0]!.hash).toBe(h1);
  });

  it('4) YAML 非法 / 结构非法 → exists:true、0 条、仍有 hash，且绝不抛', () => {
    const target = path.join(tmpRoot, 'broken-policy.yaml');

    // ① 语法非法 YAML
    writeText(target, INVALID_YAML);
    expect(() => inspectPolicyLayers({ systemPath: target })).not.toThrow();
    const [syntaxBroken] = inspectPolicyLayers({ systemPath: target });
    expect(syntaxBroken!.exists).toBe(true); // 文件在，就是「在」
    expect(syntaxBroken!.declarationCount).toBe(0); // 解析不出声明 → 0 条，不假装
    expect(syntaxBroken!.hash).toMatch(/^[0-9a-f]{12}$/); // 内容哈希照给（只读事实）
    expect(syntaxBroken!.hash).toBe(sha12(target));

    // ② 语法合法但结构非法（不是 policy 映射）——同一条 catch，同样不抛
    writeText(target, NOT_A_POLICY_MAPPING);
    expect(() => inspectPolicyLayers({ systemPath: target })).not.toThrow();
    const [shapeBroken] = inspectPolicyLayers({ systemPath: target });
    expect(shapeBroken!.exists).toBe(true);
    expect(shapeBroken!.declarationCount).toBe(0);

    // ③ 同路径换成合法内容 → 1 条：证明上面的 0 条是「解析失败」，不是「路径/探测写错了」
    writeText(target, POLICY_A);
    expect(inspectPolicyLayers({ systemPath: target })[0]!.declarationCount).toBe(1);
  });

  it('5) policy status --json（AC3）：layers 恰两项，effectiveOrder / missing 与 declarationCount 自洽', async () => {
    const ws = path.join(tmpRoot, 'ws-full');
    const sysPath = path.join(tmpRoot, 'json-system-policy.yaml');
    const projPath = path.join(ws, '.harness', 'policy.yaml');
    writeText(sysPath, POLICY_A);
    writeText(projPath, POLICY_B);

    const cap = capture();
    try {
      const code = await main(['policy', 'status', '--json', '--workspace', ws, '--policy', sysPath]);
      // 成功的只读查询仍是 0；这里两层齐备且可编译 ⇒ compiled:true（下面对它的翻转见情景 B）
      expect(code).toBe(0);
      expect(cap.err()).toBe('');
      expect((JSON.parse(cap.out()) as PolicyStatusDoc).compiled).toBe(true);

      const doc = JSON.parse(cap.out()) as PolicyStatusDoc;
      expect(doc.layers).toHaveLength(2);
      expect(doc.layers.map((l) => l.layer)).toEqual(['system', 'project']);
      expect(doc.layers.map((l) => l.path)).toEqual([sysPath, projPath]);
      expect(doc.layers.map((l) => l.exists)).toEqual([true, true]);
      expect(doc.layers.map((l) => l.declarationCount)).toEqual([1, 1]);
      for (const l of doc.layers) expect(l.hash).toMatch(/^[0-9a-f]{12}$/);
      expect(doc.layers[0]!.hash).toBe(sha12(sysPath)); // CLI 出口的哈希 = 文件真实字节
      expect(doc.layers[1]!.hash).toBe(sha12(projPath));

      // 自洽断言：两个派生字段必须与同一份 layers[].declarationCount 一致
      expect(doc.effectiveOrder).toEqual(doc.layers.filter((l) => l.declarationCount > 0).map((l) => l.layer));
      expect(doc.missing).toEqual(doc.layers.filter((l) => l.declarationCount === 0).map((l) => l.layer));
      // 受控场景的绝对值：两层齐备 → 层序 system > project、无缺层
      expect(doc.effectiveOrder).toEqual(['system', 'project']);
      expect(doc.missing).toEqual([]);

      // 情景 B：system 指向不存在的路径 + 空工作区 → 两层都缺。
      // 【本卡翻转】旧断言 `expect(code2).toBe(0)`（注释「各层都缺不是错误」）**正是锁住缺陷的那条**：
      // 两层都缺 ⇒ `loadPolicyArtifacts` 抛 `policy loader: no policy declaration found`
      // ⇒ `inspectCombinedPolicy` 给 `compiled:false`（PolicyLoader.ts 的 JSDoc 明说这**同样是
      // `run` 的真实结局**）⇒ 新判据下退出码 1。翻转后**严格更强**：旧断言只查 code + `err === ''`，
      // 新断言在同样的 doc2 自洽/绝对值断言之外，另加 `compiled:false` / `compileError` /
      // 「信封 code 与退出码同源」/「stdout 仍是那段 JSON」四条。
      const emptyWs = path.join(tmpRoot, 'ws-empty');
      fs.mkdirSync(emptyWs, { recursive: true });
      const ghost = path.join(tmpRoot, 'no-such-policy.yaml');
      expect(fs.existsSync(ghost)).toBe(false);

      cap.clear();
      const code2 = await main(['policy', 'status', '--json', '--workspace', emptyWs, '--policy', ghost]);
      expect(code2).toBe(1); // 两层都缺 ⇒ compiled:false ⇒ 非 0（成功的只读查询才保持 0）

      const doc2 = JSON.parse(cap.out()) as PolicyStatusDoc;
      expect(doc2.layers).toHaveLength(2);
      expect(doc2.layers.map((l) => l.exists)).toEqual([false, false]);
      expect(doc2.layers.map((l) => l.declarationCount)).toEqual([0, 0]);
      expect(doc2.layers.every((l) => l.hash === undefined)).toBe(true);
      expect(doc2.effectiveOrder).toEqual(doc2.layers.filter((l) => l.declarationCount > 0).map((l) => l.layer));
      expect(doc2.missing).toEqual(doc2.layers.filter((l) => l.declarationCount === 0).map((l) => l.layer));
      expect(doc2.effectiveOrder).toEqual([]);
      expect(doc2.missing).toEqual(['system', 'project']);
      // 新判据：合成后不可编译（"两层都没有声明"是 run 的真实结局）
      expect(doc2.compiled).toBe(false);
      expect(doc2.compileError).toContain('no policy declaration found');
      // 失败**不缩水** stdout：仍是恰好一段 JSON；失败信封只进 stderr，且 code 与退出码同源
      expect(cap.out().indexOf('{')).toBe(0);
      const envelope2 = JSON.parse(cap.err()) as { error: { message: string; code: number } };
      expect(Object.keys(envelope2)).toEqual(['error']);
      expect(envelope2.error.code).toBe(code2);
      expect(envelope2.error.message).toContain('两层都缺');
    } finally {
      cap.restore();
    }
  });

  it('6) policy status 人类模式：退出码 0，含两层真实路径与「生效层序」', async () => {
    const ws = path.join(tmpRoot, 'ws-human');
    const sysPath = path.join(tmpRoot, 'human-system-policy.yaml');
    const projPath = path.join(ws, '.harness', 'policy.yaml');
    writeText(sysPath, POLICY_A);
    writeText(projPath, POLICY_B);

    const cap = capture();
    try {
      const code = await main(['policy', 'status', '--workspace', ws, '--policy', sysPath]);
      expect(code).toBe(0);

      const text = cap.out();
      expect(text).toContain('[vessel] 生效策略层次');
      expect(text).toContain(sysPath); // system 层路径
      expect(text).toContain(projPath); // project 层路径
      expect(text).toContain('生效层序: system > project');
      expect(text).toContain('缺失说明: 无');
      expect(cap.err()).toBe('');
    } finally {
      cap.restore();
    }
  });

  /**
   * C-4 文案锁（EVALUATION-REPORT-21 R-6）：人类模式的「生效层序」行**不能只锁前缀**
   * `生效层序: system > project`——那样把后半句改回「靠后的层覆盖标量」这类**旧语义**
   * 也不会变红。这里正向锁新语义的关键词（左侧为高层 / deny 类列表取并集 / 低层只能加限制），
   * 反向锁旧文案「靠后的层覆盖」**不得出现**（回潮即 RED）。
   * 只加不减：既有断言（第 6 条的前缀、路径、缺失说明）保持原样，未做任何放宽。
   */
  it('6b) 【C-4 文案锁】人类模式生效层序行含新语义关键词，且不含回潮文案「靠后的层覆盖」', async () => {
    const ws = path.join(tmpRoot, 'ws-human-wording');
    const sysPath = path.join(tmpRoot, 'wording-system-policy.yaml');
    writeText(sysPath, POLICY_A);
    writeText(path.join(ws, '.harness', 'policy.yaml'), POLICY_B);

    const cap = capture();
    try {
      expect(await main(['policy', 'status', '--workspace', ws, '--policy', sysPath])).toBe(0);
      const text = cap.out();

      expect(text).toContain('生效层序: system > project'); // 既有语义不动（前缀）
      expect(text).toContain('左侧为高层'); // 新语义①：合成顺序左侧 = 高层
      expect(text).toContain('deny 类列表取并集'); // 新语义②：列表取并集（不是「后者覆盖」）
      expect(text).toContain('低层只能加限制'); // 新语义③：低层不可放宽
      expect(text).not.toContain('靠后的层覆盖'); // 反向锁：旧文案回潮即 RED
      expect(cap.err()).toBe(''); // 文案走 stdout，未污染 stderr
    } finally {
      cap.restore();
    }
  });

  it('7) 【AC4 判别点】run：project 有声明 + --policy 不存在 → stderr 含「部分装载」且退出码 0（不阻断）', async () => {
    const ws = path.join(tmpRoot, 'ws-run-partial');
    writeText(path.join(ws, '.harness', 'policy.yaml'), POLICY_A);
    const ghostSystem = path.join(tmpRoot, 'missing-system-policy.yaml');
    expect(fs.existsSync(ghostSystem)).toBe(false);

    const cap = capture();
    try {
      // mock 供应商（临时根里没有 current.json）+ 显式 --prompt：零网络、不读 stdin
      const code = await main(['run', '--workspace', ws, '--prompt', 'hi', '--policy', ghostSystem]);

      expect(code).toBe(0); // 告警**不阻断**：部分装载仍按现有层继续运行
      expect(cap.warn()).toContain('部分装载'); // 走 stderr 的 warn 通道
      expect(cap.warn()).toContain('system'); // 缺的是 system 层（明确指认，不是泛指）
      // 回合真的跑完了（不是"告警后静默退出"）：stdout 有最终回复与 mock 文本
      expect(cap.out()).toContain('=== 最终回复 ===');
      expect(cap.out()).toContain('mock 离线冒烟');
    } finally {
      cap.restore();
    }
  });

  it.skipIf(!HAS_BUILTIN_SYSTEM_POLICY)(
    '8) 【AC4 负对照】run：不传 --policy（两层齐备）→ 不出现「部分装载」（证明第 7 条不是恒定值）',
    async () => {
      const ws = path.join(tmpRoot, 'ws-run-full');
      writeText(path.join(ws, '.harness', 'policy.yaml'), POLICY_A);

      const cap = capture();
      try {
        // 前提校验：不带 --policy 时 system 层解析到仓库内置 configs/policy.default.yaml 且**存在**
        // （若这里为 false，说明环境缺少内置配置，第 7/8 条的对照关系不成立——守卫已用 skipIf 兜住）
        const pre = await main(['policy', 'status', '--json', '--workspace', ws]);
        expect(pre).toBe(0);
        const preDoc = JSON.parse(cap.out()) as PolicyStatusDoc;
        // 用 endsWith 而不是全等：断言的是「缺省 system 层落到仓库内置 configs/policy.default.yaml」
        // 这一语义，不把 builtinConfigRoot() 从模块位置上溯的绝对路径写死（盘符/短路径名差异不该 RED）
        expect(preDoc.layers[0]!.path.endsWith(path.join('configs', 'policy.default.yaml'))).toBe(true);
        expect(preDoc.layers[0]!.exists).toBe(true);
        expect(preDoc.layers[0]!.declarationCount).toBeGreaterThan(0);

        cap.clear();
        const code = await main(['run', '--workspace', ws, '--prompt', 'hi']);
        expect(code).toBe(0);
        // 负对照：两层都有声明 → partialPolicyLayers 为空 → 不得告警
        expect(cap.warn()).not.toContain('部分装载');
        // 与第 7 条同样的「回合真的跑完了」证据（两例唯一变量就是 system 层在不在）
        expect(cap.out()).toContain('=== 最终回复 ===');
        expect(cap.out()).toContain('mock 离线冒烟');
      } finally {
        cap.restore();
      }
    },
  );

  it('9) 信封纯净性：--json 的 stdout 恰好一段 JSON；人类模式不是合法 JSON', async () => {
    const ws = path.join(tmpRoot, 'ws-envelope');
    const sysPath = path.join(tmpRoot, 'envelope-system-policy.yaml');
    writeText(sysPath, POLICY_A);

    const cap = capture();
    try {
      expect(await main(['policy', 'status', '--json', '--workspace', ws, '--policy', sysPath])).toBe(0);
      const text = cap.out();

      // 「只有一段 JSON」：首字符是 {、末字符是 }、整段可解析，且不含人类文案
      expect(text.indexOf('{')).toBe(0);
      expect(text.lastIndexOf('}')).toBe(text.length - 1);
      expect(() => JSON.parse(text)).not.toThrow();
      expect(text.trim().startsWith('{')).toBe(true);
      expect(text.trim().endsWith('}')).toBe(true);
      expect(text).not.toContain('[vessel]');
      expect(cap.err()).toBe('');

      // 对照：同一状态下不带 --json → 人类文案，**不是**可解析 JSON（两模式没串）
      cap.clear();
      expect(await main(['policy', 'status', '--workspace', ws, '--policy', sysPath])).toBe(0);
      expect(cap.out()).toContain('[vessel] 生效策略层次');
      expect(() => JSON.parse(cap.out())).toThrow();
      expect(cap.err()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('10) 唯一失败出口：policy <未知子命令> 非 0，--json 走 stderr 信封、非 JSON 走人类文案', async () => {
    const cap = capture();
    try {
      const code = await main(['policy', 'bogus', '--json']);
      expect(code).not.toBe(0); // 失败不能伪装成成功（该出口来自 dispatch，不是 cmdPolicyStatus 自身）
      expect(code).toBe(2);
      expect(cap.out()).toBe(''); // 信封只进 stderr，stdout 一次都没被写
      const doc = JSON.parse(cap.err()) as { error: { message: string; code: number } };
      expect(Object.keys(doc)).toEqual(['error']);
      expect(doc.error.code).toBe(2);
      expect(doc.error.message).toBe('未知 policy 子命令 bogus。可用：vessel policy status');

      // 负对照：去掉 --json → 同一句人类文案落在 stderr，且不是合法 JSON
      cap.clear();
      expect(await main(['policy', 'bogus'])).toBe(2);
      expect(cap.out()).toBe('');
      expect(cap.err()).toBe('未知 policy 子命令 bogus。可用：vessel policy status');
      expect(() => JSON.parse(cap.err())).toThrow();
    } finally {
      cap.restore();
    }
  });

  /**
   * 【本卡判别点 A】合成后不可编译 ⇒ **非 0**（改动前恒 0）。
   *
   * 「删掉修复就红」：把 `cmdPolicyStatus` 的两个出口改回 `return 0`（或删掉
   * `compileFailure === null ? 0 : fail(1, …)` 里的 `fail` 分支）⇒ 本用例的
   * `expect(code).toBe(1)` 与 `expect(humanCode).toBe(1)` 立刻变 0 ⇒ RED。
   *
   * 翻转后**不弱于旧断言**（逐条对照）：
   *   - 旧：`toBe(0)` ⇒ 新：`toBe(1)`（非 0 且与 `vessel run` 的码同源；同时锁住"不是 2"——
   *     2 在本 CLI 留给用法/校验错误）。
   *   - 旧：`cap.err()).toBe('')` ⇒ 新：stderr **必须是**同源信封（`JSON.parse` 硬断言 + `code`
   *     逐字等于退出码）——比"空"更强：它要求失败**有可见出口**，而不是静默退非 0。
   *   - 旧：`cap.out()` 首尾 `{}`、`compiled:false`、`compileError` ⇒ 新：**全部保留**。
   *   - 新加：人类模式 stdout 仍含全部诊断行（`缺失说明: 无（各层均已装载）。`）+
   *     失败说明落在 stderr 且**不是**合法 JSON（非 JSON 模式没有被顺手改成信封）。
   */
  it('11) 【判别点】合成后不可编译（shell.deny 未知类别）：逐层全绿 / compiled:false / 退出码 1 / 诊断行一条不少', async () => {
    const ws = path.join(tmpRoot, 'ws-compile-bad');
    const sysPath = path.join(tmpRoot, 'compile-system-policy.yaml');
    writeText(sysPath, POLICY_A);
    writeText(path.join(ws, '.harness', 'policy.yaml'), BAD_SHELL_DENY_POLICY);

    const cap = capture();
    try {
      // 【本卡翻转】旧断言此处是 `toBe(0)`（注释「只读查询恒 0」）——那正是锁住缺陷的一条。
      const code = await main(['policy', 'status', '--json', '--workspace', ws, '--policy', sysPath]);
      expect(code).toBe(1);
      const text = cap.out();
      expect(text.indexOf('{')).toBe(0); // 单一 JSON 信封（既有纪律不变，失败也不缩水）
      expect(text.lastIndexOf('}')).toBe(text.length - 1);
      const doc = JSON.parse(text) as PolicyStatusDoc;
      // 分裂点本身：逐层事实说「两层都有效」——修复前这就是终点（"看着配了其实没配"）
      expect(doc.effectiveOrder).toEqual(['system', 'project']);
      expect(doc.missing).toEqual([]);
      // 新判据：真实装载路径（mergeScopes → compilePolicy）在同一输入下**抛**
      expect(doc.compiled).toBe(false);
      expect(doc.compileError).toContain('unknown shell.deny category');

      // 退出码与 `--json` 信封**同源**（既有 `fail` 出口）：信封只进 stderr，stdout 仍是那段文档
      const envelope = JSON.parse(cap.err()) as { error: { message: string; code: number } };
      expect(Object.keys(envelope)).toEqual(['error']);
      expect(envelope.error.code).toBe(code);
      // 文案承载「两类失败」的区别（第一类：层文件缺失/解析失败；第二类：合成后编译失败）
      expect(envelope.error.message).toContain('unknown shell.deny category');
      expect(envelope.error.message).toContain('两类不同的失败');
      expect(envelope.error.message).toContain('vessel run');

      // 人类模式：同样非 0；诊断行**一条不少**（退出码裁决不改渲染），失败说明走 stderr 人话
      cap.clear();
      const humanCode = await main(['policy', 'status', '--workspace', ws, '--policy', sysPath]);
      expect(humanCode).toBe(1);
      const human = cap.out();
      expect(human).toContain('生效层序: system > project'); // 逐层行仍在（新旧信息并列，不是二选一）
      expect(human).toContain('无法编译');
      expect(human).toContain('unknown shell.deny category');
      expect(human).toContain('vessel run'); // 说清后果，而不是只丢一个错误串
      expect(human).toContain('缺失说明: 无（各层均已装载）。'); // 逐层层面一切正常，如实并列
      expect(cap.err()).toContain('合成策略无法编译');
      expect(() => JSON.parse(cap.err())).toThrow(); // 非 JSON 模式仍是人话，不是信封
    } finally {
      cap.restore();
    }
  });

  /**
   * 【本卡判别点 A · 第二类失败】层文件**存在但无法解析**：与上一条是**不同的成因**，
   * 但**退出码相同（1）** —— 这正是裁决说的"两类失败的区别由 body/文案承载，不靠退出码区分"。
   *
   * 「删掉修复就红」：删掉 `fail(1, …)` ⇒ 本用例 `toBe(1)` 变 0 ⇒ RED；
   * 把成因前缀写死成「合成后编译失败（只有编译器才认得出的错误）」⇒ `toContain('project 层存在但无法解析')` RED。
   */
  it('11b) 【判别点】层文件存在但无法解析：成因不同、退出码同为 1，成因由文案/字段承载', async () => {
    const ws = path.join(tmpRoot, 'ws-layer-broken');
    const sysPath = path.join(tmpRoot, 'layer-broken-system-policy.yaml');
    writeText(sysPath, POLICY_A);
    writeText(path.join(ws, '.harness', 'policy.yaml'), INVALID_YAML);

    const cap = capture();
    try {
      const code = await main(['policy', 'status', '--json', '--workspace', ws, '--policy', sysPath]);
      expect(code).toBe(1);
      const doc = JSON.parse(cap.out()) as PolicyStatusDoc & { invalid: { layer: string; error?: string }[] };
      // 逐层事实照旧区分「缺失」与「存在但无效」（既有字段形状不变）
      expect(doc.invalid.map((l) => l.layer)).toEqual(['project']);
      expect(doc.invalid[0]!.error).toBeTruthy();
      expect(doc.missing).toEqual(['project']);
      expect(doc.compiled).toBe(false);

      const envelope = JSON.parse(cap.err()) as { error: { message: string; code: number } };
      expect(envelope.error.code).toBe(code);
      // 成因前缀正确指认"存在但无法解析"（不是"两层都缺"，也不是"只有编译器才认得出的错误"）
      expect(envelope.error.message).toContain('project 层存在但无法解析');
      expect(envelope.error.message).not.toContain('只有编译器才认得出的错误');

      // 对照：另一类成因（shell.deny 未知类别）用的是**另一句**成因前缀 —— 两类真的被区分了
      const ws2 = path.join(tmpRoot, 'ws-compiler-only');
      writeText(path.join(ws2, '.harness', 'policy.yaml'), BAD_SHELL_DENY_POLICY);
      cap.clear();
      expect(await main(['policy', 'status', '--json', '--workspace', ws2, '--policy', sysPath])).toBe(1);
      const envelope2 = JSON.parse(cap.err()) as { error: { message: string } };
      expect(envelope2.error.message).toContain('只有编译器才认得出的错误');
      expect(envelope2.error.message).not.toContain('层存在但无法解析');
    } finally {
      cap.restore();
    }
  });

  /**
   * 【本卡判别点 A 的负对照，最重要】`compiled === true` ⇒ 退出码 **0**，且人类输出
   * **逐字**等于改动前那 6 行、stderr **为空**。防"总是非零"/"顺手多打一行"——
   * 那会让所有正常仓库红灯，与缺陷正好相反。
   *
   * 逐字期望值来源（不是手抄猜的）：`cmdPolicyStatus` 的五条 `console.log`（cli.ts 的
   * 首行/逐层行/生效层序行/合成校验行/缺失说明行）+ 测试侧独立算出的 `sha12`；逐层行按
   * `  ${layer.padEnd(7)} ${state}  声明 N 条  ${hash}  ${where}${note}` 拼出。
   * 因此任何对成功路径渲染的改动（措辞、顺序、多打/少打一行、padEnd）都会 RED ——
   * 这就是"输出逐字不变"的可执行形式。
   *
   * 「删掉修复就红」：把 `compiled === true` 也接进 `fail(...)`（无条件退 1）⇒ `toBe(0)` RED；
   * 在成功路径上多写一行 stderr / 改动任何一行文案 ⇒ 逐字比对 RED。
   */
  it('12) 【负对照】同一条管线只换 deny 类别（合法）→ compiled:true、退出码 0、人类输出逐字不变、stderr 为空', async () => {
    const ws = path.join(tmpRoot, 'ws-compile-ok');
    const sysPath = path.join(tmpRoot, 'ok-system-policy.yaml');
    const projPath = path.join(ws, '.harness', 'policy.yaml');
    writeText(sysPath, POLICY_A);
    writeText(
      projPath,
      ['policy:', '  version: "0.1"', '  shell:', '    deny: [destructive-delete]', ''].join('\n'),
    );

    const cap = capture();
    try {
      expect(await main(['policy', 'status', '--json', '--workspace', ws, '--policy', sysPath])).toBe(0);
      expect(cap.err()).toBe(''); // 成功路径不新增任何 stderr 输出
      const doc = JSON.parse(cap.out()) as PolicyStatusDoc;
      expect(doc.compiled).toBe(true); // 与第 11 条唯一变量是 deny 类别 → compiled 必须翻面（证明它不是恒定值）
      expect(doc.compileError).toBeUndefined();
      expect(cap.out()).not.toContain('compileError'); // 成功时该键整个不出现

      cap.clear();
      expect(await main(['policy', 'status', '--workspace', ws, '--policy', sysPath])).toBe(0);
      // 逐字（不是 toContain）：成功路径的渲染一个字节都不许动
      expect(cap.out()).toBe(
        [
          '[vessel] 生效策略层次（policy layers，只读）',
          `  system  存在  声明 1 条  sha256:${sha12(sysPath)}  ${sysPath}`,
          `  project 存在  声明 1 条  sha256:${sha12(projPath)}  ${projPath}`,
          '  生效层序: system > project（左侧为高层：profile/approval 取高层先声明者；deny 类列表取并集；低层只能加限制、不能放宽）',
          '  合成校验: 可编译（与 vessel run 的装载路径同一套 mergeScopes → compilePolicy）',
          '  缺失说明: 无（各层均已装载）。',
        ].join('\n'),
      );
      expect(cap.out()).not.toContain('无法编译');
      expect(cap.err()).toBe('');
    } finally {
      cap.restore();
    }
  });
});
