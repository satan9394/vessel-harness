// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApiClient } from '../../api';
import { LANG_STORAGE_KEY, translate } from '../../i18n';
import { LanguageProvider, useI18n } from '../LanguageProvider';
import type { TeamDagTask } from '../../teamStages';
import Drawer from './TeamNodeDrawer';

function TeamNodeDrawer(props: ComponentProps<typeof Drawer>) {
  return <LanguageProvider><Drawer {...props} /></LanguageProvider>;
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.setItem(LANG_STORAGE_KEY, 'zh');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem(LANG_STORAGE_KEY); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const task = (output: string): TeamDagTask => ({ id: 'a', title: 'A', description: 'A', assignedRole: 'generator', dependencies: [], status: 'completed', result: { output, artifacts: [] } });
const outputText = () => host.querySelector('pre')!.textContent;
const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;

it.each([298, 300])('keeps %i characters unchanged without ellipsis or expansion', async length => {
  const api = createApiClient(); const fetch = vi.spyOn(api, 'getTeamTaskResult');
  await act(async () => root.render(<TeamNodeDrawer api={api} sessionId="session" stageId="stage" task={task('x'.repeat(length))} onClose={() => {}} />));
  expect(outputText()).toBe('x'.repeat(length)); expect(toggle()).toBeNull(); expect(fetch).not.toHaveBeenCalled();
});

it('expands the 300-character runtime preview to 570, then collapses and reuses the cached result', async () => {
  const full = 'x'.repeat(566) + 'END!';
  const api = createApiClient();
  const fetch = vi.spyOn(api, 'getTeamTaskResult').mockResolvedValue({ status: 'completed', output: full, artifacts: [], truncated: false });
  await act(async () => root.render(<TeamNodeDrawer api={api} sessionId="session" stageId="stage" task={task(full.slice(0, 300) + '…')} onClose={() => {}} />));
  expect(outputText()).toBe(full.slice(0, 300) + '…'); expect(toggle().textContent).toBe('展开全文');
  await act(async () => toggle().click());
  expect(outputText()).toBe(full); expect(outputText()).toHaveLength(570); expect(toggle().textContent).toBe('收起');
  expect(fetch).toHaveBeenCalledExactlyOnceWith('session', 'stage', 'a');
  await act(async () => toggle().click()); expect(outputText()).toHaveLength(301); expect(toggle().getAttribute('aria-expanded')).toBe('false');
  await act(async () => toggle().click()); expect(outputText()).toBe(full); expect(fetch).toHaveBeenCalledOnce();
});

it('keeps the summary and shows one safe inline message on failure', async () => {
  const api = createApiClient();
  vi.spyOn(api, 'getTeamTaskResult').mockRejectedValue(new Error('RAW PRIVATE ERROR BODY'));
  await act(async () => root.render(<TeamNodeDrawer api={api} sessionId="session" stageId="stage" task={task('x'.repeat(570))} onClose={() => {}} />));
  await act(async () => toggle().click());
  expect(outputText()).toBe('x'.repeat(300) + '…'); expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(host.textContent).toContain('全文加载失败，请重试。'); expect(host.textContent).not.toContain('RAW PRIVATE');
});

it('marks a capped response separately from the output text', async () => {
  const api = createApiClient();
  vi.spyOn(api, 'getTeamTaskResult').mockResolvedValue({ status: 'completed', output: 'x'.repeat(65536), artifacts: [], truncated: true });
  await act(async () => root.render(<TeamNodeDrawer api={api} sessionId="session" stageId="stage" task={task('x'.repeat(301))} onClose={() => {}} />));
  await act(async () => toggle().click());
  expect(outputText()).toHaveLength(65536); expect(host.textContent).toContain('输出超过 64 KiB');
});

it.each([
  ['uiTeamOutputExpand', '展开全文', 'Expand full output'],
  ['uiTeamOutputCollapse', '收起', 'Collapse'],
  ['uiTeamOutputLoading', '正在加载…', 'Loading…'],
  ['uiTeamOutputFailed', '全文加载失败，请重试。', 'Could not load full output. Please retry.'],
  ['uiTeamOutputCapped', '输出超过 64 KiB，仅显示前 64 KiB。', 'Output exceeds 64 KiB; showing the first 64 KiB.'],
] as const)('preserves the exact bilingual output copy for %s', (key, zh, en) => {
  expect(translate('zh')(key)).toBe(zh);
  expect(translate('en')(key)).toBe(en);
});

it('switches language on the same expanded task and preserves output, toggle position, focus and cache', async () => {
  const full = 'x'.repeat(566) + 'END!';
  const currentTask = task(full.slice(0, 300) + '…');
  const api = createApiClient();
  const fetch = vi.spyOn(api, 'getTeamTaskResult').mockResolvedValue({ status: 'completed', output: full, artifacts: [], truncated: false });
  function LanguageSwitch() {
    const { setLang } = useI18n();
    return <button data-language-switch onClick={() => setLang('zh')}>中文</button>;
  }
  localStorage.setItem(LANG_STORAGE_KEY, 'en');
  await act(async () => root.render(<LanguageProvider><LanguageSwitch /><Drawer api={api} sessionId="session" stageId="stage" task={currentTask} onClose={() => {}} /></LanguageProvider>));
  const button = toggle();
  expect(button.textContent).toBe('Expand full output');
  expect(button.compareDocumentPosition(host.querySelector('pre')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  button.focus();
  await act(async () => button.click());
  expect(button.textContent).toBe('Collapse'); expect(outputText()).toBe(full);
  expect(document.activeElement).toBe(button); expect(toggle()).toBe(button);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-language-switch]')!.click());
  expect(button.textContent).toBe('收起'); expect(outputText()).toHaveLength(570);
  expect(document.activeElement).toBe(button);
  await act(async () => button.click());
  expect(button.textContent).toBe('展开全文'); expect(outputText()).toHaveLength(301);
  expect(document.activeElement).toBe(button); expect(toggle()).toBe(button);
  await act(async () => button.click());
  expect(outputText()).toBe(full); expect(fetch).toHaveBeenCalledOnce();
});

it.each([false, true])('restores native focus after loading unless the user moved it (moved=%s)', async moved => {
  const api = createApiClient();
  let resolveOutput!: (result: Awaited<ReturnType<typeof api.getTeamTaskResult>>) => void;
  vi.spyOn(api, 'getTeamTaskResult').mockReturnValue(new Promise(resolve => { resolveOutput = resolve; }));
  await act(async () => root.render(<TeamNodeDrawer api={api} sessionId="session" stageId="stage" task={task('x'.repeat(301))} onClose={() => {}} />));
  const button = toggle(); button.focus();
  await act(async () => button.click());
  expect(button.disabled).toBe(true); expect(button.textContent).toBe('正在加载…');
  // jsdom does not implement the browser's focus loss when a button is disabled.
  button.blur();
  const close = host.querySelector<HTMLButtonElement>('button')!;
  if (moved) close.focus();
  await act(async () => resolveOutput({ status: 'completed', output: 'x'.repeat(570), artifacts: [], truncated: false }));
  expect(button.disabled).toBe(false); expect(toggle()).toBe(button);
  expect(document.activeElement).toBe(moved ? close : button);
});
