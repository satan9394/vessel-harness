import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkToolPins, parseToolVersion, satisfiesRange } from './toolPins.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(pins?: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-test-')); roots.push(root);
  fs.mkdirSync(path.join(root, 'configs'));
  if (pins !== undefined) fs.writeFileSync(path.join(root, 'configs/tool-pins.json'), JSON.stringify(pins));
  return root;
}
it.each([
  ['codex-cli 0.164.0', '0.164.0'], ['opencode 2.1.4', '2.1.4'], ['v2.1.4', '2.1.4'], ['garbage', null],
])('parses %s', (raw, expected) => { expect(parseToolVersion(raw)).toBe(expected); });
it.each([
  ['0.164.0', '>=0.164.0 <0.165.0', true], ['0.164.9', '>=0.164.0 <0.165.0', true],
  ['0.165.0', '>=0.164.0 <0.165.0', false], ['2.1.4', '>2.0.0 <=2.1.4 =2.1.4', true],
  ['2.1.4', '>2.1.4', false], ['1.2.3', '^1.2.3', false], ['1.2.3', '~1.2.3', false],
  ['1.2.3', '=1.2.3 || =2.0.0', false], ['1.2.3', '>=1.2.3-beta', false], ['1.2.3-beta', '>=1.2.3', false],
  ['1.2.3', '', false],
])('compares %s against %s', (version, range, expected) => { expect(satisfiesRange(version, range)).toBe(expected); });
it('warns for missing, malformed, or unsupported pin files without probing', () => {
  for (const pins of [undefined, { version: 2, tools: {} }, { version: 1, tools: { codex: null } }]) {
    expect(checkToolPins(fixture(pins), () => { throw new Error('must not probe'); })).toEqual([
      expect.objectContaining({ tool: 'tool-pins.json', status: 'warn' }),
    ]);
  }
  const root = fixture(); fs.writeFileSync(path.join(root, 'configs/tool-pins.json'), '{');
  expect(checkToolPins(root, () => null)[0]!.status).toBe('warn');
});
it('reports missing CLI, mismatch and matching versions without spawning', () => {
  const root = fixture({ version: 1, tools: { codex: { range: '>=0.164.0 <0.165.0' } } });
  expect(checkToolPins(root, () => null)[0]).toMatchObject({ status: 'warn', found: null, message: expect.stringContaining('not installed on this machine; skipped') });
  expect(checkToolPins(root, () => { throw new Error('missing'); })[0]!.status).toBe('warn');
  expect(checkToolPins(root, () => '0.165.0')[0]).toMatchObject({ status: 'warn', message: expect.stringContaining('found 0.165.0, declared >=0.164.0 <0.165.0') });
  expect(checkToolPins(root, () => '0.164.0')[0]).toMatchObject({ status: 'pass', found: '0.164.0' });
});
