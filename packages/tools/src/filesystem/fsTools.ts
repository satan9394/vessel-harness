import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolSpec } from '@vessel/shared';
import {
  assertNoNul,
  assertReadable,
  assertSizeWithin,
  assertWritable,
  canonicalize,
  type FsPolicyConfig,
} from './guards.js';

/** Build the actual Read/Write/Edit tools bound to a workspace + policy. */
export function createFsTools(opts: { workspaceRoot: string; fsPolicy: FsPolicyConfig }): ToolSpec[] {
  const { workspaceRoot: root, fsPolicy } = opts;

  const read: ToolSpec = {
    name: 'Read',
    description: 'Read a file from the workspace and return its text content (UTF-8, ≤10MiB).',
    family: 'file_read',
    requiredPermission: 'read',
    exclusive: false,
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'workspace-relative file path' } },
      required: ['path'],
    },
    async execute(args) {
      const p = String(args.path ?? '');
      if (!p) return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'path required' }, meta: {} };
      try {
        const canonical = canonicalize(root, p);
        assertReadable(root, canonical, fsPolicy);
        const stat = fs.statSync(canonical);
        if (!stat.isFile()) {
          return { content: '', error: { errorClass: 'TOOL_FAILURE', message: `not a file: ${p}` }, meta: {} };
        }
        assertSizeWithin(stat.size);
        const data = fs.readFileSync(canonical, 'utf8');
        assertNoNul(data);
        return { content: data, meta: { path: path.relative(root, canonical), bytes: stat.size } };
      } catch (err) {
        const e = err as Error & { guard?: string };
        if (e.guard) {
          return { content: '', error: { errorClass: 'TOOL_FAILURE', message: e.message }, meta: { guard: e.guard } };
        }
        return { content: '', error: { errorClass: 'TOOL_FAILURE', message: `read failed: ${(err as Error).message}` }, meta: {} };
      }
    },
  };

  const write: ToolSpec = {
    name: 'Write',
    description: 'Write a file in the workspace (creates directories as needed).',
    family: 'file_write',
    requiredPermission: 'workspace-write',
    exclusive: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'workspace-relative file path' },
        content: { type: 'string', description: 'full file content to write' },
      },
      required: ['path', 'content'],
    },
    async execute(args) {
      const p = String(args.path ?? '');
      const content = String(args.content ?? '');
      if (!p) return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'path required' }, meta: {} };
      try {
        const canonical = canonicalize(root, p);
        assertNoNul(content);
        assertWritable(root, canonical, fsPolicy);
        fs.mkdirSync(path.dirname(canonical), { recursive: true });
        fs.writeFileSync(canonical, content, 'utf8');
        return { content: `wrote ${path.relative(root, canonical)} (${Buffer.byteLength(content, 'utf8')} bytes)`, meta: { path: path.relative(root, canonical), bytes: Buffer.byteLength(content, 'utf8') } };
      } catch (err) {
        const e = err as Error & { guard?: string };
        if (e.guard) {
          return { content: '', error: { errorClass: 'DENIED', message: e.message }, meta: { guard: e.guard } };
        }
        return { content: '', error: { errorClass: 'TOOL_FAILURE', message: `write failed: ${(err as Error).message}` }, meta: {} };
      }
    },
  };

  const edit: ToolSpec = {
    name: 'Edit',
    description: 'Replace an exact literal substring in a file (single occurrence).',
    family: 'file_write',
    requiredPermission: 'workspace-write',
    exclusive: true,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string', description: 'exact text to replace' },
        new_string: { type: 'string', description: 'replacement text' },
        replace_all: { type: 'boolean', description: 'replace every occurrence' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(args) {
      const p = String(args.path ?? '');
      const oldStr = String(args.old_string ?? '');
      const newStr = String(args.new_string ?? '');
      const replaceAll = Boolean(args.replace_all);
      if (!p || oldStr === '') {
        return { content: '', error: { errorClass: 'INVALID_ARGS', message: 'path and old_string required' }, meta: {} };
      }
      try {
        const canonical = canonicalize(root, p);
        assertWritable(root, canonical, fsPolicy);
        const data = fs.readFileSync(canonical, 'utf8');
        assertNoNul(data);
        if (!data.includes(oldStr)) {
          return { content: '', error: { errorClass: 'TOOL_FAILURE', message: `old_string not found in ${p}` }, meta: { path: p } };
        }
        const updated = replaceAll ? data.split(oldStr).join(newStr) : data.replace(oldStr, newStr);
        fs.writeFileSync(canonical, updated, 'utf8');
        const count = replaceAll ? data.split(oldStr).length - 1 : 1;
        return { content: `edited ${path.relative(root, canonical)} (${count} replacement${count === 1 ? '' : 's'})`, meta: { path: path.relative(root, canonical), replacements: count } };
      } catch (err) {
        const e = err as Error & { guard?: string };
        if (e.guard) {
          return { content: '', error: { errorClass: 'DENIED', message: e.message }, meta: { guard: e.guard } };
        }
        return { content: '', error: { errorClass: 'TOOL_FAILURE', message: `edit failed: ${(err as Error).message}` }, meta: {} };
      }
    },
  };

  return [read, write, edit];
}
