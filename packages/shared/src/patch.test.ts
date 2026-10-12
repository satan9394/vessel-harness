import { describe, expect, it } from 'vitest';
import { applyPatchHunk, revertPatchHunk, parsePatchHunks } from './patch.js';

describe('strict unified patch hunks', () => {
  it('parses multiple files and sign-prefixed source with exact independent IDs', () => {
    const hunks = parsePatchHunks('--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n---counter\n+++counter\n keep\n--- a/b.ts\n+++ b/b.ts\n@@ -0,0 +1 @@\n+new\n');
    expect(hunks.map(h => [h.id, h.oldStart, h.oldLines, h.newLines])).toEqual([['a.ts#hunk-0', 1, 2, 2], ['b.ts#hunk-0', 0, 0, 1]]);
    expect(applyPatchHunk('--counter\nkeep\n', hunks[0]!)).toBe('++counter\nkeep\n');
    expect(applyPatchHunk('', hunks[1]!)).toBe('new\n');
  });
  it('applies selected hunks out of order with caller offsets and retains CRLF', () => {
    const hunks = parsePatchHunks('@@ -1 +1,2 @@\n-a\n+A\n+extra\n@@ -3 +4 @@\n-c\n+C\n', 'a.txt');
    const first = applyPatchHunk('a\r\nb\r\nc\r\n', hunks[0]!);
    expect(applyPatchHunk(first, hunks[1]!, 1)).toBe('A\r\nextra\r\nb\r\nC\r\n');
    expect(() => applyPatchHunk('changed\nb\nc\n', hunks[0]!)).toThrow('stale');
  });
  it('preserves explicit missing newlines on both sides', () => {
    const hunk = parsePatchHunks('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file', 'a.txt')[0]!;
    expect(applyPatchHunk('a', hunk)).toBe('b');
    expect(revertPatchHunk('b', hunk)).toBe('a');
    expect(() => applyPatchHunk('a\n', hunk)).toThrow('stale');
  });
  it.each([
    '@@ -1,2 +1 @@\n-a\n+b', '@@ -0 +1 @@\n-a\n+b', '@@ -1 +1 @@\n\\ No newline at end of file\n-a\n+b',
    '@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n\\ No newline at end of file',
    '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+new', 'Binary files differ',
    '@@ -1,2 +1,2 @@\n a\n b\n@@ -2 +2 @@\n-b\n+B',
    '--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n a\n b\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-x\n+y\n--- a/a.txt\n+++ b/a.txt\n@@ -2 +2 @@\n-b\n+B',
  ])('rejects malformed or unsupported input %s', patch => { expect(() => parsePatchHunks(patch, 'a.txt')).toThrow(); });
});
