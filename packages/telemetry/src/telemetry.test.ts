import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus, Session } from '@vessel/core';
import { Telemetry } from './Telemetry.js';

describe('telemetry — event subscriber + JSONL report', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tel-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('counts turns/steps/denials from bus events and session replay', async () => {
    const session = await Session.open({ workspaceRoot: dir, sessionId: 't1' });
    const bus = new EventBus();
    const tel = new Telemetry();
    tel.attach(bus);

    await bus.emit('before_turn', {});
    await bus.emit('after_model', { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 } });
    await bus.emit('after_model', { usage: { inputTokens: 50, outputTokens: 10 } });
    await bus.emit('policy_decision', { verdict: 'deny' });
    await session.appendSync({ type: 'audit/denial', toolCallId: 'tc1', toolName: 'Shell', stage: 'rule', reason: 'rm -rf', sandboxMode: 'x', surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 'tc2', toolName: 'Read', error: { errorClass: 'INVALID_ARGS', message: 'bad' }, meta: {}, surface: true });

    const c = tel.finalize(session);
    expect(c.turns).toBe(1);
    expect(c.steps).toBe(2);
    expect(c.inputTokens).toBe(150);
    expect(c.outputTokens).toBe(30);
    expect(c.cacheReadTokens).toBe(30);
    expect(c.denials).toBe(2); // 1 from event + 1 from replay record
    expect(c.invalidArgs).toBe(1);

    const metrics = tel.metrics({ durationMs: 123 });
    const m12 = metrics.find((m) => m.metric === 'M12');
    expect(m12?.value).toBe(2);
    const m10 = metrics.find((m) => m.metric === 'M10');
    expect(m10?.value).toBe(123);

    const lines = tel.reportLines({
      runId: 'run_1', scenarioId: 'B001', harness: 'ours', mode: 'offline', ts: '2026-01-01T00:00:00Z',
      metrics, events: [{ kind: 'tool/call', payload: { toolName: 'Read' } }], asserts: [], env: { model: 'm' },
    });
    expect(lines[0]!.type).toBe('meta');
    expect(lines.filter((l) => l.type === 'metric').length).toBeGreaterThan(0);
    expect(lines.some((l) => l.type === 'event')).toBe(true);
    tel.detach();
    await session.close();
  });
});
