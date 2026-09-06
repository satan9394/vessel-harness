import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LearnedStore, type LearnSuggestion } from './LearnedStore.js';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('memory/learned — suggest-only auto-learn (V0.3-M5)', () => {
  let root: string;
  let store: LearnedStore;

  beforeEach(() => {
    root = tmpDir('cah-learned-');
    store = new LearnedStore({ rootDir: root });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('suggest() writes a pending record only under suggestions/ (never user dirs)', () => {
    const rec = store.suggest({
      kind: 'skill',
      name: 'my-skill',
      content: 'do X',
      reason: 'learned from task',
      evidence: ['session abc'],
    });
    expect(rec.status).toBe('pending');
    // only the suggestion JSON exists — nothing materialized into skills/ or memory/
    expect(fs.existsSync(path.join(root, 'suggestions', `${rec.id}.json`))).toBe(true);
    expect(fs.existsSync(path.join(root, 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'memory'))).toBe(false);
  });

  it('approve() without a met evaluator verdict is refused (independent review gate)', () => {
    const rec = store.suggest({ kind: 'memory', name: 'note', content: 'body', reason: 'r', evidence: [] });
    const res = store.approve(rec.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('no met evaluator verdict');
    // nothing materialized
    expect(fs.existsSync(path.join(root, 'memory'))).toBe(false);
  });

  it('approve() after a met verdict materializes ONLY into learned/ and marks approved', () => {
    const rec = store.suggest({ kind: 'skill', name: 'ok-skill', content: 'skill body', reason: 'r', evidence: [] });
    store.recordVerdict(rec.id, 'met');
    const res = store.approve(rec.id);
    expect(res.ok).toBe(true);
    const outPath = path.join(root, 'skills', 'ok-skill', 'SKILL.md');
    expect(fs.existsSync(outPath)).toBe(true);
    expect(fs.readFileSync(outPath, 'utf8')).toContain('skill body');
    expect(store.get(rec.id)!.status).toBe('approved');
  });

  it('reject() marks the record and never materializes', () => {
    const rec = store.suggest({ kind: 'memory', name: 'bad', content: 'x', reason: 'r', evidence: [] });
    store.reject(rec.id);
    expect(store.get(rec.id)!.status).toBe('rejected');
    expect(fs.existsSync(path.join(root, 'memory'))).toBe(false);
    // approving a rejected suggestion is refused
    expect(store.approve(rec.id).ok).toBe(false);
  });

  it('no auto-modify: user skill/memory dirs stay untouched while suggestions are pending (snapshot compare)', () => {
    // simulate pre-existing user skill area OUTSIDE the learned root
    const userArea = tmpDir('cah-user-area-');
    const userSkill = path.join(userArea, '.dsh', 'skills', 'precious');
    fs.mkdirSync(userSkill, { recursive: true });
    fs.writeFileSync(path.join(userSkill, 'SKILL.md'), 'user content', 'utf8');
    const snap = (p: string) => fs.readFileSync(p, 'utf8');

    const rec = store.suggest({ kind: 'skill', name: 'precious', content: 'agent wants to overwrite', reason: 'r', evidence: [] });
    store.recordVerdict(rec.id, 'met');
    // approve materializes into learned root, NOT the user area
    store.approve(rec.id);
    expect(snap(path.join(userSkill, 'SKILL.md'))).toBe('user content'); // untouched
    expect(fs.existsSync(path.join(root, 'skills', 'precious', 'SKILL.md'))).toBe(true); // learned copy

    fs.rmSync(userArea, { recursive: true, force: true });
  });

  it('list() returns records for audit; a non-met verdict leaves the record pending', () => {
    const a = store.suggest({ kind: 'memory', name: 'a', content: '1', reason: 'r', evidence: [] });
    const b = store.suggest({ kind: 'memory', name: 'b', content: '2', reason: 'r', evidence: [] });
    store.recordVerdict(a.id, 'not_met');
    expect(store.list()).toHaveLength(2);
    expect(store.get(a.id)!.status).toBe('pending'); // not_met does not reject/approve
    expect(store.get(a.id)!.verdict).toBe('not_met');
    void b;
  });
});
