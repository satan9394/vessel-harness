import * as path from 'node:path';
import * as fs from 'node:fs';
import { HybridMemoryStore, type ReflectiveRule } from '@vessel/memory';

export function memoryDatabasePath(workspace = process.cwd()): string { return path.join(path.resolve(workspace), '.harness', 'cache', 'session_index.db'); }
export async function memoryCommand(args: string[], flags = new Map<string, string>(), injected?: HybridMemoryStore): Promise<number> {
  const sub = args[0] ?? 'rules';
  const limit = Number(flags.get('limit') ?? 20); const category = flags.get('category');
  if (!['rules', 'search', 'stats'].includes(sub) || sub === 'search' && !args.slice(1).join(' ').trim() || sub !== 'search' && args.length > 1 ||
    !Number.isInteger(limit) || limit < 1 || limit > 1000 || category !== undefined && !['policy_denial', 'tool_failure', 'architecture_constraint'].includes(category)) {
    console.error('Usage: vessel memory rules [--limit 20] [--category policy_denial|tool_failure|architecture_constraint] | search <query> | stats'); return 2;
  }
  let store = injected;
  try {
    const file = memoryDatabasePath(flags.get('workspace'));
    // ponytail: querying a workspace with no memory does not create a new database.
    if (!store && !fs.existsSync(file)) { console.log(flags.has('json') ? JSON.stringify({ empty: true }) : 'No workspace memory yet.'); return 0; }
    store ??= new HybridMemoryStore(file);
    const result = sub === 'rules' ? await store.listReflectiveRules(limit, category as ReflectiveRule['category'] | undefined)
      : sub === 'search' ? await store.searchHybrid({ query: args.slice(1).join(' '), limit }) : await store.memoryStats();
    console.log(flags.has('json') ? JSON.stringify(result) : sub === 'rules'
      ? (result as ReflectiveRule[]).map(rule => `${rule.category} | ${rule.triggerCondition} | frequency ${rule.frequency}\n${rule.lesson}\nAction: ${rule.recommendedAction}`).join('\n\n') || 'No reflective rules.'
      : JSON.stringify(result, null, 2));
    return 0;
  } catch { console.error('Memory query failed; run vessel doctor for database diagnostics.'); return 1; }
  finally { if (!injected) await store?.close(); }
}
