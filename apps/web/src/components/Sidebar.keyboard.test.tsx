// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { translate } from '../i18n';
import Sidebar from './Sidebar';

vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ t: translate('en'), lang: 'en' }) }));

let host: HTMLDivElement;
let root: Root;
const onDelete = vi.fn();
const outerKeyDown = vi.fn();
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onDelete.mockClear(); outerKeyDown.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<div onKeyDown={outerKeyDown}>
    <Sidebar projects={[]} sessions={[
      { id: 'first', workspaceRoot: 'E:/workspace', createdAt: '2026-10-23', topic: { topicId: 'one', title: 'One', createdAt: 0, updatedAt: 0 } },
      { id: 'second', workspaceRoot: 'E:/workspace', createdAt: '2026-10-22' },
    ]} onNewSession={() => {}} onSelectSession={() => {}} onDeleteSession={onDelete} />
  </div>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function trigger(index = 0) { return host.querySelectorAll<HTMLButtonElement>('.topic-action-danger')[index]!; }
function confirmation() { return host.querySelector('.topic-delete-confirm'); }
async function open(index = 0) {
  const button = trigger(index);
  button.focus();
  // Native keyboard activation produces this click; jsdom does not synthesize it from Enter.
  await act(async () => button.click());
  expect(document.activeElement?.textContent).toBe('Cancel');
}
async function key(target: Element, value: string) {
  const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
  await act(async () => target.dispatchEvent(event));
  return event;
}

it('Escape closes deletion confirmation and restores focus to the opening button', async () => {
  await open(1);
  const escape = await key(document.activeElement!, 'Escape');
  expect(confirmation()).toBeNull();
  expect(document.activeElement).toBe(trigger(1));
  expect(escape.defaultPrevented).toBe(true);
  expect(outerKeyDown).not.toHaveBeenCalled();
  expect(onDelete).not.toHaveBeenCalled();
});

it('leaves Tab unhandled in confirmation and after restoring focus', async () => {
  await open();
  expect((await key(document.activeElement!, 'Tab')).defaultPrevented).toBe(false);
  expect(confirmation()).not.toBeNull();
  await key(document.activeElement!, 'Escape');
  expect((await key(document.activeElement!, 'Tab')).defaultPrevented).toBe(false);
  // jsdom has no native Tab traversal; browser recheck must verify the next focus stop.
});

it('keeps mouse cancel and confirm paths and does not intercept Escape elsewhere', async () => {
  await open();
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(confirmation()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  await key(trigger(), 'Escape');
  expect(outerKeyDown).toHaveBeenCalledOnce();
  await open();
  const confirm = confirmation()!.querySelector<HTMLButtonElement>('button')!;
  confirm.focus();
  await key(confirm, 'Escape');
  expect(confirmation()).toBeNull();
  expect(document.activeElement).toBe(trigger());
  await open();
  await act(async () => confirmation()!.querySelector<HTMLButtonElement>('button')!.click());
  expect(confirmation()).toBeNull();
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(['first']);
});
