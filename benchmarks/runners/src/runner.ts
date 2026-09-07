import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { ChatProvider } from '@cah/shared';
import { MockProvider } from '@cah/llm';
import { composeHarness, type ComposeOptions } from '@cah/cli';
import { EvaluatorAgent, createReadOnlyExplorationTools, executePlan, generatePlan, injectPlan } from '@cah/agents';
import { McpClient, createInProcessTransport, handleMcpRequest } from '@cah/tools';
import { loadManifest } from './manifest.js';
import { runAssert } from './asserts.js';
import { OFFLINE_SCRIPTS } from './offline.js';
import type { AssertResult, ScenarioManifest, ScenarioReport } from './types.js';

export interface RunScenarioOptions {
  scenarioId: string;
  repoRoot: string;
  reportsDir: string;
  provider: ChatProvider | null;
  model: string;
  policyPath: string;
  behaviorIRPath: string;
}

function snapshotFiles(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.harness') continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const rel = path.relative(dir, full).replace(/\\/g, '/');
        out.set(rel, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
      }
    }
  };
  walk(dir);
  return out;
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

/**
 * Scenario drivers (V0.2): default = one loop turn; planner = plan → inject →
 * execute (acceptance-driven evaluator); evaluator = generator run, then an
 * independent EvaluatorAgent reviews the output (never self-certified).
 */
async function driveScenario(
  harness: Awaited<ReturnType<typeof composeHarness>>,
  manifest: ScenarioManifest,
  prompt: string,
  provider: ChatProvider,
  model: string,
  workspace: string,
): Promise<string> {
  if (manifest.harness?.planner) {
    const plan = await generatePlan(provider, model, prompt);
    await injectPlan(harness.session, plan);
    const report = await executePlan(
      async (stepPrompt) => harness.loop.runTurn(stepPrompt),
      plan,
      async ({ step, output }) => {
        const missing = step.acceptance.filter((a) => !output.includes(a));
        return missing.length === 0
          ? { verdict: 'met' as const, evidence: [...step.acceptance], reason: 'acceptance golden present' }
          : { verdict: 'not_met' as const, evidence: [`missing: ${missing.join(', ')}`], reason: 'acceptance golden missing' };
      },
      { maxAttemptsPerStep: 1 },
    );
    return `计划执行${report.overallVerdict === 'met' ? '通过' : '未通过'}：${report.reason}`;
  }
  if (manifest.harness?.evaluator) {
    const gen = await harness.loop.runTurn(prompt);
    const evalProvider = new MockProvider(OFFLINE_SCRIPTS[`${manifest.id}-eval`] ?? [], { model });
    const evaluator = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: evalProvider,
      model,
      policyArtifacts: harness.artifacts,
      tools: createReadOnlyExplorationTools(workspace),
    });
    const acceptance = manifest.pass.filter((p) => p.type === 'file_content').flatMap((p) => p.golden ?? []);
    const verdict = await evaluator.evaluate({ goal: manifest.goal, generatorOutput: gen.finalText, acceptance });
    // the verdict is injected back into the parent session (回投父上下文, recorded)
    await harness.session.appendSync({
      type: 'user/message',
      msgId: `eval_${Date.now()}`,
      role: 'user',
      content: `Evaluator Agent 结论：${verdict.verdict}（${verdict.reason}）`,
      source: 'inject',
      surface: true,
    });
    return `评估结论：${verdict.verdict}（${verdict.reason}）`;
  }
  const result = await harness.loop.runTurn(prompt);
  return result.finalText;
}

/**
 * runScenario — headless benchmark seam (BENCHMARK-SPEC §6.1):
 * prepare (copy fixture + snapshot) → inject task → run our harness
 * → collect (session + telemetry) → assert (disk/command/event, never self-report)
 * → report (JSONL + summary.json).
 */
export async function runScenario(opts: RunScenarioOptions): Promise<ScenarioReport> {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const manifest = loadManifest(opts.repoRoot, opts.scenarioId);
  const runId = `run_${startedAt.getTime()}_${crypto.randomBytes(3).toString('hex')}`;

  const runDir = path.join(opts.reportsDir, opts.scenarioId, runId);
  const workspace = path.join(runDir, 'workspace');
  const fixtureDir = path.join(opts.repoRoot, 'benchmarks', manifest.fixture);
  if (!fs.existsSync(fixtureDir)) {
    throw new Error(`fixture not found: ${fixtureDir}`);
  }
  copyDir(fixtureDir, workspace);
  const snapshotBefore = snapshotFiles(workspace);

  // scenario policy override (B005 needs danger-full-access for real shell)
  let policyPath = opts.policyPath;
  if (manifest.policy) {
    const base = fs.readFileSync(opts.policyPath, 'utf8');
    const doc = yaml.load(base) as { policy?: Record<string, unknown> } | null;
    const root: Record<string, unknown> = doc?.policy ?? (doc as Record<string, unknown> | null) ?? {};
    if (manifest.policy.profile) root.profile = manifest.policy.profile;
    if (manifest.policy.approval) root.approval = manifest.policy.approval;
    const out = path.join(runDir, 'scenario-policy.yaml');
    fs.writeFileSync(out, yaml.dump({ policy: root }), 'utf8');
    policyPath = out;
  }

  // provider: offline lane (deterministic) or live (real model)
  const provider =
    opts.provider ??
    new MockProvider(OFFLINE_SCRIPTS[opts.scenarioId] ?? [], {
      model: opts.model,
      vars: { cwd: workspace },
    });

  const prompt = fs.readFileSync(path.join(workspace, manifest.task_file), 'utf8').trim();

  const composeOpts: ComposeOptions = {
    workspaceRoot: workspace,
    provider,
    model: opts.model,
    policySystemPath: policyPath,
    behaviorIRPath: opts.behaviorIRPath,
  };
  if (manifest.harness?.subagent) {
    composeOpts.subagent = {
      enabled: true,
      maxConcurrent: manifest.harness.subagent.maxConcurrent,
      maxDepth: manifest.harness.subagent.maxDepth,
    };
  }
  if (manifest.harness?.mcp) {
    composeOpts.mcp = manifest.harness.mcp.map((c) => ({
      serverName: c.serverName,
      // offline lane: in-process transport bound to the local stdio fixture server core
      transport: createInProcessTransport((method, params) => handleMcpRequest(method, params)),
    }));
  }
  // V0.4 task routing lane: two offline mock providers (pro/fast tiers); the
  // task prompt is classified and the session routed to a tier. Machine proof:
  // only the tier the task routes to emits the golden marker in its reply.
  if (manifest.harness?.taskRouter) {
    const proProvider = new MockProvider(
      [{ when: /.*/, ifNoToolResult: true, response: { text: 'ROUTED-TO-PRO-TIER GOLDEN-ROUTE-2026' } }],
      { model: 'pro-model' },
    );
    const fastProvider = new MockProvider(
      [{ when: /.*/, ifNoToolResult: true, response: { text: 'ROUTED-TO-FAST-TIER' } }],
      { model: 'fast-model' },
    );
    composeOpts.taskRouter = {
      providers: { pro: proProvider, fast: fastProvider },
      tierModel: {
        pro: { providerId: 'pro', model: 'pro-model' },
        fast: { providerId: 'fast', model: 'fast-model' },
        mini: { providerId: 'fast', model: 'mini-model' },
      },
      taskPrompt: prompt,
    };
  }

  const harness = await composeHarness(composeOpts);

  let finalText = '';
  try {
    finalText = await driveScenario(harness, manifest, prompt, provider, opts.model, workspace);
  } finally {
    await harness.close();
  }

  // hidden test injection (B003: runner-side, never visible during the run)
  if (manifest.hidden) {
    const hiddenSrc = path.join(opts.repoRoot, 'benchmarks', manifest.hidden.source);
    const hiddenDest = manifest.hidden.into ? path.join(workspace, manifest.hidden.into) : workspace;
    if (fs.existsSync(hiddenSrc)) copyDir(hiddenSrc, hiddenDest);
  }

  const counters = harness.telemetry.finalize(harness.session);
  const records = harness.session.replay();

  const assertResults: AssertResult[] = [];
  for (let i = 0; i < manifest.pass.length; i++) {
    assertResults.push(
      await runAssert(manifest.pass[i]!, { workspace, sessionRecords: records, counters, finalText, snapshotBefore }, i),
    );
  }

  const finishedAt = new Date();
  const durationMs = finishedAt.getTime() - startedAt.getTime();
  const success = assertResults.every((a) => a.result === 'pass');

  // JSONL report (BENCHMARK-SPEC §4.2)
  fs.mkdirSync(runDir, { recursive: true });
  const reportPath = path.join(runDir, `${runId}.jsonl`);
  const lines: string[] = [
    JSON.stringify({
      type: 'meta', runId, ts: startedAtIso, scenarioId: opts.scenarioId, harness: 'ours',
      arm: null, mode: opts.provider ? 'live' : 'offline',
      env: { harnessVersion: 'cah@0.1.0', model: opts.model, provider: opts.provider?.id ?? 'mock', temperature: 0 },
    }),
  ];
  for (const m of harness.telemetry.metrics({ durationMs })) {
    lines.push(JSON.stringify({ type: 'metric', runId, ts: finishedAt.toISOString(), metric: m.metric, name: m.name, value: m.value, unit: m.unit, source: m.source, approx: m.approx, detail: m.detail }));
  }
  for (const r of records) {
    if (r.type === 'tool/call') {
      lines.push(JSON.stringify({ type: 'event', runId, ts: finishedAt.toISOString(), kind: 'tool/call', payload: { toolCallId: r.toolCallId, toolName: r.toolName } }));
    }
    if (r.type === 'audit/denial') {
      lines.push(JSON.stringify({ type: 'event', runId, ts: finishedAt.toISOString(), kind: 'audit/denial', payload: { toolCallId: r.toolCallId, ruleRef: r.ruleRef, reason: r.reason } }));
    }
  }
  for (const a of assertResults) {
    lines.push(JSON.stringify({ type: 'assert', runId, ts: finishedAt.toISOString(), assertId: a.id, assertType: a.type, target: a.target, result: a.result, evidence: a.evidence }));
  }
  fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');

  const summary: Record<string, unknown> = {
    scenarioId: opts.scenarioId,
    runId,
    success,
    mode: opts.provider ? 'live' : 'offline',
    durationMs,
    metrics: { M01: success ? 1 : 0, ...Object.fromEntries(harness.telemetry.metrics({ durationMs }).map((m) => [m.metric, m.value])) },
    asserts: assertResults.map((a) => ({ id: a.id, type: a.type, result: a.result })),
    startedAt: startedAtIso,
    finishedAt: finishedAt.toISOString(),
    reportPath,
    sessionLog: harness.session.logPath,
  };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  return {
    scenarioId: opts.scenarioId,
    runId,
    success,
    asserts: assertResults,
    metrics: summary.metrics as Record<string, number>,
    finalText,
    startedAt: startedAtIso,
    finishedAt: finishedAt.toISOString(),
    durationMs,
    reportPath,
    workspace,
    sessionLog: harness.session.logPath,
  };
}

export { loadManifest, OFFLINE_SCRIPTS };
export type { ScenarioReport, AssertResult, ScenarioManifest } from './types.js';
