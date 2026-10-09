export interface ModExecutionContext {
  sessionId: string;
  turnIndex: number;
  toolName?: string;
  metadata: Record<string, unknown>;
}

export interface ModInterceptResult {
  handled: boolean;
  result?: unknown;
  reason?: string;
}

/** These callbacks are host seams: unsigned implementations must use a sandbox proxy. */
export interface ModMiddleware {
  readonly name: string;
  readonly version: string;
  readonly priority: number;
  observe?(event: { type: string; payload: unknown; context: ModExecutionContext }): Promise<void>;
  rewriteToolInput?(input: Record<string, unknown>, context: ModExecutionContext): Promise<Record<string, unknown>>;
  rewritePromptFragment?(fragment: string, context: ModExecutionContext): Promise<string>;
  interceptToolCall?(input: Record<string, unknown>, context: ModExecutionContext): Promise<ModInterceptResult>;
}
