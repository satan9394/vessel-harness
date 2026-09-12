import type { SandboxStatus, ToolSpec } from '@vessel/shared';
import type { Sandbox } from '@vessel/runtime';

const WRAPPERS = /^(timeout|time|nice|nohup)\s+/i;

const READONLY_PREFIXES = [
  'ls',
  'dir',
  'cat',
  'type',
  'more',
  'pwd',
  'grep',
  'findstr',
  'find',
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'node --version',
  'npm --version',
  'node -v',
  'echo',
];

/**
 * Readonly classification — string parsing is ONLY for readonly *identification*
 * and deny *hints*, never the primary defense (POLICY-SPEC §2.4: 字符串解析只作只读识别).
 * Hard enforcement lives in the policy engine + sandbox.
 */
export function isReadonlyCommand(command: string): boolean {
  let c = command.trim().replace(WRAPPERS, '');
  c = c.replace(/^sudo\s+/i, '');
  const lower = c.toLowerCase();
  return READONLY_PREFIXES.some((p) => lower === p || lower.startsWith(p + ' '));
}

/**
 * task 072 escape-audit event kinds that are OPERATIONAL (an escape happened, a
 * termination succeeded, a termination failed). Everything else the process-tree
 * tracker records (`spawn` / `exit` / `attached` / `window-closed`) is routine
 * bookkeeping and is deliberately NOT forwarded — no noise in the tool result.
 */
export const ESCAPE_AUDIT_KINDS = [
  'escape-detected',
  'escape-terminated',
  'escape-terminate-failed',
] as const;

export type EscapeAuditKind = (typeof ESCAPE_AUDIT_KINDS)[number];

/**
 * Minimal structural slice of a runtime process-tree audit event — kept local so
 * @vessel/tools does not grow a hard type dependency on @vessel/runtime.
 */
export interface EscapeAuditEvent {
  kind: string;
  pid?: number;
  detail: string;
  at: number;
}

/**
 * Audit channel for escape/termination events. The product decision here is
 * "never let an escape conclusion die in runtime memory": the events go into the
 * tool result `meta` (which the AgentLoop persists on the session `tool/result`
 * record — the durable audit trail) and, when a sink is injected, are ALSO
 * pushed to the caller's audit channel.
 *
 * A plain-function injection (no `vi.fn`) so `restoreAllMocks()` cannot silently
 * disconnect the audit in tests — same convention as the runtime deps slice.
 */
export type EscapeAuditSink = (event: EscapeAuditEvent) => void;

/** Pick only the escape/termination-relevant events out of a process-tree audit. */
export function selectEscapeAuditEvents(audit: readonly EscapeAuditEvent[]): EscapeAuditEvent[] {
  const keep = new Set<string>(ESCAPE_AUDIT_KINDS);
  return (audit ?? [])
    .filter((e) => keep.has(e.kind))
    .map((e) => (e.pid === undefined ? { ...e } : { ...e, pid: e.pid }));
}

/** Stripped status payload surfaced to the caller: the facts, no prose. */
function statusMeta(status: SandboxStatus): Record<string, unknown> {
  return {
    supported: status.supported,
    active: status.active,
    backend: status.backend ?? 'none',
    ...(status.degraded === undefined ? {} : { degraded: status.degraded }),
    ...(status.fallbackReason === undefined ? {} : { reason: status.fallbackReason }),
  };
}

export function createShellTool(opts: {
  workspaceRoot: string;
  sandbox: Sandbox;
  /** optional audit channel; escape/termination events are forwarded here too. */
  audit?: EscapeAuditSink;
}): ToolSpec {
  const { sandbox } = opts;

  return {
    name: 'Shell',
    description: 'Run a shell command in the workspace (Windows: cmd.exe; POSIX: /bin/sh).',
    family: 'exec',
    requiredPermission: 'danger-full-access',
    exclusive: true,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'shell command line' },
        timeoutMs: { type: 'number', description: 'override timeout (default 30000)' },
        terminateEscaped: {
          type: 'boolean',
          description: 'task 072 hard response: terminate descendants detected outside the confined set (default false = audit only)',
        },
      },
      required: ['command'],
    },
    async execute(args, ctx) {
      const command = String(args.command ?? '');
      const timeoutMs = Number(args.timeoutMs ?? 30_000);
      // task 072 hard response is opt-in and OFF by default: the Sandbox default
      // is audit-only, and a caller can only ask for the terminate response
      // explicitly (terminateEscaped: true) — this never widens on its own.
      const terminateEscaped = args.terminateEscaped === true;
      if (!command) {
        return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'command required' }, meta: {} };
      }
      // confine seam: with the Windows Job Object backend this reports real
      // enforcement ('full') and `run` below actually confines the spawn.
      const confined = await sandbox.confine(command.split(/\s+/));
      const status = sandbox.statusSnapshot();
      try {
        const r = await sandbox.run(command, [], {
          timeoutMs,
          maxOutputBytes: 1024 * 1024,
          shell: true,
          limits: { terminateEscaped },
          // task 050: turn interrupt kills the child (result resolves killed:true)
          signal: ctx?.signal,
        });
        const output = (r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : '')).trim();
        // task 072 truthfulness: the escape conclusion must not stay in runtime
        // memory. `r.audit` is filtered down to escape/termination events and
        // carried on the result meta (persisted by the AgentLoop as the
        // `tool/result` session record) + forwarded to the injected audit sink.
        // The full audit is NOT dumped into the model-visible content.
        const escapeEvents = selectEscapeAuditEvents(r.audit);
        for (const e of escapeEvents) opts.audit?.(e);
        // honest sandbox facts for THIS spawn: the runtime status is only active
        // when the job object really attached; `degraded` carries the reason it
        // did not, so a degraded run cannot look confined.
        const sandboxMeta: Record<string, unknown> = {
          enforcement: confined.enforcement,
          ...statusMeta(status),
          ...(escapeEvents.length > 0 ? { audit: escapeEvents } : {}),
        };
        if (r.exitCode !== 0 || r.killed) {
          return {
            content: output.slice(0, 200_000),
            error: {
              errorClass: 'TOOL_FAILURE',
              message: `exit code ${r.exitCode ?? 'null'}${r.timedOut ? ' (timed out)' : ''}${r.killed && !r.timedOut ? ' (interrupted)' : ''}`,
              detail: { exitCode: r.exitCode, timedOut: r.timedOut, killed: r.killed },
            },
            meta: {
              exitCode: r.exitCode,
              timedOut: r.timedOut,
              killed: r.killed,
              readonly: isReadonlyCommand(command),
              sandbox: sandboxMeta,
            },
          };
        }
        return {
          content: output || '(no output)',
          meta: {
            exitCode: r.exitCode,
            readonly: isReadonlyCommand(command),
            sandbox: sandboxMeta,
          },
        };
      } catch (err) {
        return {
          content: '',
          error: { errorClass: 'TOOL_FAILURE', message: `spawn failed: ${(err as Error).message}` },
          meta: { readonly: isReadonlyCommand(command) },
        };
      }
    },
  };
}
