import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkProvenance, collectProvenance, diffProvenance, main, writeProvenance } from './provenance.js';
import type { ProvenanceManifest } from './provenance.js';

describe('benchmark provenance', () => {
  let root: string;
  function write(relative: string, bytes: string | Buffer): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-provenance-'));
    write('benchmarks/fixtures/B001/z.bin', Buffer.from([0, 255, 13, 10]));
    write('benchmarks/fixtures/B001/a.txt', 'alpha');
    write('benchmarks/scenarios/B001.yaml', 'id: B001\n');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns an empty diff and null manifest when missing or malformed', () => {
    const absent = { ok: false, manifest: null, diff: { missing: [], extra: [], changed: [] } };
    expect(checkProvenance(root)).toEqual(absent);
    for (const value of ['{', 'null', '{}', '{"version":2,"entries":[]}',
      JSON.stringify({ version: 1, generatedAt: 'invalid', entries: [] }),
      JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), entries: [null] }),
      JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), entries: [{ path: 'a', sha256: 'bad' }] })]) {
      write('configs/benchmark-provenance.json', value);
      expect(checkProvenance(root)).toEqual(absent);
    }
  });

  it('writes a current manifest, creates configs, and checks repeated writes', () => {
    const startedAt = Date.now();
    const manifest = writeProvenance(root);
    expect(manifest.version).toBe(1);
    expect(new Date(manifest.generatedAt).toISOString()).toBe(manifest.generatedAt);
    expect(Date.parse(manifest.generatedAt)).toBeGreaterThanOrEqual(startedAt);
    expect(Date.parse(manifest.generatedAt)).toBeLessThanOrEqual(Date.now());
    expect(manifest.entries).toEqual(collectProvenance(root));
    expect(fs.readFileSync(path.join(root, 'configs/benchmark-provenance.json'), 'utf8')).toBe(JSON.stringify(manifest, null, 2) + '\n');
    expect(checkProvenance(root)).toEqual({ ok: true, manifest, diff: { missing: [], extra: [], changed: [] } });
    expect(writeProvenance(root).entries).toEqual(manifest.entries);
    expect(checkProvenance(root).ok).toBe(true);
  });

  it('checks changed, extra, and missing files against the written manifest', () => {
    writeProvenance(root);
    write('benchmarks/fixtures/B001/a.txt', 'changed');
    write('benchmarks/fixtures/B001/new.txt', 'new');
    fs.unlinkSync(path.join(root, 'benchmarks/fixtures/B001/z.bin'));
    const result = checkProvenance(root);
    expect(result.ok).toBe(false);
    expect(result.manifest).not.toBeNull();
    expect(result.diff).toEqual({ missing: ['benchmarks/fixtures/B001/z.bin'], extra: ['benchmarks/fixtures/B001/new.txt'], changed: ['benchmarks/fixtures/B001/a.txt'] });
  });

  it('prints each difference group with at most ten paths and an overflow count', () => {
    for (let i = 0; i < 12; i++) {
      write(`benchmarks/fixtures/missing-${i}.txt`, 'old');
      write(`benchmarks/fixtures/changed-${i}.txt`, 'old');
    }
    writeProvenance(root);
    for (let i = 0; i < 12; i++) {
      fs.unlinkSync(path.join(root, `benchmarks/fixtures/missing-${i}.txt`));
      write(`benchmarks/fixtures/changed-${i}.txt`, 'new');
      write(`benchmarks/fixtures/extra-${i}.txt`, 'new');
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(main(['--check', '--project', root])).toBe(1);
    const expected: string[] = [];
    const result = checkProvenance(root);
    for (const group of ['missing', 'extra', 'changed'] as const) {
      expected.push(`${group}:`, ...result.diff[group].slice(0, 10).map(file => `  ${file}`), '  … and 2 more');
    }
    expect(log.mock.calls.map(call => call[0])).toEqual(expected);
  });

  it('runs the direct CLI for missing, write, default check, and stale manifests', () => {
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const run = (...args: string[]) => spawnSync(process.execPath, [
      path.join(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
      path.join(repoRoot, 'benchmarks/runners/src/provenance.ts'), '--project', root, ...args,
    ], { cwd: root, encoding: 'utf8', timeout: 15_000 });
    let result = run('--check');
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout.trim()).toBe('no manifest; run with --write');
    result = run('--write');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('wrote 3 entries');
    for (const args of [[], ['--check']]) {
      result = run(...args);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe('ok: 3 entries match');
    }
    write('benchmarks/fixtures/B001/a.txt', 'changed');
    result = run('--check');
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout.trim()).toBe('changed:\n  benchmarks/fixtures/B001/a.txt');
    result = run('--bogus');
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('Usage: provenance.ts');
  }, 30_000);

  it('collects exact byte hashes in path order within the fixed bounds', () => {
    for (const dir of ['.git', 'node_modules', 'dist']) write(`benchmarks/fixtures/B001/${dir}/ignored`, 'ignore');
    write('benchmarks/scenarios/nested/ignored.yaml', 'ignore');
    write('benchmarks/scenarios/ignored.json', '{}');
    const entries = collectProvenance(root);
    expect(entries.map(entry => entry.path)).toEqual([
      'benchmarks/fixtures/B001/a.txt', 'benchmarks/fixtures/B001/z.bin', 'benchmarks/scenarios/B001.yaml',
    ]);
    for (const entry of entries) {
      expect(entry.sha256).toBe(createHash('sha256').update(fs.readFileSync(path.join(root, entry.path))).digest('hex'));
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('reports changed file contents', () => {
    const expected = collectProvenance(root);
    write('benchmarks/fixtures/B001/a.txt', 'changed');
    expect(diffProvenance(expected, collectProvenance(root))).toEqual({ missing: [], extra: [], changed: ['benchmarks/fixtures/B001/a.txt'] });
  });

  it('reports missing and extra paths', () => {
    const expected = collectProvenance(root);
    fs.unlinkSync(path.join(root, 'benchmarks/fixtures/B001/a.txt'));
    write('benchmarks/fixtures/B001/new.txt', 'new');
    expect(diffProvenance(expected, collectProvenance(root))).toEqual({
      missing: ['benchmarks/fixtures/B001/a.txt'], extra: ['benchmarks/fixtures/B001/new.txt'], changed: [],
    });
  });

  it('skips linked directories without reading their targets', context => {
    write('outside/hidden.txt', 'not fixture data');
    try {
      fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'benchmarks/fixtures/B001/link'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        context.skip('Host does not permit creating symlinks/junctions');
        return;
      }
      throw error;
    }
    expect(collectProvenance(root)).toHaveLength(3);
  });

  it('matches the manifest against the real repository', () => {
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'configs/benchmark-provenance.json'), 'utf8')) as ProvenanceManifest;
    expect(manifest.version).toBe(1);
    expect(Number.isNaN(Date.parse(manifest.generatedAt))).toBe(false);
    expect(diffProvenance(manifest.entries, collectProvenance(repoRoot))).toEqual({ missing: [], extra: [], changed: [] });
  });
});
