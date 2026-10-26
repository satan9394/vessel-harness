import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectProvenance, diffProvenance } from './provenance.js';
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
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

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
