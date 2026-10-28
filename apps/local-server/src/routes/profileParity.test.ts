import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectRegistry, SessionRegistry } from '@vessel/application';
import { main } from '../../../cli/src/cli.js';
import { ProviderStore } from '../providers/ProviderStore.js';
import { providerStateRoot } from '../providers/defaultStore.js';
import { createVesselServer, type VesselServer } from '../server.js';

describe('profile CLI and HTTP parity', () => {
  let home: string;
  let server: VesselServer;
  let base: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-profile-parity-'));
    previousRoot = process.env.VESSEL_PROVIDER_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = home;
    const store = new ProviderStore({ rootDir: home });
    store.add({ id: 'local', name: 'Local', protocol: 'openai-compatible', model: 'old', baseUrl: 'http://localhost:9999/v1' });
    server = await createVesselServer({ port: 0, providerStore: store,
      projectRegistry: new ProjectRegistry({ vesselHome: home }), sessionRegistry: new SessionRegistry({ vesselHome: home }),
    }).listen();
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    await server.close();
    if (previousRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = previousRoot;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /**
   * 判别性隔离断言（task 350 / A4）：CLI 的默认 provider store 根必须就是本用例的临时根。
   *
   * 链路：`main(['provider','profile',…])` → `cmdProvider`（apps/cli/src/cli.ts:1606）
   * → `defaultProviderStore()`（apps/cli/src/cli.ts:577-579）
   * → `createDefaultProviderStore()`（apps/cli/src/providers/defaultStore.ts:1 只是 re-export，
   *   实现在 apps/local-server/src/providers/defaultStore.ts）
   * → `providerStateRoot()`（apps/local-server/src/providers/defaultStore.ts:19-21）
   * → `envRoot('VESSEL_PROVIDER_ROOT')`（packages/shared/src/envRoot.ts:22-27），
   * 即「这里读到的那个值」；env 在每次构造 store 时求值（ProviderStore.ts:255），无模块级单例缓存。
   *
   * 为什么必须有这一条：根一旦分叉，CLI 会去读写临时根之外的状态（最坏是真实 `~/.vessel`），
   * 而 `delete` 是幂等的、恒返回 exit 0（apps/cli/src/providers/profileCommands.ts:47-52），
   * 只比对输出的旧断言会**静默通过**。这条断言把「读错根」直接变成红灯。
   * 注意：卡 350 记录的 `expected 2 to be 0` **不是**读错根的症状——exit 2 只来自
   * profileCommands 的 catch（如 profiles 文件损坏/读写异常），见卡内「复核结论」。
   */
  function expectCliStoreRoot(): void {
    expect(path.resolve(providerStateRoot()), 'CLI 默认 provider store 根不是本用例的临时根').toBe(path.resolve(home));
  }

  /**
   * 读本用例临时根内的 `provider-profiles.json`，并先校验它的**真实路径**确实在临时根内。
   *
   * 用于把「CLI 真的写/删到了同一个根」这件事变成可失败断言：文件缺失（CLI 写到别处去了）、
   * 真实路径跑到根外（软链/误用真实用户目录）、内容不再是合法 v1（写坏或被污染）都会让用例红，
   * 而不是像只看输出那样被 `{ok:true}` 掩盖。
   */
  function profilesOnDisk(): { version: unknown; profiles: Record<string, unknown> } {
    const file = path.join(home, 'provider-profiles.json');
    expect(fs.existsSync(file), `profiles 文件不在本用例临时根内：${file}`).toBe(true);
    const realFile = fs.realpathSync(file);
    const inside = path.relative(fs.realpathSync(home), realFile);
    expect(inside.startsWith('..') || path.isAbsolute(inside), `profiles 文件真实路径落在临时根外：${realFile}`).toBe(false);
    return JSON.parse(fs.readFileSync(realFile, 'utf8')) as { version: unknown; profiles: Record<string, unknown> };
  }

  async function cli(...args: string[]): Promise<string> {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const code = await main(['provider', 'profile', ...args, '--json']);
      // 退出码判据不变（仍必须是 0）；但把 CLI 自己的 stderr 信封带进失败信息：
      // profileCommands 的 catch-all 会把任何 store 异常折成固定文案 + 退出码 2，
      // 原断言只会给出「expected 2 to be 0」，现场信息全丢（task 350 的历史症状）。
      const stderrText = stderr.mock.calls.map((call) => String(call[0])).join(' | ');
      expect(code, `CLI provider profile ${args[0]} 退出码非 0；stderr=${stderrText}`).toBe(0);
      expect(stdout).toHaveBeenCalledTimes(1);
      return JSON.stringify(JSON.parse(String(stdout.mock.calls[0]![0])));
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  }

  async function http(suffix = '', method = 'GET', body?: unknown): Promise<string> {
    const response = await fetch(`${base}/api/providers/profiles${suffix}`, {
      method, headers: { Origin: base, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(method === 'POST' && !suffix ? 201 : 200);
    return JSON.stringify(await response.json());
  }

  it('list returns the same ordered fields and profiles', async () => {
    await http('', 'POST', { name: 'z', provider: 'local', model: 'new', label: 'Work' });
    await http('', 'POST', { name: 'a', provider: 'local', baseUrl: 'http://localhost:9999/v2' });
    expect(Object.keys(profilesOnDisk().profiles).sort()).toEqual(['a', 'z']);
    expectCliStoreRoot();
    expect(await cli('list'), 'CLI list differs from HTTP list').toBe(await http());
  });

  it('save returns the same ordered fields', async () => {
    const api = await http('', 'POST', { name: 'work', provider: 'local', model: 'new', baseUrl: 'http://localhost:9999/v2', label: 'Work' });
    expectCliStoreRoot();
    expect(await cli('save', 'work', '--provider', 'local', '--model', 'new', '--base-url', 'http://localhost:9999/v2', '--label', 'Work'), 'CLI save differs from HTTP save').toBe(api);
    const disk = profilesOnDisk();
    expect(disk.version).toBe(1);
    expect(disk.profiles.work).toEqual({ provider: 'local', model: 'new', baseUrl: 'http://localhost:9999/v2', label: 'Work' });
  });

  it('use returns the same ordered provider fields', async () => {
    await http('', 'POST', { name: 'work', provider: 'local', model: 'new' });
    const api = await http('/work/use', 'POST');
    expectCliStoreRoot();
    expect(await cli('use', 'work'), 'CLI use differs from HTTP use').toBe(api);
  });

  it('delete returns the same ordered fields', async () => {
    await http('', 'POST', { name: 'work', provider: 'local' });
    const api = await http('/work', 'DELETE');
    await http('', 'POST', { name: 'work', provider: 'local' });
    expect(Object.keys(profilesOnDisk().profiles)).toEqual(['work']);
    expectCliStoreRoot();
    expect(await cli('delete', 'work'), 'CLI delete differs from HTTP delete').toBe(api);
    const disk = profilesOnDisk();
    expect(disk.version).toBe(1);
    expect(disk.profiles).not.toHaveProperty('work');
  });

  it('reports a corrupted profiles file through CLI and HTTP', async () => {
    fs.writeFileSync(path.join(home, 'provider-profiles.json'), '{invalid json', 'utf8');
    expectCliStoreRoot();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Delete is idempotent, so reading the wrong root cannot cause exit 2.
      // This establishes a reachable exit 2 path, not a reproduction of the original intermittent failure.
      expect(await main(['provider', 'profile', 'delete', 'work', '--json'])).toBe(2);
      expect(stderr).toHaveBeenCalledTimes(1);
      const output = String(stderr.mock.calls[0]![0]);
      expect(output).toContain('provider-profiles.json 损坏');
      expect(JSON.parse(output)).toEqual({ error: { message: 'provider-profiles.json 损坏，请修复后重试。', code: 2 } });
    } finally {
      stderr.mockRestore();
    }
    const response = await fetch(`${base}/api/providers/profiles/work`, {
      method: 'DELETE', headers: { Origin: base },
    });
    expect(await response.json()).toMatchObject({ error: 'provider_profiles_corrupted' });
  });
});
