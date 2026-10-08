/** Deterministic JSON for wire payloads. Arrays retain order; undefined object fields are omitted. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const serialize = (item: unknown, array = false): string | undefined => {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') return array ? 'null' : undefined;
    if (item === null) return 'null';
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('Canonical JSON requires finite numbers');
      return JSON.stringify(item);
    }
    if (typeof item === 'string') {
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item)) throw new TypeError('Canonical JSON requires valid Unicode');
      return JSON.stringify(item);
    }
    if (typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item !== 'object') throw new TypeError('Unsupported canonical JSON value');
    if (ancestors.has(item)) throw new TypeError('Circular canonical JSON value');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return '[' + Array.from(item, entry => serialize(entry, true)).join(',') + ']';
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new TypeError('Canonical JSON requires plain objects');
      const object = item as Record<string, unknown>;
      // RFC 8785 sorts UTF-16 code units (not locale or Unicode code points).
      // ponytail: emit keys directly so numeric property names retain canonical order.
      const keys = Object.keys(object).sort();
      const entries: string[] = [];
      for (const key of keys) {
        const content = serialize(object[key]);
        if (content !== undefined) entries.push(serialize(key)! + ':' + content);
      }
      return '{' + entries.join(',') + '}';
    } finally { ancestors.delete(item); }
  };
  const result = serialize(value);
  if (result === undefined) throw new TypeError('Unsupported canonical JSON root');
  return result;
}

export const stableStringify = canonicalJson;
