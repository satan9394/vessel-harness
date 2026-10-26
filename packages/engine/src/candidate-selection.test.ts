import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { anonymizeCandidates, selectCandidate } from './index.js';
import type { CandidateInput, CandidateReview } from './candidate-selection.js';

const seed = 'review-seed';
const candidates: CandidateInput[] = [{ id: 'a', output: 'text' }, { id: 'b', artifactPaths: ['artifact.txt'] }, { id: 'c', output: 'third text' }];
const met = (candidateId: string): CandidateReview => ({ candidateId, verdict: 'met', reason: 'independent evidence passes' });

describe('candidate selection', () => {
  it('discards empty products and produces stable aliases from the specified hash', () => {
    const input = [candidates[0]!, candidates[1]!, { id: 'empty', output: ' \n ', artifactPaths: [] }];
    const result = selectCandidate({ candidates: input, reviews: [met('empty')], seed });
    expect(result.discarded).toEqual([{ id: 'empty', reason: 'no artifact' }]);
    expect(result.chosen).toBeNull();
    expect(result.aliases).toHaveLength(2);
    expect(anonymizeCandidates(input, seed)).toEqual(anonymizeCandidates(input, seed));
    for (const entry of result.aliases) expect(entry.alias).toBe(createHash('sha256').update(`${seed}\0${entry.candidateId}`).digest('hex').slice(0, 6));
  });

  it('selects highest met count and breaks equal votes by alias order deterministically', () => {
    expect(selectCandidate({ candidates, reviews: [met('a'), met('b'), met('b')], seed }).chosen).toBe('b');
    const reviews = [met('a'), met('b')];
    const result = selectCandidate({ candidates, reviews, seed });
    const first = anonymizeCandidates(candidates.filter(candidate => candidate.id !== 'c'), seed)[0]!.candidate.id;
    expect(result.chosen).toBe(first);
    expect(selectCandidate({ candidates, reviews, seed })).toEqual(result);
  });

  it('returns null for no met votes and accounts for both zero-vote verdicts', () => {
    const result = selectCandidate({ candidates, reviews: candidates.map(candidate => ({ candidateId: candidate.id, verdict: 'not_met', reason: 'failed' })), seed });
    expect(result.chosen).toBeNull();
    expect(result.why).toContain('0 met votes across 3 candidate(s)');
    expect(result.why).toContain('3 not_met');
    const impossible = selectCandidate({ candidates, reviews: [{ candidateId: 'a', verdict: 'impossible', reason: 'cannot evaluate' }], seed });
    expect(impossible.chosen).toBeNull();
    expect(impossible.why).toContain('1 impossible');
  });

  it('ignores and counts unknown review identities', () => {
    const result = selectCandidate({ candidates, reviews: [met('unknown'), met('b')], seed });
    expect(result.chosen).toBe('b');
    expect(result.why).toContain('ignored 1 unknown review(s)');
    expect(result.why).toContain('1 met votes');
  });

  it('keeps review order unchanged when candidate input is shuffled without mutating inputs', () => {
    const before = JSON.stringify(candidates);
    const result = selectCandidate({ candidates, reviews: [], seed });
    expect(selectCandidate({ candidates: [...candidates].reverse(), reviews: [], seed }).aliases).toEqual(result.aliases);
    expect(result.aliases.map(entry => entry.alias)).toEqual(result.aliases.map(entry => entry.alias).sort());
    expect(JSON.stringify(candidates)).toBe(before);
    expect(selectCandidate({ candidates: [], reviews: [], seed })).toMatchObject({ chosen: null, aliases: [], discarded: [] });
  });
});
