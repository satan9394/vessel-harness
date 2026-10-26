import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../cli.js';

let root: string;
const fixture = { id: 'local', name: 'Local', protocol: 'openai-compatible', model: 'm', baseUrl: 'https://a.invalid/v1', endpoints: [{ url: 'https://b.invalid/v1' }] };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vessel-endpoint-cli-'));
  for (const key of ['VESSEL_PROVIDER_ROOT', 'VESSEL_USAGE_ROOT', 'VESSEL_SETTINGS_ROOT', 'VESSEL_SESSION_ROOT', 'VESSEL_MCP_ROOT']) vi.stubEnv(key, join(root, key));
  for (const key of ['VESSEL_BASE_URL', 'VESSEL_API_KEY', 'VESSEL_MODEL']) vi.stubEnv(key, undefined);
  mkdirSync(process.env.VESSEL_PROVIDER_ROOT!, { recursive: true });
  writeFileSync(join(process.env.VESSEL_PROVIDER_ROOT!, 'providers.json'), JSON.stringify([fixture]));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

it.each([false, true])('CLI actually switches and emits notice only outside JSON mode (json=%s)', async json => {
  const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 503 })).mockImplementation(async () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  vi.stubGlobal('fetch', fetchSpy);
  const code = await main(['run', '--provider', fixture.id, '--prompt', 'hello', '--workspace', root, ...(json ? ['--json'] : [])]);
  expect(code).toBe(0);
  expect(fetchSpy.mock.calls.map(args => args[0])).toEqual(['https://a.invalid/v1/chat/completions', 'https://b.invalid/v1/chat/completions']);
  const notices = vi.mocked(console.error).mock.calls.filter(args => String(args[0]).includes('端点失败转移'));
  expect(notices).toEqual(json ? [] : [['[vessel] 端点失败转移：https://a.invalid/v1 → https://b.invalid/v1']]);
});

it.each(['', '   '])('blank env %j preserves URL resolution but disables runtime candidates', async value => {
  vi.stubEnv('VESSEL_BASE_URL', value);
  const fetchSpy = vi.fn().mockResolvedValueOnce(new Response('busy', { status: 503 })).mockImplementation(async () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
  vi.stubGlobal('fetch', fetchSpy);
  const code = await main(['run', '--provider', fixture.id, '--prompt', 'hello', '--workspace', root, '--json']);
  expect(code).toBe(0);
  expect(fetchSpy).toHaveBeenCalled();
  expect(fetchSpy.mock.calls.every(args => args[0] === 'https://a.invalid/v1/chat/completions')).toBe(true);
});

it('empty base-url flag still fails before dispatch and never falls back to candidates', async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  expect(await main(['run', '--provider', fixture.id, '--base-url', '', '--prompt', 'hello', '--workspace', root, '--json'])).toBe(2);
  expect(fetchSpy).not.toHaveBeenCalled();
});
