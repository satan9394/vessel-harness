/**
 * task 076 — Vessel self-adapter (self-hosting).
 *
 * Proves the Harness Adapter Contract is usable and testable WITHOUT an
 * external harness: it runs a fixture through the local engine (composeHarness
 * → AgentLoop turn) and collects a §15 L3 RunResult from the real telemetry.
 * External adapters (077-081) implement the SAME HarnessAdapter surface.
 *
 * Isolation: the fixture workspace is copied into a temp dir (the adapter never
 * mutates the pristine fixture in benchmarks/fixtures). Cost is estimated from
 * configs/pricing.json via the same fallback chain as apps/cli/providers/pricing.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { composeHarness, type ComposeOptions } from '@vessel/cli';
import type { ChatProvider, ChatResponse, ChatRequest } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import { OFFLINE_SCRIPTS } from '../offline.js';
import { assertValidHarnessAdapter, assertValidRunResult } from './validate.js';
import type { CapabilityKey, HarnessAdapter, HarnessFixture, RunResult } from './types.js';

/** Per-fixture option keys the Vessel self-adapter reads from fixture.options. */
export interface VesselRunOptions {
  provider?: ChatProvider | null;
  model?: string;
  policySystemPath?: string;
  behaviorIRPath?: string;
  /** repo/config root used to resolve configs/pricing.json, policy, behavior. */
  configRoot?: string;
  /** keep the temp workspace for debugging (tests delete it). */
  keepWorkspace?: boolean;
}

export const VESSEL_ADAPTER_ID = 'vessel';
export const VESSEL_ADAPTER_VERSION = '0.1.0';

/** Vessel self-adapter capability map (§15 L1/L3 — the engine implements all). */
export function vesselCapabilities(): Record<CapabilityKey, boolean | 'tbd'> {
  return {
    tool_calls: true,
    file_edit: true,
    exec: true,
    subagent: true,
    mcp: true,
    planner: true,
    evaluator: true,
    memory: true,
    skill: true,
    resume: false, // self-adapter does one isolated run per fixture (no resume yet)
    compaction: true,
    policy: true,
    matrix: true,
  };
}

/** Wrap a provider to track per-request context peak (max input+cacheRead). */
function trackingProvider(base: ChatProvider, peak: { value: number }): ChatProvider {
  return {
    id: base.id,
    async chat(req: ChatRequest): Promise<ChatResponse> {
      const res = await base.chat(req);
      const usage = res.usage ?? { inputTokens: 0, outputTokens: 0 };
      const input = usage.inputTokens ?? 0;
      const cache = usage.cacheReadTokens ?? 0;
      const total = input + cache;
      if (total > peak.value) peak.value = total;
      return res;
    },
    stream: base.stream
      ? (req) => base.stream!(req)
      : undefined,
  };
}

/** Load per-1M-token prices from configs/pricing.json (fallback chain). */
export interface TokenPrice {
  input: number;
  output: number;
  cacheRead?: number;
}
function loadPrices(configRoot: string, model: string, protocol?: string): TokenPrice {
  const fallback: TokenPrice = { input: 0.5, output: 1.5, cacheRead: 0.1 };
  let table: { models?: Record<string, TokenPrice>; protocols?: Record<string, TokenPrice> } = {};
  try {
    table = JSON.parse(fs.readFileSync(path.join(configRoot, 'configs', 'pricing.json'), 'utf8'));
  } catch {
    /* corrupt/missing → default */
  }
  const byModel = table.models?.[model];
  if (byModel) return byModel;
  const protoKey = protocol && table.protocols?.[protocol] ? protocol : 'openai-compatible';
  const byProto = table.protocols?.[protoKey];
  if (byProto) return byProto;
  return table.models?.default ?? fallback;
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
 * Run one fixture through the local harness and return a validated RunResult.
 * The workspace is a temp copy (default) so the source fixture is never touched.
 */
export async function runVesselFixture(fixture: HarnessFixture): Promise<RunResult> {
  const opts = (fixture.options ?? {}) as VesselRunOptions;
  const model = opts.model ?? 'mock-model';
  const configRoot = opts.configRoot ?? process.cwd();
  const policyPath = opts.policySystemPath ?? path.join(configRoot, 'configs', 'policy.default.yaml');
  const behaviorIRPath = opts.behaviorIRPath ?? path.join(configRoot, 'configs', 'behavior.default.yaml');

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();

  // isolation: temp copy of the fixture workspace
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `cah-vessel-${fixture.id}-`));
  copyDir(fixture.workspaceRoot, workspace);
  const taskFile = fixture.taskFile ?? 'task.md';
  const taskPath = path.join(workspace, taskFile);
  const task = fs.existsSync(taskPath) ? fs.readFileSync(taskPath, 'utf8').trim() : '';

  const peak = { value: 0 };
  const baseProvider =
    opts.provider ?? new MockProvider(OFFLINE_SCRIPTS[fixture.id] ?? [], { model, vars: { cwd: workspace } });
  const provider = trackingProvider(baseProvider, peak);

  const composeOpts: ComposeOptions = {
    workspaceRoot: workspace,
    provider,
    model,
    policySystemPath: policyPath,
    behaviorIRPath,
  };

  const harness = await composeHarness(composeOpts);
  let finalText = '';
  let runError: unknown = null;
  try {
    const res = await harness.loop.runTurn(task);
    finalText = res.finalText;
  } catch (err) {
    runError = err;
  } finally {
    await harness.close();
  }

  const wallTimeMs = Date.now() - startedMs;
  const counters = harness.telemetry.finalize(harness.session);
  const records = harness.session.replay();

  // policy violations = audit/denial count (+ policy_decision deny via counters)
  let policyViolations = 0;
  for (const r of records) {
    if (r.type === 'audit/denial') policyViolations += 1;
  }
  policyViolations = Math.max(policyViolations, counters.denials);

  // humanIntervention ≈ approval asks steered to humans (CI all-auto → 0)
  const humanIntervention = counters.approvalAsks;

  // context peak: per-request max input+cacheRead captured by the provider wrap
  const contextPeak = peak.value;

  const prices = loadPrices(configRoot, model, (opts.provider ? undefined : 'openai-compatible'));
  // prefer usage recorded on the provider via telemetry counters
  const inputTokens = counters.inputTokens;
  const outputTokens = counters.outputTokens;
  const cacheReadTokens = counters.cacheReadTokens;
  const costUsd =
    (inputTokens / 1_000_000) * (prices.input ?? 0) +
    (outputTokens / 1_000_000) * (prices.output ?? 0) +
    (cacheReadTokens / 1_000_000) * (prices.cacheRead ?? 0);

  const success = runError === null && finalText.trim().length > 0;
  const metrics = {
    success,
    wallTimeMs,
    toolCalls: counters.toolCalls,
    invalidCalls: counters.invalidArgs,
    retries: counters.retries,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    costUsd,
    contextPeak,
    compactions: counters.compactions,
    humanIntervention,
    policyViolations,
    resumeSuccess: false,
  };

  const result: RunResult = {
    adapterId: VESSEL_ADAPTER_ID,
    adapterVersion: VESSEL_ADAPTER_VERSION,
    fixtureId: fixture.id,
    metrics,
    startedAt,
    artifacts: [
      { kind: 'session', path: harness.session.logPath },
      { kind: 'workspace', path: workspace },
    ],
    notes: runError ? [`run raised: ${String(runError)}`] : undefined,
  };

  assertValidRunResult(result);
  return result;
}

/**
 * The Vessel HarnessAdapter instance (task 076 self-adapter). External
 * adapters mirror this shape (id/version/run/capabilities) and pass the same
 * validation.
 */
export const vesselAdapter: HarnessAdapter = {
  id: VESSEL_ADAPTER_ID,
  version: VESSEL_ADAPTER_VERSION,
  capabilities: vesselCapabilities(),
  async run(fixture: HarnessFixture): Promise<RunResult> {
    assertValidHarnessAdapter(this);
    const result = await runVesselFixture(fixture);
    // cleanup the temp workspace unless the caller asked to keep it
    const keep = Boolean((fixture.options ?? {}).keepWorkspace);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    if (ws && !keep) {
      try {
        fs.rmSync(ws, { recursive: true, force: true });
      } catch {
        /* best-effort; temp dir is OS-managed */
      }
    }
    return result;
  },
};