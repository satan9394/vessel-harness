/** 本卡只提供判定原语，复用策略属后续卡。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeHarnessFingerprint } from '@vessel/engine';

export interface CompletedRun {
  scenarioId: string;
  runId: string;
  dir: string;
  fingerprint: string;
  fileCount: number;
  finishedAt: string;
}

/** Lists valid completion markers for one scenario, newest first. */
export function listCompletedRuns(reportsDir: string, scenarioId: string): CompletedRun[] {
  const scenarioDir = path.resolve(reportsDir, scenarioId);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scenarioDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs: CompletedRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^run_\d+_[0-9a-f]+$/.test(entry.name)) continue;
    const dir = path.resolve(scenarioDir, entry.name);
    try {
      const marker = JSON.parse(fs.readFileSync(path.join(dir, '.run-complete.json'), 'utf8'));
      if (
        marker === null || typeof marker !== 'object' || marker.version !== 1 ||
        typeof marker.fingerprint !== 'string' || marker.fingerprint.length === 0 ||
        !Number.isInteger(marker.fileCount) || marker.fileCount < 0 ||
        typeof marker.finishedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(marker.finishedAt) ||
        !Number.isFinite(Date.parse(marker.finishedAt))
      ) continue;
      runs.push({
        scenarioId, runId: entry.name, dir,
        fingerprint: marker.fingerprint, fileCount: marker.fileCount, finishedAt: marker.finishedAt,
      });
    } catch {
      // Missing, unreadable or malformed markers are not completed runs.
    }
  }
  return runs.sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
}

/** Finds the latest completed run matching the current harness identity. */
export function findReusableRun(reportsDir: string, scenarioId: string, repoRoot: string): CompletedRun | null {
  const fingerprint = computeHarnessFingerprint(repoRoot).value;
  return listCompletedRuns(reportsDir, scenarioId).find((run) => run.fingerprint === fingerprint) ?? null;
}
