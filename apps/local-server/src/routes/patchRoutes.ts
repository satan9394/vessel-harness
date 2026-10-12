import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyPatchHunk, revertPatchHunk, parsePatchHunks, type DiffHunk, type DiffInspectorWidget } from '@vessel/shared';

interface PatchState { hunks: DiffHunk[]; expected: Map<string, string>; applied: Set<string>; root?: string; error?: string }
interface Session { workspaceRoot: string; permission: string }

/** Rewriting text must preserve every byte outside the selected hunk. */
function readPatchText(file: string | number): string {
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('unsupported_patch_encoding');
  const withoutCRLF = text.replace(/\r\n/g, '');
  if (withoutCRLF.includes('\r') || (text.includes('\r\n') && withoutCRLF.includes('\n'))) throw new Error('unsupported_patch_line_endings');
  return text;
}

function target(root: string, relative: string): string {
  if (!relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || path.isAbsolute(relative)
    || relative.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'
      || /[. ]$|[\x00-\x1f<>"|?*]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('unsafe_patch_path');
  const realRoot = fs.realpathSync(root);
  let current = realRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('unsafe_patch_path');
  }
  const stat = fs.statSync(current);
  const resolved = fs.realpathSync(current);
  if (resolved !== current || !resolved.startsWith(realRoot + path.sep)) throw new Error('unsafe_patch_path');
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 2_000_000) throw new Error('unsupported_patch_file');
  return current;
}

/** Owns only server-published proposals; HTTP cannot supply paths or patch text. */
export class PatchRoutes {
  private readonly patches = new Map<string, Map<string, PatchState>>();
  constructor(private readonly session: (id: string) => Session | undefined) {}
  publish(sessionId: string, widget: DiffInspectorWidget): void {
    let states = this.patches.get(sessionId);
    if (!states) { states = new Map(); this.patches.set(sessionId, states); }
    const state: PatchState = { hunks: [], expected: new Map(), applied: new Set() };
    states.set(widget.id, state);
    try {
      if (widget.payload.patch.length > 2_000_000) throw new Error('patch_too_large');
      state.hunks = parsePatchHunks(widget.payload.patch, widget.payload.filePath);
      const session = this.session(sessionId);
      if (!session) throw new Error('session_not_found');
      state.root = fs.realpathSync(session.workspaceRoot);
      for (const hunk of state.hunks) if (!state.expected.has(hunk.filePath)) {
        const content = readPatchText(target(session.workspaceRoot, hunk.filePath));
        state.expected.set(hunk.filePath, content);
        const fileHunks = state.hunks.filter(item => item.filePath === hunk.filePath);
        let originalMatches = false;
        let appliedMatches = false;
        try {
          // Descending anchors do not shift the earlier hunk positions.
          fileHunks.reduceRight((text, item) => applyPatchHunk(text, item), content);
          originalMatches = true;
        } catch { /* Try the already-applied side below. */ }
        try {
          // A worktree diff commonly arrives after all its changes were written.
          fileHunks.reduceRight((text, item, index) => revertPatchHunk(text, item,
            fileHunks.slice(0, index).reduce((sum, previous) => sum + previous.newLines - previous.oldLines, 0)), content);
          appliedMatches = true;
        } catch { /* Exact original-side matching remains sufficient. */ }
        if (originalMatches && appliedMatches) throw new Error('ambiguous_patch_state');
        if (!originalMatches && !appliedMatches) throw new Error('stale_patch');
        if (appliedMatches) for (const item of fileHunks) state.applied.add(item.id);
      }
    } catch (error) { state.error = error instanceof Error ? error.message : 'invalid_patch'; }
  }
  apply(sessionId: string, body: unknown): { status: number; body: unknown } {
    const fail = (status: number, error: string) => ({ status, body: { error } });
    const session = this.session(sessionId);
    if (!session) return fail(404, 'session_not_found');
    if (session.permission === 'read-only') return fail(403, 'read_only_session');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'invalid_patch_action');
    const data = body as Record<string, unknown>;
    if (Object.keys(data).some(key => !['widgetId', 'hunkId', 'action'].includes(key)) || typeof data.widgetId !== 'string'
      || typeof data.hunkId !== 'string' || !['accept', 'reject'].includes(String(data.action))) return fail(400, 'invalid_patch_action');
    const state = this.patches.get(sessionId)?.get(data.widgetId);
    if (!state) return fail(404, 'patch_not_found');
    if (state.error) return fail(400, state.error);
    const hunk = state.hunks.find(item => item.id === data.hunkId);
    if (!hunk) return fail(404, 'hunk_not_found');
    const status = data.action === 'accept' ? 'accepted' : 'rejected';
    if (hunk.status === status) return { status: 200, body: { hunk } };
    try {
      const shouldApply = status === 'accepted';
      if (shouldApply !== state.applied.has(hunk.id)) {
        if (fs.realpathSync(session.workspaceRoot) !== state.root) throw new Error('workspace_changed');
        const filename = target(session.workspaceRoot, hunk.filePath);
        const validated = fs.statSync(filename);
        const expected = state.expected.get(hunk.filePath)!;
        const descriptor = fs.openSync(filename, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0));
        try {
          const stat = fs.fstatSync(descriptor);
          if (target(session.workspaceRoot, hunk.filePath) !== filename || stat.dev !== validated.dev || stat.ino !== validated.ino
            || stat.nlink !== 1 || !stat.isFile() || readPatchText(descriptor) !== expected) throw new Error('stale_patch');
          const offset = state.hunks.filter(item => item.filePath === hunk.filePath && state.applied.has(item.id) && item.oldStart < hunk.oldStart)
            .reduce((sum, item) => sum + item.newLines - item.oldLines, 0);
          const next = shouldApply ? applyPatchHunk(expected, hunk, offset) : revertPatchHunk(expected, hunk, offset);
          // Same descriptor avoids replacing symlinks and never deletes or recreates files.
          fs.writeSync(descriptor, next, 0, 'utf8'); fs.ftruncateSync(descriptor, Buffer.byteLength(next)); fs.fsyncSync(descriptor);
          state.expected.set(hunk.filePath, next);
          if (shouldApply) state.applied.add(hunk.id); else state.applied.delete(hunk.id);
        } finally { fs.closeSync(descriptor); }
      }
      hunk.status = status;
      return { status: 200, body: { hunk } };
    } catch (error) { return fail(409, error instanceof Error ? error.message : 'patch_apply_failed'); }
  }
}
