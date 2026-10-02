import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { AgentLoop, ChunkedSession, EventBus, Session } from '@vessel/core';
import { Compaction, ContextBuilder, createOverflowRecovery } from '@vessel/context';
import { TeamDagScheduler, resolveRoster, createDefaultPresetRegistry } from '@vessel/agents';
import type { ChatProvider, SessionRecord } from '@vessel/shared';
import type { ResilienceEvidence } from './metrics.js';

export const RESILIENCE_FACTS = Object.freeze(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`F${i}`, `value${i}`])));
export const recordHash = (record: SessionRecord): string => createHash('sha256').update(JSON.stringify(record)).digest('hex');
const extractFacts = (text: string): Record<string, string> => Object.fromEntries([...text.matchAll(/\b(F\d+)=(value\d+)\b/g)].map(match => [match[1]!, match[2]!]));

export interface ResilienceScenarioOptions {
  /** Caller-owned isolated fixture root. No user state or machine agents are used. */
  root: string;
  cleanupUnresponsiveMcp: () => Promise<{ cleanupMs: number; orphanProcessCount: number }>;
  retireArtifact: (file: string) => Promise<void>;
}

/** Deterministic generator lane. Evaluation is separate and sees only evidence. */
export async function runLongSessionResilience(options: ResilienceScenarioOptions): Promise<ResilienceEvidence> {
  const archiveDir = path.join(options.root, 'archive');
  const workspace = path.join(options.root, 'workspace');
  const scratch = path.join(workspace, 'scratch');
  await fs.mkdir(scratch, { recursive: true });
  const evidence: ResilienceEvidence = { rounds: [], expectedRecordHashes: [], replayedRecordHashes: [], replayedSequences: [],
    injectedTokens: 0, overflowInterceptedCount: 0, overflowAttempts: 0, pressureCompactions: 0,
    mcpCleanupMs: Number.POSITIVE_INFINITY, reopenCount: 0, orphanProcessCount: 0, workspaceResidueCount: 0 };
  let archive = await ChunkedSession.open({ dir: archiveDir, maxChunkBytes: 128 * 1024 });
  let session = await Session.open({ workspaceRoot: workspace, sessionId: 'resilience' });
  const bus = new EventBus();
  bus.on('compaction:overflow_intercepted', () => { evidence.overflowInterceptedCount++; });
  let round = 0;
  let overflowInjected = false;
  const provider: ChatProvider = { id: 'offline-blind-generator', chat: async request => {
    if (round === 30 && !request.messages.some(message => message.role === 'tool' && message.content.startsWith(`ROUND:${round}:`))) {
      evidence.overflowAttempts++;
      if (!overflowInjected) { overflowInjected = true; throw new Error('HTTP 400 maximum context length is 150000 tokens'); }
    }
    const usage = { inputTokens: Math.ceil(JSON.stringify(request.messages).length / 4), outputTokens: 1 };
    const toolsDone = ['A', 'B'].every(branch => request.messages.some(message => message.role === 'tool' && message.content.startsWith(`ROUND:${round}:${branch}`)));
    if (!toolsDone) return { content: '', toolCalls: ['A', 'B'].map(branch => ({ id: `call-${round}-${branch}`, name: 'noise', arguments: { branch } })), finishReason: 'tool_calls', usage };
    const facts = extractFacts(request.messages.map(message => message.content).join('\n'));
    return { content: Object.entries(facts).map(([key, value]) => `${key}=${value}`).join(' '), toolCalls: [], finishReason: 'stop', usage };
  } };
  const mirror = (): void => {
    const append = session.append.bind(session);
    session.append = async record => {
      const full = await append(record);
      const durable = await archive.append({ ...full, originalSeq: full.seq });
      evidence.expectedRecordHashes.push(recordHash(durable));
      return full;
    };
  };
  const buildLoop = (): AgentLoop => {
    mirror();
    const builder = new ContextBuilder({ session, model: 'offline', contextWindow: 50_000,
      stableSections: () => [], policyGuidance: () => [], instructions: () => [], getVisibleTools: () => [] });
    const compaction = new Compaction({ session, adaptive: { maxOutputTokens: 1024, safetyBufferTokens: 1024 },
      // ponytail: deterministic summarizer preserves identified facts, without a model call.
      summarize: async text => Object.entries(extractFacts(text)).map(([key, value]) => `${key}=${value}`).join(' ') });
    return new AgentLoop({ session, bus, model: 'offline', provider,
      buildContext: async step => {
        let envelope = await builder.assemble(step);
        if (compaction.shouldCompact(envelope.estimateTokens, builder.window)) {
          evidence.pressureCompactions++; await compaction.compact('pressure'); envelope = await builder.assemble(step);
        }
        return { ...envelope, maxOutputTokens: 1024 };
      },
      modelErrorRecovery: createOverflowRecovery({ session, bus, builder, compaction, maxOutputTokens: 1024 }),
      getVisibleTools: () => [], maxSteps: 4,
      runTool: async call => {
        const branch = String(call.arguments.branch);
        const content = `ROUND:${round}:${branch}\n${'x'.repeat(12_288)}`;
        evidence.injectedTokens += Math.floor(content.length / 4);
        // The owner chooses cleanup: tests may remove their own os.tmpdir files;
        // user workspaces must use their recycle-bin adapter.
        const file = path.join(scratch, `${round}-${branch}.txt`);
        await fs.writeFile(file, content);
        await options.retireArtifact(file);
        return { content, meta: {} };
      } });
  };
  let loop = buildLoop();
  const dag = new TeamDagScheduler({ id: '100-round-resilience', status: 'approved', createdAt: 0,
    roster: resolveRoster([{ memberId: 'generator', presetId: 'developer', model: 'offline', providerId: provider.id },
      { memberId: 'evaluator', presetId: 'reviewer', model: 'offline', providerId: provider.id }], createDefaultPresetRegistry()),
    tasks: Array.from({ length: 100 }, (_, i) => ({ id: `round-${i + 1}`, title: 'round', description: 'offline resilience',
      assignedRole: 'generator' as const, dependencies: i === 0 ? [] : [`round-${i}`], status: 'pending' as const })) }, bus);
  try {
    await session.appendSync({ type: 'user/message', msgId: 'facts', role: 'user', content: Object.entries(RESILIENCE_FACTS).map(([key, value]) => `${key}=${value}`).join(' '), surface: true });
    for (round = 1; round <= 100; round++) {
      dag.evaluateReadiness(); dag.claimTask(`round-${round}`, 'generator'); dag.startTask(`round-${round}`);
      const turn = await loop.runTurn(`Probe round ${round}; use two branches and preserve remembered facts.`);
      evidence.rounds.push({ round, facts: extractFacts(turn.finalText), completed: turn.kind === 'success' });
      await dag.settleTask(`round-${round}`, { output: turn.finalText, artifacts: [] });
      await archive.flush();
      if (round === 60) {
        const cleanup = await options.cleanupUnresponsiveMcp();
        evidence.mcpCleanupMs = cleanup.cleanupMs; evidence.orphanProcessCount = cleanup.orphanProcessCount;
      }
      if (round === 90) {
        // Abrupt storage-producer loss: the unflushed record must never enter replay.
        await archive.append({ type: 'user/message', msgId: 'uncommitted', role: 'user', content: 'lost volatile tail', surface: true });
        await archive.interrupt(); await session.close();
        archive = await ChunkedSession.open({ dir: archiveDir, maxChunkBytes: 128 * 1024 });
        session = await Session.open({ workspaceRoot: workspace, sessionId: 'resilience' });
        loop = buildLoop(); evidence.reopenCount++;
      }
    }
    await archive.close();
    for await (const record of archive.streamRecords()) {
      evidence.replayedRecordHashes.push(recordHash(record)); evidence.replayedSequences.push(record.seq);
    }
    evidence.workspaceResidueCount = (await fs.readdir(scratch)).length;
    return evidence;
  } finally { await archive.close(); await session.close(); }
}
