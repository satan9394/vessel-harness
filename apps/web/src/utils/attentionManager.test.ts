import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionActionWidget } from '@vessel/shared';
import { createEventStream } from '../sse';
import { ATTENTION_MUTE_KEY, AttentionManager, LONG_TASK_MS } from './attentionManager';
import { AudioSynthesizer } from './audioSynthesizer';

let documentMock: EventTarget & { title: string; hidden: boolean; hasFocus: () => boolean };
let windowMock: EventTarget & { focus: ReturnType<typeof vi.fn> };
let focused: boolean;
let storage: Map<string, string>;
class Notice {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => Notice.permission = 'granted' as const);
  static instances: Notice[] = [];
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public options: NotificationOptions) { Notice.instances.push(this); }
}
const event = { kind: 'decision_needed' as const, title: 'Decision', body: 'Review this write' };
const widget: PermissionActionWidget = { id: 'permission-1', kind: 'permission_action', status: 'pending', turnIndex: 0, timestamp: '2026-10-10T00:00:00Z', payload: { actionType: 'filesystem_write', description: 'Review write', options: [{ id: 'allow', label: 'Allow', tone: 'primary' }] } };
beforeEach(() => {
  focused = true;
  documentMock = Object.assign(new EventTarget(), { title: 'Vessel workspace', hidden: false, hasFocus: () => focused });
  windowMock = Object.assign(new EventTarget(), { focus: vi.fn() });
  storage = new Map();
  vi.stubGlobal('document', documentMock); vi.stubGlobal('window', windowMock);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  Notice.instances = []; Notice.permission = 'default'; Notice.requestPermission.mockClear();
  vi.stubGlobal('Notification', Notice);
});
afterEach(() => vi.unstubAllGlobals());
function manager() {
  const audio = new AudioSynthesizer();
  const play = vi.spyOn(audio, 'play').mockResolvedValue();
  const dispose = vi.spyOn(audio, 'dispose');
  const attention = new AttentionManager(audio);
  return { attention, play, dispose };
}
describe('attention permission, focus and resource lifetime', () => {
  it.each(['default', 'denied'] as const)('never requests %s permission on a task or mount', permission => {
    Notice.permission = permission; documentMock.hidden = true;
    const { attention } = manager(); attention.attach(); attention.trigger(event);
    expect(Notice.requestPermission).not.toHaveBeenCalled(); expect(Notice.instances).toHaveLength(0);
    expect(documentMock.title).toBe('(Decision needed) Vessel workspace'); attention.dispose();
  });
  it('requests permission only through the explicit action and handles unsupported API', async () => {
    const { attention } = manager(); expect(await attention.requestPermission()).toBe('granted');
    expect(Notice.requestPermission).toHaveBeenCalledOnce();
    Notice.permission = 'denied'; expect(await attention.requestPermission()).toBe('denied');
    expect(Notice.requestPermission).toHaveBeenCalledOnce();
    vi.stubGlobal('Notification', undefined); expect(attention.permission()).toBe('unsupported');
    expect(await attention.requestPermission()).toBe('unsupported'); attention.trigger(event); attention.dispose();
  });
  it.each([[false, true, 0], [true, true, 1], [false, false, 1]])('hidden=%s focused=%s sends %s notices', (hidden, focus, count) => {
    Notice.permission = 'granted'; documentMock.hidden = hidden as boolean; focused = focus as boolean;
    const { attention } = manager(); attention.attach(); attention.trigger(event);
    expect(Notice.instances).toHaveLength(count as number);
    if (Notice.instances[0]) {
      Notice.instances[0].onclick!(); expect(windowMock.focus).toHaveBeenCalledOnce();
      expect(Notice.instances[0].close).toHaveBeenCalledOnce();
      expect(documentMock.title).toBe('Vessel workspace');
    }
    attention.dispose();
  });
  it('restores title exactly, clears visible focus, and removes both listeners on disposal', () => {
    const removeWindow = vi.spyOn(windowMock, 'removeEventListener');
    const removeDocument = vi.spyOn(documentMock, 'removeEventListener');
    const { attention, dispose } = manager(); attention.attach(); attention.attach();
    focused = false; attention.trigger(event); attention.trigger({ ...event, kind: 'breaker_tripped' });
    expect(documentMock.title).toBe('(Interrupted) Vessel workspace');
    windowMock.dispatchEvent(new Event('focus')); expect(documentMock.title).toContain('(Interrupted)');
    focused = true; documentMock.dispatchEvent(new Event('visibilitychange')); expect(documentMock.title).toBe('Vessel workspace');
    attention.trigger(event); attention.dispose(); expect(documentMock.title).toBe('Vessel workspace');
    expect(removeWindow).toHaveBeenCalledOnce(); expect(removeDocument).toHaveBeenCalledOnce(); expect(dispose).toHaveBeenCalledOnce();
  });
  it('persists global mute while keeping visual/desktop alerts available', () => {
    Notice.permission = 'granted'; documentMock.hidden = true;
    const { attention, play, dispose } = manager(); attention.setOptions({ soundEnabled: false }); attention.trigger(event);
    expect(play).not.toHaveBeenCalled(); expect(dispose).toHaveBeenCalledOnce();
    expect(storage.get(ATTENTION_MUTE_KEY)).toBe('true'); expect(new AttentionManager().getOptions().soundEnabled).toBe(false);
    expect(Notice.instances).toHaveLength(1);
    attention.setOptions({ soundEnabled: true, notificationEnabled: false }); attention.trigger(event);
    expect(play).toHaveBeenCalledWith('warning'); expect(Notice.instances).toHaveLength(1);
    expect(new AttentionManager().getOptions().soundEnabled).toBe(true); attention.dispose();
  });
  it('continues with title fallback when storage or notification construction fails', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    vi.stubGlobal('Notification', class { static permission = 'granted'; constructor() { throw new Error('unsupported device'); } });
    documentMock.hidden = true;
    const { attention } = manager(); expect(() => { attention.setOptions({ soundEnabled: false }); attention.trigger(event); }).not.toThrow();
    expect(documentMock.title).toContain('Decision needed'); attention.dispose();
  });
});
describe('actual task and widget seam classification', () => {
  it('alerts on measured long success, interruption/error/budget but never unknown result kinds', () => {
    const { attention, play } = manager();
    attention.completed('success', LONG_TASK_MS - 1); attention.completed('unknown', 99999); expect(play).not.toHaveBeenCalled();
    attention.completed('success', LONG_TASK_MS); expect(play).toHaveBeenLastCalledWith('success');
    for (const kind of ['interrupted', 'error', 'budget']) { attention.completed(kind, 1); expect(play).toHaveBeenLastCalledWith('warning'); }
    expect(play).toHaveBeenCalledTimes(4); attention.dispose();
  });
  it('deduplicates replay through actual SSE dispatch, including resolved-before-pending replay and session reselection', () => {
    let source!: { onmessage: ((event: MessageEvent) => void) | null };
    vi.stubGlobal('EventSource', class { onmessage = null; onopen = null; close() {} constructor() { source = this; } });
    const { attention, play } = manager();
    const stream = createEventStream('/events', { onWidget: value => attention.widget('s1', value), onWidgetResponse: value => attention.resolvedWidget('s1', value.widgetId) });
    const emit = (type: string, delta: unknown) => source.onmessage!(new MessageEvent('message', { data: JSON.stringify({ type, delta }) }));
    emit('widget', widget); emit('widget', widget); attention.clear(); emit('widget', widget);
    expect(play).toHaveBeenCalledOnce();
    emit('action_response', { widgetId: 'already-resolved', selectedOptionId: 'allow', resolvedAt: widget.timestamp });
    emit('widget', { ...widget, id: 'already-resolved' });
    emit('policy', { reason: 'denied' }); emit('tool', { status: 'denied' });
    expect(play).toHaveBeenCalledOnce();
    emit('widget', { ...widget, id: 'resolved', status: 'resolved' }); expect(play).toHaveBeenCalledOnce();
    attention.widget('s2', widget); expect(play).toHaveBeenCalledTimes(2);
    stream.close(); emit('widget', { ...widget, id: 'late' }); expect(play).toHaveBeenCalledTimes(2); attention.dispose();
  });
});
