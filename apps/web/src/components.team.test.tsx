import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import ModelSelector from './components/ModelSelector';
import TeamPanel from './components/TeamPanel';
import ReviewRequiredPanel from './components/ReviewRequiredPanel';
import { complexRunningFixture, mediumTeamFixture, reviewFixture } from './team.fixtures';
import type { ReviewRecord } from './team';

/** Render a component to static HTML (node env, no jsdom needed). */
function render(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

describe('TeamPanel (task 060 panel rendering)', () => {
  it('renders a friendly empty state when no team run exists', () => {
    const html = render(<TeamPanel team={null} />);
    expect(html).toContain('No team run yet');
    expect(html).not.toContain('team-panel');
  });

  it('renders roster member cards with phase status + output + review conclusion', () => {
    const html = render(<TeamPanel team={mediumTeamFixture()} />);
    // roster order → Developer then Reviewer cards
    expect(html.indexOf('Developer')).toBeLessThan(html.indexOf('Reviewer'));
    // models + tiers visible per member
    expect(html).toContain('mock-pro');
    expect(html).toContain('mock-review');
    // phase labels + output preview
    expect(html).toContain('Generate');
    expect(html).toContain('Review');
    expect(html).toContain('已实现导出（src/out.ts）');
    // structured internal review (058) is readable, not raw JSON
    expect(html).toContain('Review: Not met');
    expect(html).toContain('AC-2 无测试结果');
    expect(html).toContain('suggest: 补单测');
    // tool chips from tool activity rows
    expect(html).toContain('read_file');
    expect(html).toContain('write_file ×2');
    // run summary text
    expect(html).toContain('2 agents · completed in 5s');
  });

  it('marks the live member of a running complex run and shows delegate rows', () => {
    const html = render(<TeamPanel team={complexRunningFixture()} />);
    expect(html).toContain('running');
    expect(html).toContain('live');
    expect(html).toContain('Orchestrate');
    expect(html).toContain('delegate →');
    expect(html).toContain('developer');
  });

  it('survives an empty finished run (roster-only edge)', () => {
    const state = { ...mediumTeamFixture(), phases: [], turns: [], toolActivities: [] };
    const html = render(<TeamPanel team={state} />);
    expect(html).toContain('Developer');
    expect(html).toContain('queued…');
  });
});

describe('ModelSelector (task 060 model choice: Auto/Fast/Pro + pin)', () => {
  const noop = () => {};

  it('shows Auto / Fast / Pro with Auto active by default', () => {
    const html = render(<ModelSelector mode="auto" label={null} pinned={false} onSelect={noop} onResolve={noop} onPin={noop} onUnpin={noop} />);
    expect(html).toContain('>Auto<');
    expect(html).toContain('>Fast<');
    expect(html).toContain('>Pro<');
    // auto segment is the active one
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    // unresolved placeholder
    expect(html).toContain('—');
  });

  it('renders the resolved actual model label (Auto → <model>)', () => {
    const html = render(
      <ModelSelector mode="auto" label="Auto → mock-pro" pinned={false} onSelect={noop} onResolve={noop} onPin={noop} onUnpin={noop} />,
    );
    expect(html).toContain('Auto → mock-pro');
  });

  it('reflects pin state: unpinned offers Pin, pinned offers Pinned · Unpin', () => {
    const loose = render(<ModelSelector mode="auto" label={null} pinned={false} onSelect={noop} onResolve={noop} onPin={noop} onUnpin={noop} />);
    expect(loose).toContain('Pin for this session');
    expect(loose).not.toContain('Unpin');

    const locked = render(<ModelSelector mode="fast" label="Fast → mock-fast" pinned onSelect={noop} onResolve={noop} onPin={noop} onUnpin={noop} />);
    expect(locked).toContain('Pinned · Unpin');
    expect(locked).not.toContain('Pin for this session');
  });

  it('marks the user-selected mode segment active', () => {
    const html = render(<ModelSelector mode="pro" label={null} pinned={false} onSelect={noop} onResolve={noop} onPin={noop} onUnpin={noop} />);
    // exactly one active segment, on Pro
    const activeIdx = html.indexOf('mode-btn-active');
    expect(activeIdx).toBeGreaterThan(-1);
    expect(html.slice(activeIdx, activeIdx + 40)).toContain('Pro');
  });
});

describe('ReviewRequiredPanel (task 060 external review area: §9.1 buttons)', () => {
  const noop = () => {};

  it('is hidden when there are no review records', () => {
    const html = render(<ReviewRequiredPanel reviews={[]} onCopy={noop} onOpenFolder={noop} onImport={noop} />);
    expect(html).toBe('');
  });

  it('pending review → External Review Required header + Copy / Open / Import buttons', () => {
    const html = render(
      <ReviewRequiredPanel reviews={[reviewFixture()]} onCopy={noop} onOpenFolder={noop} onImport={noop} />,
    );
    expect(html).toContain('External Review Required');
    expect(html).toContain('pending');
    expect(html).toContain('Copy Handoff');
    expect(html).toContain('Open Folder');
    expect(html).toContain('Import Result');
    expect(html).toContain('review_1');
  });

  it('imported review shows the parsed result summary instead of the required header', () => {
    const imported: ReviewRecord = reviewFixture({
      status: 'imported',
      results: [
        {
          id: 'res_1',
          source: 'external',
          importedAt: '2026-09-08T01:00:00.000Z',
          conclusion: {
            verdict: 'met',
            reason: '验收标准满足',
            unmet: [],
            suggestions: [],
            evidence: [],
          },
          raw: '{"verdict":"met"}',
        },
      ],
    });
    const html = render(<ReviewRequiredPanel reviews={[imported]} onCopy={noop} onOpenFolder={noop} onImport={noop} />);
    expect(html).not.toContain('External Review Required');
    expect(html).toContain('imported');
    expect(html).toContain('external · met');
    expect(html).toContain('验收标准满足');
  });
});
