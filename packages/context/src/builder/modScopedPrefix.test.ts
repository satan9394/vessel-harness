import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { Session } from '@vessel/core';
import { ContextBuilder } from './Builder.js';
import { Compaction } from '../compaction/Compaction.js';

it('frozen appendix occupies scoped tail in real requests across volatile turns and compaction', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-prefix-')); const session = await Session.open({ workspaceRoot: root });
  try {
    let volatile = 'one';
    const builder = new ContextBuilder({ session, model: 'mock', stableSections: () => ['stable'], policyGuidance: () => ['policy'], instructions: () => [{ sourcePath: 'AGENTS.md', content: 'rules', scope: 'project' }], getVisibleTools: () => [], volatileText: () => volatile, scopedAppendix: '[Mod: example]\nfixed bytes' });
    await session.appendSync({ type: 'user/message', msgId: 'u', role: 'user', content: 'task', surface: true });
    const first = await builder.assemble(1); volatile = 'two'; const second = await builder.assemble(2);
    expect(first.prefixLayout.stablePrefix).toBe(second.prefixLayout.stablePrefix);
    expect(first.prefixLayout.scopedPrefix).toBe(second.prefixLayout.scopedPrefix);
    expect(first.prefixLayout.scopedPrefix.endsWith('[Mod: example]\nfixed bytes')).toBe(true);
    expect(second.prefixLayout.volatileSuffix).not.toBe(first.prefixLayout.volatileSuffix);
    expect(second.messages.findIndex(m => m.content === '[Mod: example]\nfixed bytes')).toBeLessThan(second.messages.findIndex(m => m.content === 'task'));
    await new Compaction({ session, summarize: async () => 'summary' }).compact('manual');
    expect((await builder.assemble(1)).prefixLayout.scopedPrefix).toBe(first.prefixLayout.scopedPrefix);
  } finally { await session.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
