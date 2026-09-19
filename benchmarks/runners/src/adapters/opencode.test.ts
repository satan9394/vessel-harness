import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  opencodeAdapter,
  runOpencodeFixture,
  normalizeOpencodeRun,
  probeOpencodeEnv,
  OPENCODE_ADAPTER_ID,
  OPENCODE_ADAPTER_VERSION,
  opencodeCapabilities,
  type OpencodeRawRun,
  type ResultStub,
} from './opencode.js';
import {
  validateRunResult,
  validateHarnessAdapter,
  assertValidRunResult,
} from '../contracts/validate.js';
import type { HarnessFixture } from '../contracts/types.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-opencode-test-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

function makeFixture(id: string, task = 'Answer the question.'): string {
  const dir = path.join(tmpRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), task, 'utf8');
  return dir;
}

/** A mock OpenCode CLI: returns a given JSON body / status on the injected command. */
function mockCli(raw: unknown, opts?: { status?: number; stderr?: string }): (argv: string[], c: { cwd: string }) => ResultStub {
  const status = opts?.status ?? 0;
  const stderr = opts?.stderr ?? '';
  return () => ({
    status,
    stdout: typeof raw === 'string' ? raw : JSON.stringify(raw),
    stderr,
  });
}

/** Env-probe injection so tests never touch the real OpenCode binary. */
const envPresent: () => boolean = () => true;
const envAbsent: () => boolean = () => false;

function opencodeFixture(id: string, overrides: Partial<HarnessFixture['options']> = {}): HarnessFixture {
  return {
    id,
    workspaceRoot: makeFixture(id),
    options: {
      configRoot: REPO_ROOT,
      model: 'deepseek-chat',
      ...overrides,
    },
  };
}

const VALID_RAW: OpencodeRawRun = {
  success: true,
  finalText: 'OPENCODE-COMPLETE-ANSWER',
  wallTimeMs: 412,
  toolCalls: 4,
  invalidCalls: 0,
  retries: 2,
  inputTokens: 800,
  outputTokens: 250,
  cacheReadTokens: 90,
  contextPeak: 900,
  compactions: 0,
  humanIntervention: 0,
  policyViolations: 0,
  resumeSuccess: false,
};

describe('adapters/opencode — adapter surface (contract a-face)', () => {
  it('passes validateHarnessAdapter (id/version/run/capabilities)', () => {
    expect(validateHarnessAdapter(opencodeAdapter)).toEqual([]);
    expect(opencodeAdapter.id).toBe(OPENCODE_ADAPTER_ID);
    expect(opencodeAdapter.version).toBe(OPENCODE_ADAPTER_VERSION);
    expect(typeof opencodeAdapter.run).toBe('function');
  });

  it('capabilities are an honest Record<CapabilityKey, boolean|"tbd"> and matrix drops when env absent', () => {
    const absent = opencodeCapabilities(false);
    expect(absent.matrix).toBe(false);
    expect(absent.file_edit).toBe(true);
    const present = opencodeCapabilities(true);
    expect(present.matrix).toBe(true);
    // every key present
    for (const k of ['tool_calls','file_edit','exec','subagent','mcp','planner','evaluator','memory','skill','resume','compaction','policy','matrix']) {
      expect(present).toHaveProperty(k);
    }
  });
});

describe('adapters/opencode — driver layer (injected mock OpenCode CLI)', () => {
  it('runs a fixture and returns a valid RunResult with §15 L3 metrics from the mock CLI', async () => {
    const fixture = opencodeFixture('Z101', {
      runCommand: mockCli(VALID_RAW),
      _envResolve: envPresent,
    });
    const result = await runOpencodeFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    assertValidRunResult(result);
    expect(result.adapterId).toBe(OPENCODE_ADAPTER_ID);
    expect(result.adapterVersion).toBe(OPENCODE_ADAPTER_VERSION);
    expect(result.fixtureId).toBe('Z101');
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.toolCalls).toBe(4);
    expect(result.metrics.invalidCalls).toBe(0);
    expect(result.metrics.retries).toBe(2);
    expect(result.metrics.inputTokens).toBe(800);
    expect(result.metrics.outputTokens).toBe(250);
    expect(result.metrics.cacheReadTokens).toBe(90);
    expect(result.metrics.contextPeak).toBe(900);
    expect(result.metrics.resumeSuccess).toBe(false);
    // cost computed from deepseek-chat pricing table
    expect(result.metrics.costUsd).toBeGreaterThan(0);
    // artifacts point at the workspace
    expect(result.artifacts?.some((a) => a.kind === 'workspace')).toBe(true);
    // no approx notes on a fully-exposed summary
    expect(result.notes?.join('') ?? '').not.toContain('approx');
  });

  it('macro: opencodeAdapter.run orchestrates and cleans up its temp workspace', async () => {
    const fixture = opencodeFixture('Z102', { runCommand: mockCli(VALID_RAW), _envResolve: envPresent });
    const result = await opencodeAdapter.run(fixture);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    expect(ws).toBeDefined();
    expect(fs.existsSync(ws!)).toBe(false); // cleaned by adapter.run
    expect(result.metrics.success).toBe(true);
  });
});

describe('adapters/opencode — collection normalization', () => {
  it('defaults missing §15 L3 fields to 0 / null and flags them approx in notes', async () => {
    // only success + tokens exposed; everything else absent
    const partial: OpencodeRawRun = { success: true, finalText: 'ok', inputTokens: 50, outputTokens: 20 };
    const fixture = opencodeFixture('Z103', { runCommand: mockCli(partial), _envResolve: envPresent });
    const result = await runOpencodeFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.inputTokens).toBe(50);
    expect(result.metrics.wallTimeMs).toBeGreaterThanOrEqual(0); // fallback wall clock
    expect(result.metrics.invalidCalls).toBe(0);
    expect(result.metrics.resumeSuccess).toBeNull();
    const notes = result.notes?.join('') ?? '';
    expect(notes).toContain('approx');
  });

  it('normalizeOpencodeRun is a pure mapper usable directly', () => {
    const { acc, approxNotes } = normalizeOpencodeRun({ success: true, toolCalls: 4 });
    expect(acc.success).toBe(true);
    expect(acc.toolCalls).toBe(4);
    expect(acc.invalidCalls).toBe(0);
    expect(approxNotes.some((n) => n.includes('invalidCalls'))).toBe(true);
    // empty input → fully defaulted + approxy
    const empty = normalizeOpencodeRun(undefined);
    expect(empty.acc.success).toBe(false);
    expect(empty.approxNotes.length).toBeGreaterThan(0);
  });

  it('success is downgraded when OpenCode reports success but produces empty final text', async () => {
    const noText: OpencodeRawRun = { ...VALID_RAW, finalText: '   ' };
    const fixture = opencodeFixture('Z104', { runCommand: mockCli(noText), _envResolve: envPresent });
    const result = await runOpencodeFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('empty final text');
    expect(validateRunResult(result)).toEqual([]);
  });
});

describe('adapters/opencode — error & environment handling', () => {
  it('surface a run-time failure (CLI non-zero exit) as metrics.success=false, still a valid RunResult', async () => {
    const fixture = opencodeFixture('Z105', {
      runCommand: mockCli('', { status: 2, stderr: 'opencode exploded' }),
      _envResolve: envPresent,
    });
    const result = await runOpencodeFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('opencode exploded');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('throws on hard setup error (missing fixture workspace)', async () => {
    await expect(
      runOpencodeFixture({ id: 'ZM', workspaceRoot: path.join(tmpRoot, 'nope') }),
    ).rejects.toThrow(/fixture workspace missing/);
  });

  it('marks run pending-environment when OpenCode CLI is absent, without throwing', async () => {
    const fixture = opencodeFixture('Z106', { runCommand: mockCli(VALID_RAW), _envResolve: envAbsent });
    const result = await runOpencodeFixture(fixture);
    expect(result.metrics.success).toBe(false); // defaulted, not a crash
    expect(result.notes?.join('')).toContain('pending-environment');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('probeOpencodeEnv reports the injected resolver result', () => {
    expect(probeOpencodeEnv('opencode', envPresent)).toBe(true);
    expect(probeOpencodeEnv('opencode', envAbsent)).toBe(false);
  });
});