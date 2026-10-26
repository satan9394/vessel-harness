import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectRegistry, SessionRegistry } from '@vessel/application';
import { main } from '../../../cli/src/cli.js';
import { ProviderStore } from '../providers/ProviderStore.js';
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

  async function cli(...args: string[]): Promise<string> {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await main(['provider', 'profile', ...args, '--json'])).toBe(0);
      expect(output).toHaveBeenCalledTimes(1);
      return JSON.stringify(JSON.parse(String(output.mock.calls[0]![0])));
    } finally { output.mockRestore(); }
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
    expect(await cli('list'), 'CLI list differs from HTTP list').toBe(await http());
  });

  it('save returns the same ordered fields', async () => {
    const api = await http('', 'POST', { name: 'work', provider: 'local', model: 'new', baseUrl: 'http://localhost:9999/v2', label: 'Work' });
    expect(await cli('save', 'work', '--provider', 'local', '--model', 'new', '--base-url', 'http://localhost:9999/v2', '--label', 'Work'), 'CLI save differs from HTTP save').toBe(api);
  });

  it('use returns the same ordered provider fields', async () => {
    await http('', 'POST', { name: 'work', provider: 'local', model: 'new' });
    const api = await http('/work/use', 'POST');
    expect(await cli('use', 'work'), 'CLI use differs from HTTP use').toBe(api);
  });

  it('delete returns the same ordered fields', async () => {
    await http('', 'POST', { name: 'work', provider: 'local' });
    const api = await http('/work', 'DELETE');
    await http('', 'POST', { name: 'work', provider: 'local' });
    expect(await cli('delete', 'work'), 'CLI delete differs from HTTP delete').toBe(api);
  });
});
