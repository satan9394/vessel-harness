import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Card 277 C-F1, the part a jsdom test can hold: the conversation column must be allowed to grow
 * with its own content, and the transcript must not contribute to that floor.
 *
 * Real failure this pins (measured in Chrome at 360x900, 8-line draft): `.dual-surface` was pinned
 * to `min-height: 720px` while `.conversation` could shrink below its own content, so the composer
 * footer ended 36px past the column and painted over the Goals module card. Geometry itself is
 * verified in a browser; these are the invariants that made it possible.
 */
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const layout = readFileSync(new URL('./components/layout/layout.css', import.meta.url), 'utf8');

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`rule not found: ${selector}`);
  return match[1]!;
}

describe('mobile conversation column can grow with its content', () => {
  it('keeps the transcript out of the column\'s intrinsic height', () => {
    expect(rule(styles, '.message-list-scroll')).toMatch(/contain:\s*size\s*;/);
  });

  it('lets the conversation shrink no further than its own content', () => {
    const conversation = rule(styles, '.conversation');
    expect(conversation).toMatch(/min-height:\s*min-content\s*;/);
    // `min-height: 0` here is what allowed the composer to overflow its own column.
    expect(conversation).not.toMatch(/min-height:\s*0\s*;/);
  });

  it('does not pin the narrow-width column to a fixed height', () => {
    const mobile = /@media \(max-width: 800px\)\s*\{([\s\S]*?)\n\}/.exec(layout)?.[1] ?? '';
    const dual = /\.dual-surface\s*\{([^}]*)\}/.exec(mobile)?.[1] ?? '';
    expect(dual).toMatch(/flex-basis:\s*720px\s*;/);      // keep the usable-transcript floor
    expect(dual).toMatch(/min-height:\s*auto\s*;/);       // ...but let it grow past it
    expect(dual).not.toMatch(/min-height:\s*\d+px/);      // a fixed floor is the bug
  });
});
