import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli.js';

/**
 * Card 279: `vessel effects` is the CLI-only way out of an unknown-effect block. These cases drive
 * the real dispatcher (flag parsing, exit codes, --json) against a crashed-session fixture.
 */
describe('vessel effects', () => {
  let ws: string;
  const out: string[] = [];
  const err: string[] = [];
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-cli-effects-'));
    out.length = 0; err.length = 0;
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { out.push(args.join(' ')); });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { err.push(args.join(' ')); });
  });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(ws, { recursive: true, force: true }); });

  const call = { toolCallId: 'call-9', toolName: 'Write', arguments: { path: 'a.txt' } };

  /**
   * Write the journal record a crash leaves behind: an intent with no outcome. Written as the raw
   * line the journal produces so this test does not need `@vessel/core`/`@vessel/runtime`, which the
   * CLI app does not depend on.
   */
  async function crashed(): Promise<void> {
    const dir = path.join(ws, '.harness', 'sessions', 'sess_x');
    fs.mkdirSync(dir, { recursive: true });
    const intent = {
      kind: 'intent', key: call.toolCallId, attempt: 1, effects: 'non_idempotent',
      invocation: { canonicalToolId: 'builtin:Write', subject: { sessionId: 'sess_x', runId: 'r', agentInstanceId: 'a' }, argumentsCanonicalHash: 'h', requestedScopes: [] },
    };
    fs.writeFileSync(path.join(dir, 'execution.jsonl'), `${JSON.stringify(intent)}\n`);
  }

  it('lists pending effects, resolves them, and reports an empty queue afterwards', async () => {
    await crashed();
    const code = await main(['effects', 'list', '--workspace', ws, '--json']);
    expect(code).toBe(0);
    const listed = JSON.parse(out.at(-1)!) as { sessions: Array<{ sessionId: string; pending: Array<{ key: string }> }> };
    expect(listed.sessions).toMatchObject([{ sessionId: 'sess_x', pending: [{ key: 'call-9', attempt: 1, tool: 'builtin:Write' }] }]);

    expect(await main(['effects', 'resolve', '--workspace', ws, '--session', 'sess_x', '--key', 'call-9', '--attempt', '1', '--not-applied', '--evidence', 'checked the fixture; file absent'])).toBe(0);
    expect(out.join('\n')).toContain('not_applied');
    expect(out.join('\n')).toContain('unblocked');

    expect(await main(['effects', 'list', '--workspace', ws])).toBe(0);
    expect(out.at(-1)).toContain('No pending effects');
  });

  it('rejects an ambiguous or incomplete resolve without touching the journal', async () => {
    await crashed();
    expect(await main(['effects', 'resolve', '--workspace', ws, '--session', 'sess_x', '--key', 'call-9', '--attempt', '1', '--applied', '--not-applied', '--evidence', 'x'])).toBe(2);
    expect(await main(['effects', 'resolve', '--workspace', ws, '--session', 'sess_x', '--key', 'call-9', '--attempt', '1', '--applied'])).toBe(2);
    expect(await main(['effects', 'resolve', '--workspace', ws, '--session', 'sess_x', '--key', 'nope', '--attempt', '1', '--applied', '--evidence', 'x'])).toBe(1);
    expect(err.join('\n')).toContain('no pending effect');
    expect(await main(['effects', 'list', '--workspace', ws])).toBe(0);
    expect(out.join('\n')).toContain('call-9#1');
  });

  it('rejects an unknown subcommand with usage', async () => {
    expect(await main(['effects', 'bogus', '--workspace', ws])).toBe(2);
    expect(err.join('\n')).toContain('vessel effects list');
  });
});
