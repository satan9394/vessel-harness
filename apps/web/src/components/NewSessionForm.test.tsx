import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewSessionForm from './NewSessionForm';
import type { ApiClient } from '../api';
import { translate } from '../i18n';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as (() => void)[] }));
vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ t: translate('zh'), lang: 'zh' }) }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial; return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }]; },
  useEffect: (effect: () => (() => void), deps: unknown[]) => { const i = hooks.cursor++; const previous = hooks.values[i] as unknown[] | undefined; if (!previous || deps.some((dep, index) => dep !== previous[index])) hooks.effects.push(() => { hooks.cleanups[i]?.(); hooks.cleanups[i] = effect(); }); hooks.values[i] = deps; },
}));
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] { if (Array.isArray(root)) return root.flatMap(nodes); if (!isValidElement<Record<string, unknown>>(root)) return []; return [root, ...nodes(root.props.children as ReactNode)]; }
const models = [{ id: 'chat', name: 'chat', providerName: 'alpha', protocol: 'openai-compatible' }, { id: 'reason', name: 'reason', providerName: 'beta', protocol: 'anthropic' }];
let api: ApiClient; const configure = vi.fn(); const created = vi.fn();
let revision = 0; let hidden = false;
function render() { hooks.cursor = 0; const tree = nodes(NewSessionForm({ api, onCreated: created, onClose: () => {}, onConfigureModels: configure, providerRevision: revision, hidden })); hooks.effects.splice(0).forEach(effect => effect()); return tree; }
function field(tree: ReturnType<typeof render>, id: string) { return tree.find(node => node.props.id === id)!; }
function change(node: ReactElement<Record<string, unknown>>, value: string) { (node.props.onChange as (e: unknown) => void)({ target: { value } }); }
async function settle() { await vi.waitFor(() => expect(render().find(node => node.type === 'button' && node.props.type === 'submit')!.props.disabled).toBe(false)); }
beforeEach(() => {
  hooks.cleanups.forEach(cleanup => cleanup?.()); hooks.values = []; hooks.effects = []; hooks.cleanups = []; hooks.cursor = 0; revision = 0; hidden = false; vi.clearAllMocks();
  api = { listModels: vi.fn(async () => ({ models })), openProject: vi.fn(async () => ({})), createSession: vi.fn(async () => ({ session: { id: 'new', workspaceRoot: 'E:/workspace' } })) } as unknown as ApiClient;
});
describe('NewSessionForm real model choice', () => {
  it('submits exact provider/model with workspace and permission', async () => {
    let tree = render(); change(field(tree, 'workspaceRoot'), 'E:/workspace'); await settle(); tree = render();
    change(field(tree, 'sessionModel'), JSON.stringify(['beta', 'reason'])); change(field(tree, 'sessionPermission'), 'read-only'); tree = render();
    await (tree.find(node => node.type === 'form')!.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {} });
    expect(api.createSession).toHaveBeenCalledWith({ workspaceRoot: 'E:/workspace', provider: 'beta', model: 'reason', permission: 'read-only' });
    expect(created).toHaveBeenCalledWith({ sessionId: 'new', projectRoot: 'E:/workspace' });
  });
  it('guides configuration even with mock catalog and preserves form across settings refresh', async () => {
    vi.mocked(api.listModels).mockResolvedValueOnce({ models: [{ ...models[0]!, providerName: 'mock' }] });
    let tree = render(); change(field(tree, 'workspaceRoot'), 'E:/workspace'); change(field(tree, 'sessionPermission'), 'read-only'); await settle(); tree = render();
    expect(tree.some(node => node.props.children === '尚未配置模型')).toBe(true);
    const guide = tree.find(node => node.props.children === '配置新模型')!; (guide.props.onClick as () => void)(); expect(configure).toHaveBeenCalledOnce();
    hidden = true; tree = render(); expect(tree[0]!.props.hidden).toBe(true); revision++; hidden = false; render(); await settle(); tree = render();
    expect(field(tree, 'workspaceRoot').props.value).toBe('E:/workspace'); expect(field(tree, 'sessionPermission').props.value).toBe('read-only');
    expect(field(tree, 'sessionModel').props.value).toBe(JSON.stringify(['alpha', 'chat'])); expect(api.listModels).toHaveBeenCalledTimes(2);
  });
  it('shows localized load failure and blocks submission', async () => {
    vi.mocked(api.listModels).mockRejectedValue(new Error('raw English secret'));
    render(); await vi.waitFor(() => expect(render().some(node => node.props.role === 'alert')).toBe(true));
    expect(render().find(node => node.props.role === 'alert')!.props.children).toBe('无法加载模型，请重试');
  });
});
