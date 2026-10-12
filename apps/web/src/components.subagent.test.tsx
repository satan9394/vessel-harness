import type { ReactNode as I18nTestNode } from 'react';
import { LanguageProvider } from './components/LanguageProvider';
import { describe, expect, it , vi } from 'vitest';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { SubagentPanel, type SubagentItem } from './components/SubagentPanel.js';

describe('SubagentPanel component', () => {
  it('renders empty placeholder when no subagents exist', () => {
    const html = renderToStaticMarkup(<SubagentPanel subagents={[]} />);
    expect(html).toContain('No active subagents');
  });

  it('renders active subagents cards with badge and cancel button', () => {
    const items: SubagentItem[] = [
      {
        id: 'sub-1',
        name: 'claude-subagent',
        provider: 'claude-code',
        status: 'running',
        startedAt: '2026-10-01T00:00:00.000Z',
        worktreePath: 'E:/tmp/worktree-1',
      },
    ];

    const html = renderToStaticMarkup(<SubagentPanel subagents={items} onCancel={() => {}} />);
    expect(html).toContain('claude-subagent');
    expect(html).toContain('status-running');
    expect(html).toContain('Cancel');
  });
});

function renderToStaticMarkup(node: I18nTestNode): string {
  return renderMarkup(<LanguageProvider>{node}</LanguageProvider>).replace(/\s+/g, ' ');
}

vi.mock('./i18n', async original => ({ ...await original<typeof import('./i18n')>(), getInitialLang: () => 'en' as const }));
