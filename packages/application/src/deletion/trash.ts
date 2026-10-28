import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const DAY = 86_400_000;
const PAYLOAD = 'data';

export interface TrashMetadata {
  id: string;
  origin: string;
  kind: string;
  reason: string;
  deletedAt: string;
  /** null means retention is unlimited (TTL 0). */
  expiresAt: string | null;
  sizeBytes: number;
}
export interface TrashSkipped { id: string; reason: string }
export interface TrashList { entries: TrashMetadata[]; skipped: TrashSkipped[] }
export interface TrashResult extends TrashMetadata { sourceBackup?: { root: string; id: string } }

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function exists(target: string): boolean {
  try { fs.lstatSync(target); return true; } catch (error) {
    if (isCode(error, 'ENOENT')) return false;
    throw error;
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Check every ancestor as well: realpath alone would accept a linked root. */
function noLinks(target: string): void {
  let current = path.resolve(target);
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Linked path refused: ${current}`);
    } catch (error) {
      if (!isCode(error, 'ENOENT')) throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function checkedRoot(root: string, create = false): string {
  const absolute = path.resolve(root);
  noLinks(absolute);
  if (create) fs.mkdirSync(absolute, { recursive: true });
  if (exists(absolute)) {
    if (!fs.lstatSync(absolute).isDirectory()) throw new Error('Trash root must be a directory');
    if (path.relative(absolute, fs.realpathSync(absolute)) !== '') throw new Error('Trash root realpath mismatch');
  }
  return absolute;
}

/** A deterministic manifest proves both bytes and tree shape, and refuses all links. */
function manifest(target: string): { digest: string; sizeBytes: number } {
  noLinks(target);
  const hash = createHash('sha256');
  let sizeBytes = 0;
  function visit(current: string, name: string): void {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Linked payload refused: ${current}`);
    if (stat.isDirectory()) {
      hash.update(JSON.stringify(['directory', name]));
      for (const child of fs.readdirSync(current).sort()) visit(path.join(current, child), `${name}/${child}`);
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(current);
      sizeBytes += bytes.length;
      hash.update(JSON.stringify(['file', name, bytes.length]));
      hash.update(bytes);
    } else throw new Error(`Unsupported payload: ${current}`);
  }
  visit(target, '');
  return { digest: hash.digest('hex'), sizeBytes };
}

function ttl(value?: number): number {
  const environment = process.env.VESSEL_TRASH_TTL_DAYS;
  if (value === undefined && environment !== undefined && !/^\d+$/.test(environment)) {
    throw new Error('Trash TTL must be a non-negative integer');
  }
  const configured = value ?? (environment === undefined ? 7 : Number(environment));
  if (!Number.isSafeInteger(configured) || configured < 0) {
    throw new Error('Trash TTL must be a non-negative integer');
  }
  return configured;
}

function metadata(origin: string, kind: string, reason: string, days: number, sizeBytes: number): TrashMetadata {
  const now = new Date();
  const expiresAt = days === 0 ? null : new Date(now.getTime() + days * DAY).toISOString();
  return {
    id: `${now.toISOString().replace(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`,
    origin, kind, reason, deletedAt: now.toISOString(), expiresAt, sizeBytes,
  };
}

function prepare(root: string, entry: TrashMetadata): string {
  checkedRoot(root, true);
  const directory = path.join(root, entry.id);
  fs.mkdirSync(directory);
  // Metadata is prepared before moving the source, so no fallible write follows that move.
  fs.writeFileSync(path.join(directory, 'entry.json'), `${JSON.stringify(entry)}\n`, { flag: 'wx' });
  return directory;
}

function copyVerified(source: string, destination: string, expected: ReturnType<typeof manifest>): void {
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  const copied = manifest(destination);
  const unchanged = manifest(source);
  if (copied.digest !== expected.digest || unchanged.digest !== expected.digest || copied.sizeBytes !== expected.sizeBytes) {
    throw new Error('Trash copy verification failed');
  }
}

/**
 * Cross-volume moves retain the original in dirname(target)/.harness/trash.
 * That independently managed backup has its own metadata and TTL. Failed copies
 * may leave an incomplete entry; it is deliberately retained, never auto-purged.
 */
export function trashEntry(options: { root: string; target: string; kind: string; reason: string; ttlDays?: number }): TrashResult {
  const root = checkedRoot(options.root);
  const target = path.resolve(options.target);
  if (root === target || inside(target, root) || inside(root, target)) throw new Error('Target and trash root must not overlap');
  if (!options.kind || !options.reason) throw new Error('Trash kind and reason are required');
  const days = ttl(options.ttlDays);
  const original = manifest(target);
  const entry = metadata(target, options.kind, options.reason, days, original.sizeBytes);
  const directory = prepare(root, entry);
  const destination = path.join(directory, PAYLOAD);
  try {
    fs.renameSync(target, destination);
    return entry;
  } catch (error) {
    if (!isCode(error, 'EXDEV')) throw error;
  }
  // Keep copied data uncommitted until the source archive is ready. On failure,
  // missing entry.json prevents list/restore/purge from treating it as owned.
  fs.renameSync(path.join(directory, 'entry.json'), path.join(directory, '_pending.json'));
  copyVerified(target, destination, original);
  const backupRoot = checkedRoot(path.join(path.dirname(target), '.harness', 'trash'));
  if (backupRoot === root || inside(target, backupRoot)) throw new Error('Source backup root overlaps target');
  const backup = metadata(target, options.kind, options.reason, days, original.sizeBytes);
  const backupDirectory = prepare(backupRoot, backup);
  fs.renameSync(path.join(directory, '_pending.json'), path.join(directory, 'entry.json'));
  try {
    // Final fallible operation: failure leaves the source at its original path.
    fs.renameSync(target, path.join(backupDirectory, PAYLOAD));
  } catch (error) {
    // The verified copy remains recoverable but is not a committed trash entry.
    fs.renameSync(path.join(directory, 'entry.json'), path.join(directory, '_pending.json'));
    throw error;
  }
  return { ...entry, sourceBackup: { root: backupRoot, id: backup.id } };
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function readEntry(root: string, id: string): TrashMetadata {
  if (!id || id === '.' || id === '..' || /[/\\:]/.test(id) || path.basename(id) !== id) throw new Error('Invalid trash id');
  const directory = path.join(root, id);
  noLinks(directory);
  if (!fs.lstatSync(directory).isDirectory() || !inside(root, fs.realpathSync(directory))) throw new Error('Entry escapes trash root');
  const file = path.join(directory, 'entry.json');
  noLinks(file);
  if (!fs.lstatSync(file).isFile()) throw new Error('Missing entry.json');
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof value !== 'object' || value === null) throw new Error('Invalid entry metadata');
  const entry = value as Record<string, unknown>;
  if (entry.id !== id || typeof entry.origin !== 'string' || !path.isAbsolute(entry.origin) ||
      typeof entry.kind !== 'string' || !entry.kind || typeof entry.reason !== 'string' || !entry.reason ||
      !validDate(entry.deletedAt) || !(entry.expiresAt === null || validDate(entry.expiresAt)) ||
      (typeof entry.expiresAt === 'string' && Date.parse(entry.expiresAt) < Date.parse(entry.deletedAt)) ||
      typeof entry.sizeBytes !== 'number' || !Number.isSafeInteger(entry.sizeBytes) || entry.sizeBytes < 0 ||
      inside(root, path.resolve(entry.origin)) || path.resolve(entry.origin) === root) throw new Error('Invalid entry metadata');
  // Reject unexpected files too, including nested links not traversed by rm.
  for (const name of fs.readdirSync(directory)) {
    if (name !== 'entry.json' && name !== PAYLOAD) throw new Error('Unexpected entry contents');
  }
  const actual = manifest(path.join(directory, PAYLOAD));
  if (actual.sizeBytes !== entry.sizeBytes) throw new Error('Entry size mismatch');
  return {
    id, origin: entry.origin, kind: entry.kind, reason: entry.reason,
    deletedAt: entry.deletedAt, expiresAt: entry.expiresAt, sizeBytes: entry.sizeBytes,
  };
}

export function list(options: { root: string }): TrashList {
  const root = checkedRoot(options.root);
  const result: TrashList = { entries: [], skipped: [] };
  if (!exists(root)) return result;
  for (const id of fs.readdirSync(root).sort()) {
    if (id === '_purge.jsonl') continue;
    try { result.entries.push(readEntry(root, id)); }
    catch (error) { result.skipped.push({ id, reason: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}

export function restore(options: { root: string; id: string }): TrashMetadata {
  const root = checkedRoot(options.root);
  const entry = readEntry(root, options.id);
  // Session restores may only recreate the session layout, never arbitrary
  // directories named by otherwise structurally valid, editable metadata.
  const parent = path.dirname(entry.origin);
  if (entry.kind === 'session' && (path.basename(parent) !== 'sessions' || path.basename(path.dirname(parent)) !== '.harness')) {
    throw new Error('Invalid session restore destination');
  }
  noLinks(entry.origin);
  if (exists(entry.origin)) throw new Error('Restore destination already exists');
  const source = path.join(root, entry.id, PAYLOAD);
  fs.mkdirSync(path.dirname(entry.origin), { recursive: true });
  try { fs.renameSync(source, entry.origin); }
  catch (error) {
    if (!isCode(error, 'EXDEV')) throw error;
    // Preserve the canonical trash copy on EXDEV; publish only a verified copy.
    const temporary = path.join(path.dirname(entry.origin), `.vessel-restore-${randomUUID()}`);
    copyVerified(source, temporary, manifest(source));
    if (exists(entry.origin)) throw new Error('Restore destination already exists');
    fs.renameSync(temporary, entry.origin);
  }
  // ponytail: an empty metadata directory is harmless and deliberately retained;
  // no cleanup can turn a successful restoration into a reported failure.
  return entry;
}

export interface PurgeResult extends TrashList { purged: TrashMetadata[] }

export function purge(options: { root: string; dryRun?: boolean; olderThanDays?: number; now?: Date }): PurgeResult {
  const root = checkedRoot(options.root);
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid purge time');
  if (options.olderThanDays !== undefined && (!Number.isSafeInteger(options.olderThanDays) || options.olderThanDays < 0)) {
    throw new Error('olderThanDays must be a non-negative integer');
  }
  const found = list({ root });
  const eligible = found.entries.filter(entry => entry.expiresAt !== null && Date.parse(entry.expiresAt) <= now.getTime() &&
    (options.olderThanDays === undefined || Date.parse(entry.deletedAt) + options.olderThanDays * DAY <= now.getTime()));
  const result: PurgeResult = { entries: eligible, purged: [], skipped: found.skipped };
  if (options.dryRun || !exists(root)) return result;
  const audit = path.join(root, '_purge.jsonl');
  noLinks(audit);
  if (exists(audit) && !fs.lstatSync(audit).isFile()) throw new Error('Invalid purge audit file');
  const record = (entry: TrashMetadata, ok: boolean, reason?: string): void => {
    noLinks(audit);
    fs.appendFileSync(audit, `${JSON.stringify({ ts: now.toISOString(), id: entry.id, origin: entry.origin, bytes: entry.sizeBytes, ok, ...(reason ? { reason } : {}) })}\n`, { flag: 'a' });
  };
  for (const entry of eligible) {
    // Audit failure aborts before deletion. Revalidate immediately before rm.
    record(entry, false, 'retention/purge:pending');
    try {
      readEntry(root, entry.id);
      fs.rmSync(path.join(root, entry.id), { recursive: true });
      result.purged.push(entry);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result.skipped.push({ id: entry.id, reason });
      record(entry, false, reason);
      continue;
    }
    record(entry, true);
  }
  return result;
}
