import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeHarnessFingerprint } from '@vessel/engine';

export interface ReuseAssessment {
  ok: boolean;
  reasons: string[];
}

/** Read-only readiness assessment; it never reuses a run or skips execution. */
export function assessRunReusability(runDir: string, repoRoot: string): ReuseAssessment {
  const reasons: string[] = [];
  const read = <T>(operation: () => T): T | undefined => {
    try { return operation(); }
    catch (error) { reasons.push(`read: ${error instanceof Error ? error.message : String(error)}`); return undefined; }
  };
  const directory = (dir: string, label: string): void => {
    read(() => {
      if (!fs.existsSync(dir)) reasons.push(`missing ${label}`);
      else if (!fs.statSync(dir).isDirectory()) reasons.push(`${label} is not a directory`);
    });
  };
  const json = (name: string): Record<string, unknown> | undefined => read(() => {
    const file = path.join(runDir, name);
    if (!fs.existsSync(file)) { reasons.push(`missing ${name}`); return undefined; }
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { reasons.push(`${name} must be an object`); return undefined; }
    return value as Record<string, unknown>;
  });

  directory(runDir, 'runDir');
  const summary = json('summary.json');
  if (summary && summary.success !== true) reasons.push('summary.json success must be true');
  const marker = json('.run-complete.json');
  if (marker && marker.version !== 1) reasons.push('.run-complete.json version must be 1');
  if (marker && (typeof marker.fingerprint !== 'string' || !marker.fingerprint.trim())) reasons.push('.run-complete.json fingerprint must be nonempty');
  const fingerprint = read(() => computeHarnessFingerprint(repoRoot).value);
  if (marker && typeof marker.fingerprint === 'string' && fingerprint !== undefined && marker.fingerprint !== fingerprint) reasons.push('fingerprint mismatch');
  if (summary) for (const field of ['reportPath', 'sessionLog']) {
    if (!(field in summary)) continue;
    read(() => {
      const value = summary[field];
      if (typeof value !== 'string' || !value.trim()) { reasons.push(`${field} must be a nonempty path`); return; }
      // Runner records report paths rooted at repoRoot and absolute session log paths.
      const file = path.resolve(repoRoot, value);
      if (!fs.existsSync(file)) reasons.push(`missing ${field}: ${value}`);
      else {
        const stat = fs.statSync(file);
        if (!stat.isFile() || stat.size === 0) reasons.push(`${field} must be a nonempty file: ${value}`);
      }
    });
  }
  directory(path.join(runDir, 'workspace'), 'workspace/');
  return { ok: reasons.length === 0, reasons };
}
