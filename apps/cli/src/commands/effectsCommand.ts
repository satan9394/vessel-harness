import path from 'node:path';
import { listSessionEffects, resolveSessionEffect } from '@vessel/application';

/**
 * Operator surface for unknown effects (card 279).
 *
 * `EffectJournal` blocks every later write once a dispatch's completion is genuinely unknown
 * (process killed mid-flight, tool threw). Until this command existed the only way to clear that
 * was `POST /api/sessions/:id/effects`, so anyone driving the CLI had no way out at all.
 *
 * This is not a model tool and not an approval shortcut: it writes one operator receipt
 * (`applied` / `not_applied` + evidence) and the same `audit/effect_reconciled` record the HTTP
 * path writes. The old invocation still cannot be replayed.
 */
const USAGE = [
  'Usage:',
  '  vessel effects list [--session <id>] [--workspace <dir>]',
  '  vessel effects resolve --session <id> --key <key> --attempt <n> (--applied|--not-applied) --evidence "<what you checked>" [--workspace <dir>]',
].join('\n');

export async function effectsCommand(
  args: string[],
  options: { workspaceRoot?: string; json?: boolean; flags?: Map<string, string> } = {},
): Promise<number> {
  const sub = args[0];
  const workspace = path.resolve(options.workspaceRoot ?? process.cwd());
  const flags = options.flags ?? new Map<string, string>();

  if (sub === 'list') {
    const sessions = listSessionEffects(workspace, flags.get('session'));
    if (options.json) { console.log(JSON.stringify({ workspace, sessions }, null, 2)); return 0; }
    if (sessions.length === 0) { console.log(`No pending effects in ${workspace}.`); return 0; }
    for (const session of sessions) {
      console.log(`${session.sessionId}`);
      for (const effect of session.pending) {
        console.log(`  ${effect.key}#${effect.attempt}  ${effect.effects}  ${effect.tool}`);
      }
    }
    console.log('\nResolve with: vessel effects resolve --session <id> --key <key> --attempt <n> --applied|--not-applied --evidence "<what you checked>"');
    return 0;
  }

  if (sub === 'resolve') {
    const sessionId = flags.get('session');
    const key = flags.get('key');
    const attempt = Number(flags.get('attempt'));
    const evidence = flags.get('evidence');
    const notApplied = flags.has('not-applied');
    const applied = flags.has('applied');
    if (!sessionId || !key || !Number.isSafeInteger(attempt) || attempt < 1 || !evidence?.trim() || applied === notApplied) {
      console.error(USAGE);
      if (options.json) console.log(JSON.stringify({ error: 'usage' }));
      return 2;
    }
    try {
      const result = await resolveSessionEffect(workspace, {
        sessionId, key, attempt,
        resolution: notApplied ? 'not_applied' : 'applied',
        evidence,
      });
      if (options.json) { console.log(JSON.stringify(result, null, 2)); return 0; }
      console.log(`Resolved ${result.resolved.tool} ${result.resolved.key}#${result.resolved.attempt} as ${notApplied ? 'not_applied' : 'applied'}.`);
      console.log(result.pending.length === 0
        ? 'No pending effects remain in this session; writes are unblocked.'
        : `${result.pending.length} effect(s) still pending in this session.`);
      return 0;
    } catch (error) {
      const message = (error as Error).message;
      if (options.json) { console.log(JSON.stringify({ error: message })); return 1; }
      console.error(`Cannot resolve effect: ${message}`);
      if (/lease|already open/i.test(message)) console.error('Stop the process that owns this session (a running `vessel serve`/`vessel web`) and retry, or resolve it over HTTP while it is running.');
      return 1;
    }
  }

  console.error(USAGE);
  if (options.json) console.log(JSON.stringify({ error: 'usage' }));
  return 2;
}
