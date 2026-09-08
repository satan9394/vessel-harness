/**
 * @vessel/shared — tool contracts (D3 decision point 7: minimal builtin set + schema DSL).
 */

export type ToolFamily = 'file_read' | 'file_write' | 'search' | 'exec' | 'other';

export type RequiredPermission = 'read' | 'workspace-write' | 'danger-full-access';

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  family: ToolFamily;
  requiredPermission: RequiredPermission;
  /** Exclusive tools run serially (write barrier); others may run in parallel pool. */
  exclusive: boolean;
  inputSchema: ToolInputSchema;
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export interface ToolExecutionContext {
  workspaceRoot: string;
  cwd: string;
  /** injected by runtime/executor — policy re-check happens here; tools never trust the caller */
  guard?: (call: { toolName: string; arguments: Record<string, unknown> }) => Promise<ToolGuardDecision>;
  sandbox?: SandboxSeam;
  events?: unknown;
}

export interface ToolGuardDecision {
  action: 'allow' | 'deny' | 'ask';
  reason?: string;
  ruleRef?: string;
  stage?: string;
}

export interface SandboxSeam {
  confine(argv: string[], policyHint?: Record<string, unknown>): Promise<ConfinedArgv>;
  status(): SandboxStatus;
}

export interface ConfinedArgv {
  argv: string[];
  enforcement: 'full' | 'partial' | 'none';
  reason?: string;
}

export interface SandboxStatus {
  enabled: boolean;
  supported: 'linux-bwrap' | 'macos-seatbelt' | 'windows-acl-partial' | 'none';
  active: boolean;
  fallbackReason?: string;
}

export interface ToolExecutionResult {
  content: string;
  error?: import('./events.js').ToolErrorPayload;
  meta: Record<string, unknown>;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}
