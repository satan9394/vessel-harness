/**
 * Minimal glob matcher (policy-local copy — policy must not depend on tools;
 * ARCHITECTURE §4.6: policy 不反向依赖工具实现).
 * Supports `**`, `*`, `?`, `{a,b}`, char classes.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          // `**/` = zero or more directory segments (so `**/.env` also hits
          // a root-level `.env`, and `dir/**/foo` also hits `dir/foo`).
          re += '(?:[^/\\\\]*/)*';
          i += 3; // consume `**` and the following `/`
        } else {
          re += '.*';
          i += 2;
          if (re.endsWith('/.*')) {
            // `dir/**` must also match `dir` itself.
            re = re.slice(0, -3) + '(?:/.*)?';
          }
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
        re += '(?:' + alts.map((a) => a.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*')).join('|') + ')';
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
    re += c!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

export function globMatch(pattern: string, value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return globToRegExp(pattern.replace(/\\/g, '/')).test(normalized);
}
