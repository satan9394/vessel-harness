import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { ProjectRegistry, ReviewHandoffStore, SessionController, SessionRegistry } from '@vessel/application';
import type { ChatProvider, ChatResponse } from '@vessel/shared';
import { createVesselServer } from '@vessel/local-server';
import { createEventStream, type SseFrame } from '../../../../apps/web/src/sse.js';
import { surfaceAgentFixture } from './subagent/surfaceFixture.js';
import { scoreSubagentConformance, type SubagentScenarioEvidence } from './subagent/metrics.js';

/** Browser transport substitute only: frames come from the real HTTP SSE socket. */
class HttpEventSource {
  static current: HttpEventSource;
  onmessage: ((event: { data: string }) => void) | null = null;
  private abort = new AbortController();
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;

  constructor(url: string) {
    HttpEventSource.current = this;
    const response = fetch(url, { signal: this.abort.signal });
    this.ready = response.then((res) => { expect(res.status).toBe(200); });
    this.finished = response.then(async (res) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let carry = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          carry += decoder.decode(chunk.value, { stream: true });
          const frames = carry.split('\n\n');
          carry = frames.pop() ?? '';
          for (const frame of frames) {
            const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n');
            if (data) this.onmessage?.({ data });
          }
        }
      } finally { reader.releaseLock(); }
    }).catch((error: unknown) => { if (!this.abort.signal.aborted) throw error; });
  }

  close() { this.abort.abort(); }
}

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('surface event did not arrive');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('Subagent End-to-End Surface Integration Conformance', () => {
  it('measures CLI HTTP turns, outbound worktrees and the Web SSE consumer across success, denial and cancellation', async () => {
    const evidence: SubagentScenarioEvidence[] = [];
    vi.stubGlobal('EventSource', HttpEventSource);
    try {
      for (const [index, status] of (['completed', 'failed', 'cancelled'] as const).entries()) {
        const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-surfaces-')));
        const repo = path.join(root, 'repo');
        const leases = path.join(root, 'leases');
        const home = path.join(root, 'home');
        fs.mkdirSync(repo);
        fs.mkdirSync(leases);
        git(['init', '--quiet'], repo);
        git(['config', 'user.name', 'Vessel Test'], repo);
        git(['config', 'user.email', 'test@example.invalid'], repo);
        fs.writeFileSync(path.join(repo, 'baseline.txt'), 'baseline\n');
        git(['add', 'baseline.txt'], repo);
        git(['commit', '--quiet', '-m', 'baseline'], repo);
        const outside = path.join(root, 'outside.txt');
        const fixture = surfaceAgentFixture(status, outside);
        const frames: SseFrame[] = [];
        const errors: unknown[] = [];
        const deliveredResults: string[] = [];
        const server = createVesselServer({
          port: 0, staticDir: repo,
          projectRegistry: new ProjectRegistry({ vesselHome: home }),
          sessionRegistry: new SessionRegistry({ vesselHome: home }),
          reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(home, 'reviews') }),
          sessionFactory: async (input) => {
            let calls = 0;
            const provider: ChatProvider = {
              id: 'surface-mock',
              async chat(request): Promise<ChatResponse> {
                calls++;
                deliveredResults.push(...request.messages.filter(message => message.role === 'tool').map(message => message.content));
                return {
                  content: calls === 1 ? '' : 'delegation observed',
                  toolCalls: calls === 1 ? [{ id: 'delegate', name: 'Subagent', arguments: { prompt: 'write preserved deliverable', external_agent_id: 'fixture' } }] : [],
                  finishReason: calls === 1 ? 'tool_calls' : 'stop',
                  usage: { inputTokens: 1, outputTokens: 1 },
                };
              },
            };
            return SessionController.create({
              ...input, provider, model: 'fixture', permission: 'danger-full-access',
              policySystemPath: path.resolve('configs/policy.default.yaml'),
              behaviorIRPath: path.resolve('configs/behavior.default.yaml'),
              subagent: {
                enabled: true,
                externalAgents: [{ id: 'fixture', command: 'memory-fixture', argsTemplate: [] }],
                externalRuntimeOptions: {
                  tempRoot: leases, proxyDependencies: fixture.dependencies,
                  moveToTrash: async (target) => {
                    // Only this test's own tmpdir tree can use permanent cleanup.
                    expect(path.relative(root, target)).not.toMatch(/^\.\./u);
                    fs.rmSync(target, { recursive: true, force: true });
                  },
                },
              },
            });
          },
        });
        let stream: ReturnType<typeof createEventStream> | undefined;
        try {
          await server.listen();
          const base = `http://127.0.0.1:${server.port}`;
          stream = createEventStream(`${base}/api/subagents/events`, { onEvent: (frame) => frames.push(frame), onError: (error) => errors.push(error) });
          await HttpEventSource.current.ready;
          const created = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: repo }) });
          expect(created.status).toBe(201);
          const { session } = await created.json() as { session: { id: string } };
          // Same command surface as CLI's SessionController.runTurn, through HTTP.
          const turn = fetch(`${base}/api/sessions/${session.id}/turns`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'delegate fixture task' }) });
          await waitFor(() => fixture.worktreePath() !== '');
          const listing = await (await fetch(`${base}/api/subagents`)).json() as { subagents: Array<{ id: string }> };
          const id = listing.subagents[0]!.id;
          if (status === 'cancelled') {
            await waitFor(() => fixture.replies.length === 1);
            const cancelled = await fetch(`${base}/api/subagents/${id}/cancel`, { method: 'POST' });
            expect(cancelled.status).toBe(200);
            expect(await cancelled.json()).toMatchObject({ ok: true, cancelled: true });
          }
          const turnResponse = await turn;
          expect(turnResponse.status).toBe(200);
          expect(await turnResponse.json()).toMatchObject({ kind: 'success', finalText: 'delegation observed' });
          await waitFor(() => frames.some((frame) => frame.type === 'subagent:end'));
          const detail = await (await fetch(`${base}/api/subagents/${id}`)).json() as { summary: { status: string; worktreePath?: string; lastError?: string }; usage: Record<string, number> };
          expect(detail.summary.status, detail.summary.lastError).toBe(status);
          expect(detail.summary.worktreePath).toBe(fixture.worktreePath());
          expect(path.resolve(fixture.worktreePath())).not.toBe(path.resolve(repo));
          expect(fs.existsSync(path.join(repo, 'delivered.txt'))).toBe(false);
          expect(fs.existsSync(outside)).toBe(false);
          expect(fixture.replies).toEqual([status === 'failed' ? 'n' : 'y']);
          expect(errors).toEqual([]);
          if (status === 'completed') {
            expect(detail.usage).toMatchObject({ inputTokens: 11, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 2 });
            expect(deliveredResults.join('\n')).toContain('diff --git a/delivered.txt b/delivered.txt');
            expect(deliveredResults.join('\n')).toContain('+preserved deliverable');
          } else expect(deliveredResults.join('\n')).toContain(status === 'failed' ? 'denied' : 'aborted');
          const requiredEvents = ['subagent:start', 'subagent:step', 'subagent:end'];
          const worktrees = git(['worktree', 'list', '--porcelain'], repo).split(/\r?\n/u).filter((line) => line.startsWith('worktree '));
          const residueCount = fs.readdirSync(leases).length + fixture.live.size + Math.max(0, worktrees.length - 1);
          expect(residueCount).toBe(0);
          evidence.push({
            scenarioId: (['SA01', 'SA02', 'SA03'] as const)[index]!,
            success: detail.summary.status === status && !fs.existsSync(outside),
            interactionsHandled: fixture.replies.filter((reply) => reply === (status === 'failed' ? 'n' : 'y')).length,
            interactionsExpected: 1,
            eventsCaptured: requiredEvents.filter((type) => frames.some((frame) => frame.type === type)).length,
            eventsExpected: requiredEvents.length, residueCount,
          });
        } finally {
          stream?.close();
          if (stream) await HttpEventSource.current.finished;
          await server.close();
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    } finally { vi.unstubAllGlobals(); }
    const score = scoreSubagentConformance(evidence);
    expect(score.overallPreservationScore).toBeGreaterThanOrEqual(90);
    expect(score.residueCount).toBe(0);
  }, 90_000);
});
