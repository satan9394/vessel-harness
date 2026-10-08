import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { Session } from '@vessel/core';
import { TripartitePrefixBuilder } from './TripartitePrefixBuilder.js';
import { ContextBuilder } from './Builder.js';
import { Compaction } from '../compaction/Compaction.js';

it('keeps stable bytes and hash independent of scoped and volatile inputs', () => {
  const builder = new TripartitePrefixBuilder();
  const options = { coreRoleInstructions: 'role', architectureConstraints: ['thin core'], toolSchemas: [{ name: 'Read', description: 'read', parameters: { z: 1, a: { y: 2, x: 1 } } }], projectRules: 'rules', reflectiveLessons: ['lesson'], ephemeralContext: 'tool output' };
  const first = builder.build(options);
  const second = builder.build({ ...options, projectRules: 'changed', reflectiveLessons: ['new lesson'], ephemeralContext: 'changed output', toolSchemas: [{ ...options.toolSchemas[0]!, parameters: { a: { x: 1, y: 2 }, z: 1 } }] });
  expect(first.stablePrefix).toBe(second.stablePrefix); expect(first.prefixByteHash).toBe(second.prefixByteHash);
  expect(first.prefixByteHash).toBe(createHash('sha256').update(first.stablePrefix).digest('hex'));
  expect(first.fullPrompt).toBe([first.stablePrefix, first.scopedPrefix, first.volatileSuffix].join('\n\n'));
  expect(first.scopedPrefix).toBe('rules\n\nlesson');
});

it('actual context requests place scoped user data before history and volatile data after tool results', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-prefix-'));
  const session = await Session.open({ workspaceRoot: root, sessionId: 'prefix' });
  try {
    let ephemeral = 'first environment'; let lesson = 'first lesson';
    const builder = new ContextBuilder({ session, model: 'm', stableSections: () => ['stable'], policyGuidance: () => ['policy'],
      instructions: () => [{ sourcePath: 'AGENTS.md', content: 'project rule', scope: 'project' }], getVisibleTools: () => [], volatileText: () => ephemeral,
      reflectiveRules: async () => [{ triggerCondition: 'goal', lesson, recommendedAction: 'action' }] });
    await session.appendSync({ type: 'user/message', msgId: 'u', role: 'user', content: 'goal', surface: true });
    const first = await builder.assemble(1);
    await session.appendSync({ type: 'assistant/attempt', msgId: 'a', role: 'assistant', content: '', toolCalls: [{ toolCallId: 't', name: 'Read', arguments: {} }], attemptNo: 1, surface: false });
    await session.appendSync({ type: 'tool/result', toolCallId: 't', toolName: 'Read', content: 'dynamic output', meta: {}, surface: true });
    ephemeral = 'new environment'; lesson = 'new lesson';
    const second = await builder.assemble(2);
    expect(first.prefixLayout.prefixByteHash).toBe(second.prefixLayout.prefixByteHash);
    expect(second.messages[0]!.content).not.toContain('new lesson');
    expect(second.messages.findIndex(message => message.source === 'instruction')).toBeLessThan(second.messages.findIndex(message => message.content === 'goal'));
    const toolIndex = second.messages.findIndex(message => message.role === 'tool');
    expect(second.messages[toolIndex - 1]!.toolCalls?.[0]!.id).toBe('t');
    expect(second.messages.at(-1)!.content).toContain('new environment');
    expect(second.prefixLayout.volatileSuffix).toContain('dynamic output');
    expect(second.prefixLayout.scopedPrefix).toBe(first.prefixLayout.scopedPrefix);
    await new Compaction({ session, summarize: async () => 'summary' }).compact('manual');
    const compacted = await builder.assemble(1);
    expect(compacted.messages.some(message => message.content.includes('project rule'))).toBe(true);
  } finally { await session.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
