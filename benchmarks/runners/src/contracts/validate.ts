/**
 * task 076 — Harness Adapter Contract validation.
 *
 * Every `RunResult` and `HarnessAdapter` an adapter (Vessel self-adapter or an
 * external 077-081 adapter) hands back MUST pass validation: all §15 L3 fields
 * present, correct types, and sane ranges. Validation is fail-loud — a missing
 * metric field is an adapter bug, not a silent NaN to aggregate.
 */
import type { HarnessAdapter, RunResult, RunResultMetrics } from './types.js';

export interface RunResultValidationIssue {
  field: string;
  message: string;
}

/** Numeric metrics that must be non-negative. */
const NON_NEG = [
  'wallTimeMs',
  'toolCalls',
  'invalidCalls',
  'retries',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'contextPeak',
  'compactions',
  'humanIntervention',
  'policyViolations',
] as const;

/** Validate a RunResultMetrics object. Returns [] when valid. */
export function validateRunResultMetrics(m: RunResultMetrics): RunResultValidationIssue[] {
  const issues: RunResultValidationIssue[] = [];
  if (m === null || typeof m !== 'object') {
    return [{ field: 'metrics', message: 'metrics must be an object' }];
  }
  if (typeof m.success !== 'boolean') {
    issues.push({ field: 'metrics.success', message: `expected boolean, got ${typeof m.success}` });
  }
  for (const key of NON_NEG) {
    const v = (m as unknown as Record<string, unknown>)[key];
    if (typeof v !== 'number' || Number.isNaN(v)) {
      issues.push({ field: `metrics.${key}`, message: `expected number, got ${String(v)}` });
    } else if (v < 0) {
      issues.push({ field: `metrics.${key}`, message: `expected >= 0, got ${v}` });
    }
  }
  if (typeof m.costUsd !== 'number' || Number.isNaN(m.costUsd) || m.costUsd < 0) {
    issues.push({ field: 'metrics.costUsd', message: `expected number >= 0, got ${String(m.costUsd)}` });
  }
  if (m.resumeSuccess !== null && typeof m.resumeSuccess !== 'boolean') {
    issues.push({ field: 'metrics.resumeSuccess', message: `expected boolean | null, got ${String(m.resumeSuccess)}` });
  }
  return issues;
}

/** Validate a full RunResult. Returns [] when valid. */
export function validateRunResult(r: RunResult): RunResultValidationIssue[] {
  const issues: RunResultValidationIssue[] = [];
  if (r === null || typeof r !== 'object') return [{ field: 'result', message: 'run() must return an object' }];
  if (typeof r.adapterId !== 'string' || r.adapterId.length === 0) {
    issues.push({ field: 'adapterId', message: 'required non-empty string' });
  }
  if (typeof r.adapterVersion !== 'string' || r.adapterVersion.length === 0) {
    issues.push({ field: 'adapterVersion', message: 'required non-empty string' });
  }
  if (typeof r.fixtureId !== 'string' || r.fixtureId.length === 0) {
    issues.push({ field: 'fixtureId', message: 'required non-empty string' });
  }
  if (typeof r.startedAt !== 'string' || Number.isNaN(Date.parse(r.startedAt))) {
    issues.push({ field: 'startedAt', message: 'required ISO timestamp string' });
  }
  const metricIssues = validateRunResultMetrics(r.metrics);
  for (const i of metricIssues) issues.push(i);
  if (r.artifacts !== undefined) {
    if (!Array.isArray(r.artifacts)) {
      issues.push({ field: 'artifacts', message: 'expected array of {kind,path}' });
    } else {
      for (const a of r.artifacts) {
        if (!a || typeof a.kind !== 'string' || typeof a.path !== 'string') {
          issues.push({ field: 'artifacts[]', message: 'each artifact must be {kind:string,path:string}' });
        }
      }
    }
  }
  if (r.notes !== undefined && !Array.isArray(r.notes)) {
    issues.push({ field: 'notes', message: 'expected array of strings' });
  }
  return issues;
}

/** Validate an adapter's static contract surface (id/version/capabilities). */
export function validateHarnessAdapter(a: HarnessAdapter): RunResultValidationIssue[] {
  const issues: RunResultValidationIssue[] = [];
  if (!a || typeof a !== 'object') return [{ field: 'adapter', message: 'adapter must be an object' }];
  if (typeof a.id !== 'string' || a.id.length === 0) issues.push({ field: 'adapter.id', message: 'required non-empty string' });
  if (typeof a.version !== 'string' || a.version.length === 0) issues.push({ field: 'adapter.version', message: 'required non-empty string' });
  if (typeof a.run !== 'function') issues.push({ field: 'adapter.run', message: 'must be a function' });
  if (!a.capabilities || typeof a.capabilities !== 'object' || Array.isArray(a.capabilities)) {
    issues.push({ field: 'adapter.capabilities', message: 'required capabilities map (Record<CapabilityKey, boolean | "tbd">)' });
  }
  return issues;
}

/** Convenience: throw when any validation issue is present. */
export function assertValidRunResult(r: RunResult): void {
  const issues = validateRunResult(r);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.field}: ${i.message}`).join('; ');
    throw new Error(`invalid RunResult (${r?.adapterId ?? '?'}): ${detail}`);
  }
}

/** Convenience: throw when the adapter surface is invalid. */
export function assertValidHarnessAdapter(a: HarnessAdapter): void {
  const issues = validateHarnessAdapter(a);
  if (issues.length > 0) {
    const detail = issues.map((i) => `${i.field}: ${i.message}`).join('; ');
    throw new Error(`invalid HarnessAdapter (${a?.id ?? '?'}): ${detail}`);
  }
}