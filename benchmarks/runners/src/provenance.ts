import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // Text fixtures arrive as LF on CI and can be CRLF on a Windows worktree, so
  // hash newline-normalized bytes: the manifest must not depend on checkout.
  const digest = (buffer: Buffer): string => {
    const normalized = buffer.includes(0) ? buffer : Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
    return createHash('sha256').update(normalized).digest('hex');
  };
  return files.sort().map(rel => ({
    path: rel,
    sha256: digest(fs.readFileSync(path.join(repoRoot, rel))),
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

/** Regenerate the manifest from the current fixture and scenario bytes. */
export function writeProvenance(repoRoot: string): ProvenanceManifest {
  const manifest: ProvenanceManifest = { version: 1, generatedAt: new Date().toISOString(), entries: collectProvenance(repoRoot) };
  const file = path.join(repoRoot, 'configs/benchmark-provenance.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/** Missing or malformed manifests are distinct from valid manifests with stale entries. */
export function checkProvenance(repoRoot: string): {
  ok: boolean; manifest: ProvenanceManifest | null; diff: ReturnType<typeof diffProvenance>;
} {
  let manifest: ProvenanceManifest;
  try {
    const value = JSON.parse(fs.readFileSync(path.join(repoRoot, 'configs/benchmark-provenance.json'), 'utf8'));
    if (value === null || value.version !== 1 || typeof value.generatedAt !== 'string'
      || Number.isNaN(Date.parse(value.generatedAt)) || !Array.isArray(value.entries)
      || !value.entries.every((entry: unknown) => entry !== null && typeof entry === 'object'
        && 'path' in entry && typeof entry.path === 'string'
        && 'sha256' in entry && typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256))) {
      return { ok: false, manifest: null, diff: { missing: [], extra: [], changed: [] } };
    }
    manifest = value;
  } catch {
    return { ok: false, manifest: null, diff: { missing: [], extra: [], changed: [] } };
  }
  const diff = diffProvenance(manifest.entries, collectProvenance(repoRoot));
  return { ok: !diff.missing.length && !diff.extra.length && !diff.changed.length, manifest, diff };
}

export function main(argv: string[]): number {
  let repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') write = true;
    else if (arg === '--project' && argv[i + 1]) repoRoot = path.resolve(argv[++i]!);
    else if (arg !== '--check') {
      console.error('Usage: provenance.ts [--write | --check] [--project <dir>]');
      return 2;
    }
  }
  if (write) {
    console.log(`wrote ${writeProvenance(repoRoot).entries.length} entries`);
    return 0;
  }
  const result = checkProvenance(repoRoot);
  if (!result.manifest) {
    console.log('no manifest; run with --write');
    return 1;
  }
  if (result.ok) {
    console.log(`ok: ${result.manifest.entries.length} entries match`);
    return 0;
  }
  for (const group of ['missing', 'extra', 'changed'] as const) {
    const files = result.diff[group];
    if (!files.length) continue;
    console.log(`${group}:`);
    for (const file of files.slice(0, 10)) console.log(`  ${file}`);
    if (files.length > 10) console.log(`  … and ${files.length - 10} more`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
