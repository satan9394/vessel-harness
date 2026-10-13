import * as crypto from 'node:crypto';
import { COMPACTION_RETAIN_RATIO, projectSession, markProjectionPublicationUncertain, type SessionRecord, type ConservationMessage } from '@vessel/shared';
import { Session } from '@vessel/core';
import { computeAdaptiveThreshold, type AdaptiveCompactionOptions } from './adaptiveThreshold.js';
import { CompactionBoundaryGuard } from './CompactionBoundaryGuard.js';
import { assertCompactionConservation } from './assertCompactionConservation.js';

const leases = new WeakSet<Session>();

export type CompactionTrigger = 'pressure' | 'overflow' | 'manual';

export interface CompactionResult {
  trigger: CompactionTrigger;
  removedRecords: number;
  replacedSeq: { from: number; to: number };
  summary: string;
}

export interface CompactionDeps {
  session: Session;
  /** summarizer — default heuristic fallback when no LLM configured */
  summarize?: (regionText: string, context: { userRequest: string }) => Promise<string>;
  adaptive?: Omit<AdaptiveCompactionOptions, 'contextWindow'>;
}

/**
 * Default heuristic summarizer (Claw-style fallback): keeps the user request,
 * file paths touched, and a truncated tail of the region.
 */
async function heuristicSummarize(regionText: string, context: { userRequest: string }): Promise<string> {
  const lines = regionText.split('\n').filter((l) => l.trim());
  const head = lines.slice(0, 40).join('\n');
  const tail = lines.slice(-20).join('\n');
  const pathHints = [...new Set((regionText.match(/(?:path|file)[:=]\s*["']?([^"'\n,}]+)/gi) ?? []).slice(0, 8))];
  return [
    `用户请求：${context.userRequest.slice(0, 500)}`,
    pathHints.length ? `涉及路径：${pathHints.join('; ')}` : '',
    `<已压缩区域的头部摘要>\n${head.slice(0, 1500)}`,
    `<已压缩区域的尾部摘要>\n${tail.slice(0, 800)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * context/compaction — Basic Compaction (ARCHITECTURE §2.4 / D3 decision point 6).
 * Transactional: compaction/start (lock first) → validated summary → appended
 * projection commit of the oldest BALANCED region (physical history stays intact).
 * Tail kept verbatim per retainRatio 0.16. Same session log (not_new_session).
 */
export class Compaction {
  private readonly summarize: NonNullable<CompactionDeps['summarize']>;
  private compacting = false;

  constructor(private readonly deps: CompactionDeps) {
    this.summarize = deps.summarize ?? heuristicSummarize;
  }

  shouldCompact(estimateTokens: number, contextWindow: number): boolean {
    return estimateTokens >= computeAdaptiveThreshold({ contextWindow, maxOutputTokens: 4096, ...this.deps.adaptive });
  }

  async compact(trigger: CompactionTrigger): Promise<CompactionResult> {
    if (this.compacting || leases.has(this.deps.session)) {
      throw new Error('compaction already in progress (transaction lock)');
    }
    this.compacting = true;
    const session = this.deps.session;
    const compactionId = crypto.randomUUID();
    let publicationUncertain = false;
    leases.add(session);
    try {
      const projection = projectSession(session.sessionId, session.replay());
      const records = projection.visibleMessages.filter((r) => r.type !== 'compaction/start' && r.type !== 'compaction/end');

      await session.appendSync({ type: 'compaction/start', trigger, compactionId, surface: false });

      // select oldest balanced region ending at ~(1 - retainRatio) of records
      const retainRatio = trigger === 'overflow' ? 0.3 : COMPACTION_RETAIN_RATIO;
      const targetCut = Math.max(1, Math.floor(records.length * (1 - retainRatio)));
      const cut = this.balancedCut(records, targetCut);
      if (cut <= 0) {
        await session.appendSync({ type: 'compaction/end', trigger, compactionId, removedRecords: 0, surface: false });
        return { trigger, removedRecords: 0, replacedSeq: { from: -1, to: -1 }, summary: '' };
      }

      const region = records.slice(0, cut);
      const firstUser = region.find((r) => r.type === 'user/message' && (r as { source?: string }).source !== 'instruction');
      const userRequest = firstUser ? (firstUser as { content: string }).content : '(无用户请求)';
      const regionText = region.map((r) => JSON.stringify(r)).join('\n');

      const candidate = await this.summarize(regionText, { userRequest });
      if (!candidate.trim()) throw new Error('Empty compaction summary');
      // Authoritative constraints and denials are carried verbatim, never entrusted to a summarizer.
      const goals = region.filter(r => r.type === 'user/message');
      const denials = region.filter(r => r.type === 'audit/denial' || r.type === 'tool/result' && r.error?.errorClass === 'DENIED');
      const denialEventIds = denials.map(r => `${session.sessionId}:${r.seq}`);
      const summary = [candidate, ...goals.map(r => `Preserved user constraint: ${r.content}`),
        ...denials.map(r => `Preserved denial ${session.sessionId}:${r.seq}: ${JSON.stringify(r)}`)].join('\n');
      const { abandoned } = CompactionBoundaryGuard.accountToolCalls(records);
      const compactedMessages = [{ role: 'user', content: summary, metadata: { denialEventIds } },
        ...records.slice(cut).flatMap<ConservationMessage>(r => {
          if (r.type === 'assistant/attempt') return [{ role: 'assistant', content: r.content, toolCalls: r.toolCalls.filter(c => !abandoned.get(r)?.has(c.toolCallId)).map(c => ({ id: c.toolCallId })) }];
          if (r.type === 'tool/result') return [{ role: 'tool', content: r.content, toolCallId: r.toolCallId }];
          return [];
        })];
      assertCompactionConservation({ originalMessages: goals.map(r => ({ role: 'user', content: r.content, metadata: { preserveVerbatim: true } })),
        compactedMessages, preservedGoalPrefix: firstUser ? userRequest : undefined, requiredDenialEventIds: denialEventIds });

      const fromSeq = region[0]!.seq;
      const toSeq = region[region.length - 1]!.seq;
      if (projectSession(session.sessionId, session.replay()).revision !== projection.revision) throw new Error('Compaction revision conflict');
      const removed = region.length;
      try {
        await session.appendSync({ type: 'compaction/end', trigger, removedRecords: removed, surface: false, outcome: 'committed',
          compactionId, projectionCommit: { expectedRevision: projection.revision, startSeq: fromSeq, endSeq: toSeq, summary } });
      } catch (error) {
        const uncertain = session.replay().find(r => r.compactionId === compactionId && r.outcome === 'committed');
        if (uncertain) { markProjectionPublicationUncertain(uncertain); publicationUncertain = true; }
        throw error;
      }

      return { trigger, removedRecords: removed, replacedSeq: { from: fromSeq, to: toSeq }, summary };
    } catch (error) {
      if (!publicationUncertain) await session.appendSync({ type: 'compaction/end', trigger, compactionId, removedRecords: 0, surface: false, outcome: 'failed' });
      throw error;
    } finally {
      this.compacting = false;
      leases.delete(session);
    }
  }

  /**
   * Largest index ≤ target such that the boundary is "balanced":
   * every tool/call inside the region has its tool/result inside too
   * (pairs are never split — Claw 400 / OpenAI-compat orphaned tool lesson).
   */
  private balancedCut(records: SessionRecord[], target: number): number {
    const { balancedAfter } = CompactionBoundaryGuard.accountToolCalls(records);
    let lastBalanced = 0;
    for (let i = 0; i < records.length; i++) {
      if (balancedAfter.has(i)) {
        lastBalanced = i + 1;
        if (lastBalanced >= target) return lastBalanced;
      }
    }
    return lastBalanced;
  }
}
