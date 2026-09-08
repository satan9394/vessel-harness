import type { ToolSpec } from '@vessel/shared';
import { runCommand } from '@vessel/runtime';
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

export function createShellTool(opts: { workspaceRoot: string; sandbox: Sandbox }): ToolSpec {
  const { workspaceRoot: root, sandbox } = opts;

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
      },
      required: ['command'],
    },
    async execute(args, ctx) {
      const command = String(args.command ?? '');
      const timeoutMs = Number(args.timeoutMs ?? 30_000);
      if (!command) {
        return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'command required' }, meta: {} };
      }
      // confine seam: v0.1 reports partial enforcement transparently
      const confined = await sandbox.confine(command.split(/\s+/));
      const status = sandbox.statusSnapshot();
      try {
        const r = await runCommand(command, [], {
          cwd: root,
          timeoutMs,
          maxOutputBytes: 1024 * 1024,
          shell: true,
        });
        const output = (r.stdout + (r.stderr ? '\n[stderr]\n' + r.stderr : '')).trim();
        if (r.exitCode !== 0) {
          return {
            content: output.slice(0, 200_000),
            error: {
              errorClass: 'TOOL_FAILURE',
              message: `exit code ${r.exitCode}${r.timedOut ? ' (timed out)' : ''}`,
              detail: { exitCode: r.exitCode, timedOut: r.timedOut },
            },
            meta: {
              exitCode: r.exitCode,
              timedOut: r.timedOut,
              readonly: isReadonlyCommand(command),
              sandbox: { enforcement: confined.enforcement, status: status.supported },
            },
          };
        }
        return {
          content: output || '(no output)',
          meta: {
            exitCode: r.exitCode,
            readonly: isReadonlyCommand(command),
            sandbox: { enforcement: confined.enforcement, status: status.supported },
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
