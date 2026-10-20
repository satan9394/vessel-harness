import { describe, expect, it, beforeEach, vi } from 'vitest';
import { applyTheme, getStoredTheme, toggleTheme } from './theme';

describe('theme utils', () => {
  const store: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { for (const k in store) delete store[k]; }),
  };

  const attributes: Record<string, string> = {};
  const classListSet = new Set<string>();
  const mockDocumentElement = {
    getAttribute: vi.fn((key: string) => attributes[key] ?? null),
    setAttribute: vi.fn((key: string, val: string) => { attributes[key] = val; }),
    removeAttribute: vi.fn((key: string) => { delete attributes[key]; }),
    classList: {
      add: vi.fn((cls: string) => classListSet.add(cls)),
      remove: vi.fn((cls: string) => classListSet.delete(cls)),
      contains: vi.fn((cls: string) => classListSet.has(cls)),
    },
  };

  beforeEach(() => {
    vi.stubGlobal('localStorage', mockLocalStorage);
    vi.stubGlobal('document', { documentElement: mockDocumentElement });
    mockLocalStorage.clear();
    for (const k in attributes) delete attributes[k];
    classListSet.clear();
  });

  it('defaults to system when nothing is stored', () => {
    expect(getStoredTheme()).toBe('system');
  });

  it('stores and retrieves theme mode', () => {
    applyTheme('dark');
    expect(getStoredTheme()).toBe('dark');
    expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    expect(classListSet.has('dark')).toBe(true);

    applyTheme('light');
    expect(getStoredTheme()).toBe('light');
    expect(mockDocumentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'light');
    expect(classListSet.has('light')).toBe(true);

    applyTheme('system');
    expect(mockDocumentElement.removeAttribute).toHaveBeenCalledWith('data-theme');
  });

  it('toggles between dark and light', () => {
    expect(toggleTheme('dark')).toBe('light');
    expect(toggleTheme('light')).toBe('dark');
    expect(toggleTheme('system')).toBe('light');
  });
});
