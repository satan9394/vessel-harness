import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main } from './cli.js';

/**
 * jsonErrorExits.test.ts — `--json` **失败出口**的命令侧验收（Round 14 切片 A，AGENTS.md §7）。
 *
 * 背景：`cli.ts` 原先约 57 处命令失败出口写的是 `console.error(msg); return N;`——`--json`
 * 模式下用户拿到的是**人类文案**，stdout/stderr 都不是可解析文档。切片 A 把它们统一改成
 * `return fail(N, msg, flags, () => console.error(msg));`（`fail` 见 `cli/output.ts`）：
 *   - `--json`：stderr 打 `{"error":{"message","code"}}`，stdout 保持为空；
 *   - 非 `--json`：走 human 闭包，输出**逐字不变**。
 *
 * 本文件补的是这一层的**命令侧**覆盖（此前只有 `output.ts` 自身有单测，出口改造零覆盖）。
 * 风格照抄 `jsonCommands.test.ts`：一律走真实 `main(argv)`，`console.*` 全程 spy，
 * 四个状态根 + `VESSEL_MCP_ROOT` 全部注入 `mkdtempSync` 临时目录，`afterEach` 还原并清理。
 *
 * 判别性要点（每条用例都要能真的失败）：
 *   1. **主用例**：`provider set`（缺 id）+ `--json` → 退出码 2、stdout 为空、stderr 能被
 *      `JSON.parse` 成 `{error:{message,code}}`。**若该出口未改造**，stderr 是人类用法文案，
 *      `JSON.parse` 必抛 → RED（所以断言里显式写了 `JSON.parse`，不用宽松 `toContain`）。
 *   2. **负对照**：同一条命令、同一参数、去掉 `--json` → stderr 人类文案**逐字**等于常量
 *      （回归锁），且不是合法 JSON、stdout 同样为空。
 *   3. **多行出口**：`provider set` / `provider export --with-secrets` 原本逐行打印用法块 →
 *      `--json` 下 `message` 含 `\n`（多行以换行连接），非 JSON 下**逐行**输出（split 成数组比对）。
 *   4. **信封纯净性**：所有 `--json` 失败出口的 `stdout.trim() === ''`（信封只打一次、且只进 stderr）。
 *   5. **参数合法但前置条件缺失**：`models --provider ghost`（登记表里没有该 provider）与
 *      `run` + 损坏的 `mcp.json`（配置本身坏了、fail-loud）——两条都**零网络、零真实状态写入**。
 *
 * 非 JSON 原文常量的来源说明（本轮无法跑 git，故按「改造语义」确认）：切片 A 的改造是
 * **机械替换**——`console.error(msg); return N;` ↔ `fail(N, msg, flags, () => console.error(msg))`。
 * 因此常量逐字取自 `cli.ts` 里 human 闭包**本体**（`() => console.error(msg)` 的 msg、
 * 多行分支 `for (const msgLine of msgLines) console.error(msgLine)` 的 msgLines 数组），
 * 该闭包即改造前那两行的原样复现；本文件把它锁成常量，一旦 human 分支被改写就会 RED。
 * 旁证：`cli.test.ts:636`（bench-report 缺 --input）与 `cli.test.ts:1126`（--with-secrets 不支持）
 * 在改造前就已断言过这两条人类文案，本轮未改动它们——两条常量必须同时满足新旧两处断言。
 *
 * 隔离纪律（AGENTS.md §8）：`VESSEL_PROVIDER_ROOT` / `VESSEL_USAGE_ROOT` / `VESSEL_SETTINGS_ROOT` /
 * `VESSEL_SESSION_ROOT` 之外**额外**注入 `VESSEL_MCP_ROOT`——`cmdRun` 会读 `mcp.json`，
 * 不隔离就可能在真实 `~/.vessel/mcp.json` 有效时**真的 spawn MCP 子进程**。
 */

/** 改造前原文（逐字回归锁）：`provider set` 缺 id 的两行用法块。 */
const PROVIDER_SET_USAGE = [
  '用法: vessel provider set <id> [--name <显示名>] [--model <model>] [--base-url <url>] [--api-key <key>] [--cost-multiplier <n>]',
  '  --cost-multiplier：成本倍率（只乘总额，不改分项单价；缺省 1；<0 或非数字报错）',
].join('\n');

/** 改造前原文（逐字回归锁）：`provider export --with-secrets` 的三行拒绝文案。 */
const PROVIDER_EXPORT_WITH_SECRETS = [
  '[vessel provider export] --with-secrets 不支持：本项目没有任何「明文导出」路径（导出只写 secretRef 占位）。',
  '  迁移密钥请整体搬运 ~/.vessel（含 DPAPI 加密的 secrets.json），或在新机器执行',
  '  `vessel provider set <id> --api-key <key>` 重新录入（经 CredentialStore 加密落盘）。',
].join('\n');

/** 改造前原文（逐字回归锁）：`provider <未知子命令>`。 */
const PROVIDER_UNKNOWN_SUB = '[vessel] 未知 provider 子命令 "zzz"（可用: list/add/set/remove/switch/use/current/export/import/endpoint）';

/** 改造前原文（逐字回归锁）：`models --provider ghost`（登记表里没有该 provider）。 */
const MODELS_UNKNOWN_PROVIDER = '[vessel] provider "ghost" 不存在（vessel provider list 查看；vessel provider add 添加）';

/** 改造前原文（逐字回归锁）：`bench-report` 缺 `--input`。 */
const BENCH_REPORT_NO_INPUT = '[vessel] bench-report 需要 --input <runResults.json>（076 RunResult[] 或 082 lane report JSON）';

/** 改造前原文（逐字回归锁）：`usage recompute --since <非法日期>`。 */
const USAGE_RECOMPUTE_BAD_SINCE = '[vessel usage recompute] --since 需要本地日 YYYY-MM-DD（收到 "not-a-date"）。';

/** 改造前原文（逐字回归锁）：`sessions <未知子命令>`。 */
const SESSIONS_UNKNOWN_SUB = '未知 sessions 子命令 bogus。可用：vessel sessions list';

/** 改造前原文（逐字回归锁）：`run --provider anthropic` 但没有 base-url（provider 名是插值的）。 */
const RUN_MISSING_BASE_URL = '[vessel] anthropic 需要 --base-url 或 VESSEL_BASE_URL（或先 vessel provider add 配置）';

const ROOT_ENV = [
  'VESSEL_PROVIDER_ROOT',
  'VESSEL_USAGE_ROOT',
  'VESSEL_SETTINGS_ROOT',
  'VESSEL_SESSION_ROOT',
  'VESSEL_MCP_ROOT',
] as const;

let tmpRoot: string;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-jsonexit-'));
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
 * 收集 stdout / stderr / warn。口径与 `jsonCommands.test.ts` 的 `capture()` 一致：
 * `main()` 与 `fail()` 都走 `console.*`，断言用 `spy.mock.calls.flat().join('\n')`。
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

type Cap = ReturnType<typeof capture>;

/**
 * `--json` 失败出口的判别性断言：stderr **必须**是一段可解析 JSON，且形状恰为
 * `{error:{message,code}}`、`code` 与 `fail()` 传入的退出码同源、`message` 逐字等于原文。
 *
 * `JSON.parse` 是硬断言：出口若未走 `fail()`（仍是 human 文案），这里必抛 → 用例 RED。
 */
function expectErrorEnvelope(cap: Cap, exitCode: number, expectedMessage: string): void {
  const doc = JSON.parse(cap.err()) as { error: { message: string; code: number } };
  expect(Object.keys(doc)).toEqual(['error']);
  expect(Object.keys(doc.error).sort()).toEqual(['code', 'message']);
  expect(typeof doc.error.message).toBe('string');
  expect(doc.error.message.trim().length).toBeGreaterThan(0);
  expect(doc.error.code).toBe(exitCode);
  expect(doc.error.message).toBe(expectedMessage);
}

/**
 * 负对照断言：非 `--json` 时 stderr 是人类文案、**逐字**等于改造前原文，且**不是**合法 JSON
 * （后者是「human 分支没有被顺手改成信封」的反向锁）。
 */
function expectHumanStderr(cap: Cap, expectedHumanText: string): void {
  expect(cap.err()).toBe(expectedHumanText);
  expect(() => JSON.parse(cap.err())).toThrow();
}

describe('--json 失败出口（Round 14 切片 A）：走真实 main()', () => {
  it('1) 主用例（判别性）：provider set 缺 id + --json → 退出码 2、stdout 为空、stderr 是可解析信封', async () => {
    const cap = capture();
    try {
      const code = await main(['provider', 'set', '--json']);

      expect(code).not.toBe(0); // 失败不能伪装成成功
      expect(code).toBe(2); // 与 fail(2, ...) 的「原本的码」一致

      // 信封纯净性：stdout 一次都没有被写（不是空白而是空串）
      expect(cap.out()).toBe('');
      expect(cap.out().trim()).toBe('');

      // 判别点：JSON.parse 必成功——出口未改造时这里是人类用法文案，必抛
      expectErrorEnvelope(cap, 2, PROVIDER_SET_USAGE);

      // 多行用法块以 \n 连接进 message（原 human 分支是逐行 console.error）
      const parsed = JSON.parse(cap.err()) as { error: { message: string } };
      expect(parsed.error.message).toContain('\n');
      expect(parsed.error.message.split('\n')).toHaveLength(2);
    } finally {
      cap.restore();
    }
  });

  it('2) 负对照（非 JSON 回归锁）：同一条命令、同一参数、去掉 --json → 人类文案逐行逐字不变', async () => {
    const cap = capture();
    try {
      const code = await main(['provider', 'set']);
      expect(code).toBe(2);

      // 回归锁：逐字相等（任何改写 human 分支的改动都会 RED）
      expectHumanStderr(cap, PROVIDER_SET_USAGE);
      // 逐行输出（不是一行 join 后的整体）：split 出来正好是原文两行
      expect(cap.err().split('\n')).toEqual(PROVIDER_SET_USAGE.split('\n'));
      // stdout 行为不变：原本这些出口就不写 stdout
      expect(cap.out()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('3) 多行出口 provider export --with-secrets：--json message 含 \\n；非 JSON 逐行原文', async () => {
    const cap = capture();
    try {
      const code = await main(['provider', 'export', '--with-secrets', '--json']);
      expect(code).toBe(2);
      expect(cap.out().trim()).toBe('');

      expectErrorEnvelope(cap, 2, PROVIDER_EXPORT_WITH_SECRETS);
      const doc = JSON.parse(cap.err()) as { error: { message: string } };
      expect(doc.error.message).toContain('\n');
      expect(doc.error.message.split('\n')).toHaveLength(3);

      // 对照：同参数去掉 --json → 逐行打印、逐字等于原文
      cap.clear();
      expect(await main(['provider', 'export', '--with-secrets'])).toBe(2);
      expectHumanStderr(cap, PROVIDER_EXPORT_WITH_SECRETS);
      expect(cap.err().split('\n')).toEqual(PROVIDER_EXPORT_WITH_SECRETS.split('\n'));
      expect(cap.out()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('4) 信封纯净性：七条 --json 失败出口的 stdout 全为空串，且 stderr 各是一段可解析文档', async () => {
    const cases: { argv: string[]; code: number; human: string }[] = [
      { argv: ['provider', 'set', '--json'], code: 2, human: PROVIDER_SET_USAGE },
      { argv: ['provider', 'export', '--with-secrets', '--json'], code: 2, human: PROVIDER_EXPORT_WITH_SECRETS },
      { argv: ['provider', 'zzz', '--json'], code: 2, human: PROVIDER_UNKNOWN_SUB },
      { argv: ['models', '--provider', 'ghost', '--json'], code: 2, human: MODELS_UNKNOWN_PROVIDER },
      { argv: ['bench-report', '--json'], code: 2, human: BENCH_REPORT_NO_INPUT },
      { argv: ['usage', 'recompute', '--since', 'not-a-date', '--json'], code: 2, human: USAGE_RECOMPUTE_BAD_SINCE },
      { argv: ['sessions', 'bogus', '--json'], code: 2, human: SESSIONS_UNKNOWN_SUB },
    ];

    const cap = capture();
    try {
      for (const c of cases) {
        cap.clear();
        const code = await main(c.argv);
        // 退出码 = 该分支原本的码
        expect(code).toBe(c.code);
        // 信封不得混入 stdout（既不是"打了两次"，也不是"打错了流"）
        expect(cap.out()).toBe('');
        expect(cap.out().trim()).toBe('');
        // stderr 恰好一段可解析文档，message 与 human 分支同源
        expectErrorEnvelope(cap, c.code, c.human);
        expect(cap.err().split('\n')).toHaveLength(1); // 信封是单行 JSON，未被拆成多行
      }
    } finally {
      cap.restore();
    }
  });

  it('5) 参数合法但前置条件缺失：models --provider ghost（登记表里没有）→ --json 信封 code=2', async () => {
    const cap = capture();
    try {
      // 参数本身合法（--provider 有值），失败原因是前置条件：临时登记表里没有这个 id
      const code = await main(['models', '--provider', 'ghost', '--json']);
      expect(code).toBe(2);
      expect(cap.out()).toBe('');
      expectErrorEnvelope(cap, 2, MODELS_UNKNOWN_PROVIDER);

      // 对照：去掉 --json → 同一句人类文案，且不是可解析 JSON
      cap.clear();
      expect(await main(['models', '--provider', 'ghost'])).toBe(2);
      expectHumanStderr(cap, MODELS_UNKNOWN_PROVIDER);
      expect(cap.out()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('6) bench-report 缺 --input：--json 信封 code=2；非 JSON 与既有断言同源', async () => {
    const cap = capture();
    try {
      expect(await main(['bench-report', '--json'])).toBe(2);
      expect(cap.out().trim()).toBe('');
      expectErrorEnvelope(cap, 2, BENCH_REPORT_NO_INPUT);

      cap.clear();
      expect(await main(['bench-report'])).toBe(2);
      expectHumanStderr(cap, BENCH_REPORT_NO_INPUT);
      expect(cap.out()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('7) usage recompute --since 非法日期：--json 信封 code=2；非 JSON 逐字原文', async () => {
    const cap = capture();
    try {
      expect(await main(['usage', 'recompute', '--since', 'not-a-date', '--json'])).toBe(2);
      expect(cap.out().trim()).toBe('');
      expectErrorEnvelope(cap, 2, USAGE_RECOMPUTE_BAD_SINCE);

      cap.clear();
      expect(await main(['usage', 'recompute', '--since', 'not-a-date'])).toBe(2);
      expectHumanStderr(cap, USAGE_RECOMPUTE_BAD_SINCE);
      expect(cap.out()).toBe('');
    } finally {
      cap.restore();
    }
  });

  it('8) run 前置条件缺失（mcp.json 损坏，fail-loud）→ --json 信封 code=1', async () => {
    // 只有把 VESSEL_MCP_ROOT 也指到临时根，写入才不碰真实 ~/.vessel/mcp.json。
    const mcpFile = path.join(tmpRoot, 'mcp.json');
    fs.writeFileSync(mcpFile, '{broken', 'utf8');
    // 文案由 McpConfigStore.load() 的报错 + cli.ts 的包装逐字拼出（含平台路径分隔符）
    const MCP_CORRUPTED = `[vessel] MCP 配置错误：mcp file corrupted (invalid JSON): ${mcpFile}`;

    const cap = capture();
    try {
      // mock 供应商（临时根里没有 current.json）+ 显式 --prompt：既不发网络，也不读 stdin
      const code = await main(['run', '--prompt', 'hi', '--json']);
      expect(code).toBe(1); // 该出口原本就是 exit 1
      expect(cap.out().trim()).toBe('');
      expectErrorEnvelope(cap, 1, MCP_CORRUPTED);

      // 对照：去掉 --json → 同一句人类文案（不是可解析 JSON），退出码同为 1
      cap.clear();
      expect(await main(['run', '--prompt', 'hi'])).toBe(1);
      expectHumanStderr(cap, MCP_CORRUPTED);
      expect(cap.out()).toBe('');

      // 源文件未被改写（fail-loud 只报错，不做隔离/迁移）
      expect(fs.readFileSync(mcpFile, 'utf8')).toBe('{broken');
    } finally {
      cap.restore();
    }
  });

  it('9) run 前置条件缺失（anthropic 没有 base-url，退出在构造 provider 之前）→ --json 信封 code=2', async () => {
    // `--base-url` 缺省会回落到 `process.env.VESSEL_BASE_URL`：先摘掉它，
    // 保证本用例**任何机器上都**命中原出口，而不是带着真 URL 往网络层走。
    const savedBaseUrl = process.env.VESSEL_BASE_URL;
    delete process.env.VESSEL_BASE_URL;

    const cap = capture();
    try {
      // `--provider anthropic` 是"需要真实端点"的名字（REAL_PROVIDER_NAMES）且临时登记表里没有它
      // → plan.real && !plan.baseUrl → 在 buildRealProvider 之前就 fail(2)，零网络、零写入。
      const code = await main(['run', '--provider', 'anthropic', '--prompt', 'hi', '--json']);
      expect(code).toBe(2);
      expect(cap.out()).toBe('');
      expectErrorEnvelope(cap, 2, RUN_MISSING_BASE_URL);

      // 对照：去掉 --json → 同一句人类文案，退出码同为 2
      cap.clear();
      expect(await main(['run', '--provider', 'anthropic', '--prompt', 'hi'])).toBe(2);
      expectHumanStderr(cap, RUN_MISSING_BASE_URL);
      expect(cap.out()).toBe('');
    } finally {
      cap.restore();
      if (savedBaseUrl === undefined) delete process.env.VESSEL_BASE_URL;
      else process.env.VESSEL_BASE_URL = savedBaseUrl;
    }
  });
});
