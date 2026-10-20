import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api';
import { translate } from '../i18n';
import TaskComposer from './TaskComposer';
import { ModelQuickSwitcher, type ModelQuickSwitcherProps } from './providers/ModelQuickSwitcher';

// ponytail: Use the existing Node-only component harness; the browser owns newline insertion.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ t: translate('en'), lang: 'en' }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }];
  },
  useRef: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = { current: initial };
    return hooks.values[i];
  },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const i = hooks.cursor++;
    const previous = hooks.values[i] as unknown[] | undefined;
    if (!previous || deps.some((dep, index) => dep !== previous[index])) hooks.effects.push(() => {
      hooks.cleanups[i]?.();
      const cleanup = effect();
      if (cleanup) hooks.cleanups[i] = cleanup;
    });
    hooks.values[i] = deps;
  },
}));

function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}
let api: ApiClient;
const onStarted = vi.fn();
const onConfigureModels = vi.fn();
function render() {
  hooks.cursor = 0;
  const tree = nodes(TaskComposer({ api, projects: [], selectedRoot: 'E:/workspace', onSelectProject: () => {},
    providerRevision: 0, disabled: false, onConfigureModels, onAdvanced: () => {}, onStarted }));
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
}
function textarea() { return render().find(node => node.type === 'textarea')!; }
function invoke(node: ReactElement<Record<string, unknown>>, handler: string, event = {}) {
  return (node.props[handler] as (event: unknown) => unknown)(event);
}
function enter(overrides = {}) {
  const event = { key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), ...overrides };
  invoke(textarea(), 'onKeyDown', event);
  return event;
}
async function ready() {
  invoke(textarea(), 'onChange', { target: { value: '执行任务' } });
  await vi.waitFor(() => expect(render().find(node => node.type === 'button' && node.props.type === 'submit')!.props.disabled).toBe(false));
}
async function expectNoSubmission() {
  await Promise.resolve();
  expect(api.openProject).not.toHaveBeenCalled();
  expect(api.createSession).not.toHaveBeenCalled();
  expect(onStarted).not.toHaveBeenCalled();
}
beforeEach(() => {
  hooks.cleanups.forEach(cleanup => cleanup?.());
  hooks.values = []; hooks.cursor = 0; hooks.effects = []; hooks.cleanups = []; vi.clearAllMocks();
  api = {
    listModels: vi.fn(async () => ({ models: [] })), openProject: vi.fn(async () => ({})),
    createSession: vi.fn(async () => ({ session: { id: 'new', workspaceRoot: 'E:/workspace' } })),
    updateSessionTopic: vi.fn(async () => ({})),
  } as unknown as ApiClient;
});

describe('TaskComposer IME and keyboard submission', () => {
  it('opens the requested onboarding preset without submitting a session', async () => {
    render(); await ready();
    const cards = render().filter(node => node.props.className === 'onboarding-card');
    expect(cards).toHaveLength(4);
    invoke(cards[1]!, 'onClick'); expect(onConfigureModels).toHaveBeenCalledWith('anthropic');
    await expectNoSubmission();
  });
  it('submits the model chosen in the quick switcher', async () => {
    vi.mocked(api.listModels).mockResolvedValue({ models: [
      { id: 'one', name: 'One', providerName: 'alpha', protocol: 'openai-compatible' },
      { id: 'two', name: 'Two', providerName: 'beta', protocol: 'anthropic' },
    ] });
    await ready();
    const switcher = render().find(node => node.type === ModelQuickSwitcher)!.props as unknown as ModelQuickSwitcherProps;
    switcher.onSelect({ provider: 'beta', model: 'two' });
    enter();
    await vi.waitFor(() => expect(api.createSession).toHaveBeenCalledWith(expect.objectContaining({ provider: 'beta', model: 'two' })));
    expect(render().some(node => node.props.className === 'onboarding-card')).toBe(false);
  });
  it('leaves Enter to the IME while composition is active across renders', async () => {
    await ready();
    invoke(textarea(), 'onCompositionStart');
    expect(enter().preventDefault).not.toHaveBeenCalled();
    await expectNoSubmission();
  });

  it.each([
    { nativeEvent: { isComposing: true } },
    { keyCode: 229 },
  ])('guards native composition and legacy keyCode: %j', async overrides => {
    await ready();
    expect(enter(overrides).preventDefault).not.toHaveBeenCalled();
    await expectNoSubmission();
  });

  it('submits the completed text on Enter after compositionEnd', async () => {
    await ready();
    invoke(textarea(), 'onCompositionStart');
    enter();
    await expectNoSubmission();
    invoke(textarea(), 'onCompositionEnd');
    expect(enter().preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => expect(onStarted).toHaveBeenCalledExactlyOnceWith({ id: 'new', workspaceRoot: 'E:/workspace' }, '执行任务'));
  });

  it('allows the native Shift+Enter newline and keeps multiline text without submitting', async () => {
    await ready();
    expect(enter({ shiftKey: true }).preventDefault).not.toHaveBeenCalled();
    // Simulate the subsequent native textarea change; no DOM dependency is installed.
    invoke(textarea(), 'onChange', { target: { value: '执行任务\n' } });
    expect(textarea().props.value).toBe('执行任务\n');
    await expectNoSubmission();
  });

  it('blocks form submission during composition as well', async () => {
    await ready();
    invoke(textarea(), 'onCompositionStart');
    await invoke(render().find(node => node.type === 'form')!, 'onSubmit', { preventDefault: vi.fn() });
    await expectNoSubmission();
  });
});
