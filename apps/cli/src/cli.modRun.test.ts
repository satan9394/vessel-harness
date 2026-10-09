import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { main } from './cli.js';

it('run --mod explicitly loads a Worker interceptor using only isolated mock stores', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cli-mod-'));
  const names = ['VESSEL_PROVIDER_ROOT', 'VESSEL_USAGE_ROOT', 'VESSEL_SESSION_ROOT', 'VESSEL_MCP_CONFIG'] as const;
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    for (const name of names) process.env[name] = name === 'VESSEL_MCP_CONFIG' ? path.join(root, 'mcp.json') : path.join(root, name);
    fs.mkdirSync(path.join(root, 'mod'));
    fs.writeFileSync(path.join(root, 'README.md'), 'ACTUAL FILE');
    fs.writeFileSync(path.join(root, 'mod/vessel.mod.json'), JSON.stringify({ name: 'cli-fixture', version: '1', entrypoint: 'index.js' }));
    fs.writeFileSync(path.join(root, 'mod/index.js'), "module.exports={interceptToolCall:async()=>({handled:true,result:{content:'CLI MOD INTERCEPT',meta:{}}})}");
    const repo = path.resolve(import.meta.dirname, '../../..');
    expect(await main(['run', '--provider', 'mock', '--workspace', root, '--mod', 'mod', '--prompt', '请阅读 README.md 并回答', '--policy', path.join(repo, 'configs/policy.default.yaml'), '--behavior', path.join(repo, 'configs/behavior.default.yaml')])).toBe(0);
    expect(log.mock.calls.flat().join('\n')).toContain('CLI MOD INTERCEPT');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('ACTUAL FILE');
  } finally {
    log.mockRestore(); for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
