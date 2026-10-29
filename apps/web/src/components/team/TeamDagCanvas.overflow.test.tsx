// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translate } from '../../i18n';
import TeamDagCanvas from './TeamDagCanvas';

vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: translate('en'), lang: 'en' }) }));

let host: HTMLDivElement;
let root: Root;
let resize: () => void;
const disconnect = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  disconnect.mockClear();
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.unstubAllGlobals();
});

it('shows a scroll hint only on overflow, preserves node size and selects the exact node', async () => {
  const select = vi.fn();
  await act(async () => root.render(<TeamDagCanvas tasks={[
    { id: 'a', title: 'First', description: 'First', assignedRole: 'generator', dependencies: [], status: 'pending' },
    { id: 'b', title: 'Second', description: 'Second', assignedRole: 'generator', dependencies: ['a'], status: 'running' },
  ]} activeTaskId="b" onSelectTask={select} />));
  const scroll = host.querySelector<HTMLDivElement>('.team-dag-scroll')!;
  Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 242 });
  Object.defineProperty(scroll, 'scrollWidth', { configurable: true, value: 484 });
  await act(async () => resize());
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Scroll horizontally');
  expect(scroll.tabIndex).toBe(0);
  expect(host.querySelector('foreignObject')?.getAttribute('width')).toBe('200');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-pressed="true"]')!.click());
  expect(select).toHaveBeenCalledExactlyOnceWith('b');
  Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 800 });
  await act(async () => resize());
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(scroll.hasAttribute('tabindex')).toBe(false);
  await act(async () => root.render(<></>));
  expect(disconnect).toHaveBeenCalledOnce();
});
