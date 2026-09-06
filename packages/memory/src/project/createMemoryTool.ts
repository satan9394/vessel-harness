import type { ToolExecutionResult, ToolSpec, ToolErrorPayload } from '@cah/shared';
import { ProjectStore } from './ProjectStore.js';

export interface MemoryToolOptions {
  workspaceRoot: string;
  /** optional override of the store root (tests inject a temp dir) */
  rootDir?: string;
}

/**
 * memory/project — single `Memory` tool (ARCHITECTURE §4.8: 单一 memory 工具).
 * Registers like any other tool so it flows through the same pipeline:
 * BeforeTool → Policy Engine → Execute → AfterTool. Operations:
 *   read(name) | write(name, content) | list() | search(keyword) | snapshot()
 * Writes are project-scoped under .harness/memory (never outside workspace).
 */
export function createMemoryTool(opts: MemoryToolOptions): ToolSpec {
  const store = new ProjectStore(opts.workspaceRoot, { rootDir: opts.rootDir });
  store.ensure();

  return {
    name: 'Memory',
    description:
      '项目级长期记忆（跨会话）：read/write/list/search/snapshot。write 写入 .harness/memory/ 下 topic 文件并更新 MEMORY.md 索引；snapshot 返回冻结快照用于注入上下文。',
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
            const content = store.read(name);
            return ok(content === undefined ? `(no memory topic "${name}")` : content, { op, name });
          }
          case 'write': {
            const name = String(args.name ?? '');
            const content = String(args.content ?? '');
            if (!name) return err('INVALID_ARGS', 'Memory.write: name required', {});
            const r = store.write(name, content);
            return ok(`saved memory topic "${r.name}"`, { op, name, updatedAt: r.updatedAt });
          }
          case 'list': {
            const entries = store.list();
            if (entries.length === 0) return ok('(no project memory yet)', { op, count: 0 });
            return ok(entries.map((e) => `- ${e.name}: ${e.summary}`).join('\n'), { op, count: entries.length });
          }
          case 'search': {
            const kw = String(args.keyword ?? '');
            if (!kw) return err('INVALID_ARGS', 'Memory.search: keyword required', {});
            const hits = store.search(kw);
            if (hits.length === 0) return ok(`(no memory topic matches "${kw}")`, { op, keyword: kw, count: 0 });
            return ok(hits.map((e) => `- ${e.name}: ${e.summary}`).join('\n'), { op, keyword: kw, count: hits.length });
          }
          case 'snapshot': {
            const snap = store.snapshot();
            return ok(snap === '' ? '(no project memory to snapshot)' : snap, { op });
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
