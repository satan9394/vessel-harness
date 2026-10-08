import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceStateFingerprint } from '@vessel/shared';
export type { WorkspaceStateFingerprint } from '@vessel/shared';

const git = promisify(execFile);
const ignored = new Set(['.git', 'node_modules', 'dist', '.tmp', '.agent-state', '.dsh-vision-router']);
const runtimeState = new Set(['sessions', 'cache', 'logs', 'usage', 'iterations', 'sessions.json']);
function ignoredPath(relative: string): boolean {
  const parts = relative.split('/');
  return parts.some(part => ignored.has(part)) || parts.some((part, i) =>
    (part === '.harness' || part === '.vessel') && runtimeState.has(parts[i + 1] ?? ''));
}

/** Read-only snapshot. Symlinks are hashed as links and never followed. */
export class WorkspaceFingerprinter {
  static async compute(workspaceRoot: string): Promise<WorkspaceStateFingerprint> {
    const root = fs.realpathSync.native(workspaceRoot);
    const hash = createHash('sha256');
    let fileCount = 0;
    let contentBytes = 0;
    let ancestor = root;
    let inGit = false;
    for (;;) {
      if (fs.existsSync(path.join(ancestor, '.git'))) { inGit = true; break; }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    const options = { encoding: 'buffer' as const, maxBuffer: 64 * 1024 * 1024, windowsHide: true };
    const confinedParents = new Map<string, boolean>();
    const outsidePaths: string[] = [];
    const inspect = (name: string) => {
      if (ignoredPath(name)) return;
      const filename = path.resolve(root, name);
      const relative = path.relative(root, filename);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
      let stat: fs.Stats;
      try { stat = fs.lstatSync(filename); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { name }; throw error; }
      // A listed file can have a symlinked parent directory. Do not read through
      // that parent outside the root; leaf symlinks are read only as link text.
      const directory = path.dirname(filename);
      if (!confinedParents.has(directory)) {
        const parent = path.relative(root, fs.realpathSync.native(directory));
        confinedParents.set(directory, parent !== '..' && !parent.startsWith(`..${path.sep}`) && !path.isAbsolute(parent));
      }
      if (!confinedParents.get(directory)) { outsidePaths.push(name); return; }
      if (!stat.isFile() && !stat.isSymbolicLink()) return;
      return { name, filename, stat };
    };
    const read = (files: Array<{ name: string; untracked: boolean }>) => {
      const entries = files.map(file => ({ ...file, snapshot: inspect(file.name) }));
      // Fresh contents on every invocation, including same-mtime rewrites. Bound
      // IO concurrency and hash in inventory order so scheduling cannot alter it.
      const contents = async () => {
        for (let offset = 0; offset < entries.length; offset += 32) {
          const batch = entries.slice(offset, offset + 32);
          const bytes = await Promise.all(batch.map(({ snapshot }) => {
            if (!snapshot?.stat || !snapshot.filename) return undefined;
            return snapshot.stat.isSymbolicLink()
              ? Buffer.from(fs.readlinkSync(snapshot.filename)) : fs.promises.readFile(snapshot.filename);
          }));
          for (let i = 0; i < batch.length; i++) {
            const { name, untracked, snapshot } = batch[i]!;
            if (!snapshot) continue;
            if (!snapshot.stat) { hash.update(JSON.stringify([name, 'deleted'])); continue; }
            const content = bytes[i]!;
            hash.update(JSON.stringify([name, snapshot.stat.mtimeMs, snapshot.stat.size, content.length]));
            hash.update(content); contentBytes += content.length; fileCount++;
            if (untracked) uncommittedDiffBytes += content.length;
          }
        }
      };
      return contents();
    };
    const walked: Array<{ name: string; untracked: boolean }> = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const filename = path.join(directory, entry.name);
        if (ignoredPath(path.relative(root, filename).split(path.sep).join('/'))) continue;
        if (entry.isDirectory()) { walk(filename); continue; }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        walked.push({ name: path.relative(root, filename).split(path.sep).join('/'), untracked: true });
      }
    };
    let uncommittedDiffBytes = 0;
    // Includes staged + unstaged tracked changes against HEAD. Untracked files
    // contribute their raw byte lengths; non-Git workspaces are wholly untracked.
    // Git output is binary-safe and external diff/textconv drivers cannot execute.
    if (inGit) {
      // Git supplies the file set: nested ignore rules, tracked ignore exceptions
      // and fresh untracked files are resolved without scanning scratch trees.
      const { stdout: names } = await git('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-t', '-z', '--', '.'], options);
      const files = new Map<string, boolean>();
      for (const tagged of names.toString('utf8').split('\0').filter(Boolean)) files.set(tagged.slice(2), tagged[0] === '?');
      const contents = read([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, untracked]) => ({ name, untracked })));
      const excludes = [...ignored].map(name => `:(exclude,glob)**/${name}/**`);
      for (const directory of ['.harness', '.vessel']) for (const state of runtimeState) {
        excludes.push(`:(exclude,glob)**/${directory}/${state}`, `:(exclude,glob)**/${directory}/${state}/**`);
      }
      // Git also follows parent junctions when reading tracked paths. Its patch
      // must obey the same confinement as the file contents above.
      excludes.push(...outsidePaths.map(name => `:(exclude,literal)${name}`));
      const diffArgs = ['-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--binary'];
      const patch = async (): Promise<Buffer> => {
        try { return (await git('git', [...diffArgs, 'HEAD', '--', '.', ...excludes], options)).stdout; }
        catch (error) {
          // An unborn repository has no HEAD; staged + unstaged patches remain
          // observable. Other Git failures must not masquerade as a clean tree.
          if (!/ambiguous argument 'HEAD'|bad revision 'HEAD'/.test(String((error as { stderr?: Buffer }).stderr))) throw error;
          return Buffer.concat([(await git('git', [...diffArgs, '--cached', '--', '.', ...excludes], options)).stdout,
            (await git('git', [...diffArgs, '--', '.', ...excludes], options)).stdout]);
        }
      };
      const [, diff] = await Promise.all([contents, patch()]);
      uncommittedDiffBytes += diff.length;
      hash.update(diff);
    } else { walk(root); await read(walked); uncommittedDiffBytes = contentBytes; }
    return { timestamp: Date.now(), trackedFilesHash: hash.digest('hex'), uncommittedDiffBytes, fileCount };
  }
}
