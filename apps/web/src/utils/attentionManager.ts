import { AudioSynthesizer } from './audioSynthesizer';
import type { WidgetBlock } from '@vessel/shared';

export type AttentionEventKind = 'decision_needed' | 'task_completed' | 'breaker_tripped';
export interface AttentionOptions { soundEnabled: boolean; notificationEnabled: boolean }
export interface AttentionEvent { kind: AttentionEventKind; title: string; body: string }
export const ATTENTION_MUTE_KEY = 'vessel.attention.muted';
/** Completion cues only for locally measured turns lasting at least five seconds. */
export const LONG_TASK_MS = 5000;

export class AttentionManager {
  private options: AttentionOptions = { soundEnabled: true, notificationEnabled: true };
  private originalTitle?: string;
  private notifications = new Set<Notification>();
  private seen = new Set<string>();
  private attached = false;
  constructor(private audio = new AudioSynthesizer()) {
    try { this.options.soundEnabled = localStorage.getItem(ATTENTION_MUTE_KEY) !== 'true'; } catch { /* storage unavailable */ }
  }
  getOptions(): AttentionOptions { return { ...this.options }; }
  unlockAudio(): void { if (this.options.soundEnabled) void this.audio.unlock(); }
  setOptions(options: Partial<AttentionOptions>): void {
    this.options = { ...this.options, ...options };
    if (options.soundEnabled !== undefined) {
      if (!options.soundEnabled) this.audio.dispose();
      try { localStorage.setItem(ATTENTION_MUTE_KEY, String(!options.soundEnabled)); } catch { /* private storage */ }
    }
  }
  permission(): NotificationPermission | 'unsupported' {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  }
  /** Called only by the explicit notification button, never by trigger or attach. */
  async requestPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (this.permission() !== 'default') return this.permission();
    try { return await Notification.requestPermission(); } catch { return this.permission(); }
  }
  attach(): void {
    if (this.attached || typeof window === 'undefined') return;
    this.attached = true;
    window.addEventListener('focus', this.onFocus);
    document.addEventListener('visibilitychange', this.onFocus);
  }
  private onFocus = () => {
    if (!document.hidden && document.hasFocus()) this.clear();
  };
  clear(): void {
    if (this.originalTitle !== undefined) document.title = this.originalTitle;
    this.originalTitle = undefined;
    for (const notification of this.notifications) { notification.onclick = null; notification.onclose = null; notification.close(); }
    this.notifications.clear();
  }
  trigger(event: AttentionEvent): void {
    if (typeof document === 'undefined') return;
    this.originalTitle ??= document.title;
    const label = { decision_needed: 'Decision needed', task_completed: 'Completed', breaker_tripped: 'Interrupted' }[event.kind];
    document.title = `(${label}) ${this.originalTitle}`;
    if (this.options.soundEnabled) void this.audio.play(event.kind === 'task_completed' ? 'success' : 'warning');
    if (this.options.notificationEnabled && (document.hidden || !document.hasFocus()) && this.permission() === 'granted') {
      try {
        const notification = new Notification(event.title, { body: event.body, tag: `vessel-${event.kind}` });
        this.notifications.add(notification);
        notification.onclick = () => { window.focus(); this.clear(); };
        notification.onclose = () => { this.notifications.delete(notification); };
      } catch { /* some browsers expose the API but cannot create desktop notifications */ }
    }
  }
  /** Replay and session reselection share the same id ledger; denies are not approvals. */
  widget(sessionId: string, widget: WidgetBlock): void {
    const key = `${sessionId}:${widget.id}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (widget.kind === 'permission_action' && widget.status === 'pending') {
      this.trigger({ kind: 'decision_needed', title: 'Vessel: decision needed', body: widget.payload.description });
    }
  }
  resolvedWidget(sessionId: string, widgetId: string): void { this.seen.add(`${sessionId}:${widgetId}`); }
  completed(kind: string, durationMs: number): void {
    if (kind === 'success' && durationMs >= LONG_TASK_MS) this.trigger({ kind: 'task_completed', title: 'Vessel: task completed', body: 'The current task completed successfully.' });
    else if (['interrupted', 'error', 'budget'].includes(kind)) this.trigger({ kind: 'breaker_tripped', title: 'Vessel: task interrupted', body: kind === 'budget' ? 'The task stopped at its budget limit.' : 'The task stopped and needs attention.' });
  }
  dispose(): void {
    if (this.attached) { window.removeEventListener('focus', this.onFocus); document.removeEventListener('visibilitychange', this.onFocus); }
    this.attached = false;
    this.clear(); this.audio.dispose();
  }
}
