import { BehaviorCompileError, compileBehavior } from '@vessel/behavior';
import {
  behaviorConformanceVerdict,
  detectBehaviorConflicts,
  type BehaviorAssertionResult,
  type BehaviorConformanceReport,
  type BehaviorCompositionDraft,
  type BehaviorDiagnostic,
  type BehaviorIR,
  type PolicyArtifacts,
} from '@vessel/shared';

/** UI-015 — options supplied by the local-server (live policy + optional assertions). */
export interface ComposeCandidateOptions {
  policy: PolicyArtifacts;
  policyRevision?: string;
  layers?: BehaviorIR[];
  assertionResults?: Record<string, BehaviorAssertionResult[]>;
  supportedAssertionIds?: string[];
  unsupportedEntryIds?: string[];
}

/**
 * Compose a staged behavior candidate into a live conformance report.
 *
 * Activation is delegated to the *same* `compileBehavior` gate used for real
 * sessions: a candidate that would fail to compile is reported as `rejected`
 * with the exact diagnostic, never silently activated.
 */
export function composeBehaviorCandidate(draft: BehaviorCompositionDraft, options: ComposeCandidateOptions): BehaviorConformanceReport {
  const conflicts = detectBehaviorConflicts(draft.entries);
  const ir: BehaviorIR = { version: '1.0', entries: draft.entries.map((entry) => structuredClone(entry)), sourceRef: 'studio:composer' };
  try {
    const result = compileBehavior(ir, options.policy, {
      layers: options.layers,
      policyRevision: options.policyRevision,
      assertionResults: options.assertionResults,
      supportedAssertionIds: options.supportedAssertionIds,
      unsupportedEntryIds: options.unsupportedEntryIds,
    });
    const conformance = result.inspection.entries.map((entry) => ({
      entryId: entry.id,
      category: entry.category,
      channel: entry.channel,
      priority: entry.priority,
      policyRef: entry.policyRef,
      policyRuleFound: result.conformance.find((item) => item.entryId === entry.id)?.policyRuleFound ?? false,
      compatibility: entry.compatibility,
    }));
    return {
      snapshotHash: result.inspection.snapshotHash,
      verdict: behaviorConformanceVerdict(conflicts, conformance),
      conflicts,
      conformance,
      diagnostics: result.inspection.diagnostics,
      warnings: result.warnings,
      levels: result.inspection.layers.map((layer) => ({ level: layer.level, status: layer.status })),
    };
  } catch (error) {
    if (!(error instanceof BehaviorCompileError)) throw error;
    const diagnostic: BehaviorDiagnostic = { entryId: error.entryId, severity: 'error', code: 'COMPILE_FAILED', message: error.message, sourceRef: 'studio:composer' };
    return {
      snapshotHash: '',
      verdict: 'rejected',
      conflicts: [...conflicts, { domain: error.entryId, entryIds: [error.entryId], severity: 'error', code: 'missing_enforcement', message: error.message }],
      conformance: [],
      diagnostics: [diagnostic],
      warnings: [],
      levels: [],
    };
  }
}
