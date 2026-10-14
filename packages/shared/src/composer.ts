import type { BehaviorCategory, BehaviorChannel, BehaviorCompatibility, BehaviorDiagnostic, BehaviorEntry } from './behavior.js';

/**
 * UI-015 (Agent Studio Composer) shared contract.
 *
 * The Composer lets a user *stage* behavior rules, reorder priorities, detect
 * conflicts, and request a live conformance report — but activation is still
 * gated by the same `compileBehavior` used for real sessions. A rejected
 * candidate can never be activated.
 */

export interface BehaviorCompositionDraft {
  entries: BehaviorEntry[];
  /** optional session whose live policy/behavior snapshot the candidate is checked against. */
  sessionId?: string;
}

export interface BehaviorConflict {
  /** conflict bucket: explicit `conflictDomain`, else `class` (+ channel). */
  domain: string;
  entryIds: string[];
  severity: 'warning' | 'error';
  code: 'duplicate_id' | 'missing_enforcement' | 'critical_without_assertions' | 'conflicting_guidance' | 'priority_tie';
  message: string;
}

export interface BehaviorConformanceEntry {
  entryId: string;
  category: BehaviorCategory;
  channel: BehaviorChannel;
  priority: number;
  policyRef: string | null;
  policyRuleFound: boolean;
  compatibility: BehaviorCompatibility;
}

export interface BehaviorConformanceReport {
  snapshotHash: string;
  /** `rejected` = compile-blocking conflict; activation must be refused. */
  verdict: 'verified' | 'enforceable' | 'incomplete' | 'rejected';
  conflicts: BehaviorConflict[];
  conformance: BehaviorConformanceEntry[];
  diagnostics: BehaviorDiagnostic[];
  warnings: string[];
  levels: { level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'; status: 'available' | 'unavailable' }[];
}

/**
 * Deterministic, side-effect-free conflict scan over staged entries. Runs before
 * compilation so the UI can explain *why* a candidate is invalid even when the
 * compiler would throw on the first offender.
 */
export function detectBehaviorConflicts(entries: readonly BehaviorEntry[]): BehaviorConflict[] {
  const conflicts: BehaviorConflict[] = [];
  const seen = new Map<string, number>();
  for (const entry of entries) {
    seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);
  }
  for (const [id, count] of [...seen.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (count > 1) conflicts.push({ domain: id, entryIds: [id], severity: 'error', code: 'duplicate_id', message: `Behavior id "${id}" appears ${count} times.` });
  }
  for (const entry of entries) {
    if (entry.channel === 'runtime_policy' && !entry.policy_ref?.trim()) {
      conflicts.push({ domain: entry.conflictDomain ?? entry.class, entryIds: [entry.id], severity: 'error', code: 'missing_enforcement', message: `Runtime constraint "${entry.id}" has no policy_ref.` });
    }
    if (entry.channel === 'runtime_policy' && entry.severity === 'critical' && (entry.assertions ?? []).length === 0) {
      conflicts.push({ domain: entry.conflictDomain ?? entry.class, entryIds: [entry.id], severity: 'error', code: 'critical_without_assertions', message: `Critical constraint "${entry.id}" requires conformance assertions.` });
    }
  }
  const buckets = new Map<string, BehaviorEntry[]>();
  for (const entry of entries) {
    const domain = entry.conflictDomain ?? `${entry.class}:${entry.channel}`;
    const bucket = buckets.get(domain) ?? [];
    bucket.push(entry);
    buckets.set(domain, bucket);
  }
  for (const [domain, bucket] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (bucket.length < 2) continue;
    const renders = new Set(bucket.map((entry) => entry.render));
    if (renders.size > 1) {
      conflicts.push({ domain, entryIds: bucket.map((entry) => entry.id).sort(), severity: 'warning', code: 'conflicting_guidance', message: `${bucket.length} entries in domain "${domain}" render conflicting guidance.` });
    }
    const byPriority = new Map<number, string[]>();
    for (const entry of bucket) {
      const list = byPriority.get(entry.priority ?? 0) ?? [];
      list.push(entry.id);
      byPriority.set(entry.priority ?? 0, list);
    }
    for (const [priority, ids] of [...byPriority.entries()].sort(([a], [b]) => a - b)) {
      if (ids.length > 1) conflicts.push({ domain, entryIds: ids.sort(), severity: 'warning', code: 'priority_tie', message: `${ids.length} entries in domain "${domain}" share priority ${priority}; ordering is unstable.` });
    }
  }
  return conflicts;
}

/** Verdict derived from conflicts + per-entry conformance facts (never optimistic). */
export function behaviorConformanceVerdict(
  conflicts: readonly BehaviorConflict[],
  conformance: readonly BehaviorConformanceEntry[],
): BehaviorConformanceReport['verdict'] {
  if (conflicts.some((conflict) => conflict.severity === 'error')) return 'rejected';
  if (conformance.some((entry) => entry.channel === 'runtime_policy' && !entry.policyRuleFound)) return 'incomplete';
  if (conformance.length > 0 && conformance.every((entry) => entry.compatibility === 'Verified')) return 'verified';
  return 'enforceable';
}
