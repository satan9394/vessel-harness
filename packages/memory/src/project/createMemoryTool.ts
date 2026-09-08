import type { ToolExecutionResult, ToolSpec, ToolErrorPayload } from '@vessel/shared';
import type { MemoryScope } from '../persistent/ScopedMemoryStore.js';
import { ScopedMemoryStore, projectMemoryRoot } from '../persistent/ScopedMemoryStore.js';

export interface MemoryToolOptions {
  workspaceRoot: string;
  /** test-only override: point the project scope root at a temp dir */
  rootDir?: string;
  /** test-only override: point the user scope root at a temp home */
  userRoot?: string;
}

/**
 * memory — single `Memory` tool (ARCHITECTURE §4.8: 单一 memory 工具).
 * Registers like any other tool so it flows through the same pipeline:
 * BeforeTool → Policy Engine → Execute → AfterTool. Operations:
 *   read(name) | write(name, content) | list() | search(keyword) | snapshot()
 * Scoped (user/project/local; default project for backward compatibility).
 * Writes target an explicit scope under its on-disk root (never outside).
 */
export function createMemoryTool(opts: MemoryToolOptions): ToolSpec {
  const store = new ScopedMemoryStore({
    workspaceRoot: opts.workspaceRoot,
    userRoot: opts.userRoot,
    projectRoot: opts.rootDir ?? projectMemoryRoot(opts.workspaceRoot),
  });

  const resolveScope = (raw: unknown): MemoryScope => {
    const s = String(raw ?? 'project');
    return s === 'user' || s === 'project' || s === 'local' ? s : 'project';
  };

  return {
    name: 'Memory',
    description:
      '长期记忆（跨会话）：read/write/list/search/snapshot，可按 scope（user/project/local）隔离；write 写入对应作用域 topic 文件并更新索引；snapshot 返回冻结快照用于注入。',
    family: 'other',
    requiredPermission: 'workspace-write',
    exclusive: false,
    inputSchema: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['read', 'write', 'list', 'search', 'snapshot'],
          description: 'memory 操作',
        },
        scope: {
          type: 'string',
          enum: ['user', 'project', 'local'],
          description: '作用域（默认 project）',
        },
        name: { type: 'string', description: 'topic 名（read/write）' },
        content: { type: 'string', description: 'topic 内容（write）' },
        keyword: { type: 'string', description: '检索关键字（search）' },
      },
      required: ['op'],
    },
    async execute(args): Promise<ToolExecutionResult> {
      const op = String(args.op ?? '');
      try {
        switch (op) {
          case 'read': {
            const name = String(args.name ?? '');
            if (!name) return err('INVALID_ARGS', 'Memory.read: name required', {});
            const scope = resolveScope(args.scope);
            const content = scope === 'project' ? store.readMerged(name)?.content : store.read(scope, name);
            return ok(content === undefined ? `(no memory topic "${name}")` : content, { op, name, scope });
          }
          case 'write': {
            const name = String(args.name ?? '');
            const content = String(args.content ?? '');
            if (!name) return err('INVALID_ARGS', 'Memory.write: name required', {});
            const scope = resolveScope(args.scope);
            const r = store.write(scope, name, content);
            return ok(`saved memory topic "${r.name}" (scope: ${scope})`, { op, name, scope, updatedAt: r.updatedAt });
          }
          case 'list': {
            const scope = resolveScope(args.scope);
            const entries = store.list(scope);
            if (entries.length === 0) return ok('(no memory yet)', { op, scope, count: 0 });
            return ok(entries.map((e) => `- ${e.name}: ${e.summary}`).join('\n'), { op, scope, count: entries.length });
          }
          case 'search': {
            const kw = String(args.keyword ?? '');
            if (!kw) return err('INVALID_ARGS', 'Memory.search: keyword required', {});
            const scope = resolveScope(args.scope);
            const hits = store.search(scope, kw);
            if (hits.length === 0) return ok(`(no memory topic matches "${kw}")`, { op, scope, keyword: kw, count: 0 });
            return ok(hits.map((e) => `- ${e.name}: ${e.summary}`).join('\n'), { op, scope, keyword: kw, count: hits.length });
          }
          case 'snapshot': {
            const snap = store.snapshotMerged();
            return ok(snap === '' ? '(no memory to snapshot)' : snap, { op, scope: 'merged' });
          }
          default:
            return err('INVALID_ARGS', `Memory: unknown op "${op}"`, {});
        }
      } catch (e) {
        return err('TOOL_FAILURE', `Memory.${op} failed: ${(e as Error).message}`, {});
      }
    },
  };
}

function ok(content: string, meta: Record<string, unknown>): ToolExecutionResult {
  return { content, meta: { memory: meta } };
}

function err(errorClass: ToolErrorPayload['errorClass'], message: string, detail: Record<string, unknown>): ToolExecutionResult {
  return { content: '', error: { errorClass, message, detail }, meta: {} };
}
