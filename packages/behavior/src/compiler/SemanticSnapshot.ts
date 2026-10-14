import { createHash } from 'node:crypto';
import type { BehaviorCategory, BehaviorEntry, BehaviorEntryInspection, BehaviorIR } from '@vessel/shared';
import { BehaviorCompileError } from './BehaviorCompileError.js';

export function behaviorSnapshotHash(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function effectiveBehavior(layers: BehaviorIR[]): { ir: BehaviorIR; provenance: Map<string, BehaviorEntryInspection['provenance']> } {
  const entries = new Map<string, BehaviorEntry>();
  const provenance = new Map<string, BehaviorEntryInspection['provenance']>();
  for (const [index, layer] of layers.entries()) {
    // Programmatic callers receive the same validation as file imports.
    const seen = new Set<string>();
    for (const raw of layer.entries) {
      if (seen.has(raw.id)) throw new BehaviorCompileError(raw.id, raw.policy_ref ?? null, 'duplicate entry identity');
      seen.add(raw.id);
      const sourceRef = raw.sourceRef ?? raw.source ?? layer.sourceRef ?? `<layer:${index}>`;
      const entry = structuredClone(Object.fromEntries(Object.entries({ ...raw, sourceRef }).filter(([, value]) => value !== undefined))) as unknown as BehaviorEntry;
      entry.category ??= entry.channel === 'runtime_policy' ? 'Constraint' : ({ planning: 'Workflow', loop: 'Workflow', verification: 'Verification', context: 'ContextStrategy', tools: 'ToolStrategy', budget: 'ResourceBudget' } as Record<string, BehaviorCategory>)[entry.class] ?? 'Instruction';
      entry.enforcementChannel ??= entry.channel;
      const previous = entries.get(entry.id);
      const priority = entry.priority ?? index;
      if (entry.trust === 'untrusted' && (entry.channel === 'runtime_policy' || entry.permissions)) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'untrusted privileged declaration');
      if (entry.enforcementChannel !== undefined && entry.enforcementChannel !== entry.channel) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'enforcement channel conflicts with channel');
      const fields = provenance.get(entry.id) ?? {};
      const immutable = ['id', 'version', 'channel', 'enforcementChannel', 'policy_ref', 'category', 'conflictDomain', 'severity', 'trust'] as const;
      if (previous) {
        for (const field of immutable) if (entry[field] !== undefined && previous[field] !== undefined && entry[field] !== previous[field]) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, `immutable ${field} cannot be overridden`);
        if (priority < (previous.priority ?? fields.render?.priority ?? 0)) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'lower priority override');
        if (priority === (previous.priority ?? fields.render?.priority ?? 0) && entry.render !== previous.render) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'ambiguous equal-priority override');
      }
      const merged: BehaviorEntry = { ...previous, ...entry, priority };
      for (const [field] of Object.entries(entry)) {
        if (immutable.includes(field as typeof immutable[number]) && fields[field]) continue;
        fields[field] = { sourceRef, priority, strategy: immutable.includes(field as typeof immutable[number]) ? 'immutable' : 'replace' };
      }
      for (const field of ['assertions', 'applicability'] as const) if (previous?.[field] || entry[field]) {
        // Applicability describes covered contexts; union retains every upstream obligation.
        merged[field] = [...new Set([...(previous?.[field] ?? []), ...(entry[field] ?? [])])];
        fields[field] = { sourceRef, priority, strategy: 'deduplicate' };
        for (const item of entry[field] ?? []) fields[`${field}.${item}`] ??= { sourceRef, priority, strategy: 'deduplicate' };
      }
      if (previous?.permissions || entry.permissions) {
        const upstream = previous?.permissions;
        const next = entry.permissions;
        if (upstream?.allowedTools && next?.allowedTools?.some(tool => !upstream.allowedTools!.includes(tool))) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'allowedTools privilege escalation');
        if (upstream?.maxToolCalls !== undefined && next?.maxToolCalls !== undefined && next.maxToolCalls > upstream.maxToolCalls) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, 'maxToolCalls privilege escalation');
        merged.permissions = {
          ...upstream, ...next,
          deniedTools: [...new Set([...(upstream?.deniedTools ?? []), ...(next?.deniedTools ?? [])])],
        };
        fields.permissions = { sourceRef, priority, strategy: 'narrow' };
        for (const field of Object.keys(entry.permissions ?? {})) fields[`permissions.${field}`] = { sourceRef, priority, strategy: 'narrow' };
      }
      if (previous?.requiredCapabilities || entry.requiredCapabilities) {
        merged.requiredCapabilities = { ...previous?.requiredCapabilities, ...entry.requiredCapabilities };
        for (const [key, requirement] of Object.entries(entry.requiredCapabilities ?? {})) {
          const upstream = previous?.requiredCapabilities?.[key as keyof NonNullable<BehaviorEntry['requiredCapabilities']>];
          if (upstream !== undefined && (key === 'contextWindow' ? (requirement as number) < (upstream as number) : requirement !== upstream)) throw new BehaviorCompileError(entry.id, entry.policy_ref ?? null, `requiredCapabilities.${key} cannot be weakened or contradicted`);
          fields[`requiredCapabilities.${key}`] = { sourceRef, priority, strategy: 'narrow' };
        }
      }
      entries.set(entry.id, merged);
      provenance.set(entry.id, fields);
    }
  }
  return { ir: { version: layers.at(-1)!.version, entries: [...entries.values()] }, provenance };
}
