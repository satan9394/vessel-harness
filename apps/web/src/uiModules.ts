/**
 * Vessel Local Web — UI module toggles (task 043).
 *
 * The Customize panel checkbox state (Team / Tasks / Changed Files / Context /
 * Tool Activity / Logs / Cost / MCP / Policy) persists to localStorage under a
 * single JSON key. Storage is injected so the logic is unit-testable under the
 * node environment (which has no `localStorage`); in the browser it defaults to
 * the real `window.localStorage`.
 */

/** Ordered module ids shown in the Customize panel. */
export const UI_MODULES = [
  'Team',
  'Tasks',
  'ChangedFiles',
  'Context',
  'ToolActivity',
  'Logs',
  'Cost',
  'MCP',
  'Policy',
] as const;

export type UiModuleId = (typeof UI_MODULES)[number];

export type UiModuleState = Record<UiModuleId, boolean>;

/** localStorage key persisted by the Customize panel. */
export const STORAGE_KEY = 'vessel.ui.modules';

/** Default: only Tasks + Changed Files on — "能力丰富界面安静". */
export const DEFAULT_MODULES: UiModuleState = {
  Team: false,
  Tasks: true,
  ChangedFiles: true,
  Context: false,
  ToolActivity: false,
  Logs: false,
  Cost: false,
  MCP: false,
  Policy: false,
};

/** Minimal storage contract so tests can inject an in-memory stub. */
export interface PersistStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function pickLocalStorage(): PersistStorage | null {
  try {
    return (globalThis as { localStorage?: PersistStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read persisted state; falls back to defaults on missing / corrupt / partial. */
export function loadModules(storage?: PersistStorage | null): UiModuleState {
  const store = storage === undefined ? pickLocalStorage() : storage;
  if (!store) return { ...DEFAULT_MODULES };
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { ...DEFAULT_MODULES };
  }
  if (!raw) return { ...DEFAULT_MODULES };
  try {
    const parsed = JSON.parse(raw) as Partial<UiModuleState>;
    const next: UiModuleState = { ...DEFAULT_MODULES };
    for (const key of UI_MODULES) {
      if (typeof parsed[key] === 'boolean') next[key] = parsed[key];
    }
    return next;
  } catch {
    return { ...DEFAULT_MODULES };
  }
}

/** Persist the full state; safe no-op when storage is unavailable or full. */
export function saveModules(state: UiModuleState, storage?: PersistStorage | null): void {
  const store = storage === undefined ? pickLocalStorage() : storage;
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage blocked/full — degrade silently, UI stays in-memory */
  }
}

/** Toggle one module and return a new (immutable) state. */
export function toggleModule(state: UiModuleState, key: UiModuleId): UiModuleState {
  return { ...state, [key]: !state[key] };
}