import * as fs from 'node:fs';
import * as path from 'node:path';
import { Session } from '@vessel/core';
import { canonicalArgumentsHash } from '@vessel/shared';
import { EffectJournal, type EffectReconciliation } from '@vessel/runtime';

/**
 * Operator recovery for unknown effects, without a running server or a model session.
 *
 * `SessionController.reconcileEffect` is the in-process path used by `POST /api/sessions/:id/effects`.
 * The CLI needs the same two steps — journal receipt + `audit/effect_reconciled` record — but cannot
 * build a controller (that wants providers, models, policy artifacts). The logic is three lines; the
 * duplication is deliberate and this comment is the reason to keep it in step with the controller.
 */

export interface PendingEffectView {
  key: string;
  attempt: number;
  effects: string;
  tool: string;
  invocationHash: string;
}

export interface SessionEffects {
  sessionId: string;
  pending: PendingEffectView[];
}

function journalPath(sessionDir: string): string {
  return path.join(sessionDir, 'execution.jsonl');
}

/** Session directories under a workspace, newest first. Missing workspace state yields an empty list. */
function sessionDirs(workspaceRoot: string): string[] {
  const root = path.join(workspaceRoot, '.harness', 'sessions');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(root, entry.name))
    .filter(dir => fs.existsSync(journalPath(dir)))
    .sort((a, b) => fs.statSync(journalPath(b)).mtimeMs - fs.statSync(journalPath(a)).mtimeMs);
}

/**
 * Reading through `EffectJournal` also runs its torn-tail repair, which is the same thing the app
 * does on open: a half-written last line means a crashed append, not user data.
 */
export function listSessionEffects(workspaceRoot: string, sessionId?: string): SessionEffects[] {
  const dirs = sessionId ? [path.join(workspaceRoot, '.harness', 'sessions', sessionId)] : sessionDirs(workspaceRoot);
  return dirs
    .filter(dir => fs.existsSync(journalPath(dir)))
    .map(dir => ({
      sessionId: path.basename(dir),
      pending: new EffectJournal(journalPath(dir)).pending().map(intent => ({
        key: intent.key, attempt: intent.attempt, effects: intent.effects,
        tool: intent.invocation.canonicalToolId, invocationHash: canonicalArgumentsHash(intent.invocation),
      })),
    }))
    .filter(entry => entry.pending.length > 0);
}

/**
 * Resolve one pending effect. Takes the session's single-writer lease for the write, so a running
 * server that still owns the session makes this fail closed instead of racing it.
 */
export async function resolveSessionEffect(workspaceRoot: string, input: {
  sessionId: string;
  key: string;
  attempt: number;
  resolution: EffectReconciliation['resolution'];
  evidence: string;
}): Promise<{ sessionId: string; resolved: PendingEffectView; pending: PendingEffectView[] }> {
  // `Session.open` happily creates a directory for an unknown id, so a typo would leave a phantom
  // empty session behind. Refuse before opening: no journal means no effect to reconcile.
  const dir = path.join(workspaceRoot, '.harness', 'sessions', input.sessionId);
  if (!fs.existsSync(journalPath(dir))) throw new Error(`no pending effect ${input.key}#${input.attempt}`);
  const session = await Session.open({ workspaceRoot, sessionId: input.sessionId });
  try {
    const journal = new EffectJournal(journalPath(session.dir));
    const target = journal.pending().find(intent => intent.key === input.key && intent.attempt === input.attempt);
    if (!target) throw new Error(`no pending effect ${input.key}#${input.attempt}`);
    const receipt: EffectReconciliation = {
      key: input.key, attempt: input.attempt,
      invocationHash: canonicalArgumentsHash(target.invocation),
      resolution: input.resolution, evidence: input.evidence,
    };
    journal.reconcile(receipt);
    await session.appendSync({ type: 'audit/effect_reconciled', surface: false,
      key: receipt.key, attempt: receipt.attempt, invocationHash: receipt.invocationHash, resolution: receipt.resolution });
    return {
      sessionId: input.sessionId,
      resolved: { key: target.key, attempt: target.attempt, effects: target.effects,
        tool: target.invocation.canonicalToolId, invocationHash: receipt.invocationHash },
      pending: journal.pending().map(intent => ({ key: intent.key, attempt: intent.attempt, effects: intent.effects,
        tool: intent.invocation.canonicalToolId, invocationHash: canonicalArgumentsHash(intent.invocation) })),
    };
  } finally {
    await session.close();
  }
}
