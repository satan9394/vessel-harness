import type { ModExecutionContext, ModInterceptResult, ModMiddleware } from './types.js';

export class ModPipelineError extends Error {
  constructor(readonly modName: string, readonly operation: string, cause: unknown) {
    super(`Mod ${modName} failed closed during ${operation}`, { cause });
    this.name = 'ModPipelineError';
  }
}

/** Clone data without invoking accessors or retaining host references. */
function snapshot<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || value === undefined) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError('Mod data must be JSON-compatible');
  if (ancestors.has(value)) throw new TypeError('Cyclic Mod data');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new TypeError('Non-plain Mod data');
  ancestors.add(value);
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe Mod data key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new TypeError('Mod data accessors are forbidden');
    Object.defineProperty(copy, key, { value: snapshot(descriptor.value, ancestors), enumerable: true });
  }
  ancestors.delete(value);
  return Object.freeze(copy) as T;
}

function record(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected Mod data record');
}

function rejectAuthorityChanges(value: Record<string, unknown>): void {
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[_-]/g, '').toLowerCase();
    if (/(sandbox|credential|policy)/.test(normalized) || ['securitylevel', 'permission', 'permissions', 'apikey', 'accesstoken', 'secret'].includes(normalized)) throw new TypeError('Mod cannot rewrite host authority');
    if (child && typeof child === 'object') rejectAuthorityChanges(child as Record<string, unknown>);
  }
}

export class ModPipeline {
  private readonly middleware = new Map<string, ModMiddleware>();
  private failure?: ModPipelineError;

  register(mod: ModMiddleware): void {
    if (!/^[\w.-]+$/.test(mod.name) || !mod.version || !Number.isFinite(mod.priority)) throw new TypeError('Invalid Mod identity or priority');
    if (this.middleware.has(mod.name)) throw new TypeError(`Duplicate Mod: ${mod.name}`);
    // Capture and bind callbacks: registration cannot later be changed by its caller.
    this.middleware.set(mod.name, Object.freeze({
      name: mod.name, version: mod.version, priority: mod.priority,
      observe: mod.observe?.bind(mod), rewriteToolInput: mod.rewriteToolInput?.bind(mod),
      rewritePromptFragment: mod.rewritePromptFragment?.bind(mod), interceptToolCall: mod.interceptToolCall?.bind(mod),
    }));
  }

  unregister(name: string): boolean { return this.middleware.delete(name); }

  list(): ModMiddleware[] {
    // Stable sort preserves registration order at equal priority.
    return [...this.middleware.values()].sort((a, b) => a.priority - b.priority);
  }

  private async invoke<T>(mod: ModMiddleware, operation: string, call: () => Promise<T>): Promise<T> {
    this.assertHealthy();
    try { return await call(); }
    catch (cause) {
      this.failure ??= new ModPipelineError(mod.name, operation, cause);
      throw this.failure;
    }
  }

  private assertHealthy(): void { if (this.failure) throw this.failure; }

  async dispatchObserve(type: string, payload: unknown, context: ModExecutionContext): Promise<void> {
    this.assertHealthy();
    const event = snapshot({ type, payload, context });
    // Result observers unwind the onion; all entry events traverse outer to inner.
    const layers = this.list();
    if (type === 'after_tool') layers.reverse();
    for (const mod of layers) if (mod.observe) await this.invoke(mod, 'observe', () => mod.observe!(event));
  }

  async dispatchRewriteToolInput(toolName: string, input: Record<string, unknown>, context: ModExecutionContext): Promise<Record<string, unknown>> {
    this.assertHealthy();
    record(input);
    let current = snapshot(input);
    const isolatedContext = snapshot({ ...snapshot(context), toolName });
    for (const mod of this.list()) if (mod.rewriteToolInput) {
      current = await this.invoke(mod, 'rewriteToolInput', async () => {
        const rewritten = await mod.rewriteToolInput!(current, isolatedContext);
        record(rewritten);
        const isolated = snapshot(rewritten);
        rejectAuthorityChanges(isolated);
        return isolated;
      });
    }
    return current;
  }

  async dispatchIntercept(toolName: string, input: Record<string, unknown>, context: ModExecutionContext): Promise<ModInterceptResult> {
    this.assertHealthy();
    record(input);
    const isolatedInput = snapshot(input);
    const isolatedContext = snapshot({ ...snapshot(context), toolName });
    for (const mod of this.list()) if (mod.interceptToolCall) {
      const result = await this.invoke(mod, 'interceptToolCall', async () => {
        const response = snapshot(await mod.interceptToolCall!(isolatedInput, isolatedContext));
        record(response);
        if (typeof response.handled !== 'boolean' || (response.reason !== undefined && typeof response.reason !== 'string')) throw new TypeError('Invalid Mod intercept response');
        return response as unknown as ModInterceptResult;
      });
      if (result.handled) return result;
    }
    return { handled: false };
  }

  /** Only the incremental fragment is exposed. No stable or session prefix reaches a Mod. */
  async dispatchRewritePromptFragment(fragment: string, context: ModExecutionContext): Promise<string> {
    this.assertHealthy();
    const isolatedContext = snapshot(context);
    let current = fragment;
    const names: string[] = [];
    for (const mod of this.list()) if (mod.rewritePromptFragment) {
      current = await this.invoke(mod, 'rewritePromptFragment', async () => {
        const rewritten = await mod.rewritePromptFragment!(current, isolatedContext);
        if (typeof rewritten !== 'string') throw new TypeError('Invalid Mod prompt fragment');
        return rewritten;
      });
      names.push(`[Mod: ${mod.name}]`);
    }
    return names.length ? `${names.join('\n')}\n${current}` : current;
  }

  async appendScopedPrompt(scopedPrefix: string, fragment: string, context: ModExecutionContext): Promise<string> {
    const rewritten = await this.dispatchRewritePromptFragment(fragment, context);
    return rewritten ? `${scopedPrefix}\n${rewritten}` : scopedPrefix;
  }
}
