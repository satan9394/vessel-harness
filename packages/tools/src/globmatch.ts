/**
 * Minimal glob matcher.
 * Supports: ** (any depth), * (within segment), ? (single char),
 * {a,b} alternation and [abc] character classes.
 * Used for policy path matching and the Glob tool.
 */

const ESCAPE_RE = /[.+^${}()|[\]\\]/g;

export function globToRegExp(pattern: string): RegExp {
  let re = '';
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (re.endsWith('/.*')) {
          re = re.slice(0, -3) + '(?:/.*)?';
        }
        continue;
      }
      re += '[^/\\\\]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      re += '[^/\\\\]';
      i += 1;
      continue;
    }
    if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end > i) {
        const alts = pattern.slice(i + 1, end).split(',');
        const inner = alts
          .map((a) => a.replace(ESCAPE_RE, '\\$&').replace(/\*/g, '[^/\\\\]*'))
          .join('|');
        re += '(?:' + inner + ')';
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const end = pattern.indexOf(']', i);
      if (end > i) {
        re += pattern.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    re += c.replace(ESCAPE_RE, '\\$&');
    i += 1;
  }
  return new RegExp('^' + re + '$');
}

export function globMatch(pattern: string, value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return globToRegExp(pattern.replace(/\\/g, '/')).test(normalized);
}
