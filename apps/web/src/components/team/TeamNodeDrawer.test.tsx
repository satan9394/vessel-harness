// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApiClient } from '../../api';
import { translate } from '../../i18n';
import type { TeamDagTask } from '../../teamStages';
import TeamNodeDrawer from './TeamNodeDrawer';

vi.mock('../LanguageProvider', () => ({ useI18n: () => ({ t: translate('zh'), lang: 'zh' }) }));
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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
