import type { BehaviorAssertionResult, BehaviorCategory, BehaviorInspection, PolicyArtifacts, ProviderCapabilities } from '@vessel/shared';
import type { BehaviorEntry, BehaviorIR } from '../ir/BehaviorIR.js';
import { CAPABILITY_KEYS, parseBehaviorIR } from '../ir/BehaviorIR.js';
import { behaviorSnapshotHash, effectiveBehavior } from './SemanticSnapshot.js';
import { BehaviorCompileError } from './BehaviorCompileError.js';
export { BehaviorCompileError } from './BehaviorCompileError.js';

export interface CompileOptions {
  layers?: BehaviorIR[];
  assertionResults?: Record<string, BehaviorAssertionResult[]>;
  unsupportedEntryIds?: string[];
  modelProfile?: { provider: string; model: string; capabilities?: ProviderCapabilities };
  supportedAssertionIds?: string[];
  /** Trusted enforcement revision: rule source alone cannot identify closed-over state. */
  policyRevision?: string;
}

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
  inspection: BehaviorInspection;
}

/**
 * behavior/compiler — L2/L3 render + dual-channel enforcement
 * (ARCHITECTURE §3.2 / D3 decision point 14).
 * channel=runtime_policy entries must resolve to a policy rule (policy_ref);
 * Missing enforcement aborts compilation before a candidate can be activated.
 */
export function compileBehavior(ir: BehaviorIR, policy: PolicyArtifacts, options: CompileOptions = {}): CompileResult {
  const inputs = [ir, ...(options.layers ?? [])];
  const layers: BehaviorIR[] = [];
  for (const layer of inputs) {
    // Missing runtime policy refs use the compiler's activation-blocking error.
    for (const entry of layer.entries) if (entry.channel === 'runtime_policy' && !entry.policy_ref?.trim()) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null);
    layers.push(parseBehaviorIR(JSON.stringify(layer), layer.sourceRef ?? `<layer:${layers.length}>`));
  }
  const effective = effectiveBehavior(layers);
  ir = effective.ir;
  const promptSections: string[] = [];
  const conformance: CompileResult['conformance'] = [];
  const warnings: string[] = [];
  const modelProfile = options.modelProfile ? { provider: options.modelProfile.provider, model: options.modelProfile.model, capabilities: options.modelProfile.capabilities ? Object.fromEntries([...CAPABILITY_KEYS].map(key => {
    const capability = options.modelProfile!.capabilities![key as keyof ProviderCapabilities];
    return [key, !capability || capability.status === 'unknown' ? { status: 'unknown' } : { status: capability.status, value: capability.value }];
  })) : null } : null;
  const enforcement = { deniedTools: policy.deniedTools, profile: policy.profile, approval: policy.approval, fsConfig: policy.fsConfig, shellAllow: policy.shellAllow, policyRevision: options.policyRevision ?? null, rules: policy.rules.map(rule => ({ id: rule.id, domain: rule.domain, action: rule.action, matcher: typeof rule.match === 'function' ? rule.match.toString() : null })) };
  const inspection: BehaviorInspection = { version: ir.version, snapshotHash: behaviorSnapshotHash({ effectiveIR: ir, enforcement, modelProfile }), entries: [], layers: [], diagnostics: [] };

  for (const entry of ir.entries) {
    const category: BehaviorCategory = entry.category ?? (entry.channel === 'runtime_policy' ? 'Constraint' : ({ planning: 'Workflow', loop: 'Workflow', verification: 'Verification', context: 'ContextStrategy', tools: 'ToolStrategy', budget: 'ResourceBudget' } as Record<string, BehaviorCategory>)[entry.class] ?? 'Instruction');
    const unsupportedCapabilities = Object.entries(entry.requiredCapabilities ?? {}).filter(([key, required]) => {
      const capability = options.modelProfile?.capabilities?.[key as keyof ProviderCapabilities];
      if (!capability || capability.status === 'unknown') return true;
      return key === 'contextWindow' ? typeof capability.value !== 'number' || capability.value < (required as number) : capability.value !== required;
    }).map(([key]) => key);
    const unsupported = (options.unsupportedEntryIds?.includes(entry.id) ?? false) || unsupportedCapabilities.length > 0;
    const assertions = entry.assertions ?? [];
    const assertionResults = options.assertionResults?.[entry.id] ?? [];
    if (entry.channel === 'runtime_policy' && unsupported) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, `required model feature is unsupported or unknown${unsupportedCapabilities.length ? `: ${unsupportedCapabilities.join(', ')}` : ''}`);
    if (entry.channel === 'runtime_policy' && entry.severity === 'critical' && assertions.length === 0) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'critical constraint requires conformance assertions');
    if (entry.channel === 'runtime_policy' && entry.severity === 'critical' && assertions.some(id => !options.supportedAssertionIds?.includes(id))) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'critical constraint requires registered conformance assertions');
    const ruleIds = entry.policy_ref ? policy.rules.filter(rule => hasDomainEnforcement(entry.policy_ref!, { ...policy, rules: [rule], deniedTools: [] })).map(rule => rule.id) : [];
    if (entry.policy_ref === 'tools.deny' && policy.deniedTools.length) ruleIds.push(...policy.deniedTools.map(tool => `denied-tool:${tool}`));
    const verified = !!options.policyRevision?.trim() && assertions.length > 0 && assertions.every(id => assertionResults.some(result => result.assertionId === id && result.passed && result.evidence.trim() && result.snapshotHash === inspection.snapshotHash)) && !assertionResults.some(result => assertions.includes(result.assertionId) && result.snapshotHash === inspection.snapshotHash && !result.passed);
    inspection.entries.push({ id: entry.id, category, sourceRef: entry.sourceRef!, priority: entry.priority ?? 0, channel: entry.channel, compatibility: unsupported ? 'Renderable' : entry.channel === 'runtime_policy' ? verified ? 'Verified' : 'Enforceable' : 'Mappable', policyRef: entry.policy_ref ?? null, policyRuleIds: ruleIds, assertions: [...assertions], assertionResults: structuredClone(assertionResults), provenance: effective.provenance.get(entry.id)! });
    if (unsupported) {
      const message = `Behavior ${entry.id}: model profile cannot preserve the requested feature${unsupportedCapabilities.length ? ` (${unsupportedCapabilities.join(', ')} unsupported or unknown)` : ''}; prompt guidance only.`;
      warnings.push(message);
      inspection.diagnostics.push({ entryId: entry.id, severity: 'warning', code: 'MODEL_DEGRADATION', message, sourceRef: entry.sourceRef! });
    }
    if (entry.permissions) {
      // ponytail: permission declarations cannot create runtime mechanisms.
      const p = entry.permissions;
      if (entry.channel === 'runtime_policy' && (p.allowedTools !== undefined || p.maxToolCalls !== undefined || p.deniedTools?.some(tool => !policy.deniedTools.includes(tool)))) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'permission declaration has no matching runtime enforcement');
      if (entry.channel === 'prompt_guidance') {
        const message = `Behavior ${entry.id}: permissions are guidance metadata, not runtime enforcement.`;
        warnings.push(message);
        inspection.diagnostics.push({ entryId: entry.id, severity: 'warning', code: 'PERMISSION_GUIDANCE_ONLY', message, sourceRef: entry.sourceRef! });
      }
    }
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
    if (!found) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null);
    promptSections.push(entry.render);
  }

  const harnessConfig = { deniedTools: [...policy.deniedTools], profile: policy.profile, approval: policy.approval };
  const sourceRefs = [...new Set(layers.flatMap(layer => layer.entries.map(entry => entry.sourceRef!)))];
  const snapshots: unknown[] = [structuredClone(layers), structuredClone(ir), { promptSections: [...promptSections], modelProfile }, { harnessConfig, conformance: structuredClone(conformance), mappings: inspection.entries.map(entry => ({ entryId: entry.id, policyRef: entry.policyRef, ruleIds: entry.policyRuleIds })) }];
  inspection.layers = snapshots.map((snapshot, index) => ({ level: `L${index}` as 'L0' | 'L1' | 'L2' | 'L3', status: 'available', sourceRefs, snapshot, snapshotHash: behaviorSnapshotHash(snapshot) }));
  inspection.layers.push({ level: 'L4', status: 'unavailable', sourceRefs, snapshot: null, reason: 'RequestEnvelope is available only after actual request composition.' });
  return {
    promptSections,
    harnessConfig,
    conformance,
    warnings,
    inspection,
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
 * Custom references require an exact restrictive rule ID, never a prefix.
 */
export function hasDomainEnforcement(ref: string, policy: PolicyArtifacts): boolean {
  if (!ref || ref.trim() !== ref) return false;
  const dot = ref.indexOf('.');
  const domain = dot === -1 ? ref : ref.slice(0, dot);
  const key = dot === -1 ? '' : ref.slice(dot + 1);
  const rules = policy.rules.filter((r) => typeof r.match === 'function' && (r.action === 'deny' || r.action === 'ask'));

  if (domain === 'filesystem') {
    // protected claim <-> fs-protected:* rules; deny_read claim <-> fs-deny-read:*
    const prefix = key === 'protected' ? 'fs-protected:' : key === 'deny_read' || key === 'deny-read' ? 'fs-deny-read:' : '';
    if (prefix) return rules.some((r) => r.domain === 'filesystem' && r.id.startsWith(prefix) && r.action === 'deny');
    if (key === 'confinement') return rules.some((r) => r.domain === 'filesystem' && r.id === 'fs-confinement' && r.action === 'deny');
  }
  if (domain === 'shell') {
    if (key === 'deny') return rules.some((r) => r.domain === 'shell' && r.id.startsWith('shell-deny:') && r.action === 'deny');
    // shell.<category> (e.g. shell.destructive-delete) -> shell-deny:<category>
    if (key) return rules.some((r) => r.domain === 'shell' && r.id === `shell-deny:${key}` && r.action === 'deny');
  }
  if (domain === 'tools' && key === 'deny') {
    return policy.deniedTools.length > 0 || rules.some((r) => r.domain === 'tools' && r.action === 'deny');
  }
  if (domain === 'git') {
    if (key === 'force_push') return rules.some((r) => r.domain === 'git' && r.id === 'git:force-push');
  }
  if (domain === 'network') {
    if (key === 'deny_domains') return rules.some((r) => r.domain === 'network' && r.id.startsWith('net-deny:') && r.action === 'deny');
  }
  return rules.some((r) => r.id === ref);
}

export function behaviorEntryPrompt(entry: BehaviorEntry): string {
  return entry.render;
}
