/** Session-scoped SSE envelope. A new runtime stream uses a new epoch. */
export interface SessionStreamFrame {
  version: 1;
  sessionId: string;
  streamId: string;
  cursor: number;
  eventId: string;
  turnId?: string;
  type: string;
  delta: unknown;
  ts: number;
}

/** Observed runtime facts; absence of a terminal kind is not evidence of success. */
export interface SessionStreamRun {
  active: boolean;
  turnId?: string;
  kind?: string;
  finishReason?: string;
}
