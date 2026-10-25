import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeHarnessFingerprint } from './fingerprint.js';

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

describe('computeHarnessFingerprint', () => {
  let root: string;
  const write = (rel: string, content = rel): void => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-fingerprint-'));
    write('packages/z/src/z.ts', 'z');
    write('packages/a/src/a.test.ts', 'a');
    write('configs/behavior.default.yaml', 'yaml');
    write('configs/tool-pins.json', '{}');
    write('package-lock.json', 'lock');
  });
  afterEach(() => {
    vi.mocked(fs.readFileSync).mockClear();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('is stable, sorted and unique, with the exact path/NUL/bytes SHA-256 encoding', () => {
    const files = ['configs/behavior.default.yaml', 'configs/tool-pins.json', 'package-lock.json', 'packages/a/src/a.test.ts', 'packages/z/src/z.ts'];
    const hash = createHash('sha256');
    for (const file of files) hash.update(file + '\0').update(fs.readFileSync(path.join(root, file)));
    const first = computeHarnessFingerprint(root);
    expect(first).toEqual({ value: hash.digest('hex').slice(0, 16), fileCount: 5, files });
    expect(first.value).toMatch(/^[0-9a-f]{16}$/);
    expect(computeHarnessFingerprint(root)).toEqual(first);
  });

  it('changes when source (including a test) changes', () => {
    const before = computeHarnessFingerprint(root).value;
    write('packages/a/src/a.test.ts', 'changed');
    expect(computeHarnessFingerprint(root).value).not.toBe(before);
  });

  it.each(['configs/behavior.default.yaml', 'configs/tool-pins.json', 'package-lock.json'])('changes when %s changes', (file) => {
    const before = computeHarnessFingerprint(root).value;
    write(file, 'changed');
    expect(computeHarnessFingerprint(root).value).not.toBe(before);
  });

  it('ignores dist and every excluded path, and files outside the input set', () => {
    const before = computeHarnessFingerprint(root);
    for (const dir of ['dist', 'node_modules', '.harness', '.git', '.tmp', '.tmp-build']) {
      write(`${dir}/file.ts`);
      write(`packages/a/src/${dir}/file.ts`);
      write(`packages/${dir}/src/file.ts`);
    }
    for (const file of ['packages/a/src/.tmp-file.ts', 'packages/a/src/build.tsbuildinfo', 'packages/a/src/data.json', 'packages/a/elsewhere/file.ts', 'configs/nested/file.yaml', 'configs/.tmp-file.yaml', 'configs/file.yml', 'apps/cli/src/file.ts']) write(file);
    expect(computeHarnessFingerprint(root)).toEqual(before);
  });

  it('skips unreadable files without listing or hashing them', () => {
    const before = computeHarnessFingerprint(root);
    vi.mocked(fs.readFileSync).mockImplementationOnce(() => { throw new Error('unreadable'); });
    const result = computeHarnessFingerprint(root);
    expect(result.files).toEqual(before.files.filter((file) => file !== 'configs/behavior.default.yaml'));
    expect(result.fileCount).toBe(before.fileCount - 1);
  });

  it('accepts a missing input tree', () => {
    expect(computeHarnessFingerprint(path.join(root, 'missing'))).toEqual({
      value: 'e3b0c44298fc1c14', fileCount: 0, files: [],
    });
  });
});
