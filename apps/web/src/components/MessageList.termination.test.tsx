import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import MessageList from './MessageList';
const folded = vi.hoisted(() => ({ ids: undefined as Set<string> | undefined }));

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => [folded.ids ?? (typeof initial === 'function' ? initial() : initial), vi.fn()],
  useRef: () => ({ current: null }),
  useEffect: () => {},
}));
vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}

describe('persisted message termination', () => {
  beforeEach(() => { folded.ids = undefined; });
  it.each(['error', 'denied'] as const)('keeps %s tool cards visible after a fold command or terminal update', status => {
    folded.ids = new Set(['failed', 'success']);
    const tree = nodes(MessageList({ thinking: false, items: [
      { id: 'failed', kind: 'tool', tool: { toolName: 'Read', status, errorDetail: 'fixture error', ts: 1 } },
      { id: 'success', kind: 'tool', tool: { toolName: 'Read', status: 'done', ts: 2 } },
    ] }));
    const failed = tree.find(node => node.props['data-message-card'] === 'failed')!;
    const success = tree.find(node => node.props['data-message-card'] === 'success')!;
    expect(failed.props['aria-expanded']).toBe(true);
    expect(nodes(failed).find(node => node.type === 'div' && 'hidden' in node.props)!.props.hidden).toBe(false);
    expect(success.props['aria-expanded']).toBe(false);
    expect(nodes(success).find(node => node.type === 'div' && 'hidden' in node.props)!.props.hidden).toBe(true);
  });
  it.each(['length', 'interrupted'] as const)('renders a translated %s status on its historical message', termination => {
    const tree = nodes(MessageList({ thinking: false, items: [
      { id: 'partial', kind: 'message', msg: { role: 'assistant', text: 'partial body', ts: 1, termination } },
      { id: 'later', kind: 'message', msg: { role: 'assistant', text: 'later normal reply', ts: 2 } },
    ] }));
    const statuses = tree.filter(node => node.props.role === 'status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].props.children).toBe(termination === 'length' ? 'responseLengthLimit' : 'interrupted');
  });
});
