import { describe, it, expect } from 'vitest';
import { globMatch, globToRegExp } from './globmatch.js';

// V1.1-A: `**/` must match ZERO or more directory segments, so a root-level
// file (e.g. `.env`, `README`) is in scope for `**/.env` / `**/README`.
describe('policy/risk — globmatch `**/` zero-or-more directory semantics', () => {
  it('`**/.env` hits a root-level `.env` (no leading directory)', () => {
    expect(globMatch('**/.env', '.env')).toBe(true);
  });
  it('`**/.env` still hits nested `.env` (one and many levels)', () => {
    expect(globMatch('**/.env', 'a/.env')).toBe(true);
    expect(globMatch('**/.env', 'a/b/.env')).toBe(true);
  });
  it('`.env` requires the separator matching (a plain file under a dir is not confused)', () => {
    expect(globMatch('**/.env', '.env')).toBe(true);
  });
  it('`**/README` hits `README` at root and nested', () => {
    expect(globMatch('**/README', 'README')).toBe(true);
    expect(globMatch('**/README', 'a/README')).toBe(true);
    expect(globMatch('**/README', 'a/b/README')).toBe(true);
  });
  it('`**/secret` does not match a dir that merely starts with the name', () => {
    expect(globMatch('**/secret', 'secret-prod')).toBe(false);
    expect(globMatch('**/secret', 'a/secretary')).toBe(false);
  });

  it('`xd/**/README` (075-style) hits nested AND `xd/README` (zero middle levels)', () => {
    expect(globMatch('xd/**/README', 'xd/README')).toBe(true);
    expect(globMatch('xd/**/README', 'xd/a/README')).toBe(true);
    expect(globMatch('xd/**/README', 'xd/a/b/README')).toBe(true);
  });

  it('`**` alone still matches anything recursively', () => {
    expect(globMatch('**', '.env')).toBe(true);
    expect(globMatch('**', 'a/b/c.txt')).toBe(true);
    expect(globMatch('**', '/abs.txt')).toBe(true);
  });

  it('`dir/**` still includes `dir` itself', () => {
    expect(globMatch('dir/**', 'dir')).toBe(true);
    expect(globMatch('dir/**', 'dir/a')).toBe(true);
    expect(globMatch('dir/**', 'dir/a/b')).toBe(true);
    expect(globMatch('dir/**', 'other/dir')).toBe(false);
  });

  it('`*` does not cross path separators', () => {
    expect(globMatch('*', 'file.txt')).toBe(true);
    expect(globMatch('*', 'a/file.txt')).toBe(false);
    expect(globMatch('a/*.ts', 'a/index.ts')).toBe(true);
    expect(globMatch('a/*.ts', 'a/sub/index.ts')).toBe(false);
  });

  it('top-level bare `*.env` still matches only root-level (unchanged)', () => {
    expect(globMatch('*.env', '.env')).toBe(true);
    expect(globMatch('*.env', 'a/.env')).toBe(false);
  });

  it('`?`, `{a,b}`, and char classes behave unchanged', () => {
    expect(globMatch('file?.txt', 'file1.txt')).toBe(true);
    expect(globMatch('file?.txt', 'file.txt')).toBe(false);
    expect(globMatch('{foo,bar}.txt', 'bar.txt')).toBe(true);
    expect(globMatch('{foo,bar}.txt', 'baz.txt')).toBe(false);
    expect(globMatch('file[0-9].txt', 'file5.txt')).toBe(true);
    expect(globMatch('file[0-9].txt', 'filex.txt')).toBe(false);
  });

  it('Windows backslash paths are normalized to `/` before matching', () => {
    expect(globMatch('**/.env', '.env')).toBe(true);
    expect(globMatch('**/.env', 'a\\.env')).toBe(true);
    expect(globMatch('**/.env', 'a\\b\\.env')).toBe(true);
    expect(globMatch('**\\README', 'a\\README')).toBe(true); // pattern backslashes too
  });

  it('anchors the full path (no partial / prefix matches)', () => {
    expect(globMatch('**/.env', 'x.env')).toBe(false);
    expect(globMatch('**/.env', '.envs')).toBe(false);
  });
});

describe('policy/risk — globmatch compiled regex shape', () => {
  it('`**/` compiles to a zero-or-more directory-group (no mandatory leading `/`)', () => {
    const src = globToRegExp('**/.env').source;
    expect(src.startsWith('^')).toBe(true);
    expect(src).toBe('^(?:[^/\\\\]*\\/)*\\.env$');
    // the old buggy compile emitted `.*/` which required a leading separator
    expect(src.startsWith('^.*')).toBe(false);
  });
});