import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamingReasoningBlock, type StreamingReasoningBlockProps } from './StreamingReasoningBlock';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as { deps: unknown[]; cleanup?: () => void }[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = initial; return [hooks.values[i], (v: unknown) => { hooks.values[i] = typeof v === 'function' ? v(hooks.values[i]) : v; }]; },
  useRef: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = { current: initial }; return hooks.values[i]; },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => { const i = hooks.cursor++; const old = hooks.effects[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) { old?.cleanup?.(); hooks.effects[i] = { deps, cleanup: effect() }; } },
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
function render(props: StreamingReasoningBlockProps) { hooks.cursor = 0; return nodes(StreamingReasoningBlock(props)); }
function text(tree: ReturnType<typeof render>) { return tree.flatMap(n => n.props.children).filter(v => typeof v === 'string').join(' ').replace(/\s+/g, ' '); }
afterEach(() => { hooks.effects.forEach(effect => effect?.cleanup?.()); hooks.effects = []; hooks.values = []; vi.useRealTimers(); });
describe('streaming reasoning interaction', () => {
  it('ticks while streaming, folds on completion, toggles on demand, restarts and cleans up timers', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const props = { content: 'a', isStreaming: true };
    expect(render(props).find(n => n.type === 'details')?.props.open).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(text(render({ ...props, content: 'ab' }))).toContain('1.2s');
    const ended = { ...props, isStreaming: false, elapsedMs: 1250 };
    render(ended); const folded = render(ended);
    expect(folded.find(n => n.type === 'details')?.props.open).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    (folded.find(n => n.type === 'summary')!.props.onClick as (e: { preventDefault(): void }) => void)({ preventDefault() {} });
    expect(render(ended).find(n => n.type === 'details')?.props.open).toBe(true);
    render(props); render(props); vi.advanceTimersByTime(200);
    expect(text(render(props))).toContain('200ms');
    hooks.effects.forEach(e => e?.cleanup?.()); expect(vi.getTimerCount()).toBe(0);
  });
  it('renders only supplied matched rules with lesson/reflection and keeps unknown counts unknown', () => {
    const props = { content: '<script>untrusted</script>', isStreaming: false, elapsedMs: 2000, matchedRules: [{ id: 'r', trigger: 'Shell', lesson: 'denied', recommendedAction: 'read-only' }] };
    expect(text(render(props))).toContain('Token rate unavailable');
    expect(text(render(props))).toContain('Rule r');
    expect(text(render(props))).toContain('denied'); expect(text(render(props))).toContain('Reflection: read-only');
    expect(text(render({ ...props, reasoningTokens: 12 }))).toContain('6.0 reasoning tokens/s');
    expect(text(render({ ...props, outputTokens: 20, modelDurationMs: 4000 }))).toContain('5.0 output tokens/s (model-call average)');
    expect(text(render({ ...props, reasoningTokens: 0 }))).toContain('0.0 reasoning tokens/s');
  });
});

// Use the real English dictionary while exercising JSX handlers without a renderer.
vi.mock('../LanguageProvider', async () => {
  const { translate } = await import('../../i18n');
  return { useI18n: () => ({ lang: 'en', t: translate('en'), setLang: vi.fn() }) };
});

