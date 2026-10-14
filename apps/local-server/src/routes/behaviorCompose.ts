import { composeBehaviorCandidate } from '@vessel/application';
import type { BehaviorEntry, PolicyArtifacts } from '@vessel/shared';

/**
 * UI-015 write side: verify a staged behavior composition without activating it.
 * Validation happens here; compilation is delegated to the shared behavior
 * compiler via the application layer, so the Studio cannot bypass the same gate
 * a real session uses.
 */
export class BehaviorComposeRoutes {
  constructor(private readonly resolvePolicy: (sessionId: string | null) => PolicyArtifacts | undefined) {}

  compose(body: unknown): { status: number; body: unknown } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'invalid_composition' } };
    const draft = body as { entries?: unknown; sessionId?: unknown };
    if (!Array.isArray(draft.entries) || draft.entries.length === 0 || draft.entries.length > 64) return { status: 400, body: { error: 'invalid_composition' } };
    if (!draft.entries.every(isBehaviorEntry)) return { status: 400, body: { error: 'invalid_composition' } };
    const sessionId = typeof draft.sessionId === 'string' && draft.sessionId.trim() ? draft.sessionId : null;
    const policy = this.resolvePolicy(sessionId);
    if (!policy) return { status: 404, body: { error: 'policy_unavailable' } };
    const report = composeBehaviorCandidate({ entries: draft.entries as BehaviorEntry[], sessionId: sessionId ?? undefined }, { policy });
    return { status: 200, body: report };
  }
}

function isBehaviorEntry(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === 'string' && entry.id.trim().length > 0
    && typeof entry.class === 'string' && entry.class.trim().length > 0
    && (entry.channel === 'prompt_guidance' || entry.channel === 'runtime_policy')
    && typeof entry.render === 'string';
}
