import { loadBehaviorIR } from '@vessel/behavior';
import type { BehaviorEntry } from '@vessel/shared';

/** UI-015 — the reusable behavior library the Studio Composer draws rules from. */
export function loadBehaviorLibrary(filePath: string): BehaviorEntry[] {
  return loadBehaviorIR(filePath).entries.map((entry) => structuredClone(entry));
}
