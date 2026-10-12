import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ModelSelector from './ModelSelector';
import { ApiError, type ApiClient } from '../api';
import { translate } from '../i18n';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ t: translate('en'), lang: 'en' }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial; return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }]; },
  useRef: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = { current: initial }; return hooks.values[i]; },
  useEffect: (effect: () => (() => void), deps: unknown[]) => { const i = hooks.cursor++; const previous = hooks.values[i] as unknown[] | undefined; if (!previous || deps.some((dep, index) => dep !== previous[index])) hooks.effects.push(() => { hooks.cleanups[i]?.(); hooks.cleanups[i] = effect(); }); hooks.values[i] = deps; },
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!isValidElement<Record<string, unknown>>(root)) return []; return [root, ...nodes(root.props.children as ReactNode)]; }
const models = [{ id: 'a', name: 'a', providerName: 'alpha', protocol: 'openai-compatible' }, { id: 'b', name: 'b', providerName: 'beta', protocol: 'anthropic' }];
let api: ApiClient; let busy = false; let sessionId = 's1'; let revision = 0;
const onUpdated = vi.fn(); const onBusyChange = vi.fn();
function render() { hooks.cursor = 0; const tree = nodes(ModelSelector({ api, sessionId, providerRevision: revision, busy, onUpdated, onBusyChange })); hooks.effects.splice(0).forEach(effect => effect()); return tree; }
function selector() { return render().find(node => node.type === 'select')!; }
async function settle() { await vi.waitFor(() => expect(selector().props.disabled).toBe(false)); }
async function select() { (selector().props.onChange as (event: unknown) => void)({ target: { value: JSON.stringify(['beta', 'b']) } }); await vi.waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false)); }
beforeEach(() => {
  hooks.cleanups.forEach(cleanup => cleanup?.()); hooks.values = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0; busy = false; revision = 0; sessionId = 's1'; vi.clearAllMocks();
  api = { listModels: vi.fn(async () => ({ models })), getSession: vi.fn(async () => ({ session: { id: 's1', workspaceRoot: '/', createdAt: '', provider: 'alpha', model: 'a' } })), switchSessionModel: vi.fn(async () => ({ session: { id: 's1', workspaceRoot: '/', createdAt: '', provider: 'beta', model: 'b' } })) } as unknown as ApiClient;
});
describe('ModelSelector actual session models', () => {
  it('loads the actual current model and switches through the API', async () => {
    render(); await settle(); expect(selector().props.value).toBe(JSON.stringify(['alpha', 'a']));
    expect(render().filter(node => node.type === 'option').map(node => node.props.children)).toEqual([['alpha', ' / ', 'a'], ['beta', ' / ', 'b']]);
    await select(); expect(api.switchSessionModel).toHaveBeenCalledWith('s1', { provider: 'beta', model: 'b' }); expect(selector().props.value).toBe(JSON.stringify(['beta', 'b'])); expect(onUpdated).toHaveBeenCalledOnce();
  });
  it('keeps selection after failed switch and translates busy errors', async () => {
    vi.mocked(api.switchSessionModel).mockRejectedValue(new ApiError('session_busy', 409, { error: 'session_busy' }));
    render(); await settle(); await select(); expect(selector().props.value).toBe(JSON.stringify(['alpha', 'a']));
    expect(render().find(node => node.props.role === 'alert')!.props.children).toBe('Wait for the active task to finish before switching models.'); expect(onUpdated).not.toHaveBeenCalled();
  });
  it('reports unsupported switching as a switch failure rather than an active task', async () => {
    vi.mocked(api.switchSessionModel).mockRejectedValue(new ApiError('model_switch_unavailable', 409, { error: 'model_switch_unavailable' }));
    render(); await settle(); await select();
    expect(render().find(node => node.props.role === 'alert')!.props.children).toBe('Model switch failed. The current model is unchanged.');
  });
  it('disables switching while a turn is active and refreshes provider changes', async () => {
    render(); await settle(); busy = true; expect(selector().props.disabled).toBe(true);
    (selector().props.onChange as (event: unknown) => void)({ target: { value: JSON.stringify(['beta', 'b']) } }); expect(api.switchSessionModel).not.toHaveBeenCalled();
    busy = false; revision++; render(); await settle(); expect(api.listModels).toHaveBeenCalledTimes(2);
  });
  it('keeps busy ownership through a catalog refresh and releases it on completion', async () => {
    let resolve!: (value: Awaited<ReturnType<ApiClient['switchSessionModel']>>) => void;
    vi.mocked(api.switchSessionModel).mockImplementation(() => new Promise(done => { resolve = done; }));
    render(); await settle(); (selector().props.onChange as (event: unknown) => void)({ target: { value: JSON.stringify(['beta', 'b']) } });
    expect(onBusyChange).toHaveBeenLastCalledWith(true); revision++; render();
    resolve({ session: { id: 's1', workspaceRoot: '/', createdAt: '', provider: 'beta', model: 'b' } });
    await vi.waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false)); await settle();
    expect(selector().props.value).toBe(JSON.stringify(['beta', 'b'])); expect(onUpdated).toHaveBeenCalledOnce();
  });
  it('ignores an old session switch response after session navigation', async () => {
    let resolve!: (value: Awaited<ReturnType<ApiClient['switchSessionModel']>>) => void;
    vi.mocked(api.switchSessionModel).mockImplementation(() => new Promise(done => { resolve = done; }));
    render(); await settle(); (selector().props.onChange as (event: unknown) => void)({ target: { value: JSON.stringify(['beta', 'b']) } });
    sessionId = 's2'; render(); expect(onBusyChange).toHaveBeenLastCalledWith(false); await settle(); resolve({ session: { id: 's1', workspaceRoot: '/', createdAt: '', provider: 'beta', model: 'b' } }); await Promise.resolve(); await Promise.resolve();
    expect(selector().props.value).toBe(JSON.stringify(['alpha', 'a'])); expect(onUpdated).not.toHaveBeenCalled();
  });
});
