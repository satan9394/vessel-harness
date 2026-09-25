import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { VERSION } from '@vessel/shared';

export type VesselTaskPolicyProfile = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface RunVesselTaskArgs {
  task: string;
  workspaceRoot?: string;
  policyProfile?: VesselTaskPolicyProfile;
  maxSteps?: number;
  includeDiff?: boolean;
  /** Optional caller-selected ID permits status/cancel calls while the run request is pending. */
  sessionId?: string;
}

export interface VesselTaskResultContract {
  success: boolean;
  finalText: string;
  steps: number;
  changedFiles: string[];
  diffSummary?: string;
  totalTokens: number;
  sessionId: string;
}

export interface VesselTaskProgress {
  step?: number;
  summary?: string;
}

export interface VesselTaskExecutor {
  execute(
    args: RunVesselTaskArgs & { sessionId: string; policyProfile: VesselTaskPolicyProfile; maxSteps: number },
    signal: AbortSignal,
    progress: (update: VesselTaskProgress) => void,
  ): Promise<VesselTaskResultContract>;
}

export interface VesselMcpTaskStatus {
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  step: number;
  progressSummary: string;
  result?: VesselTaskResultContract;
}

export const VESSEL_MCP_TOOLS = [
  {
    name: 'run_vessel_task',
    description: 'Run a bounded Vessel task and return its compact result contract.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', minLength: 1 },
        workspaceRoot: { type: 'string' },
        policyProfile: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'] },
        maxSteps: { type: 'integer', minimum: 1, maximum: 20 },
        includeDiff: { type: 'boolean' },
        sessionId: { type: 'string', description: 'Optional caller-selected ID for concurrent status/cancel requests.' },
      },
      required: ['task'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_vessel_task_status',
    description: 'Query the bounded status and compact result of a Vessel task.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', minLength: 1 } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_vessel_task',
    description: 'Request cancellation of a running Vessel task.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', minLength: 1 } },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
] as const;

const MAX_RESULT_TEXT = 16_384;
const MAX_DIFF_SUMMARY = 24_576;
const MAX_CHANGED_FILES = 100;
const MAX_PROGRESS_SUMMARY = 512;
const MAX_TRACKED_TASKS = 512;
const MAX_RPC_LINE_CHARS = 1_048_576;

interface TaskEntry {
  controller: AbortController;
  status: VesselMcpTaskStatus;
}

export interface VesselMcpServer {
  handle(method: string, params?: unknown): Promise<unknown>;
  connect(input: Readable, output: Writable, diagnostics?: Writable): () => void;
  close(): void;
  status(sessionId: string): VesselMcpTaskStatus | undefined;
}

/** MCP stdio server; task execution and composition remain in the application caller. */
export function createVesselMcpServer(executor: VesselTaskExecutor): VesselMcpServer {
  const tasks = new Map<string, TaskEntry>();
  let closed = false;

  const status = (sessionId: string): VesselMcpTaskStatus | undefined => {
    const current = tasks.get(sessionId)?.status;
    return current ? { ...current, ...(current.result ? { result: { ...current.result, changedFiles: [...current.result.changedFiles] } } : {}) } : undefined;
  };

  const runTask = async (input: unknown): Promise<VesselTaskResultContract> => {
    const raw = record(input);
    const task = typeof raw.task === 'string' ? raw.task.trim() : '';
    if (!task) throw new Error('task must be a non-empty string');

    const requestedId = raw.sessionId === undefined ? randomUUID() : parseSessionId(raw.sessionId);
    if (tasks.has(requestedId)) throw new Error(`sessionId is already in use: ${requestedId}`);
    const policyProfile = parsePolicy(raw.policyProfile);
    const maxSteps = parseMaxSteps(raw.maxSteps);
    if (raw.workspaceRoot !== undefined && (typeof raw.workspaceRoot !== 'string' || raw.workspaceRoot.trim() === '')) {
      throw new Error('workspaceRoot must be a non-empty path');
    }
    if (raw.includeDiff !== undefined && typeof raw.includeDiff !== 'boolean') throw new Error('includeDiff must be a boolean');

    const args: RunVesselTaskArgs & { sessionId: string; policyProfile: VesselTaskPolicyProfile; maxSteps: number } = {
      task,
      sessionId: requestedId,
      policyProfile,
      maxSteps,
      ...(typeof raw.workspaceRoot === 'string' ? { workspaceRoot: raw.workspaceRoot } : {}),
      ...(raw.includeDiff === true ? { includeDiff: true } : {}),
    };
    const entry: TaskEntry = {
      controller: new AbortController(),
      status: { sessionId: requestedId, status: 'running', step: 0, progressSummary: 'Task accepted.' },
    };
    tasks.set(requestedId, entry);
    pruneTasks(tasks);

    try {
      const result = await executor.execute(args, entry.controller.signal, (update) => {
        if (entry.status.status !== 'running') return;
        entry.status = {
          ...entry.status,
          step: Number.isInteger(update.step) && update.step! >= 0 ? update.step! : entry.status.step,
          progressSummary: boundedText(update.summary ?? entry.status.progressSummary, MAX_PROGRESS_SUMMARY),
        };
      });
      const compact = compactResult(result, requestedId);
      entry.status = {
        ...entry.status,
        status: entry.controller.signal.aborted ? 'cancelled' : 'completed',
        step: compact.steps,
        progressSummary: entry.controller.signal.aborted ? 'Task cancellation requested.' : 'Task completed.',
        result: compact,
      };
      return compact;
    } catch (error) {
      const message = boundedText(error instanceof Error ? error.message : String(error), MAX_RESULT_TEXT);
      entry.status = {
        ...entry.status,
        status: entry.controller.signal.aborted ? 'cancelled' : 'failed',
        progressSummary: entry.controller.signal.aborted ? 'Task cancelled.' : message,
      };
      throw new Error(message);
    }
  };

  const handle = async (method: string, params?: unknown): Promise<unknown> => {
    if (closed) throw new Error('MCP server is closed');
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'vessel-mcp-agent', version: VERSION },
        };
      case 'ping':
        return {};
      case 'notifications/initialized':
        return null;
      case 'tools/list':
        return { tools: VESSEL_MCP_TOOLS };
      case 'tools/call': {
        const input = record(params);
        const name = typeof input.name === 'string' ? input.name : '';
        const args = input.arguments ?? {};
        if (name === 'run_vessel_task') {
          try {
            const result = await runTask(args);
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          } catch (error) {
            return toolError(error instanceof Error ? error.message : String(error));
          }
        }
        if (name === 'query_vessel_task_status') {
          const sessionId = parseSessionId(record(args).sessionId);
          const current = status(sessionId);
          if (!current) return toolError(`unknown sessionId: ${sessionId}`);
          return { content: [{ type: 'text', text: JSON.stringify(current) }] };
        }
        if (name === 'cancel_vessel_task') {
          const sessionId = parseSessionId(record(args).sessionId);
          const entry = tasks.get(sessionId);
          const cancelled = entry?.status.status === 'running' ? (entry.controller.abort(), true) : false;
          return { content: [{ type: 'text', text: JSON.stringify({ sessionId, cancelled }) }] };
        }
        return toolError(`unknown tool: ${name}`);
      }
      default:
        throw new Error(`unknown method: ${method}`);
    }
  };

  const server: VesselMcpServer = {
    handle,
    status,
    connect(input, output, diagnostics = process.stderr) {
      const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
      let disconnected = false;
      const write = (value: unknown): void => {
        if (disconnected || output.destroyed) return;
        try {
          output.write(`${JSON.stringify(value)}\n`);
        } catch (error) {
          diagnostics.write(`[vessel mcp-agent] protocol write failed: ${error instanceof Error ? error.message : String(error)}\n`);
        }
      };
      lines.on('line', (line) => {
        if (line.length > MAX_RPC_LINE_CHARS) {
          write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'request line exceeds 1 MiB' } });
          return;
        }
        let request: Record<string, unknown>;
        try {
          request = record(JSON.parse(line));
        } catch {
          write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
          return;
        }
        const id = request.id;
        const method = typeof request.method === 'string' ? request.method : '';
        if (request.jsonrpc !== '2.0' || !method) {
          if (id !== undefined) write({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } });
          return;
        }
        // Each request runs independently so status/cancel can be serviced while a task is awaiting a model.
        void handle(method, request.params).then(
          (result) => { if (id !== undefined) write({ jsonrpc: '2.0', id, result }); },
          (error: unknown) => {
            if (id === undefined) return;
            const code = method === 'tools/call' ? -32602 : -32603;
            const message = boundedText(error instanceof Error ? error.message : String(error), 2048);
            write({ jsonrpc: '2.0', id, error: { code, message } });
          },
        );
      });
      const disconnect = (): void => {
        if (disconnected) return;
        disconnected = true;
        for (const entry of tasks.values()) if (entry.status.status === 'running') entry.controller.abort();
      };
      lines.once('close', disconnect);
      input.once('error', (error) => diagnostics.write(`[vessel mcp-agent] stdin failed: ${error.message}\n`));
      output.once('error', (error) => diagnostics.write(`[vessel mcp-agent] stdout failed: ${error.message}\n`));
      return () => {
        lines.close();
        disconnect();
      };
    },
    close() {
      closed = true;
      for (const entry of tasks.values()) if (entry.status.status === 'running') entry.controller.abort();
    },
  };
  return server;
}

function compactResult(input: VesselTaskResultContract, sessionId: string): VesselTaskResultContract {
  const changedFiles = Array.isArray(input.changedFiles)
    ? input.changedFiles.slice(0, MAX_CHANGED_FILES).map((file) => boundedText(String(file), 512))
    : [];
  const diffSummary = input.diffSummary === undefined ? undefined : boundedText(input.diffSummary, MAX_DIFF_SUMMARY);
  return {
    success: input.success === true,
    finalText: boundedText(input.finalText, MAX_RESULT_TEXT),
    steps: Number.isInteger(input.steps) && input.steps >= 0 ? input.steps : 0,
    changedFiles,
    ...(diffSummary === undefined ? {} : { diffSummary }),
    totalTokens: Number.isFinite(input.totalTokens) && input.totalTokens >= 0 ? Math.floor(input.totalTokens) : 0,
    sessionId,
  };
}

function parsePolicy(value: unknown): VesselTaskPolicyProfile {
  if (value === undefined) return 'workspace-write';
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value;
  throw new Error('policyProfile must be read-only, workspace-write, or danger-full-access');
}

function parseMaxSteps(value: unknown): number {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 20) {
    throw new Error('maxSteps must be an integer between 1 and 20');
  }
  return value as number;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new Error(`${field} must be a non-empty string no longer than ${max} characters`);
  return value;
}

function parseSessionId(value: unknown): string {
  const sessionId = boundedString(value, 'sessionId', 128);
  if (!/^[A-Za-z0-9_-]+$/u.test(sessionId)) throw new Error('sessionId may contain only letters, digits, underscore, or hyphen');
  return sessionId;
}

function boundedText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;
}

function record(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function toolError(message: string): { isError: true; content: { type: 'text'; text: string }[] } {
  return { isError: true, content: [{ type: 'text', text: boundedText(message, 2048) }] };
}

function pruneTasks(tasks: Map<string, TaskEntry>): void {
  while (tasks.size > MAX_TRACKED_TASKS) {
    const removable = [...tasks].find(([, entry]) => entry.status.status !== 'running');
    if (!removable) return;
    tasks.delete(removable[0]);
  }
}
