import { describe, expect, it } from 'vitest';
import { canonicalJson, stableStringify } from './canonicalJson.js';

describe('canonical JSON', () => {
  it('sorts deeply, including numeric property names, without sorting arrays', () => {
    const first = { z: [{ b: 2, a: 1 }, 3], '2': 'two', '10': 'ten', a: { y: true, x: null } };
    const second = { a: { x: null, y: true }, '10': 'ten', '2': 'two', z: [{ a: 1, b: 2 }, 3] };
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(stableStringify(first)).toBe('{"10":"ten","2":"two","a":{"x":null,"y":true},"z":[{"a":1,"b":2},3]}');
  });
  it('uses RFC 8785 ECMAScript numbers and string escaping', () => {
    expect(canonicalJson([333333333.33333329, 1e30, 4.50, 2e-3, 1e-27, -0])).toBe('[333333333.3333333,1e+30,4.5,0.002,1e-27,0]');
    expect(canonicalJson('\u0000\b\t\n\f\r"\\/é😀')).toBe('"\\u0000\\b\\t\\n\\f\\r\\"\\\\/é😀"');
    expect(canonicalJson({ '\uE000': 1, '😀': 2, '\r': 3, '€': 4 })).toBe('{"\\r":3,"€":4,"😀":2,"":1}');
  });
  it('preserves optional wire fields and rejects invalid JCS inputs', () => {
    expect(canonicalJson({ optional: undefined, array: [undefined], present: false })).toBe('{"array":[null],"present":false}');
    for (const value of [NaN, Infinity, -Infinity, '\uD800', '\uDC00', 1n, undefined, new Date(0)]) expect(() => canonicalJson(value)).toThrow(TypeError);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('Circular');
    const reused = { a: 1 }; expect(canonicalJson([reused, reused])).toBe('[{"a":1},{"a":1}]');
  });
});
