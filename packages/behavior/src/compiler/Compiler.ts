import type { PolicyArtifacts } from '@vessel/shared';
import type { BehaviorEntry, BehaviorIR } from '../ir/BehaviorIR.js';

export interface CompileResult {
  /** stable-layer prompt sections (L2 render output) */
  promptSections: string[];
  harnessConfig: {
    deniedTools: string[];
    profile: string;
    approval: string;
  };
  /** conformance check results — for Evaluator / Conformance Suite assertions */
  conformance: { entryId: string; channel: string; policyRef: string | null; policyRuleFound: boolean }[];
  warnings: string[];
}

/**
 * behavior/compiler — L2/L3 render + dual-channel enforcement
 * (ARCHITECTURE §3.2 / D3 decision point 14).
 * channel=runtime_policy entries must resolve to a policy rule (policy_ref);
 * missing enforcement => compile warning (never silently dropped).
 */
export function compileBehavior(ir: BehaviorIR, policy: PolicyArtifacts): CompileResult {
  const promptSections: string[] = [];
  const conformance: CompileResult['conformance'] = [];
  const warnings: string[] = [];

  for (const entry of ir.entries) {
    if (entry.channel === 'prompt_guidance') {
      promptSections.push(entry.render);
      conformance.push({ entryId: entry.id, channel: entry.channel, policyRef: null, policyRuleFound: true });
      continue;
    }
    // runtime_policy — resolve policy_ref against the compiled artifacts.
    // ref points to a policy DOMAIN (e.g. filesystem.protected), so enforcement
    // is verified at domain level (rules of that domain with the right action).
    const ref = entry.policy_ref ?? '';
    const found = hasDomainEnforcement(ref, policy);
    conformance.push({ entryId: entry.id, channel: entry.channel, policyRef: ref, policyRuleFound: found });
    if (!found) {
      warnings.push(`behavior "${entry.id}" (channel=runtime_policy, policy_ref=${ref}) has NO matching policy rule — enforcement missing!`);
    } else {
      promptSections.push(entry.render);
    }
  }

  return {
    promptSections,
    harnessConfig: {
      deniedTools: policy.deniedTools,
      profile: policy.profile,
      approval: policy.approval,
    },
    conformance,
    warnings,
  };
}

/**
 * Dual-channel enforcement check (D4 §7.2): does the compiled policy actually
 * enforce what this entry claims? policy_ref points at a DECLARATION key
 * (e.g. "filesystem.protected"); the compiler mints rule ids from that same
 * declaration (fs-protected:<glob>, shell-deny:<category>, …), so we match the
 * ref against those rule ids at RULE level — a claim of "filesystem.protected"
 * is only satisfied by an actual fs-protected:* rule, not by any filesystem
 * deny (e.g. a lone fs-deny-read would previously pass the domain check).
 * A domain-level fallback remains for refs the id scheme does not cover.
 */
export function hasDomainEnforcement(ref: string, policy: PolicyArtifacts): boolean {
  const dot = ref.indexOf('.');
  const domain = dot === -1 ? ref : ref.slice(0, dot);
  const key = dot === -1 ? '' : ref.slice(dot + 1);
  const rules = policy.rules;

  if (domain === 'filesystem') {
    // protected claim <-> fs-protected:* rules; deny_read claim <-> fs-deny-read:*
    const prefix = key === 'protected' ? 'fs-protected:' : key === 'deny_read' || key === 'deny-read' ? 'fs-deny-read:' : '';
    if (prefix) return rules.some((r) => r.id.startsWith(prefix) && r.action === 'deny');
    // fall through to prefix fallback for ad-hoc ids
  }
  if (domain === 'shell') {
    if (key === 'deny') return rules.some((r) => r.id.startsWith('shell-deny:') && r.action === 'deny');
    // shell.<category> (e.g. shell.destructive-delete) -> shell-deny:<category>
    if (key) return rules.some((r) => r.id === `shell-deny:${key}` && r.action === 'deny');
  }
  if (domain === 'tools' && key === 'deny') {
    return policy.deniedTools.length > 0 || rules.some((r) => r.domain === 'tools' && r.action === 'deny');
  }
  if (domain === 'git') {
    if (key === 'force_push') return rules.some((r) => r.id === 'git:force-push');
    return rules.some((r) => r.domain === 'git');
  }
  if (domain === 'network') {
    return rules.some((r) => r.domain === 'network');
  }
  // fallback: rule id prefix match for refs the scheme above does not cover
  return rules.some((r) => r.id.startsWith(ref) || ref.startsWith(r.id));
}

export function behaviorEntryPrompt(entry: BehaviorEntry): string {
  return entry.render;
}
