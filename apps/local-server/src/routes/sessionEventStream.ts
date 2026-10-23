import { randomUUID } from 'node:crypto';
import type { SessionStreamFrame } from '@vessel/shared';

type Send = (text: string) => void;
const NAMED_EVENTS = new Set(['widget', 'widget_block', 'action_request', 'action_response', 'inspector']);

/** One producer per session, retained across disconnected observers, bounded in memory. */
export class SessionEventStream {
  readonly streamId = randomUUID();
  private cursor = 0;
  private bytes = 0;
  private readonly frames: Array<{ cursor: number; text: string; bytes: number }> = [];
  private readonly senders = new Set<Send>();
  private turnId?: string;
  constructor(private readonly sessionId: string, private readonly snapshot: (hydrate: boolean) => unknown,
    private readonly maxFrames = 512, private readonly maxBytes = 2 * 1024 * 1024) {}

  setTurn(turnId: string | undefined): void { this.turnId = turnId; }

  publish(type: string, delta: unknown): void {
    const frame: SessionStreamFrame = { version: 1, sessionId: this.sessionId, streamId: this.streamId,
      cursor: ++this.cursor, eventId: `${this.streamId}:${this.cursor}`, turnId: this.turnId, type, delta, ts: Date.now() };
    const text = this.encode(frame);
    const bytes = Buffer.byteLength(text);
    this.frames.push({ cursor: frame.cursor, text, bytes }); this.bytes += bytes;
    while (this.frames.length > this.maxFrames || this.bytes > this.maxBytes) this.bytes -= this.frames.shift()!.bytes;
    for (const send of this.senders) this.send(send, text);
  }

  subscribe(send: Send, lastEventId?: string, hydrate = true): () => void {
    const prefix = `${this.streamId}:`;
    const tail = lastEventId?.startsWith(prefix) ? lastEventId.slice(prefix.length) : '';
    const cursor = /^\d+$/.test(tail) ? Number(tail) : -1;
    if (Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= this.cursor && cursor >= (this.frames[0]?.cursor ?? this.cursor + 1) - 1) {
      for (const frame of this.frames) if (frame.cursor > cursor) send(frame.text);
    }
    // Synchronous snapshot + registration: no event can fall in between.
    // Also corrects stale browser caches and supplies state after an expired epoch/window.
    send(this.encode({ version: 1, sessionId: this.sessionId, streamId: this.streamId, cursor: this.cursor,
      eventId: `${this.streamId}:checkpoint:${this.cursor}`, turnId: this.turnId, type: hydrate ? 'transcript' : 'checkpoint', delta: this.snapshot(hydrate), ts: Date.now() }));
    this.senders.add(send);
    return () => { this.senders.delete(send); };
  }

  heartbeat(): string {
    // A watermark detects a lost final frame, but must not acknowledge missing events.
    return `data: ${JSON.stringify({ version: 1, sessionId: this.sessionId, streamId: this.streamId, cursor: this.cursor, type: 'ping', ts: Date.now() })}\n\n`;
  }

  /** Older named-event readers do not consume checkpoints. Same-cursor aliases are idempotent. */
  bootstrap(type: string, delta: unknown): string {
    return this.encode({ version: 1, sessionId: this.sessionId, streamId: this.streamId, cursor: this.cursor,
      eventId: `${this.streamId}:bootstrap:${type}:${this.cursor}`, turnId: this.turnId, type, delta, ts: Date.now() });
  }

  close(): void { this.senders.clear(); this.frames.splice(0); this.bytes = 0; }

  private send(send: Send, text: string): void {
    try { send(text); } catch { this.senders.delete(send); }
  }
  private encode(frame: SessionStreamFrame): string {
    const id = `${frame.streamId}:${frame.cursor}`;
    const named = NAMED_EVENTS.has(frame.type) ? `event: ${frame.type}\n` : '';
    let text = `id: ${id}\n${named}data: ${JSON.stringify(frame)}\n\n`;
    // Preserve the older widget event alias; both deliveries share one identity.
    if (frame.type === 'widget_block') text += `id: ${id}\nevent: widget\ndata: ${JSON.stringify({ ...frame, type: 'widget' })}\n\n`;
    return text;
  }
}
