import * as crypto from 'node:crypto';
import { COMPACTION_RETAIN_RATIO, COMPACTION_THRESHOLD_RATIO, type SessionRecord } from '@cah/shared';
import { Session } from '@cah/core';

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
 * Transactional: compaction/start (lock first) → summary → surface replace of the
 * oldest BALANCED region (tool call/result pairs never split) → compaction/end exactly once.
 * Tail kept verbatim per retainRatio 0.16. Same session log (not_new_session).
 */
export class Compaction {
  private readonly summarize: NonNullable<CompactionDeps['summarize']>;
  private compacting = false;

  constructor(private readonly deps: CompactionDeps) {
    this.summarize = deps.summarize ?? heuristicSummarize;
  }

  shouldCompact(estimateTokens: number, contextWindow: number): boolean {
    return estimateTokens >= COMPACTION_THRESHOLD_RATIO * contextWindow;
  }

  async compact(trigger: CompactionTrigger): Promise<CompactionResult> {
    if (this.compacting) {
      throw new Error('compaction already in progress (transaction lock)');
    }
    this.compacting = true;
    const session = this.deps.session;
    try {
      const all = session.replay();
      const records = all.filter((r) => r.type !== 'compaction/start' && r.type !== 'compaction/end');

      await session.appendSync({ type: 'compaction/start', trigger, surface: false });

      // select oldest balanced region ending at ~(1 - retainRatio) of records
      const targetCut = Math.max(1, Math.floor(records.length * (1 - COMPACTION_RETAIN_RATIO)));
      const cut = this.balancedCut(records, targetCut);
      if (cut <= 0) {
        await session.appendSync({ type: 'compaction/end', trigger, removedRecords: 0, surface: false });
        return { trigger, removedRecords: 0, replacedSeq: { from: -1, to: -1 }, summary: '' };
      }

      const region = records.slice(0, cut);
      const firstUser = region.find((r) => r.type === 'user/message' && (r as { source?: string }).source !== 'instruction');
      const userRequest = firstUser ? (firstUser as { content: string }).content : '(无用户请求)';
      const regionText = region.map((r) => JSON.stringify(r)).join('\n');

      const summary = await this.summarize(regionText, { userRequest });

      const fromSeq = region[0]!.seq;
      const toSeq = region[region.length - 1]!.seq;
      const removed = await session.replaceRegion(fromSeq, toSeq, {
        type: 'user/message',
        msgId: `m_compacted_${crypto.randomBytes(4).toString('hex')}`,
        role: 'user',
        content: `<compacted-summary>\n${summary}\n</compacted-summary>`,
        source: 'compacted-summary',
        surface: true,
      });

      await session.appendSync({ type: 'compaction/end', trigger, removedRecords: removed, surface: false });

      return { trigger, removedRecords: removed, replacedSeq: { from: fromSeq, to: toSeq }, summary };
    } finally {
      this.compacting = false;
    }
  }

  /**
   * Largest index ≤ target such that the boundary is "balanced":
   * every tool/call inside the region has its tool/result inside too
   * (pairs are never split — Claw 400 / OpenAI-compat orphaned tool lesson).
   */
  private balancedCut(records: SessionRecord[], target: number): number {
    let openCalls = new Set<string>();
    let lastBalanced = 0;
    for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      if (r.type === 'tool/call') openCalls.add(r.toolCallId);
      if (r.type === 'tool/result') openCalls.delete(r.toolCallId);
      if (openCalls.size === 0) {
        lastBalanced = i + 1;
        if (lastBalanced >= target) return lastBalanced;
      }
    }
    return lastBalanced;
  }
}
