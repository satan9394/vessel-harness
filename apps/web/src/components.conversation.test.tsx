import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError } from './api';
import { ConversationError, MAX_ERROR_TEXT, turnErrorText } from './components/ConversationView';

/**
 * BRIEF-22 — a turn that ends in `kind='error'` answers **500** with a body of
 * exactly `{ finalText, kind, steps, turnId }` and **no** `message` field
 * (apps/local-server `turnStatusFor`). Before the fix the conversation banner
 * rendered the bare `HTTP 500`, so the reason the harness had written into
 * `finalText` never reached the user.
 *
 * These cases pin the two layers ConversationView owns: the text derivation
 * (`turnErrorText`, the exact string handed to `setError`) and the banner
 * element (`ConversationError`, the exact JSX that renders it).
 *
 * jsdom / @testing-library are not dependencies of this package (`vitest.config`
 * uses environment: 'node'), so the banner is rendered with react-dom/server —
 * the same technique components.team.test.tsx / components.goal.test.tsx use.
 * A full form-submit interaction test would need a DOM environment, i.e. a new
 * dependency; that is out of scope for this fix.
 */

const BLOCKED_BODY = {
  finalText: '[blocked] 输入被 BeforeTurn 拦截：policy',
  kind: 'error',
  steps: [],
  turnId: 't-block',
};

describe('ConversationView error banner (turn kind=error)', () => {
  it('① shows the real reason for a 500 whose body only carries finalText', () => {
    const err = new ApiError('HTTP 500', 500, BLOCKED_BODY);
    const text = turnErrorText(err);

    expect(text).toBe('[blocked] 输入被 BeforeTurn 拦截：policy');

    const html = renderToStaticMarkup(<ConversationError text={text} />);
    expect(html).toContain('conversation-error');
    expect(html).toContain('输入被 BeforeTurn 拦截');
    expect(html).not.toContain('HTTP 500');
  });

  it('①′ shows the denial-limit reason too (the other kind=error source)', () => {
    const err = new ApiError('HTTP 500', 500, {
      finalText: 'same intent denied 3 times: Write',
      kind: 'error',
      steps: [],
      turnId: 't-limit',
    });
    const html = renderToStaticMarkup(<ConversationError text={turnErrorText(err)} />);
    expect(html).toContain('same intent denied 3 times: Write');
    expect(html).not.toContain('HTTP 500');
  });

  it('③ falls back to "HTTP <status>" when the body has no readable reason (never blank/undefined)', () => {
    const err = new ApiError('HTTP 502', 502, { unexpected: true });
    const text = turnErrorText(err);

    expect(text).toBe('HTTP 502');

    const html = renderToStaticMarkup(<ConversationError text={text} />);
    expect(html).toBe('<div class="error-text conversation-error">HTTP 502</div>');
    expect(html).not.toContain('undefined');
  });

  it('② keeps the pre-existing banner markup byte-for-byte (styling/structure untouched)', () => {
    const html = renderToStaticMarkup(<ConversationError text="boom" />);
    expect(html).toBe('<div class="error-text conversation-error">boom</div>');
  });

  it('keeps non-ApiError messages, flattens newlines, and caps very long reasons', () => {
    expect(turnErrorText(new Error('boom'))).toBe('boom');
    expect(turnErrorText(new Error('line1\n  line2'))).toBe('line1 line2');
    expect(turnErrorText('plain string throw')).toBe('plain string throw');

    const long = turnErrorText(new ApiError('HTTP 500', 500, { finalText: 'x'.repeat(5000) }));
    expect(long).toHaveLength(MAX_ERROR_TEXT + 1);
    expect(long.endsWith('…')).toBe(true);
  });

  it('reads the reason from the body even when ApiError.message is generic', () => {
    // defence in depth: any ApiError carrying a turn body shows its finalText,
    // not the placeholder message it was constructed with.
    const err = new ApiError('Request failed', 500, BLOCKED_BODY);
    expect(turnErrorText(err)).toBe('[blocked] 输入被 BeforeTurn 拦截：policy');
  });
});

/**
 * Wiring guard — **static, not behavioural**, and labelled as such on purpose.
 *
 * The two cases above prove the derivation and the banner; they cannot prove the
 * component's `catch` actually routes through them, because that path only runs
 * on a form submit and this package has no DOM environment (see the file header).
 * Rather than pretend, the invariant is pinned by reading the source file.
 * Reverting the catch to the old `setError(err.message)` turns this red.
 */
describe('ConversationView error wiring (static source guard)', () => {
  const source = readFileSync(new URL('./components/ConversationView.tsx', import.meta.url), 'utf8');

  it('routes a failed turn through turnErrorText instead of err.message', () => {
    expect(source).toMatch(/setError\(\s*turnErrorText\(err\)\s*\)/);
  });

  it('renders the reason through the existing ConversationError banner', () => {
    expect(source).toMatch(/ConversationError\s+text=\{error\}/);
  });
});
