import path from 'node:path';
import { SessionRegistry, trashStore } from '@vessel/application';

const usage = 'Usage: vessel trash list [--json] | restore <id> | purge [--dry-run] [--older-than <days>] [--json] (all accept --root <path>)';

export function trashCommand(args: string[], flags = new Map<string, string>()): number {
  const [sub, id] = args;
  const allowed = sub === 'list' ? ['root', 'json'] : sub === 'restore' ? ['root'] : ['root', 'json', 'dry-run', 'older-than'];
  if (!['list', 'restore', 'purge'].includes(sub ?? '') || args.length !== (sub === 'restore' ? 2 : 1) ||
      [...flags.keys()].some(key => !allowed.includes(key)) || flags.get('root') === 'true' ||
      (flags.has('older-than') && !/^\d+$/.test(flags.get('older-than')!))) {
    if (flags.has('json')) console.log(JSON.stringify({ error: 'Invalid trash command or options' }));
    else console.error(usage);
    return 2;
  }
  const root = path.resolve(flags.get('root') ?? process.env.VESSEL_TRASH_ROOT ?? path.join(process.cwd(), '.harness', 'trash'));
  try {
    if (sub === 'restore') {
      const entry = trashStore.restore({ root, id: id! });
      if (entry.kind === 'session') {
        try {
          const sessionId = path.basename(entry.origin);
          const workspaceRoot = path.dirname(path.dirname(path.dirname(entry.origin)));
          new SessionRegistry().restoreRemoved(sessionId, workspaceRoot);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Trash: Directory restored to ${entry.origin}, but session registration failed: ${message}. ` +
            'Do not repeat trash restore. Verify VESSEL_SESSION_ROOT points to the original registry and retain the restored directory; ' +
            'inspect sessions.metadata.jsonl there before retrying registration. vessel sessions list does not rebuild missing metadata.');
          return 1;
        }
        console.log(`Restored ${entry.id} to ${entry.origin}; session registered for vessel sessions list.`);
        return 0;
      }
      console.log(`Restored ${entry.id} to ${entry.origin}`);
    } else if (sub === 'list') {
      const result = trashStore.list({ root });
      if (flags.has('json')) console.log(JSON.stringify(result));
      else console.log(result.entries.length ? ['ID\tORIGIN\tDELETED\tEXPIRES', ...result.entries.map(e => `${e.id}\t${e.origin}\t${e.deletedAt}\t${e.expiresAt ?? 'never'}`)].join('\n') : 'Trash is empty.');
      if (!flags.has('json') && result.skipped.length) console.error(`Skipped ${result.skipped.length} invalid entries.`);
    } else {
      const result = trashStore.purge({ root, dryRun: flags.has('dry-run'), olderThanDays: flags.has('older-than') ? Number(flags.get('older-than')) : undefined });
      if (flags.has('json')) console.log(JSON.stringify(result));
      else console.log(flags.has('dry-run') ? `Eligible: ${result.entries.length}` : `Purged: ${result.purged.length}`);
      if (!flags.has('json') && result.skipped.length) console.error(`Skipped ${result.skipped.length} entries.`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (flags.has('json')) console.log(JSON.stringify({ error: message }));
    else console.error(`Trash: ${message}`);
    return 1;
  }
}
