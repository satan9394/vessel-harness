import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { main, envNonBlank } from './cli.js';

/**
 * `VESSEL_BASE_URL` / `VESSEL_API_KEY` 的**空白判据**（C-1 卡）。
 *
 * 病灶：两处 `planProvider({ baseUrl: flags.get('base-url') ?? process.env.VESSEL_BASE_URL, … })`
 * 里 `??` 只挡 `undefined` ⇒ `VESSEL_BASE_URL='   '`（shell/CI 里"清空变量"或模板注入成空白的
 * 常见形态）被当成**真端点**：`missingBaseUrl()` 判它非空、不退出，直接拿一个空白 URL 去构造
 * provider 并真发请求；`VESSEL_API_KEY='   '` 同理会拿一个纯空白密钥去真连（401）。纯空串本身
 * 不静默（缺 baseUrl 明确退出、缺 apiKey 401）—— 纯空白才是那条缝。
 *
 * 修法：判据收敛为模块内唯一函数 `envNonBlank`（`undefined`/`''`/纯空白 ⇒ 未设置；**非空白值
 * 逐字返回、不 trim**），两处调用点改走它；`flags > env` 的**优先级结构逐字未动**。
 *
 * 「删哪行会红」：
 *   - 把 ② 的两处调用点改回 `process.env.VESSEL_BASE_URL` ⇒ ② 红（会走到真构造 provider 的
 *     分支，退出码不再是 2）/ ④ 红；
 *   - 把 `envNonBlank` 的 `raw.trim() === ''` 去掉（退回"只挡空串"）⇒ ① 红（纯空白那条）+
 *     ② 红；
 *   - 让它 trim 非空白值（改成 `return raw.trim()`）⇒ ① 的最后一条负对照红
 *     （"有值时行为逐字不变"）；
 *   - 改优先级（`envNonBlank(...) ?? flags.get(...)`）⇒ ④ 的优先级断言红。
 *
 * ③ 是**非判别**的既有行为对照（空串在改动前后都是 exit 2）—— 它证明的是"空串不静默"这条
 * 结论未被顺手改掉，不是本卡修复的判别性证据；判别性证据是 ②。
 *
 * apiKey 侧说明（如实标注）：`VESSEL_API_KEY` 唯一消费者是 provider 构造函数，仓内**没有**
 * 零网络的端到端可观测点（要观测就得真连端点）。故 apiKey 这一半由 ①（判据单测）+ ④（调用点
 * 源码守卫）钉住，**是静态守卫，不是行为用例**。
 *
 * 隔离纪律（AGENTS.md §8）：状态根全部指向 `mkdtemp` 临时目录（含 `VESSEL_MCP_ROOT`，
 * 与 `jsonErrorExits.test.ts` 同款），任何分支都不会读写真实 `~/.vessel`。
 */

const CLI_SRC = fileURLToPath(new URL('./cli.ts', import.meta.url));

const ROOT_ENV = [
  'VESSEL_PROVIDER_ROOT',
  'VESSEL_USAGE_ROOT',
  'VESSEL_SETTINGS_ROOT',
  'VESSEL_SESSION_ROOT',
  'VESSEL_MCP_ROOT',
] as const;

/** 本卡涉及的两个端点变量：逐用例快照/还原。 */
const ENDPOINT_ENV = ['VESSEL_BASE_URL', 'VESSEL_API_KEY'] as const;

const RUN_MISSING_BASE_URL =
  '[vessel] anthropic 需要 --base-url 或 VESSEL_BASE_URL（或先 vessel provider add 配置）';

let tmpRoot: string;
const savedRoots = new Map<string, string | undefined>();
const savedEndpoints = new Map<string, string | undefined>();

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-blankenv-'));
  for (const key of ROOT_ENV) {
    savedRoots.set(key, process.env[key]);
    process.env[key] = tmpRoot;
  }
  for (const key of ENDPOINT_ENV) {
    savedEndpoints.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ROOT_ENV) {
    const prev = savedRoots.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
  for (const key of ENDPOINT_ENV) {
    const prev = savedEndpoints.get(key);
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** stdout/stderr 采集（口径同 `jsonErrorExits.test.ts` 的 `capture()`）。 */
function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => out.push(a.join(' ')));
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => err.push(a.join(' ')));
  const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return {
    out: () => out.join('\n'),
    err: () => err.join('\n'),
    restore: () => {
      spyLog.mockRestore();
      spyErr.mockRestore();
      spyWarn.mockRestore();
    },
  };
}

describe('VESSEL_BASE_URL / VESSEL_API_KEY —— 空/纯空白按未设置（C-1）', () => {
  it('① 判据单测：undefined / 空串 / 纯空白 ⇒ 未设置；非空白值逐字返回（不 trim）', () => {
    delete process.env.VESSEL_BASE_URL;
    expect(envNonBlank('VESSEL_BASE_URL')).toBeUndefined();

    process.env.VESSEL_BASE_URL = '';
    expect(envNonBlank('VESSEL_BASE_URL')).toBeUndefined();

    process.env.VESSEL_BASE_URL = '   ';
    expect(envNonBlank('VESSEL_BASE_URL')).toBeUndefined();

    process.env.VESSEL_BASE_URL = '\t \n';
    expect(envNonBlank('VESSEL_BASE_URL')).toBeUndefined();

    // 负对照：「有值时行为逐字不变」——判据只管"有没有值"，不做值变换
    process.env.VESSEL_BASE_URL = '  http://127.0.0.1:1/v1  ';
    expect(envNonBlank('VESSEL_BASE_URL')).toBe('  http://127.0.0.1:1/v1  ');
    // apiKey 同一条判据（密钥是逐字值，绝不 trim）
    process.env.VESSEL_API_KEY = '  sk-test-not-a-real-key  ';
    expect(envNonBlank('VESSEL_API_KEY')).toBe('  sk-test-not-a-real-key  ');
    process.env.VESSEL_API_KEY = '   ';
    expect(envNonBlank('VESSEL_API_KEY')).toBeUndefined();
  });

  it('② 判别性：VESSEL_BASE_URL 纯空白 ⇒ 视为未设置 ⇒ 在构造 provider 之前 fail(2)', async () => {
    process.env.VESSEL_BASE_URL = '   ';
    const cap = capture();
    try {
      // `--provider anthropic` 是"需要真实端点"的名字（REAL_PROVIDER_NAMES）且临时根里没有它
      // ⇒ plan.real 且 baseUrl 应为空。改前 `'   '` 被当成真端点 ⇒ 不会走这个出口（真构造
      // provider 并往 `'   '` 发请求）⇒ `toBe(2)` 与信封断言同时红。
      const code = await main(['run', '--provider', 'anthropic', '--prompt', 'hi', '--json']);
      expect(code).toBe(2);
      expect(cap.out()).toBe('');
      const doc = JSON.parse(cap.err()) as { error: { message: string; code: number } };
      expect(doc.error.code).toBe(2);
      expect(doc.error.message).toBe(RUN_MISSING_BASE_URL);
    } finally {
      cap.restore();
    }
  });

  it('③ 非判别对照：空串本就 fail(2)（"空串不静默"这条既有结论未变）', async () => {
    process.env.VESSEL_BASE_URL = '';
    const cap = capture();
    try {
      expect(await main(['run', '--provider', 'anthropic', '--prompt', 'hi', '--json'])).toBe(2);
      const doc = JSON.parse(cap.err()) as { error: { message: string } };
      expect(doc.error.message).toBe(RUN_MISSING_BASE_URL);
    } finally {
      cap.restore();
    }
  });

  it('④ 调用点守卫（apiKey 侧无零网络端到端观测点）：两处都走 envNonBlank，优先级结构未动', () => {
    const src = fs.readFileSync(CLI_SRC, 'utf8');
    expect(src).not.toContain('process.env.VESSEL_BASE_URL');
    expect(src).not.toContain('process.env.VESSEL_API_KEY');
    expect(src.match(/envNonBlank\('VESSEL_BASE_URL'\)/g)).toHaveLength(2);
    expect(src.match(/envNonBlank\('VESSEL_API_KEY'\)/g)).toHaveLength(2);
    // 优先级逐字未动：flags 仍在前，env 只当回落（flag 为空串/纯空白时照旧挡住 env）
    expect(src).toContain("flags.get('base-url') ?? envNonBlank('VESSEL_BASE_URL')");
    expect(src).toContain("flags.get('api-key') ?? envNonBlank('VESSEL_API_KEY')");
  });
});
