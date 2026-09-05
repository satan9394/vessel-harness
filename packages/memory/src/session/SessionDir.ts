import * as path from 'node:path';

/**
 * memory/session — session directory binding (ARCHITECTURE §4.8, v0.1 minimal
 * skeleton). Resolves where a session's event log lives; full project/persistent
 * memory is V0.3.
 */
export function resolveSessionDir(workspaceRoot: string, sessionId: string): string {
  return path.join(workspaceRoot, '.harness', 'sessions', sessionId);
}

export const SESSION_LOG_NAME = 'session.jsonl';
