#!/usr/bin/env node
/**
 * Update an installed copy of this Skill from its published Git repository.
 *
 * The Skill ships as one directory. This command fetches the published branch into
 * a cache directory under the project's `.pdw/`, compares the whole skill tree byte
 * for byte, backs the installed copy up, and replaces changed/added files atomically.
 * It never touches `.pdw/config.json`, never deletes a file, never commits, pushes or
 * publishes, and it can replace itself. Origin (repository / branch / sub path /
 * version) is read from the installed SKILL.md frontmatter, so there is no local
 * machine path in this program.
 *
 * Usage:
 *   node <skill>/scripts/update.mjs [--project <dir>] [--source <url>] [--ref <branch>] [--mirror <dir>] [--dry-run] [--json]
 *
 * `--mirror <dir>` additionally brings a second copy of the skill (for example a shared
 * agent skill root) to the same bytes. The mirror must already exist and must not contain,
 * or be contained by, the installed skill; files the published copy does not ship are kept.
 *
 * Exit codes: 0 current or updated (doctor passed), 1 failure. Nothing is left half
 * applied: every file is written through a temporary name and renamed into place.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

/** Parse the shallow YAML frontmatter (`key:` scalars and one `metadata:` section). */
function frontmatter(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const end = lines.indexOf('---', 1);
  if (end < 0) return {};
  const data = {};
  let section = null;
  for (const line of lines.slice(1, end)) {
    const nested = section && /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (nested) { data[section][nested[1]] = nested[2].trim().replace(/^["']|["']$/g, ''); continue; }
    const top = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!top) continue;
    const value = top[2].trim().replace(/^["']|["']$/g, '');
    if (value) { data[top[1]] = value; section = null; } else { data[top[1]] = {}; section = top[1]; }
  }
  return data;
}

/** Compare two directories the way Windows does when they may differ only in case. */
function sameDirectory(left, right) {
  const normalize = value => {
    let resolved;
    try { resolved = fs.realpathSync.native(value); } catch { resolved = path.resolve(value); }
    return resolved.replace(/[\\/]+$/, '');
  };
  const a = normalize(left), b = normalize(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Every regular file under `root`, as sorted relative paths; symlinks are refused. */
function walk(root) {
  if (!fs.existsSync(root)) throw new Error(`Skill directory not found: ${root}`);
  const files = [];
  const visit = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Skill tree contains a symbolic link: ${name}`);
      if (entry.isDirectory()) visit(full, name);
      else if (entry.isFile()) files.push(name);
      else throw new Error(`Unsupported skill entry: ${name}`);
    }
  };
  visit(root);
  return files.sort();
}

/** Atomic write: a temporary sibling is renamed over the target, refusing symlinks. */
function writeFile(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing symlink output: ${file}`);
  const temp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(temp, buffer);
  const deadline = Date.now() + 1000;
  for (;;) {
    try { fs.renameSync(temp, file); break; }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(20, deadline - Date.now()));
    }
  }
}

/** Project root: `--project`, else the `.agents/skills/<name>` install layout. */
function projectRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  const candidate = path.resolve(skillRoot, '..', '..', '..');
  const expected = path.join(candidate, '.agents', 'skills', path.basename(skillRoot));
  if (sameDirectory(expected, skillRoot)) return candidate;
  throw new Error(`Cannot infer the project root from ${skillRoot}; pass --project <dir>`);
}

/** First free backup directory name, so repeated updates never overwrite a backup. */
function backupDirectory(project, version) {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const suffix = attempt === 1 ? '' : `-${attempt}`;
    const candidate = path.join(project, '.pdw', `skill-upgrade-${day}`, `personal-dev-workflow-pre-${version}${suffix}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('No free backup directory name; clean up .pdw/skill-upgrade-* first');
}

function main(argv) {
  const args = [...argv];
  const flag = name => {
    const index = args.indexOf(name);
    if (index < 0) return null;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${name}`);
    args.splice(index, 2);
    return value;
  };
  const take = name => { const index = args.indexOf(name); if (index >= 0) args.splice(index, 1); return index >= 0; };
  const dryRun = take('--dry-run') || take('--check');
  const jsonOnly = take('--json');
  const projectFlag = flag('--project'), sourceFlag = flag('--source'), refFlag = flag('--ref');
  const skillPathFlag = flag('--skill-path'), mirrorFlag = flag('--mirror');
  if (args.length) throw new Error(`Unknown argument: ${args.join(' ')}`);

  const front = frontmatter(path.join(skillRoot, 'SKILL.md'));
  const metadata = front.metadata ?? {};
  const version = metadata.version ?? 'unknown';
  const source = sourceFlag ?? metadata.repository;
  const ref = refFlag ?? metadata.branch ?? 'main';
  const skillPath = skillPathFlag ?? metadata['skill-path'] ?? `skills/${front.name ?? path.basename(skillRoot)}`;
  const project = projectRoot(projectFlag);
  const report = line => { if (!jsonOnly) console.log(line); };
  const configNote = 'Skill files only: model, reasoning depth, limits and prompt_guidance are project settings; show a diff and wait for explicit user confirmation before changing them.';
  const mirrorRoot = mirrorFlag ? path.resolve(mirrorFlag) : null;
  if (mirrorRoot) {
    if (sameDirectory(mirrorRoot, skillRoot)) throw new Error('--mirror must not be the installed skill directory');
    if (inside(skillRoot, mirrorRoot) || inside(mirrorRoot, skillRoot)) throw new Error('--mirror and the installed skill must not contain one another');
    if (!fs.existsSync(mirrorRoot)) throw new Error(`Mirror directory not found: ${mirrorRoot}; create it before updating`);
    if (!fs.statSync(mirrorRoot).isDirectory()) throw new Error(`Mirror path is not a directory: ${mirrorRoot}`);
  }

  if (!source) throw new Error('No source: SKILL.md metadata.repository is missing; pass --source <git-url>');

  const local = new Map(walk(skillRoot).map(name => [name, hash(fs.readFileSync(path.join(skillRoot, name)))]));
  const cache = path.join(project, '.pdw', 'update-cache', `${Date.now()}`);
  fs.mkdirSync(cache, { recursive: true });
  // Byte comparison must not depend on the operator's Git line-ending settings.
  const clone = spawnSync('git', ['clone', '--depth', '1', '--branch', ref,
    '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--config', 'core.safecrlf=false',
    source, 'source'], { cwd: cache, encoding: 'utf8', windowsHide: true });
  if (clone.status !== 0) {
    throw new Error(`git clone failed (${clone.status ?? 'spawn'}): ${(clone.stderr ?? '').trim() || 'no output'}; check network or proxy, or pass --source`);
  }
  const fetched = path.join(cache, 'source', skillPath);
  const remote = new Map(walk(fetched).map(name => [name, hash(fs.readFileSync(path.join(fetched, name)))]));
  // The mirror is compared against the published bytes, not against the local copy, so a stale
  // mirror is repaired even when the installed skill is already current.
  const mirrorFiles = mirrorRoot ? new Map(walk(mirrorRoot).map(name => [name, hash(fs.readFileSync(path.join(mirrorRoot, name)))])) : null;
  const mirrorPending = mirrorRoot ? [...remote.keys()].filter(name => mirrorFiles.get(name) !== remote.get(name)) : [];
  const mirrorKept = mirrorRoot ? [...mirrorFiles.keys()].filter(name => !remote.has(name)) : [];

  const changed = [...remote.keys()].filter(name => local.has(name) && local.get(name) !== remote.get(name));
  const added = [...remote.keys()].filter(name => !local.has(name));
  const stale = [...local.keys()].filter(name => !remote.has(name));
  const current = changed.length === 0 && added.length === 0;
  const summary = { updated: false, version, source, ref, skill_path: skillPath, skill_root: skillRoot, project,
    files: { total: remote.size, changed, added, stale_kept: stale }, mirror: null, backup: null, cache, doctor: null, note: configNote };

  /** Bring the optional second copy to the published bytes; never deletes mirror-only files. */
  const syncMirror = () => {
    if (!mirrorRoot || !mirrorPending.length) return null;
    const result = { root: mirrorRoot, updated: [...mirrorPending], kept: [...mirrorKept], backup: null, dry_run: dryRun };
    if (dryRun) return result;
    const backup = backupDirectory(project, `${version}-mirror`);
    for (const name of mirrorFiles.keys()) writeFile(path.join(backup, name), fs.readFileSync(path.join(mirrorRoot, name)));
    for (const name of mirrorPending) {
      const target = path.resolve(mirrorRoot, name);
      if (!inside(mirrorRoot, target)) throw new Error(`Refusing to write outside the mirror: ${name}`);
      writeFile(target, fs.readFileSync(path.join(fetched, name)));
    }
    result.backup = backup;
    return result;
  };
  const reportMirror = mirror => {
    if (!mirror) return;
    if (mirror.dry_run) report(`Mirror ${mirror.root}: ${mirror.updated.length} file(s) would be written.`);
    else report(`Mirror ${mirror.root}: ${mirror.updated.length} file(s) written; backup ${mirror.backup}`);
    if (mirror.kept.length) report(`Mirror keeps ${mirror.kept.length} file(s) the published copy does not ship: ${mirror.kept.join(', ')}`);
  };

  if (current) {
    report(`personal-dev-workflow ${version} is already current (${source} ${ref}); nothing changed.`);
    report(configNote);
    if (stale.length) report(`Kept ${stale.length} local file(s) the published copy no longer ships: ${stale.join(', ')}`);
    summary.mirror = syncMirror();
    reportMirror(summary.mirror);
    console.log(JSON.stringify(summary));
    return;
  }
  report(`Update available: ${changed.length} changed, ${added.length} added (${source} ${ref}).`);
  if (dryRun) {
    report('Dry run: nothing was written. Drop --dry-run to update.');
    summary.mirror = syncMirror();
    reportMirror(summary.mirror);
    console.log(JSON.stringify(summary));
    return;
  }

  const backup = backupDirectory(project, version);
  for (const name of local.keys()) writeFile(path.join(backup, name), fs.readFileSync(path.join(skillRoot, name)));
  for (const name of [...changed, ...added]) {
    const target = path.resolve(skillRoot, name);
    if (!inside(skillRoot, target)) throw new Error(`Refusing to write outside the skill: ${name}`);
    writeFile(target, fs.readFileSync(path.join(fetched, name)));
  }
  summary.updated = true;
  summary.backup = backup;
  summary.mirror = syncMirror();
  report(`Updated personal-dev-workflow ${version}: ${changed.length} changed, ${added.length} added.`);
  report(`Backup: ${backup}`);
  if (stale.length) report(`Kept ${stale.length} local file(s) the published copy no longer ships: ${stale.join(', ')}`);
  reportMirror(summary.mirror);
  report(configNote);

  const doctor = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'pdw.mjs'), 'doctor', '--project', project], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  summary.doctor = { exit_code: doctor.status, stderr: (doctor.stderr ?? '').trim() || null };
  report(doctor.status === 0 ? 'doctor: exit 0' : `doctor: exit ${doctor.status} — inspect ${backup}`);
  console.log(JSON.stringify(summary));
  if (doctor.status !== 0) process.exitCode = 1;
}

try { main(process.argv.slice(2)); }
catch (error) { console.error(`PDW update: ${error.message}`); process.exitCode = 1; }
