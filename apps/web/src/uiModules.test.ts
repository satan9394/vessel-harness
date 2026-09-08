import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODULES,
  STORAGE_KEY,
  UI_MODULES,
  loadModules,
  saveModules,
  toggleModule,
  type PersistStorage,
  type UiModuleState,
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
  it('returns defaults when nothing is persisted', () => {
    const store = memoryStorage();
    expect(loadModules(store)).toEqual(DEFAULT_MODULES);
    // exactly the 9 panel modules are defined
    expect(UI_MODULES).toHaveLength(9);
  });

  it('defaults to Tasks + Changed Files on and the rest off', () => {
    expect(DEFAULT_MODULES.Tasks).toBe(true);
    expect(DEFAULT_MODULES.ChangedFiles).toBe(true);
    for (const key of UI_MODULES) {
      if (key === 'Tasks' || key === 'ChangedFiles') continue;
      expect(DEFAULT_MODULES[key]).toBe(false);
    }
  });

  it('persists toggled state and reloads it identically', () => {
    const store = memoryStorage();
    const next = toggleModule(toggleModule(DEFAULT_MODULES, 'Cost'), 'ToolActivity');

    saveModules(next, store);

    // written under the expected key as JSON
    const raw = store.dump().get(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(() => JSON.parse(raw!)).not.toThrow();
    expect(loadModules(store)).toEqual(next);
  });

  it('toggles a single module immutably', () => {
    const a = toggleModule(DEFAULT_MODULES, 'Cost');
    expect(a.Cost).toBe(true);
    expect(DEFAULT_MODULES.Cost).toBe(false); // original untouched
    const b = toggleModule(a, 'Cost');
    expect(b.Cost).toBe(false);
  });

  it('recovers from corrupt/partial persisted JSON', () => {
    const store = memoryStorage();
    store.setItem(STORAGE_KEY, '{not valid json!');
    expect(loadModules(store)).toEqual(DEFAULT_MODULES);

    // partial top-level object: missing keys fall back to defaults
    store.setItem(STORAGE_KEY, JSON.stringify({ Cost: true }));
    const loaded = loadModules(store);
    expect(loaded.Cost).toBe(true);
    expect(loaded.Tasks).toBe(true); // default preserved
  });
});