import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { HybridMemoryStore } from '@vessel/memory';
import { memoryCommand, memoryDatabasePath } from './memoryCommand.js';
import { main } from '../cli.js';

afterEach(() => vi.restoreAllMocks());
it('lists filtered rules, recalls persisted rules with RRF and reports frequencies and embedding dimensions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-cli-')); const store = new HybridMemoryStore(memoryDatabasePath(root));
  const rule = { category: 'tool_failure' as const, triggerCondition: 'shell EBUSY', lesson: 'Transient file lock', recommendedAction: 'Check retry safety' };
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await store.upsertReflectiveRule(rule); await store.upsertReflectiveRule(rule);
    await store.upsertReflectiveRule({ ...rule, category: 'policy_denial', triggerCondition: 'write denied' });
    expect(await memoryCommand(['rules'], new Map([['json', 'true'], ['category', 'tool_failure'], ['limit', '1']]), store)).toBe(0);
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toHaveLength(1);
    await memoryCommand(['search', 'EBUSY'], new Map([['json', 'true']]), store);
    expect(JSON.parse(log.mock.calls.at(-1)![0])[0].rrfScore).toBeGreaterThan(0);
    await memoryCommand(['stats'], new Map([['json', 'true']]), store);
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ ruleCount: 2, categories: { tool_failure: 2, policy_denial: 1 }, vectorDimensions: [] });
  } finally { await store.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
it('validates query/category/limits and does not create memory for an empty workspace', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await memoryCommand(['search'])).toBe(2);
  expect(await memoryCommand(['rules'], new Map([['limit', '0']]))).toBe(2);
  expect(await memoryCommand(['rules'], new Map([['category', 'bad']]))).toBe(2);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-empty-'));
  try {
    expect(await memoryCommand(['stats'], new Map([['workspace', root]]))).toBe(0); expect(fs.existsSync(memoryDatabasePath(root))).toBe(false);
    expect(await main(['memory', 'stats', '--workspace', root])).toBe(0); expect(await main(['mem', 'rules', '--workspace', root])).toBe(0);
  }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
});
