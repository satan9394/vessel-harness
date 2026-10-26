import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ProvenanceEntry { path: string; sha256: string }
export interface ProvenanceManifest { version: 1; generatedAt: string; entries: ProvenanceEntry[] }

const EXCLUDED = new Set(['.git', 'node_modules', 'dist']);

/** Collect ordinary fixture files and top-level scenario YAML files, never following links. */
export function collectProvenance(repoRoot: string): ProvenanceEntry[] {
  const files: string[] = [];
  const walk = (relative: string, recursive: boolean): void => {
    const dir = path.join(repoRoot, relative);
    if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED.has(entry.name) || entry.isSymbolicLink()) continue;
      const rel = `${relative}/${entry.name}`;
      if (entry.isDirectory() && recursive) walk(rel, true);
      else if (entry.isFile() && (recursive || entry.name.endsWith('.yaml'))) files.push(rel);
    }
  };
  walk('benchmarks/fixtures', true);
  walk('benchmarks/scenarios', false);
  return files.sort().map(rel => ({
    path: rel,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(repoRoot, rel))).digest('hex'),
  }));
}

/** Compare path sets and byte fingerprints without mutating either input. */
export function diffProvenance(expected: ProvenanceEntry[], actual: ProvenanceEntry[]): {
  missing: string[]; extra: string[]; changed: string[];
} {
  const before = new Map(expected.map(entry => [entry.path, entry.sha256]));
  const after = new Map(actual.map(entry => [entry.path, entry.sha256]));
  return {
    missing: [...before.keys()].filter(file => !after.has(file)).sort(),
    extra: [...after.keys()].filter(file => !before.has(file)).sort(),
    changed: [...before.keys()].filter(file => after.has(file) && after.get(file) !== before.get(file)).sort(),
  };
}
