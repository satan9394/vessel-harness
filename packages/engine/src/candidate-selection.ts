import { createHash } from 'node:crypto';

export interface CandidateInput {
  id: string;
  output?: string;
  artifactPaths?: string[];
}

export interface CandidateReview {
  candidateId: string;
  verdict: 'met' | 'not_met' | 'impossible';
  reason: string;
}

export interface SelectionResult {
  chosen: string | null;
  why: string;
  discarded: Array<{ id: string; reason: string }>;
  /** Audit mapping, in the order shown for review. */
  aliases: Array<{ alias: string; candidateId: string }>;
}

/** Stable aliases depend only on seed and candidate identity. */
export function anonymizeCandidates(candidates: CandidateInput[], seed: string): Array<{ alias: string; candidate: CandidateInput }> {
  return candidates.map(candidate => ({
    alias: createHash('sha256').update(seed).update('\0').update(candidate.id).digest('hex').slice(0, 6),
    candidate,
  })).sort((a, b) => a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0);
}

/** Pure vote aggregation; callers must supply independent evaluator reviews. */
export function selectCandidate(input: {
  candidates: CandidateInput[];
  reviews: CandidateReview[];
  seed: string;
}): SelectionResult {
  // 基线概念留给调用方，通过不传该候选实现。
  const discarded: SelectionResult['discarded'] = [];
  const pool = anonymizeCandidates(input.candidates.filter(candidate => {
    if (candidate.output?.trim() || candidate.artifactPaths?.length) return true;
    discarded.push({ id: candidate.id, reason: 'no artifact' });
    return false;
  }), input.seed);
  const votes = new Map(pool.map(({ candidate }) => [candidate.id, 0]));
  const known = new Set(input.candidates.map(candidate => candidate.id));
  const counts = { met: 0, not_met: 0, impossible: 0 };
  let ignored = 0;
  for (const review of input.reviews) {
    if (!known.has(review.candidateId)) { ignored++; continue; }
    if (!votes.has(review.candidateId)) continue;
    counts[review.verdict]++;
    if (review.verdict === 'met') votes.set(review.candidateId, votes.get(review.candidateId)! + 1);
  }
  let chosen: string | null = null;
  let best = 0;
  for (const { candidate } of pool) {
    const count = votes.get(candidate.id)!;
    if (count > best) { chosen = candidate.id; best = count; }
  }
  return {
    chosen,
    why: `${counts.met} met votes across ${pool.length} candidate(s); ${counts.not_met} not_met; ${counts.impossible} impossible; ignored ${ignored} unknown review(s)` +
      (chosen === null ? '' : `; chose ${chosen} with ${best} met vote(s), ties resolved by alias order`),
    discarded,
    aliases: pool.map(({ alias, candidate }) => ({ alias, candidateId: candidate.id })),
  };
}
