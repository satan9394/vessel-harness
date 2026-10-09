import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { modCommand } from './modCommand.js';
import { main } from '../cli.js';

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(source = 'module.exports = {};') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-cli-')); roots.push(root);
  const mod = path.join(root, '.harness', 'mods', 'demo'); fs.mkdirSync(mod, { recursive: true });
  fs.writeFileSync(path.join(mod, 'vessel.mod.json'), JSON.stringify({ name: 'demo', version: '1.0.0', priority: 10, entrypoint: 'index.js', permissions: { allowedTools: ['Read'], filesystemRead: ['public.txt'] }, systemPromptContribution: 'Hello' }));
  fs.writeFileSync(path.join(mod, 'index.js'), source);
  return { root, mod };
}
it('lists discovered manifests honestly, inspects permissions and routes CLI main', async () => {
  const { root } = fixture(); const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await main(['mod', 'list', '--workspace', root])).toBe(0);
  expect(log.mock.calls[0]![0]).toContain('not loaded instances');
  expect(log.mock.calls[0]![0]).toContain('disabled until explicit opt-in');
  expect(await modCommand(['inspect', 'demo'], { workspaceRoot: root })).toBe(0);
  expect(log.mock.calls[1]![0]).toContain('public.txt');
  expect(log.mock.calls[1]![0]).toContain('Hello');
});
it('verify and audit never execute malicious source and fail closed', async () => {
  const { root, mod } = fixture('process.env.API_KEY; require("node:fs"); throw new Error("executed")');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await main(['mod', 'verify', mod, '--workspace', root])).toBe(1);
  expect(await main(['mod', 'audit', mod, '--workspace', root])).toBe(1);
  expect(log.mock.calls[0]![0]).toContain('Process environment access is forbidden');
});
it('rejects missing and malformed manifests, unknown names and bad arguments', async () => {
  const { root, mod } = fixture(); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
  fs.writeFileSync(path.join(mod, 'vessel.mod.json'), '{broken');
  expect(await modCommand(['list'], { workspaceRoot: root })).toBe(1);
  expect(await modCommand(['inspect', 'missing'], { workspaceRoot: root })).toBe(1);
  expect(await modCommand(['verify'])).toBe(2);
  expect(await modCommand(['verify', path.join(root, 'missing')])).toBe(1);
});
it.each(['claude.mod', 'package.json'])('audits Claude ecosystem manifest %s with identical precedence', async filename => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-compat-')); roots.push(root);
  const manifest = { name: 'compat', version: '1', entrypoint: 'index.js' };
  fs.writeFileSync(path.join(root, filename), JSON.stringify(filename === 'package.json' ? { 'claude.mod': manifest } : manifest));
  fs.writeFileSync(path.join(root, 'index.js'), 'module.exports = { observe() {}, interceptToolCall() {} };');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await modCommand(['verify', root])).toBe(0);
  expect(log.mock.calls[0]![0]).toContain('interceptToolCall');
  fs.writeFileSync(path.join(root, 'vessel.mod.json'), '{broken');
  expect(await modCommand(['verify', root])).toBe(1);
});
