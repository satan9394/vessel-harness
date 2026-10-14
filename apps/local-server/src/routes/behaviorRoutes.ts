import type { BehaviorInspection } from '@vessel/shared';

/** Only activated session snapshots are inspectable; never compile a UI-only candidate. */
export class BehaviorRoutes {
  constructor(private readonly snapshot: (sessionId: string) => BehaviorInspection | undefined) {}

  inspect(sessionId: string | null): { sessionId: string; inspection: BehaviorInspection } | undefined {
    if (!sessionId) return undefined;
    const inspection = this.snapshot(sessionId);
    return inspection ? { sessionId, inspection: structuredClone(inspection) } : undefined;
  }
}
