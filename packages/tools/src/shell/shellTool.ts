import type { SandboxStatus, ToolSpec } from '@vessel/shared';
import type { Sandbox } from '@vessel/runtime';
import { errorCode } from '../execution/selfHealing.js';
import { win32 } from 'node:path';
import { PlatformSandboxRunner } from '../execution/sandbox/platformSandbox.js';
import type { NativeSandboxRunner, SandboxAuditEvent } from '../execution/sandbox/types.js';

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
  nativeSandbox?: NativeSandboxRunner;
  nativeAudit?: (event: SandboxAuditEvent) => void | Promise<void>;
}): ToolSpec {
  const { sandbox } = opts;
  const native = opts.nativeSandbox ?? (opts.nativeAudit ? new PlatformSandboxRunner() : undefined);

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
      if (native) {
        // Only the workspace is a write root. `os.tmpdir()` used to be included for scratch files,
        // but the sandbox preflight requires *every* root to be ACL-provisioned (Low label + the
        // restricted SID grant), and the OS temp directory never is — so including it turned every
        // command into "sandbox directory requires provisioned ... ACL". A Low-integrity token
        // cannot write the Medium-labelled temp directory anyway, so the root bought nothing.
        const allowedWritePaths = [opts.workspaceRoot];
        try {
          // Wrap every command: readonly prefix parsing cannot exclude shell redirection or substitution.
          const executable = process.platform === 'win32' ? win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe') : '/bin/sh';
          const argv = process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command];
          const result = await native.execute(executable, argv, { cwd: opts.workspaceRoot, allowedWritePaths, cpuTimeoutMs: timeoutMs, lowIntegrity: true, signal: ctx?.signal });
          await opts.nativeAudit?.({ isolationTier: result.isolationTier, sandboxed: result.sandboxed, outcome: result.sandboxed ? 'enforced' : 'fallback', allowedWritePaths,
            ...(result.constraints ? { constraints: result.constraints } : {}), ...(!result.sandboxed ? { reason: 'native-helper-unavailable' } : {}) });
          let output = (result.stdout + (result.stderr ? '\n[stderr]\n' + result.stderr : '')).trim();
          // The native launcher can lose local-code-page stderr before it reaches TypeScript.
          // Keep the failure and raw text; the hint does not infer a permission denial.
          if (result.exitCode !== 0 && /\uFFFD|\?{3,}/.test(result.stderr)) {
            output += '\n[hint] Command failed; stderr may use a non-UTF-8 code page. If writing files, check that the target is inside the sandbox allowed write roots.';
          }
          return {
            content: output || '(no output)',
            ...(result.exitCode !== 0 ? { error: { errorClass: 'TOOL_FAILURE' as const, message: `exit code ${result.exitCode}`, detail: { exitCode: result.exitCode } } } : {}),
            meta: { exitCode: result.exitCode, readonly: isReadonlyCommand(command), retryUnsafe: true, sandbox: { active: result.sandboxed, isolationTier: result.isolationTier } },
          };
        } catch (error) {
          await opts.nativeAudit?.({ isolationTier: process.platform === 'win32' ? 'windows-job-restricted' : 'passthrough-fallback', sandboxed: false, outcome: 'denied', allowedWritePaths, reason: String(error) });
          // The raw preflight error is a bare path complaint. Say what to do about it, otherwise the
          // only honest reading is "Shell is broken" (measured: a real model session retried three
          // times and then reported the tool as unavailable).
          const unprepared = /requires provisioned Low Integrity and restricted SID ACL/.test(String(error));
          const hint = unprepared ? ` — this workspace is not prepared for the sandbox; run: scripts/provision-sandbox.ps1 -Path "${opts.workspaceRoot}"` : '';
          return { content: '', error: { errorClass: 'DENIED', message: `sandbox execution denied: ${String(error)}${hint}` }, meta: { retryUnsafe: true } };
        }
      }
      // confine seam: with the Windows Job Object backend this reports the
      // enforcement the backend is prepared to provide ('full') and `run` below
      // actually confines the spawn. It is a PRE-round prediction (it only reads
      // the failure recorded by an earlier round), so it is surfaced under its
      // own name — `preRoundEnforcement` — and is never mixed with the
      // round-scoped facts of this spawn.
      const confined = await sandbox.confine(command.split(/\s+/));
      let completed = false;
      try {
        const r = await sandbox.run(command, [], {
          timeoutMs,
          maxOutputBytes: 1024 * 1024,
          shell: true,
          limits: { terminateEscaped },
          // task 050: turn interrupt kills the child (result resolves killed:true)
          signal: ctx?.signal,
        });
        completed = true;
        const output = (r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : '')).trim();
        // task 072 truthfulness: the escape conclusion must not stay in runtime
        // memory. `r.audit` is filtered down to escape/termination events and
        // carried on the result meta (persisted by the AgentLoop as the
        // `tool/result` session record) + forwarded to the injected audit sink.
        // The full audit is NOT dumped into the model-visible content.
        const escapeEvents = selectEscapeAuditEvents(r.audit);
        for (const e of escapeEvents) opts.audit?.(e);
        // Honest sandbox facts for THIS spawn (BRIEF ①). Which round each field
        // describes is NOT allowed to be ambiguous:
        //   - `preRoundEnforcement` — what `confine()` predicted BEFORE this round
        //     opened (a capability statement about the backend, not an outcome).
        //   - `supported` / `active` / `backend` / `degraded` / `reason` — the
        //     outcome of THIS round, taken from `r.sandbox`, i.e. the status
        //     `Sandbox.run` captured AFTER the spawn + attach settled.
        // Why it must be `r.sandbox`: `run()` opens a fresh round
        // (`Sandbox.beginRound()` clears `degraded`), so a snapshot taken BEFORE
        // `run()` describes the PREVIOUS round — it would report `active:true`
        // (and no `degraded`) for a round whose attach actually failed, and the
        // durable `tool/result` record would claim confinement that never was.
        const sandboxMeta: Record<string, unknown> = {
          preRoundEnforcement: confined.enforcement,
          ...statusMeta(r.sandbox),
          ...(escapeEvents.length > 0 ? { audit: escapeEvents } : {}),
        };
        if (r.exitCode !== 0 || r.killed) {
          return {
            content: output,
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
          error: { errorClass: 'TOOL_FAILURE', message: `spawn failed: ${(err as Error).message}`, ...(!completed && errorCode(err) ? { detail: { code: errorCode(err) } } : {}) },
          meta: { readonly: isReadonlyCommand(command) },
        };
      }
    },
  };
}
