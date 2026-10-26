import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectRegistry, SessionRegistry } from '@vessel/application';
import { main } from '../cli.js';
import { UsageStore } from './UsageStore.js';
import { createVesselServer, type VesselServer } from '../../../local-server/src/server.js';
import { ProviderStore } from '../../../local-server/src/providers/ProviderStore.js';

let home: string;
let server: VesselServer | undefined;
let previous: Record<string, string | undefined>;
const roots = ['VESSEL_USAGE_ROOT', 'VESSEL_PROVIDER_ROOT', 'VESSEL_SESSION_ROOT'];
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-usage-window-'));
  previous = Object.fromEntries(roots.map(key => [key, process.env[key]]));
  for (const key of roots) process.env[key] = home;
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const key of roots) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  fs.rmSync(home, { recursive: true, force: true });
});

function seed(sameProvider = false) {
  const entries = Object.fromEntries([
    ['early', 24, 0.3], ['inside', 25, 0.2], ['late', 26, 0.1],
  ].map(([model, day, costUsd]) => [String(model), {
    provider: sameProvider ? 'shared' : model, model, costUsd, calls: 1,
    inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0,
    estimated: false, pricingSource: 'model', events: 1,
    lastTs: new Date(2026, 9, Number(day), 0).toISOString(),
  }]));
  fs.writeFileSync(path.join(home, 'usage.json'), JSON.stringify({ version: 1, entries, recent: [] }));
}

async function cli(...args: string[]) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    expect(await main(['usage', ...args])).toBe(0);
    return log.mock.calls.map(args => String(args[0])).join('\n');
  } finally { log.mockRestore(); }
}

it('CSV excludes out-of-window models before aggregation, including models sharing a provider', async () => {
  seed(true);
  const flags = ['--since', '2026-10-25', '--until', '2026-10-25'];
  expect(await cli('--csv', ...flags)).toBe('provider,model,calls,input_tokens,output_tokens,cache_read_tokens,cache_creation_tokens,cost_usd,estimated\nshared,inside,1,10,2,0,0,0.200000,false');
  const json = JSON.parse(await cli('--json', ...flags));
  server = await createVesselServer({ port: 0, providerStore: new ProviderStore({ rootDir: home }),
    projectRegistry: new ProjectRegistry({ vesselHome: home }), sessionRegistry: new SessionRegistry({ vesselHome: home }),
    usageByProvider: (window) => new UsageStore({ rootDir: home }).byProvider(window),
  }).listen();
  for (const [query, windowFlags] of [
    ['since=2026-10-25&until=2026-10-25', flags],
    ['since=2026-10-25', ['--since', '2026-10-25']],
    ['until=2026-10-25', ['--until', '2026-10-25']],
  ] as const) {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/providers/usage?${query}`);
    expect(response.status).toBe(200);
    const http = await response.json() as { byProvider: unknown[] };
    expect(http.byProvider).toEqual(JSON.parse(await cli('--json', ...windowFlags)).byProvider);
  }
  expect(json.byProvider).toMatchObject([{ provider: 'shared', calls: 1, costUsd: 0.2, models: [{ model: 'inside' }] }]);
  expect(json.byModel.map((row: { model: string }) => row.model)).toEqual(['inside']);
  const human = await cli(...flags);
  expect(human.slice(human.indexOf('\n按供应商:'))).toBe('\n按供应商:\n  shared: 10in/2out · 1 次 · $0.2000\n    inside · 12 · $0.2000\n\n按模型:\n  shared/inside: $0.2000 · 1 次');
});

it('human and JSON provider rows agree with HTTP windows', async () => {
  seed();
  server = await createVesselServer({ port: 0, providerStore: new ProviderStore({ rootDir: home }),
    projectRegistry: new ProjectRegistry({ vesselHome: home }), sessionRegistry: new SessionRegistry({ vesselHome: home }),
    usageByProvider: (window) => new UsageStore({ rootDir: home }).byProvider(window),
  }).listen();
  for (const [query, flags, names] of [
    ['since=2026-10-25&until=2026-10-25', ['--since', '2026-10-25', '--until', '2026-10-25'], ['inside']],
    ['since=2026-10-25', ['--since', '2026-10-25'], ['inside', 'late']],
    ['until=2026-10-25', ['--until', '2026-10-25'], ['early', 'inside']],
  ] as const) {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/providers/usage?${query}`);
    expect(response.status).toBe(200);
    const http = await response.json() as { byProvider: unknown[] };
    const json = JSON.parse(await cli('--json', ...flags));
    expect(json.byProvider).toEqual(http.byProvider);
    const human = await cli(...flags);
    const providers = human.slice(human.indexOf('\n按供应商:') + 1, human.indexOf('\n按模型:'));
    expect(providers).toBe('按供应商:\n' + names.map(name => `  ${name}: 10in/2out · 1 次 · $${({ early: 0.3, inside: 0.2, late: 0.1 }[name]).toFixed(4)}\n    ${name} · 12 · $${({ early: 0.3, inside: 0.2, late: 0.1 }[name]).toFixed(4)}\n`).join(''));
  }
});

it('keeps the exact unwindowed human provider and model output', async () => {
  seed(true);
  const output = await cli();
  expect(output.slice(output.indexOf('\n按供应商:'))).toBe('\n按供应商:\n  shared: 30in/6out · 3 次 · $0.6000\n    early · 12 · $0.3000\n    inside · 12 · $0.2000\n    late · 12 · $0.1000\n\n按模型:\n  shared/early: $0.3000 · 1 次\n  shared/inside: $0.2000 · 1 次\n  shared/late: $0.1000 · 1 次');
});

it('windows totals, cache and recent by local day before taking the recent limit', async () => {
  seed(true);
  const file = path.join(home, 'usage.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [index, entry] of Object.values(data.entries).entries()) {
    Object.assign(entry as object, { cachePromptTokens: 100, measuredCachedTokens: (index + 1) * 10, cacheSavingsUsd: (index + 1) / 100 });
  }
  data.recent = Object.values(data.entries).map(entry => ({ ...(entry as object), ts: (entry as { lastTs: string }).lastTs }));
  fs.writeFileSync(file, JSON.stringify(data));
  for (const [flags, names, cached] of [
    [['--since', '2026-10-25', '--until', '2026-10-25'], ['inside'], 20],
    [['--since', '2026-10-25'], ['inside', 'late'], 50],
    [['--until', '2026-10-25'], ['early', 'inside'], 30],
    [['--since', '2026-10-27'], [], 0],
    [[], ['early', 'inside', 'late'], 60],
  ] as const) {
    const json = JSON.parse(await cli('--json', '--cache', '--recent', '1', ...flags));
    expect(json.byModel.map((row: { model: string }) => row.model)).toEqual(names);
    expect(json.totals).toMatchObject({ calls: names.length, inputTokens: names.length * 10,
      outputTokens: names.length * 2, models: names.length, providers: names.length ? 1 : 0 });
    expect(json.totals.costUsd).toBeCloseTo(json.byProvider.reduce((sum: number, row: { costUsd: number }) => sum + row.costUsd, 0));
    expect(json.cache).toMatchObject({ promptTokensTotal: names.length * 100, cachedTokensTotal: cached,
      overallCacheHitRate: names.length ? cached / (names.length * 100) : 0, unmeasuredEntries: 0 });
    expect(json.cache.estimatedSavingsUsd).toBeCloseTo(cached / 1000);
    expect(json.recent.map((row: { model: string }) => row.model)).toEqual(names.slice(-1));
    const human = await cli('--cache', '--recent', '1', ...flags);
    expect(human).toContain(`总消耗: input ${names.length * 10} · output ${names.length * 2} · cache 读 0 · cache 写 0 · 调用 ${names.length}`);
    expect(human).toContain(`估算成本: $${json.totals.costUsd.toFixed(4)}（${names.length ? 1 : 0} 供应商 / ${names.length} 模型）`);
    expect(human).toContain(`${cached}/${names.length * 100} measured prompt tokens`);
  }
});
