/**
 * Vessel Local Web — UI module toggles (task 043, updated in task 240).
 *
 * The Customize panel checkbox state persists to localStorage under a single JSON key.
 * Only modules that have real, active panel implementations are exposed to the user.
 * Unimplemented or integrated modules (ChangedFiles/Cost/ToolActivity/Context/Logs/MCP/Policy)
 * are filtered out so that no empty or fake placeholder cards are ever rendered.
 */

/** Active UI module ids that have real dedicated panel implementations. */
export const ACTIVE_UI_MODULES = [
  'Tasks',
  'Team',
  'Swarm',
  'CognitiveRules',
] as const;

export type ActiveUiModuleId = (typeof ACTIVE_UI_MODULES)[number];

/** All historical and active module identifiers for storage backward-compatibility. */
export const ALL_UI_MODULES = [
  'Swarm',
  'CognitiveRules',
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

export type UiModuleId = (typeof ALL_UI_MODULES)[number];

/** Modules exposed in the Customize panel (only active, real ones). */
export const UI_MODULES = ACTIVE_UI_MODULES;

export type UiModuleState = Record<UiModuleId, boolean>;

/** localStorage key persisted by the Customize panel. */
export const STORAGE_KEY = 'vessel.ui.modules';

/** Default: only Tasks on — "能力丰富界面安静". */
export const DEFAULT_MODULES: UiModuleState = {
  Tasks: true,
  Team: false,
  Swarm: false,
  CognitiveRules: false,
  ChangedFiles: false,
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

/** Read persisted state; falls back to defaults on missing / corrupt / partial, and filters out dead modules. */
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
    // Only recover state for active modules; historical/dead placeholders remain false
    for (const key of ACTIVE_UI_MODULES) {
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
