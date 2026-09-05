/**
 * Dev-only vitest-compatible shim for sandboxed environments where vitest's
 * esbuild service cannot spawn (piped stdio is blocked). Implements the subset
 * of the vitest API used by this repo's tests on top of node:test + node:assert.
 *
 * Canonical verification stays `npx vitest run` (see docs/V02-PROGRESS.md);
 * this shim is a fallback lane, not a replacement for vitest.
 */
import { describe, it, test, beforeEach, afterEach, before, after } from 'node:test';
import * as assert from 'node:assert/strict';

// vitest names for suite-level hooks; node:test calls them before/after
const beforeAll = before;
const afterAll = after;

// ---------------------------------------------------------------------------
// Asymmetric matchers (expect.any / expect.anything / expect.objectContaining)
// ---------------------------------------------------------------------------

export class AsymmetricMatcher {
  constructor(check, name) {
    this.check = check;
    this.name = name;
  }
  matches(actual) {
    return this.check(actual);
  }
}

export const any = (ctor) => new AsymmetricMatcher((v) => v instanceof ctor, `any(${ctor.name})`);
export const anything = () => new AsymmetricMatcher(() => true, 'anything');
export const objectContaining = (subset) =>
  new AsymmetricMatcher((v) => isPartialMatch(v, subset), 'objectContaining');

function isAsymmetric(v) {
  return v instanceof AsymmetricMatcher;
}

function isPartialMatch(actual, expected) {
  if (isAsymmetric(expected)) return expected.matches(actual);
  if (expected === null) return actual === null;
  if (typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') return false;
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.length !== expected.length) return false;
      return expected.every((e, i) => isPartialMatch(actual[i], e));
    }
    return Object.keys(expected).every((k) => isPartialMatch(actual[k], expected[k]));
  }
  return Object.is(actual, expected);
}

function argsEqual(actualArgs, expectedArgs) {
  if (actualArgs.length !== expectedArgs.length) return false;
  return actualArgs.every((a, i) => {
    const e = expectedArgs[i];
    if (isAsymmetric(e)) return e.matches(a);
    try {
      assert.deepStrictEqual(a, e);
      return true;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// Spies (vi.fn / vi.spyOn)
// ---------------------------------------------------------------------------

const registeredSpies = new Set();

export function fn(impl) {
  const spy = function (...args) {
    spy.mock.calls.push(args);
    let result;
    try {
      result = (spy._impl ?? (() => undefined))(...args);
      if (result && typeof result.then === 'function') {
        return result.then(
          (r) => {
            spy.mock.results.push({ type: 'return', value: r });
            return r;
          },
          (e) => {
            spy.mock.results.push({ type: 'throw', value: e });
            throw e;
          },
        );
      }
      spy.mock.results.push({ type: 'return', value: result });
      return result;
    } catch (err) {
      spy.mock.results.push({ type: 'throw', value: err });
      throw err;
    }
  };
  spy.mock = { calls: [], results: [] };
  spy._impl = impl;
  spy.mockImplementation = (f) => {
    spy._impl = f;
    return spy;
  };
  spy.mockReturnValue = (v) => {
    spy._impl = () => v;
    return spy;
  };
  spy.mockResolvedValue = (v) => {
    spy._impl = async () => v;
    return spy;
  };
  spy.mockRejectedValue = (e) => {
    spy._impl = async () => {
      throw e;
    };
    return spy;
  };
  spy.mockClear = () => {
    spy.mock.calls = [];
    spy.mock.results = [];
    return spy;
  };
  spy.mockReset = () => {
    spy.mockClear();
    spy._impl = () => undefined;
    return spy;
  };
  spy.mockRestore = () => {
    spy.mockClear();
    spy._impl = undefined;
    return spy;
  };
  registeredSpies.add(spy);
  return spy;
}

export function spyOn(obj, method) {
  const orig = obj[method];
  if (typeof orig !== 'function') {
    throw new Error(`[vitest-shim] spyOn: ${String(method)} is not a function`);
  }
  const spy = fn(orig);
  spy._original = orig;
  obj[method] = spy;
  spy.mockRestore = () => {
    obj[method] = orig;
    registeredSpies.delete(spy);
  };
  return spy;
}

export const vi = {
  fn,
  spyOn,
  mock: spyOn,
  clearAllMocks() {
    for (const s of registeredSpies) s.mockClear();
  },
  resetAllMocks() {
    for (const s of registeredSpies) s.mockReset();
  },
  restoreAllMocks() {
    for (const s of [...registeredSpies]) s.mockRestore();
  },
  async waitFor(callback, opts = {}) {
    const timeout = opts.timeout ?? 1000;
    const interval = opts.interval ?? 10;
    const start = Date.now();
    let lastErr;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        await callback();
        return;
      } catch (err) {
        lastErr = err;
        if (Date.now() - start >= timeout) break;
        await new Promise((r) => setTimeout(r, interval));
      }
    }
    throw lastErr ?? new Error('vi.waitFor timed out');
  },
};

// ---------------------------------------------------------------------------
// expect()
// ---------------------------------------------------------------------------

function fail(message) {
  throw new Error(message);
}

function assertMatch(actual, expected) {
  if (expected instanceof RegExp) return expected.test(actual);
  return String(actual).includes(String(expected));
}

class ExpectImpl {
  constructor(value, negated = false) {
    this.value = value;
    this._negated = negated;
  }

  get not() {
    return new ExpectImpl(this.value, !this._negated);
  }

  get rejects() {
    return new PromiseExpectation(this.value, false, this._negated);
  }

  get resolves() {
    return new PromiseExpectation(this.value, true, this._negated);
  }

  _check(ok, message) {
    if (this._negated ? ok : !ok) {
      fail(message);
    }
    return undefined;
  }

  toBe(expected) {
    const ok = Object.is(this.value, expected);
    this._check(ok, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(this.value)} (toBe)`);
  }

  toEqual(expected) {
    let ok = true;
    try {
      assert.deepStrictEqual(this.value, expected);
    } catch {
      ok = false;
    }
    this._check(ok, `expected deep-equal ${JSON.stringify(expected)}, got ${JSON.stringify(this.value)} (toEqual)`);
  }

  toStrictEqual(expected) {
    this.toEqual(expected);
  }

  toContain(expected) {
    let ok = false;
    const v = this.value;
    if (typeof v === 'string') ok = v.includes(String(expected));
    else if (Array.isArray(v)) ok = v.some((x) => (isAsymmetric(expected) ? expected.matches(x) : Object.is(x, expected)));
    else if (v instanceof Set) ok = v.has(expected);
    else if (v && typeof v === 'object') ok = expected in v;
    this._check(ok, `expected ${JSON.stringify(this.value)} to contain ${JSON.stringify(expected)} (toContain)`);
  }

  toHaveLength(n) {
    const ok = this.value != null && typeof this.value.length === 'number' && this.value.length === n;
    this._check(ok, `expected length ${n}, got ${this.value?.length} (toHaveLength)`);
  }

  toBeUndefined() {
    this._check(this.value === undefined, `expected undefined, got ${JSON.stringify(this.value)} (toBeUndefined)`);
  }

  toBeDefined() {
    this._check(this.value !== undefined, `expected defined, got undefined (toBeDefined)`);
  }

  toBeNull() {
    this._check(this.value === null, `expected null, got ${JSON.stringify(this.value)} (toBeNull)`);
  }

  toBeTruthy() {
    this._check(Boolean(this.value), `expected truthy, got ${JSON.stringify(this.value)} (toBeTruthy)`);
  }

  toBeFalsy() {
    this._check(!this.value, `expected falsy, got ${JSON.stringify(this.value)} (toBeFalsy)`);
  }

  toBeGreaterThan(n) {
    this._check(this.value > n, `expected > ${n}, got ${this.value} (toBeGreaterThan)`);
  }

  toBeGreaterThanOrEqual(n) {
    this._check(this.value >= n, `expected >= ${n}, got ${this.value} (toBeGreaterThanOrEqual)`);
  }

  toBeLessThan(n) {
    this._check(this.value < n, `expected < ${n}, got ${this.value} (toBeLessThan)`);
  }

  toBeLessThanOrEqual(n) {
    this._check(this.value <= n, `expected <= ${n}, got ${this.value} (toBeLessThanOrEqual)`);
  }

  toMatch(expected) {
    let ok = false;
    if (typeof this.value === 'string') ok = assertMatch(this.value, expected);
    else if (Array.isArray(this.value)) ok = this.value.some((x) => assertMatch(String(x), expected));
    this._check(ok, `expected ${JSON.stringify(this.value)} to match ${expected} (toMatch)`);
  }

  toMatchObject(expected) {
    const ok = isPartialMatch(this.value, expected);
    this._check(ok, `expected ${JSON.stringify(this.value)} to match object ${JSON.stringify(expected)} (toMatchObject)`);
  }

  toThrow(expected) {
    if (typeof this.value !== 'function') {
      fail('toThrow expects a function (or use .rejects on a promise)');
    }
    let threw = false;
    let thrown;
    try {
      const ret = this.value();
      if (ret && typeof ret.then === 'function') {
        fail('toThrow on an async function: use await expect(fn()).rejects.toThrow()');
      }
    } catch (err) {
      threw = true;
      thrown = err;
    }
    if (this._negated) {
      this._check(threw, 'expected function not to throw');
      return;
    }
    if (!threw) fail('expected function to throw, but it did not (toThrow)');
    matchThrown(thrown, expected);
  }

  toBeInstanceOf(ctor) {
    const ok = this.value instanceof ctor;
    this._check(ok, `expected instanceof ${ctor.name}, got ${JSON.stringify(this.value)} (toBeInstanceOf)`);
  }

  toHaveProperty(path, value) {
    const keys = Array.isArray(path) ? path : String(path).split('.');
    let cur = this.value;
    for (const k of keys) {
      if (cur == null || !(k in Object(cur))) {
        this._check(false, `expected property ${String(path)} (toHaveProperty)`);
        return;
      }
      cur = cur[k];
    }
    if (arguments.length >= 2) {
      const ok = Object.is(cur, value);
      this._check(ok, `expected property ${String(path)} = ${JSON.stringify(value)}, got ${JSON.stringify(cur)} (toHaveProperty)`);
      return;
    }
    this._check(true, '');
  }

  toHaveBeenCalled() {
    const spy = requireSpy(this.value);
    this._check(spy.mock.calls.length > 0, 'expected spy to have been called (toHaveBeenCalled)');
  }

  toHaveBeenCalledTimes(n) {
    const spy = requireSpy(this.value);
    this._check(spy.mock.calls.length === n, `expected spy called ${n} times, got ${spy.mock.calls.length} (toHaveBeenCalledTimes)`);
  }

  toHaveBeenCalledWith(...args) {
    const spy = requireSpy(this.value);
    const ok = spy.mock.calls.some((c) => argsEqual(c, args));
    this._check(ok, `expected spy to have been called with ${JSON.stringify(args)} (toHaveBeenCalledWith)`);
  }
}

function requireSpy(v) {
  if (v && typeof v === 'function' && v.mock && Array.isArray(v.mock.calls)) return v;
  fail('matcher requires a spy (vi.fn / vi.spyOn)');
}

function matchThrown(thrown, expected) {
  if (expected === undefined) return;
  if (expected instanceof RegExp) {
    if (!expected.test(String(thrown?.message ?? thrown))) {
      fail(`expected throw message to match ${expected}, got "${thrown?.message ?? thrown}"`);
    }
    return;
  }
  if (typeof expected === 'string') {
    if (!String(thrown?.message ?? thrown).includes(expected)) {
      fail(`expected throw message to include "${expected}", got "${thrown?.message ?? thrown}"`);
    }
    return;
  }
  if (typeof expected === 'function' && expected.prototype instanceof Error) {
    if (!(thrown instanceof expected)) {
      fail(`expected throw instanceof ${expected.name}, got ${thrown?.constructor?.name}`);
    }
    return;
  }
  if (typeof expected === 'function') {
    if (!expected(thrown)) fail('expected throw predicate to pass');
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!isPartialMatch(thrown, expected)) {
      fail(`expected throw to match object ${JSON.stringify(expected)}, got ${JSON.stringify(thrown)}`);
    }
    return;
  }
  if (!Object.is(thrown, expected)) fail(`expected throw ${JSON.stringify(expected)}, got ${JSON.stringify(thrown)}`);
}

class PromiseExpectation {
  constructor(promise, resolve, negated) {
    this.promise = promise;
    this.resolve = resolve;
    this.negated = negated;
  }

  get not() {
    return new PromiseExpectation(this.promise, this.resolve, !this.negated);
  }

  async _value() {
    if (this.resolve) {
      return await this.promise;
    }
    return await assert.rejects(this.promise);
  }

  async _apply(name, ...args) {
    const v = await this._value();
    return new ExpectImpl(v, this.negated)[name](...args);
  }

  async toThrow(expected) {
    if (this.resolve) {
      const v = await this._value();
      return new ExpectImpl(() => v, this.negated).toThrow(expected);
    }
    let threw = false;
    let reason;
    try {
      await this.promise;
    } catch (err) {
      threw = true;
      reason = err;
    }
    if (this.negated) {
      if (threw) fail('expected promise not to reject (rejects.toThrow negated)');
      return;
    }
    if (!threw) fail('expected promise to reject, but it resolved (rejects.toThrow)');
    matchThrown(reason, expected);
  }

  toBe(...a) { return this._apply('toBe', ...a); }
  toEqual(...a) { return this._apply('toEqual', ...a); }
  toContain(...a) { return this._apply('toContain', ...a); }
  toHaveLength(...a) { return this._apply('toHaveLength', ...a); }
  toBeUndefined() { return this._apply('toBeUndefined'); }
  toBeDefined() { return this._apply('toBeDefined'); }
  toBeTruthy() { return this._apply('toBeTruthy'); }
  toBeFalsy() { return this._apply('toBeFalsy'); }
  toBeNull() { return this._apply('toBeNull'); }
  toMatch(...a) { return this._apply('toMatch', ...a); }
  toMatchObject(...a) { return this._apply('toMatchObject', ...a); }
  toBeGreaterThan(...a) { return this._apply('toBeGreaterThan', ...a); }
  toBeGreaterThanOrEqual(...a) { return this._apply('toBeGreaterThanOrEqual', ...a); }
  toBeLessThan(...a) { return this._apply('toBeLessThan', ...a); }
  toBeLessThanOrEqual(...a) { return this._apply('toBeLessThanOrEqual', ...a); }
  toBeInstanceOf(...a) { return this._apply('toBeInstanceOf', ...a); }
  toHaveProperty(...a) { return this._apply('toHaveProperty', ...a); }
  toHaveBeenCalled() { return this._apply('toHaveBeenCalled'); }
  toHaveBeenCalledTimes(...a) { return this._apply('toHaveBeenCalledTimes', ...a); }
  toHaveBeenCalledWith(...a) { return this._apply('toHaveBeenCalledWith', ...a); }
}

export function expect(value) {
  return new ExpectImpl(value);
}

expect.any = any;
expect.anything = anything;
expect.objectContaining = objectContaining;

// ---------------------------------------------------------------------------
// Re-export node:test primitives under the same names vitest tests use.
// ---------------------------------------------------------------------------

export { describe, it, test, beforeEach, afterEach, beforeAll, afterAll };

export default { describe, it, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll };
