import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
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
