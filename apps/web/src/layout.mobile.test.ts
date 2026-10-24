import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Card 277 C-F1: the column must grow with its furniture and a usable transcript minimum,
 * without counting the transcript's full content. Browser geometry: scripts/ui-geom-check.mjs.
 *
 * Real failure this pins (measured in Chrome at 360x900, 8-line draft): `.dual-surface` was pinned
 * to `min-height: 720px` while `.conversation` could shrink below its own content, so the composer
 * footer ended 36px past the column and painted over the Goals module card. Geometry itself is
 * verified in a browser; these are the invariants that made it possible.
 */
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./components/layout/layout.css', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('./components/dashboard.css', import.meta.url), 'utf8');

// Read balanced blocks so a missing media query fails and nested rules cannot be silently skipped.
function blocks(css: string): { selector: string; body: string }[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const result = [];
  let start = 0;
  while (start < source.length) {
    const open = source.indexOf('{', start);
    if (open < 0) break;
    let end = open + 1;
    let depth = 1;
    while (end < source.length && depth) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
      end++;
    }
    if (depth) throw new Error('unclosed CSS block');
    result.push({ selector: source.slice(start, open).trim(), body: source.slice(open + 1, end - 1) });
    start = end;
  }
  return result;
}

function rule(css: string, selector: string): string {
  const match = blocks(css).find(block => block.selector === selector);
  if (!match) throw new Error(`rule not found: ${selector}`);
  return match.body;
}

describe('conversation column can grow across viewport branches', () => {
  it('keeps the transcript out of the column\'s intrinsic height', () => {
    expect(rule(styles, '.message-list-scroll')).toMatch(/contain:\s*size\s*;/);
    expect(rule(styles, '.message-list-scroll')).toMatch(/min-height:\s*60px\s*;/);
    expect(rule(styles, '.message-list-scroll')).toMatch(/overflow-y:\s*auto\s*;/);
    expect(rule(styles, '.message-list-scroll')).toMatch(/overscroll-behavior-y:\s*contain\s*;/);
  });

  it('lets the conversation shrink no further than its own content', () => {
    const conversation = rule(styles, '.conversation');
    expect(conversation).toMatch(/min-height:\s*min-content\s*;/);
    // `min-height: 0` here is what allowed the composer to overflow its own column.
    expect(conversation).not.toMatch(/min-height:\s*0\s*;/);
  });

  it('lets the base column grow beyond its desktop flex basis', () => {
    const dual = rule(layout, '.dual-surface');
    expect(dual).toMatch(/flex:\s*1 0 420px\s*;/);
    expect(dual).toMatch(/min-height:\s*auto\s*;/);
  });

  it('lets the <=800px column grow beyond its narrow flex basis', () => {
    const dual = rule(rule(layout, '@media (max-width: 800px)'), '.dual-surface');
    expect(dual).toMatch(/flex-basis:\s*720px\s*;/);      // keep the usable-transcript floor
    expect(dual).toMatch(/min-height:\s*auto\s*;/);       // ...but let it grow past it
    expect(dual).not.toMatch(/min-height:\s*\d+px/);      // a fixed floor is the bug
  });

  it('preserves the <=700px shell and transcript layout branch', () => {
    const mobile = rule(styles, '@media (max-width: 700px)');
    expect(rule(mobile, '.main')).toMatch(/overflow-y:\s*auto\s*;/);
    expect(rule(mobile, '.message-list-scroll')).toMatch(/padding:\s*24px 12px\s*;/);
    expect(rule(mobile, '.module-sections')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)\s*;/);
  });

  it('rejects fixed column minimums and transcript collapse in every media branch, including dashboards', () => {
    let checked = 0;
    function check(css: string) {
      for (const { selector, body } of blocks(css)) {
        if (selector.startsWith('@')) check(body);
        else if (/(?:\.conversation|\.dual-surface|\.chat-surface|\.conversation-wrap)(?![\w-])/.test(selector)) {
          checked++;
          const intermediate = /(?:\.chat-surface|\.conversation-wrap)(?![\w-])/.test(selector)
            && !/(?:\.conversation|\.dual-surface)(?![\w-])/.test(selector);
          // Check every declaration, including more specific selectors and later overrides.
          for (const minimum of body.matchAll(/(?:^|;)\s*min-height:\s*([^;]+)/g)) {
            expect(minimum[1]!.trim(), selector).toMatch(intermediate ? /^(?:auto|min-content|0)$/ : /^(?:auto|min-content)$/);
          }
        } else if (/\.message-list-scroll(?![\w-])/.test(selector)) {
          // A later breakpoint must not undo the transcript's reserved space or intrinsic-size isolation.
          for (const declaration of body.matchAll(/(?:^|;)\s*(min-height|contain|overflow(?:-y)?|overscroll-behavior(?:-y)?):\s*([^;]+)/g)) {
            const expected = { 'min-height': '60px', contain: 'size', overflow: 'auto', 'overflow-y': 'auto', 'overscroll-behavior': 'contain', 'overscroll-behavior-y': 'contain' };
            expect(declaration[2]!.trim(), selector).toBe(expected[declaration[1] as keyof typeof expected]);
          }
        }
      }
    }
    for (const css of [styles, layout, dashboard]) check(css);
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});
