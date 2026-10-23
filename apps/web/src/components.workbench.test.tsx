import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ApiClient, SessionMeta } from './api';
import TaskComposer, { createTaskSession, projectName, readableSessionTitle } from './components/TaskComposer';
import { LanguageProvider } from './components/LanguageProvider';
import { groupedCommands, type CommandItem } from './components/palette/types';

const session: SessionMeta = { id: 'sess_debug_123', workspaceRoot: 'E:/Projects/Vessel', createdAt: '2026-10-12T00:00:00Z' };
describe('task-first workbench contract', () => {
  it('opens the project, creates with explicit policy/model and sets deterministic title without running a turn', async () => {
    const order: string[] = [];
    const api = { openProject: vi.fn(async () => { order.push('project'); }), createSession: vi.fn(async () => { order.push('session'); return { session }; }), updateSessionTopic: vi.fn(async () => { order.push('title'); return { session }; }), runTurn: vi.fn() } as unknown as ApiClient;
    expect(await createTaskSession(api, { workspaceRoot: ' E:/Projects/Vessel ', permission: 'read-only', provider: 'real', model: 'model-a' }, '  Fix\n  navigation  ')).toEqual(session);
    expect(order).toEqual(['project', 'session', 'title']);
    expect(api.createSession).toHaveBeenCalledWith({ workspaceRoot: 'E:/Projects/Vessel', permission: 'read-only', provider: 'real', model: 'model-a' });
    expect(api.updateSessionTopic).toHaveBeenCalledWith(session.id, { title: 'Fix navigation' });
    expect(api.runTurn).not.toHaveBeenCalled();
  });
  it('blocks empty input before mutations and never retries failed creation', async () => {
    const api = { openProject: vi.fn(), createSession: vi.fn().mockRejectedValue(new Error('denied')), updateSessionTopic: vi.fn() } as unknown as ApiClient;
    await expect(createTaskSession(api, { workspaceRoot: ' ' }, 'task')).rejects.toThrow('required');
    await expect(createTaskSession(api, { workspaceRoot: 'E:/repo' }, ' ')).rejects.toThrow('required');
    expect(api.openProject).not.toHaveBeenCalled();
    await expect(createTaskSession(api, { workspaceRoot: 'E:/repo' }, 'task')).rejects.toThrow('denied');
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(api.updateSessionTopic).not.toHaveBeenCalled();
  });
  it('keeps a created session usable if optional title persistence fails', async () => {
    const api = { openProject: vi.fn(), createSession: vi.fn().mockResolvedValue({ session }), updateSessionTopic: vi.fn().mockRejectedValue(new Error('metadata offline')) } as unknown as ApiClient;
    await expect(createTaskSession(api, { workspaceRoot: 'E:/repo' }, 'task')).resolves.toEqual(session);
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });
  it('holds navigation busy for the entire pending creation and releases it on failure', async () => {
    let rejectCreation!: (reason: Error) => void;
    const busy = vi.fn();
    const api = { openProject: vi.fn(), createSession: vi.fn(() => new Promise((_resolve, reject) => { rejectCreation = reject; })), updateSessionTopic: vi.fn() } as unknown as ApiClient;
    const creation = createTaskSession(api, { workspaceRoot: 'E:/repo' }, 'task', busy);
    await Promise.resolve();
    expect(busy.mock.calls).toEqual([[true]]);
    rejectCreation(new Error('denied'));
    await expect(creation).rejects.toThrow('denied');
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });
  it('renders a persistent composer with project/task/model/permission and optional advanced entry', () => {
    const html = renderToStaticMarkup(<LanguageProvider><TaskComposer api={{} as ApiClient} projects={[{ root: 'E:/Projects/Vessel' }]} selectedRoot="E:/Projects/Vessel" onSelectProject={() => {}} providerRevision={0} disabled={false} onConfigureModels={() => {}} onAdvanced={() => {}} onStarted={() => {}} /></LanguageProvider>);
    expect(html).toContain('class="task-composer"');
    expect(html).toContain('id="taskProject"'); expect(html).toContain('id="taskInput"');
    expect(html).toMatch(/<textarea[^>]*autoFocus=""/i);
    expect(html).toContain('model-pill'); expect(html).toContain('value="read-only"');
    expect(html).toContain('data-action="advanced-session"'); expect(html).not.toContain('role="dialog"');
  });
  it('uses readable labels while retaining technical identity outside display titles', () => {
    expect(projectName('E:\\Projects\\Vessel')).toBe('Vessel');
    expect(readableSessionTitle(session, 'New session')).toBe('New session');
    expect(readableSessionTitle({ ...session, topic: { title: 'sess_leak' } as SessionMeta['topic'] }, 'New session')).toBe('New session');
    expect(readableSessionTitle({ ...session, topic: { title: 'Fix policy' } as SessionMeta['topic'] }, 'New session')).toBe('Fix policy');
  });
});
describe('semantic palette keyboard ordering', () => {
  const commands: CommandItem[] = [
    { id: 's', title: 'Fix navigation', category: 'session', keywords: ['sess_123'], execute() {} },
    { id: 'p', title: 'Vessel', category: 'project', execute() {} },
    { id: 'a', title: 'Settings', category: 'action', execute() {} },
  ];
  it('orders system/project/session and excludes collapsed options from keyboard targets', () => {
    expect(groupedCommands(commands, '', []).map(item => item.id)).toEqual(['a', 'p', 's']);
    expect(groupedCommands(commands, '', ['session']).map(item => item.id)).toEqual(['a', 'p']);
    expect(groupedCommands(commands, 'sess123', ['session']).map(item => item.id)).toEqual(['s']);
  });
});
