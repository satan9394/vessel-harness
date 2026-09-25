import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '@vessel/core';
import { ExternalAgentRuntime, type ExternalAgentConfig } from '@vessel/agents';
import { spawnWithVirtualProxy, WindowsJobObject, type VirtualProxyDependencies } from '@vessel/runtime';
import { scoreSubagentConformance, type SubagentScenarioEvidence } from './subagent/metrics.js';

let testCleanupRoot = '';

describe('offline subagent capability conformance', () => {
  let testRoot: string;
  let repoRoot: string;
  let runtimeTemp: string;
  const childPids = new Set<number>();

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-subagent-conformance-'));
    testCleanupRoot = testRoot;
    repoRoot = path.join(testRoot, 'repo');
    runtimeTemp = path.join(testRoot, 'leases');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(runtimeTemp, { recursive: true });
    git(['init', '--quiet'], repoRoot);
    git(['config', 'user.email', 'conformance@example.invalid'], repoRoot);
    git(['config', 'user.name', 'Conformance Mock'], repoRoot);
    fs.writeFileSync(path.join(repoRoot, 'base.txt'), 'base\n');
    git(['add', 'base.txt'], repoRoot);
    git(['commit', '--quiet', '-m', 'base'], repoRoot);
  });

  afterEach(() => {
    for (const pid of childPids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
    }
    childPids.clear();
    if (testRoot) fs.rmSync(testRoot, { recursive: true, force: true });
    testCleanupRoot = '';
  });

  it('scores refactor diff transfer, policy-gated interaction, and timeout tree cleanup at 90% or higher', async () => {
    const evidence: SubagentScenarioEvidence[] = [];

    // SA01: a mock CLI edits a new file in its private worktree; the parent gets
    // a diff and standard event stream while the checkout remains untouched.
    const bus = new EventBus();
    const observationSignals = new Set<string>();
    bus.on('model_stream_start', () => { observationSignals.add('stream-start'); });
    bus.on('model_stream_delta', (payload) => {
      const chunk = (payload as { chunk?: { type?: string; text?: string; id?: string; name?: string } }).chunk;
      if (chunk?.type === 'text_delta' && chunk.text) observationSignals.add('text-delta');
      if (chunk?.type === 'reasoning_delta' && chunk.text) observationSignals.add('reasoning-delta');
      if (chunk?.type === 'tool_call_start' && chunk.id && chunk.name) observationSignals.add('tool-call-delta');
    });
    bus.on('model_stream_end', (payload) => {
      const end = payload as { text?: string; toolCalls?: unknown[]; usage?: { inputTokens?: number; outputTokens?: number } };
      if (end.text?.includes('refactor validated')) observationSignals.add('final-text');
      if (end.toolCalls?.some((call) => typeof call === 'object' && call !== null)) observationSignals.add('final-tool-calls');
      if ((end.usage?.inputTokens ?? 0) > 0 && (end.usage?.outputTokens ?? 0) > 0) observationSignals.add('reported-usage');
    });
    bus.on('subagent_stop', () => { observationSignals.add('subagent-stop'); });
    bus.on('after_delegate', () => { observationSignals.add('after-delegate'); });
    const refactor = nodeAgent([
      "const fs=require('node:fs');",
      "fs.writeFileSync('refactor.txt','child change\\n');",
      "for (const record of [",
      "{type:'text_delta',text:'refactor validated'},",
      "{type:'reasoning_delta',text:'inspect then update'},",
      "{type:'tool_call_start',id:'tc-1',name:'Read',arguments:'{\\\"path\\\":\\\"base.txt\\\"}'},",
      "{type:'tool_call_end',id:'tc-1'},",
      "{type:'usage',inputTokens:12,outputTokens:5}",
      "]) console.log(JSON.stringify(record));",
    ].join('\n'), 'blind-refactor');
    const runtime = createTestRuntime({ agents: [refactor], bus, tempRoot: runtimeTemp, proxyDependencies: proxyDeps() });
    const refactorResult = await runtime.execute({ agentId: refactor.id, prompt: 'refactor one file', parentWorkspaceRoot: repoRoot });
    const diff = String(refactorResult.structured?.diff ?? '');
    const refactorClean = residueCount(repoRoot, runtimeTemp) === 0;
    evidence.push({
      scenarioId: 'SA01',
      success: refactorResult.stopReason === 'completed'
        && diff.includes('diff --git a/refactor.txt b/refactor.txt')
        && diff.includes('+child change')
        && !fs.existsSync(path.join(repoRoot, 'refactor.txt')),
      interactionsHandled: 0,
      interactionsExpected: 0,
      eventsCaptured: observationSignals.size,
      eventsExpected: 9,
      residueCount: refactorClean ? 0 : residueCount(repoRoot, runtimeTemp),
    });

    // SA02: one allowlisted worktree write is approved; one out-of-scope path
    // is denied by the same virtual prompt gate.
    const safeAgent = nodeAgent([
      "const fs=require('node:fs'); const path=require('node:path'); const target=path.join(process.cwd(),'safe.txt');",
      "process.stdout.write('Overwrite '+target+'? [y/N]');",
      "process.stdin.once('data', value=>{ if(String(value).trim()==='y'){ fs.writeFileSync(target,'approved'); console.log('APPROVED'); } else { console.log('DENIED'); } process.exit(0); });",
    ].join('\n'), 'blind-safe-prompt');
    const unsafeAgent = nodeAgent([
      "const path=require('node:path'); const target=path.join(process.env.OUTSIDE_ROOT,'outside.txt');",
      "process.stdout.write('Overwrite '+target+'? [y/N]');",
      "process.stdin.once('data', value=>{ process.stdout.write(String(value).trim()==='n'?'DENIED':'APPROVED'); process.exit(0); });",
    ].join('\n'), 'blind-unsafe-prompt', { OUTSIDE_ROOT: testRoot });
    const interactionRuntime = createTestRuntime({ agents: [safeAgent, unsafeAgent], tempRoot: runtimeTemp, proxyDependencies: proxyDeps() });
    const safeResult = await interactionRuntime.execute({ agentId: safeAgent.id, prompt: 'approve worktree change', parentWorkspaceRoot: repoRoot });
    const unsafeResult = await interactionRuntime.execute({ agentId: unsafeAgent.id, prompt: 'deny outside change', parentWorkspaceRoot: repoRoot });
    const interactionsHandled = Number(safeResult.stopReason === 'completed' && String(safeResult.structured?.diff ?? '').includes('safe.txt'))
      + Number(unsafeResult.stopReason === 'denied');
    const interactionClean = residueCount(repoRoot, runtimeTemp) === 0 && !fs.existsSync(path.join(testRoot, 'outside.txt'));
    evidence.push({
      scenarioId: 'SA02',
      success: interactionsHandled === 2 && interactionClean,
      interactionsHandled,
      interactionsExpected: 2,
      eventsCaptured: 0,
      eventsExpected: 0,
      residueCount: interactionClean ? 0 : residueCount(repoRoot, runtimeTemp) + Number(fs.existsSync(path.join(testRoot, 'outside.txt'))),
    });

    // SA03: the controlled Node mock creates a grandchild and hangs. The proxy
    // timeout must terminate the process tree before returning to the scorer.
    const treeScript = [
      "const {spawn}=require('node:child_process');",
      "const grandchild=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
      "process.stdout.write('GRANDCHILD:'+grandchild.pid+'\\n');",
      "setInterval(()=>{},1000);",
    ].join('\n');
    let jobName: string | undefined;
    const treeResult = await spawnWithVirtualProxy({
      command: process.execPath,
      args: ['-e', treeScript],
      cwd: repoRoot,
      timeoutMs: process.platform === 'win32' ? 20_000 : 600,
      ...(process.platform === 'win32' ? { onJobAttached: (name: string) => { jobName = name; } } : {}),
    });
    const grandchildPid = Number(treeResult.stdout.match(/GRANDCHILD:(\d+)/u)?.[1]);
    if (Number.isInteger(grandchildPid) && grandchildPid > 0) childPids.add(grandchildPid);
    const grandchildGone = Number.isInteger(grandchildPid) && grandchildPid > 0 ? await waitUntilGone(grandchildPid) : false;
    evidence.push({
      scenarioId: 'SA03',
      success: treeResult.killedByTimeout && treeResult.exitCode !== 0 && grandchildGone
        && (process.platform !== 'win32' || typeof jobName === 'string'),
      interactionsHandled: 0,
      interactionsExpected: 0,
      eventsCaptured: 0,
      eventsExpected: 0,
      residueCount: grandchildGone ? 0 : 1,
    });

    const metrics = scoreSubagentConformance(evidence);
    expect(evidence.map((item) => item.scenarioId)).toEqual(['SA01', 'SA02', 'SA03']);
    expect(metrics.successRate).toBe(1);
    expect(metrics.interactionPreservation).toBe(1);
    expect(metrics.observabilityPassThrough).toBe(1);
    expect(metrics.overallPreservationScore).toBeGreaterThanOrEqual(90);
    expect(metrics.residueCount).toBe(0);
    if (process.platform === 'win32' && jobName) {
      expect(await WindowsJobObject.activeProcessCount(jobName)).toBeNull();
    }
  }, 60_000);

  it('does not award observability when required stream payloads are missing', () => {
    const metrics = scoreSubagentConformance([
      { scenarioId: 'SA01', success: true, interactionsHandled: 0, interactionsExpected: 0, eventsCaptured: 0, eventsExpected: 4, residueCount: 0 },
      { scenarioId: 'SA02', success: true, interactionsHandled: 1, interactionsExpected: 1, eventsCaptured: 0, eventsExpected: 0, residueCount: 0 },
      { scenarioId: 'SA03', success: true, interactionsHandled: 0, interactionsExpected: 0, eventsCaptured: 0, eventsExpected: 0, residueCount: 0 },
    ]);
    expect(metrics.observabilityPassThrough).toBe(0);
    expect(metrics.overallPreservationScore).toBeLessThan(100);
  });
});

function nodeAgent(script: string, id: string, env?: Record<string, string>): ExternalAgentConfig {
  return { id, command: process.execPath, argsTemplate: ['-e', script], env, isolateWorkspace: true };
}

function createTestRuntime(options: ConstructorParameters<typeof ExternalAgentRuntime>[0]): ExternalAgentRuntime {
  return new ExternalAgentRuntime({
    ...options,
    moveToTrash: async (candidate) => {
      const root = fs.realpathSync.native(testCleanupRoot);
      const target = fs.existsSync(candidate) ? fs.realpathSync.native(candidate) : path.resolve(candidate);
      const relative = path.relative(root, target);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
        throw new Error('conformance cleanup refused to touch a path outside its temporary root');
      }
      fs.rmSync(target, { recursive: true, force: true });
    },
  });
}

function proxyDeps(): VirtualProxyDependencies {
  if (process.platform !== 'win32') return {};
  return {
    enumerateDescendants: async () => [],
    createJob: async (pid) => ({ jobName: 'conformance-external', rootPid: pid, attached: true, async terminate() {}, async dispose() {} }),
  };
}

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + (result.stderr || result.stdout));
  return result.stdout;
}

function residueCount(repoRoot: string, tempRoot: string): number {
  const registered = git(['worktree', 'list', '--porcelain'], repoRoot)
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length)));
  const extraWorktrees = registered.filter((candidate) => {
    try { return fs.realpathSync.native(candidate) !== fs.realpathSync.native(repoRoot); }
    catch { return true; }
  }).length;
  return fs.readdirSync(tempRoot).length + extraWorktrees;
}

async function waitUntilGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 25));
    } catch {
      return true;
    }
  }
  return false;
}
