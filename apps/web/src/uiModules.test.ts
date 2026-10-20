import { describe, it, expect } from 'vitest';
import {
  ACTIVE_UI_MODULES,
  DEFAULT_MODULES,
  STORAGE_KEY,
  UI_MODULES,
  loadModules,
  saveModules,
  toggleModule,
  type PersistStorage,
} from './uiModules';

/** In-memory localStorage stub (node env has no real localStorage). */
function memoryStorage(): PersistStorage & { dump: () => Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => new Map(map),
  };
}

describe('uiModules', () => {
  it('returns defaults when nothing is persisted and only exposes active panels', () => {
    const store = memoryStorage();
    expect(loadModules(store)).toEqual(DEFAULT_MODULES);
    expect(UI_MODULES).toHaveLength(4);
    expect(UI_MODULES).toEqual(ACTIVE_UI_MODULES);
    expect(UI_MODULES).toContain('Tasks');
    expect(UI_MODULES).toContain('Team');
    expect(UI_MODULES).toContain('Swarm');
    expect(UI_MODULES).toContain('CognitiveRules');
  });

  it('defaults to Tasks on and others off for a quiet interface', () => {
    expect(DEFAULT_MODULES.Tasks).toBe(true);
    for (const key of UI_MODULES) {
      if (key === 'Tasks') continue;
      expect(DEFAULT_MODULES[key]).toBe(false);
    }
  });

  it('persists toggled state and reloads it identically', () => {
    const store = memoryStorage();
    const next = toggleModule(toggleModule(DEFAULT_MODULES, 'Team'), 'Swarm');

    saveModules(next, store);

    // written under the expected key as JSON
    const raw = store.dump().get(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(() => JSON.parse(raw!)).not.toThrow();
    expect(loadModules(store)).toEqual(next);
  });

  it('toggles a single active module immutably', () => {
    const a = toggleModule(DEFAULT_MODULES, 'Team');
    expect(a.Team).toBe(true);
    expect(DEFAULT_MODULES.Team).toBe(false); // original untouched
    const b = toggleModule(a, 'Team');
    expect(b.Team).toBe(false);
  });

  it('recovers from corrupt/partial persisted JSON and filters out dead placeholders', () => {
    const store = memoryStorage();
    store.setItem(STORAGE_KEY, '{not valid json!');
    expect(loadModules(store)).toEqual(DEFAULT_MODULES);

    // Historical persisted object containing dead/unimplemented placeholders:
    // Dead modules (Cost, Context, Logs) must be safely filtered out to false.
    store.setItem(
      STORAGE_KEY,
      JSON.stringify({
        Cost: true,
        Context: true,
        Logs: true,
        Swarm: true,
        Tasks: false,
      }),
    );
    const loaded = loadModules(store);
    expect(loaded.Swarm).toBe(true);
    expect(loaded.Tasks).toBe(false);
    expect(loaded.Cost).toBe(false);
    expect(loaded.Context).toBe(false);
    expect(loaded.Logs).toBe(false);
  });
});
