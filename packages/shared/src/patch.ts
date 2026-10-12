export interface DiffHunk {
  id: string;
  filePath: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  status: 'pending' | 'accepted' | 'rejected';
}
export interface PatchCherryPickRequest { widgetId: string; hunkId: string; action: 'accept' | 'reject' }

/** Strict text-only unified diff. Unsupported rename/create/delete/binary patches fail closed. */
export function parsePatchHunks(patch: string, fallbackPath?: string): DiffHunk[] {
  const result: DiffHunk[] = [];
  let filePath = fallbackPath ?? '';
  let oldPath = '';
  let hunk: DiffHunk | undefined;
  const finish = () => {
    if (!hunk) return;
    if (hunk.lines.filter(line => line[0] !== '+' && line[0] !== '\\').length !== hunk.oldLines
      || hunk.lines.filter(line => line[0] !== '-' && line[0] !== '\\').length !== hunk.newLines) throw new Error('invalid_hunk_counts');
    result.push(hunk); hunk = undefined;
  };
  const rows = patch.replace(/\r\n/g, '\n').split('\n');
  if (rows.at(-1) === '') rows.pop();
  for (const line of rows) {
    if (line.startsWith('diff --git ') || line.startsWith('index ')) { finish(); continue; }
    if (line.startsWith('--- ') && !hunk) { oldPath = line.slice(4).split('\t')[0]!.replace(/^a\//, ''); continue; }
    if (line.startsWith('+++ ') && !hunk) {
      filePath = line.slice(4).split('\t')[0]!.replace(/^b\//, '');
      if (oldPath !== filePath || filePath === '/dev/null') throw new Error('unsupported_patch');
      continue;
    }
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (match) {
      finish();
      if (!filePath) throw new Error('missing_patch_path');
      hunk = { id: `${filePath}#hunk-${result.filter(item => item.filePath === filePath).length}`, filePath,
        oldStart: +match[1]!, oldLines: +(match[2] ?? 1), newStart: +match[3]!, newLines: +(match[4] ?? 1), lines: [], status: 'pending' };
      if (![hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines].every(Number.isSafeInteger)) throw new Error('invalid_hunk_range');
      if ((hunk.oldLines && !hunk.oldStart) || (hunk.newLines && !hunk.newStart)) throw new Error('invalid_hunk_range');
    } else if (hunk && /^[ +\-]/.test(line)) {
      // A new file header only follows a completed hunk.
      if (line.startsWith('--- ') && hunk.lines.filter(row => row[0] !== '+' && row[0] !== '\\').length === hunk.oldLines
        && hunk.lines.filter(row => row[0] !== '-' && row[0] !== '\\').length === hunk.newLines) {
        finish(); oldPath = line.slice(4).split('\t')[0]!.replace(/^a\//, '');
      } else hunk.lines.push(line);
    } else if (hunk && line === '\\ No newline at end of file' && /^[ +\-]/.test(hunk.lines.at(-1) ?? '')) hunk.lines.push(line);
    else throw new Error('unsupported_patch');
  }
  finish();
  if (!result.length) throw new Error('empty_patch');
  const previousByPath = new Map<string, DiffHunk>();
  for (const next of result) {
    const previous = previousByPath.get(next.filePath);
    if (previous && next.oldStart < previous.oldStart + previous.oldLines) throw new Error('overlapping_hunks');
    previousByPath.set(next.filePath, next);
  }
  return result;
}

/** Exact anchored replacement: never search/fuzz a stale patch into another location. */
export function applyPatchHunk(content: string, hunk: DiffHunk, offset = 0): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  if (content.includes('\0')) throw new Error('binary_file');
  const source = content.replace(/\r\n/g, '\n').split('\n');
  const ended = source.at(-1) === '';
  if (ended) source.pop();
  const old = hunk.lines.filter(line => line[0] === ' ' || line[0] === '-').map(line => line.slice(1));
  const replacement = hunk.lines.filter(line => line[0] === ' ' || line[0] === '+').map(line => line.slice(1));
  const index = (hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1) + offset;
  if (index < 0 || index > source.length || old.some((line, i) => source[index + i] !== line)) throw new Error('stale_patch');
  const oldNoNewline = hunk.lines.some((line, i) => line[0] === '\\' && hunk.lines[i - 1]?.[0] !== '+');
  const newNoNewline = hunk.lines.some((line, i) => line[0] === '\\' && hunk.lines[i - 1]?.[0] !== '-');
  const touchesEnd = index + old.length === source.length;
  if ((oldNoNewline || newNoNewline) && !touchesEnd) throw new Error('invalid_newline_marker');
  if (touchesEnd && old.length && oldNoNewline === ended) throw new Error('stale_patch');
  source.splice(index, old.length, ...replacement);
  return source.join(newline) + (touchesEnd ? (newNoNewline || !source.length ? '' : newline) : (ended ? newline : ''));
}

/** Reverse at the current original-side anchor plus deltas of earlier applied hunks. */
export function revertPatchHunk(content: string, hunk: DiffHunk, offset = 0): string {
  const anchor = (hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart - 1) + offset;
  const reversed: DiffHunk = { ...hunk, oldStart: anchor + (hunk.newLines === 0 ? 0 : 1), oldLines: hunk.newLines,
    newStart: hunk.oldStart, newLines: hunk.oldLines,
    lines: hunk.lines.map(line => line[0] === '+' ? '-' + line.slice(1) : line[0] === '-' ? '+' + line.slice(1) : line) };
  return applyPatchHunk(content, reversed);
}
