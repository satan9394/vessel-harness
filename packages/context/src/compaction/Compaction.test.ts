import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Session } from '@vessel/core';
import { projectSession } from '@vessel/shared';
import { Compaction } from './Compaction.js';
import { assertCompactionConservation } from './assertCompactionConservation.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it.each(['user/message', 'assistant/message', 'assistant/attempt', 'tool/result'] as const)(
  'conserves summary and tail keepIDs through reload and repeated compaction (%s)', async type => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-keepid-'));
    roots.push(root);
    let session = await Session.open({ workspaceRoot: root, sessionId: 'keepid' });
    try {
      await session.appendSync({ type: 'user/message', content: 'goal', metadata: { keepID: 'keep-0' } });
      await session.appendSync({ type: 'assistant/message', content: 'ESSENTIAL_ANCHOR', metadata: { keepId: 'assistant-anchor', keepIds: ['alias', 'keep-0', 42] } });
      for (let i = 0; i < 12; i++) await session.appendSync({ type: 'user/message', content: `filler-${i}` });
      if (type === 'tool/result') await session.appendSync({ type: 'assistant/attempt', content: 'call', toolCalls: [{ toolCallId: 'call', name: 'read', args: {} }] });
      await session.appendSync({ type, content: 'TAIL_ANCHOR', id: 'tail-message', toolCalls: [], toolCallId: 'call', metadata: { keepID: 'tail', keepId: 'tail-alias', keepIds: ['tail-array'], extra: 'retained' } });
      const compact = () => new Compaction({ session, summarize: async () => 'unrelated summary' }).compact('manual');
      const first = await compact();
      expect(first.summary).toContain('keep-0');
      expect(first.summary).toContain('ESSENTIAL_ANCHOR');
      const tail = projectSession(session.sessionId, session.replay()).visibleMessages.find(r => r.id === 'tail-message');
      expect(tail?.metadata).toEqual({ keepID: 'tail', keepId: 'tail-alias', keepIds: ['tail-array'], extra: 'retained' });
      await session.close();
      session = await Session.open({ workspaceRoot: root, sessionId: 'keepid' });
      const assertAnchors = () => {
        const projection = projectSession(session.sessionId, session.replay());
        assertCompactionConservation({ originalMessages: [{ role: 'assistant', content: 'ESSENTIAL_ANCHOR', metadata: { keepId: 'assistant-anchor' } }],
          compactedMessages: projection.visibleMessages.filter(r => typeof r.content === 'string').map(r => ({ role: 'user', content: r.content, metadata: r.metadata as Record<string, unknown> })),
          requiredKeepIds: ['keep-0', 'assistant-anchor', 'alias', 'tail', 'tail-alias', 'tail-array'] });
      };
      assertAnchors();
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 8; i++) await session.appendSync({ type: 'user/message', content: `next-${round}-${i}` });
        await compact();
        assertAnchors();
      }
    } finally { await session.close(); }
  },
);
