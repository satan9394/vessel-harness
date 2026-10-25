import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface HarnessFingerprint {
  value: string;
  fileCount: number;
  /** Sorted, slash-separated paths relative to repoRoot. */
  files: string[];
}

const EXCLUDED = new Set(['dist', 'node_modules', '.harness', '.git']);

function excluded(name: string): boolean {
  return EXCLUDED.has(name) || name.startsWith('.tmp') || name.endsWith('.tsbuildinfo');
}

function entries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Only records harness identity; does not decide whether a run can be reused. */
export function computeHarnessFingerprint(repoRoot: string): HarnessFingerprint {
  const candidates: string[] = [];
  const walkSource = (dir: string): void => {
    for (const entry of entries(path.join(repoRoot, dir))) {
      if (excluded(entry.name)) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walkSource(rel);
      else if (entry.isFile() && entry.name.endsWith('.ts')) candidates.push(rel);
    }
  };
  for (const pkg of entries(path.join(repoRoot, 'packages'))) {
    if (!pkg.isDirectory() || excluded(pkg.name)) continue;
    for (const entry of entries(path.join(repoRoot, 'packages', pkg.name))) {
      if (entry.name === 'src' && entry.isDirectory()) walkSource(`packages/${pkg.name}/src`);
    }
  }
  for (const entry of entries(path.join(repoRoot, 'configs'))) {
    if (!excluded(entry.name) && entry.isFile() && /\.(yaml|json)$/.test(entry.name)) {
      candidates.push(`configs/${entry.name}`);
    }
  }
  if (entries(repoRoot).some((entry) => entry.name === 'package-lock.json' && entry.isFile())) {
    candidates.push('package-lock.json');
  }

  const hash = createHash('sha256');
  const files: string[] = [];
  for (const rel of candidates.sort()) {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(path.join(repoRoot, rel));
    } catch {
      continue; // A file disappearing during a build must not abort identity recording.
    }
    hash.update(rel).update('\0').update(bytes);
    files.push(rel);
  }
  return { value: hash.digest('hex').slice(0, 16), fileCount: files.length, files };
}
