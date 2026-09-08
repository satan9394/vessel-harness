/**
 * runtime/sidecar — message framing (task 070).
 *
 * Framing decision (see docs/SIDECAR-PROTOCOL.md §4 for the full rationale):
 *   NEWLINE-DELIMITED JSON  (one JSON message per physical line).
 *
 * JSON.stringify never emits a raw 0x0A inside a string value — it escapes
 * `\n` as `\\n` — so a JSON-RPC message serializes to a single physical line
 * with no embedded newline. Splitting on `\n` therefore yields exactly one
 * message per frame with no ambiguity. This is the simplest robust framing
 * (the same scheme Node's own child-process stdio capture and many LSP-adjacent
 * single-line protocols use), keeps the wire human-readable and debuggable with
 * `tail`/`type`, and needs no length arithmetic or max-packet state machine.
 *
 * Rejected alternatives (documented in the spec):
 *   - Raw JSON blob per write: cannot delimit consecutive messages on a pipe
 *     (no message boundary survives concatenation).
 *   - Length-prefixed framing (4-byte LE length + payload, LSP/JSON-RPC 1.x
 *     style): unambiguous but adds a binary envelope, complicates debug/echo of
 *     a live session, and buys nothing here — every message already fits in one
 *     line and protocol messages are bounded in practice. Retained as a v2
 *     option if a message schema ever grows unbound binary fields.
 */

/** Maximum line length we accept before declaring the stream corrupt. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/**
 * SidecarFramer buffers inbound raw string chunks and emits one callback per
 * complete newline-delimited frame. Tolerates the trailing-newline qualifier:
 * frame lines are trimmed of their terminating `\r?\n` only.
 */
export class SidecarFramer {
  private buffer = '';
  private readonly maxBytes: number;
  private lastFrame: string | undefined;

  constructor(maxBytes: number = MAX_FRAME_BYTES) {
    this.maxBytes = maxBytes;
  }

  /**
   * Push a raw chunk of the stream. Calls `onFrame` once per completed line.
   * Throws if a single frame exceeds maxBytes (stream is corrupt).
   */
  push(chunk: string, onFrame: (frame: string) => void): void {
    this.buffer += chunk;
    if (this.buffer.length > this.maxBytes) {
      throw new Error(
        `sidecar frame exceeds maxBytes(${this.maxBytes}); stream is corrupt`,
      );
    }
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const nl = this.buffer.indexOf('\n');
      if (nl === -1) break;
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const frame = line.endsWith('\r') ? line.slice(0, -1) : line;
      if (frame.length === 0) continue; // blank line — skip, not a message
      this.lastFrame = frame;
      onFrame(frame);
    }
  }

  /** Remaining un-terminated buffer (exposed for diagnostics/tests). */
  peekBuffer(): string {
    return this.buffer;
  }

  /** Most recently emitted raw frame (no trailing newline). */
  last(): string | undefined {
    return this.lastFrame;
  }
}

/**
 * Serialize a JSON-RPC message to a single stdio frame (one physical line,
 * newline-terminated). This is the exact bytes the host writes to the sidecar.
 */
export function encodeFrame(message: unknown): string {
  return JSON.stringify(message) + '\n';
}

/**
 * Deserialize one frame back into a JSON-RPC message.
 * Throws a structured error on parse failure so the caller can map it to
 * JSON-RPC error -32700 (Parse error).
 */
export function decodeFrame(frame: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame);
  } catch (err) {
    throw new Error(
      `invalid JSON frame: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  return parsed;
}