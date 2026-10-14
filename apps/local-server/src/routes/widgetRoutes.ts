import { isWidgetBlock, type PermissionActionWidget, type WidgetBlock, type WidgetActionResponse, type WidgetEventKind } from '@vessel/shared';

type Send = (kind: WidgetEventKind, value: WidgetBlock | WidgetActionResponse) => void;
interface PendingAction { timer: ReturnType<typeof setTimeout>; settle: (response: WidgetActionResponse | undefined) => void }

/** Presentation-layer publication and decision seam; never executes the selected option. */
export class WidgetRoutes {
  private readonly blocks = new Map<string, Map<string, WidgetBlock>>();
  private readonly senders = new Map<string, Set<Send>>();
  private readonly pending = new Map<string, Map<string, PendingAction>>();
  constructor(private readonly sessionExists: (id: string) => boolean, private readonly onPublish?: (id: string, widget: WidgetBlock) => void) {}

  publish(sessionId: string, widget: WidgetBlock): void {
    if (!this.sessionExists(sessionId)) throw new Error('session_not_found');
    if (!isWidgetBlock(widget)) throw new TypeError('invalid_widget');
    let blocks = this.blocks.get(sessionId);
    if (!blocks) { blocks = new Map(); this.blocks.set(sessionId, blocks); }
    if (blocks.has(widget.id)) throw new Error('duplicate_widget');
    const copy = structuredClone(widget);
    blocks.set(copy.id, copy);
    this.onPublish?.(sessionId, copy);
    // Non-waiting producer publications still have a bounded decision lifetime.
    if (copy.kind === 'permission_action' && copy.status === 'pending' && !this.pending.get(sessionId)?.has(copy.id)) {
      let actions = this.pending.get(sessionId);
      if (!actions) { actions = new Map(); this.pending.set(sessionId, actions); }
      const timer = setTimeout(() => this.expire(sessionId, copy.id), 60_000);
      timer.unref();
      actions.set(copy.id, { timer, settle: () => {} });
    }
    this.emit(sessionId, 'widget_block', copy);
    if (copy.kind === 'permission_action' && copy.status === 'pending') this.emit(sessionId, 'action_request', copy);
  }

  request(sessionId: string, widget: PermissionActionWidget, timeoutMs = 60_000): Promise<WidgetActionResponse | undefined> {
    if (widget.status !== 'pending' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new TypeError('invalid_action_request');
    // Register before publishing: subscribers may synchronously answer the request.
    if (!this.sessionExists(sessionId) || !isWidgetBlock(widget)) throw new TypeError('invalid_action_request');
    const widgetId = widget.id;
    if (this.blocks.get(sessionId)?.has(widgetId)) throw new Error('duplicate_widget');
    let pending = this.pending.get(sessionId);
    if (!pending) { pending = new Map(); this.pending.set(sessionId, pending); }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.expire(sessionId, widgetId), timeoutMs);
      timer.unref();
      pending.set(widgetId, { timer, settle: resolve });
      try { this.publish(sessionId, widget); }
      catch (error) {
        clearTimeout(timer);
        pending.delete(widgetId);
        if (!pending.size) this.pending.delete(sessionId);
        const block = this.blocks.get(sessionId)?.get(widgetId);
        if (block) block.status = 'expired';
        reject(error);
      }
    });
  }

  respond(sessionId: string, widgetId: string, body: unknown): { status: number; body: { success: boolean; error?: string } } {
    const widget = this.blocks.get(sessionId)?.get(widgetId);
    if (!widget || widget.status === 'expired') return { status: 404, body: { success: false, error: 'widget_not_found' } };
    if (widget.kind !== 'permission_action' || widget.status !== 'pending') return { status: 400, body: { success: false, error: 'widget_not_pending' } };
    const selected = body && typeof body === 'object' ? (body as { selectedOptionId?: unknown }).selectedOptionId : undefined;
    if (typeof selected !== 'string' || !widget.payload.options.some(option => option.id === selected)) return { status: 400, body: { success: false, error: 'invalid_option' } };
    const response = { widgetId, selectedOptionId: selected, resolvedAt: new Date().toISOString() };
    widget.status = 'resolved';
    widget.resolution = { selectedOptionId: selected, resolvedAt: response.resolvedAt };
    this.settle(sessionId, widgetId, response);
    this.emit(sessionId, 'widget_block', widget);
    this.emit(sessionId, 'action_response', response);
    return { status: 200, body: { success: true } };
  }

  /** Pending permission decisions — read side for the Activity approval queue (UI-013). */
  pendingApprovals(sessionId?: string): { sessionId: string; widgetId: string; actionType: PermissionActionWidget['payload']['actionType']; description: string; requestedAt: string; options: PermissionActionWidget['payload']['options'] }[] {
    const result: { sessionId: string; widgetId: string; actionType: PermissionActionWidget['payload']['actionType']; description: string; requestedAt: string; options: PermissionActionWidget['payload']['options'] }[] = [];
    for (const [id, blocks] of this.blocks) {
      if (sessionId !== undefined && id !== sessionId) continue;
      for (const widget of blocks.values()) {
        if (widget.kind !== 'permission_action' || widget.status !== 'pending') continue;
        result.push({ sessionId: id, widgetId: widget.id, actionType: widget.payload.actionType, description: widget.payload.description, requestedAt: widget.timestamp, options: widget.payload.options.map(option => ({ ...option })) });
      }
    }
    return result.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.widgetId.localeCompare(b.widgetId));
  }

  subscribe(sessionId: string, send: Send): () => void {    let senders = this.senders.get(sessionId);
    if (!senders) { senders = new Set(); this.senders.set(sessionId, senders); }
    senders.add(send);
    for (const widget of this.blocks.get(sessionId)?.values() ?? []) {
      if (!this.send(sessionId, send, 'widget_block', widget)) break;
      if (widget.kind === 'permission_action' && widget.status === 'pending' && !this.send(sessionId, send, 'action_request', widget)) break;
    }
    return () => {
      senders.delete(send);
      if (!senders.size && this.senders.get(sessionId) === senders) this.senders.delete(sessionId);
    };
  }

  close(): void {
    for (const [sessionId, actions] of this.pending) for (const widgetId of actions.keys()) this.expire(sessionId, widgetId);
    this.senders.clear();
    this.blocks.clear();
  }
  patchDecision(sessionId: string, widgetId: string, hunkId: string, status: 'accepted' | 'rejected'): void {
    const widget = this.blocks.get(sessionId)?.get(widgetId);
    if (widget?.kind !== 'diff_inspector') return;
    widget.payload.hunkStatuses = { ...widget.payload.hunkStatuses, [hunkId]: status };
    this.emit(sessionId, 'widget_block', widget);
  }
  private emit(sessionId: string, kind: WidgetEventKind, value: WidgetBlock | WidgetActionResponse): void {
    for (const send of this.senders.get(sessionId) ?? []) this.send(sessionId, send, kind, value);
  }
  private send(sessionId: string, send: Send, kind: WidgetEventKind, value: WidgetBlock | WidgetActionResponse): boolean {
    try { send(kind, structuredClone(value)); return true; }
    catch {
      // A disconnected observer cannot interrupt decision settlement or other observers.
      const senders = this.senders.get(sessionId);
      senders?.delete(send);
      if (!senders?.size) this.senders.delete(sessionId);
      return false;
    }
  }
  private settle(sessionId: string, widgetId: string, response?: WidgetActionResponse): void {
    const actions = this.pending.get(sessionId);
    const pending = actions?.get(widgetId);
    if (!pending) return;
    clearTimeout(pending.timer);
    actions!.delete(widgetId);
    if (!actions!.size) this.pending.delete(sessionId);
    pending.settle(response);
  }
  private expire(sessionId: string, widgetId: string): void {
    const widget = this.blocks.get(sessionId)?.get(widgetId);
    if (widget?.status === 'pending') widget.status = 'expired';
    this.settle(sessionId, widgetId);
    if (widget?.status === 'expired') this.emit(sessionId, 'widget_block', widget);
  }
}
