import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  dshAdapter,
  runDshFixture,
  normalizeDshRun,
  probeDshEnv,
  DSH_ADAPTER_ID,
  DSH_ADAPTER_VERSION,
  dshCapabilities,
  type DshRawRun,
  type ResultStub,
} from './dsh.js';
import {
  validateRunResult,
  validateHarnessAdapter,
  assertValidRunResult,
} from '../contracts/validate.js';
import type { HarnessFixture } from '../contracts/types.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-dsh-test-'));
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

/** A mock DSH CLI: returns a given JSON body / status on the injected command. */
function mockCli(raw: unknown, opts?: { status?: number; stderr?: string }): (argv: string[], c: { cwd: string }) => ResultStub {
  const status = opts?.status ?? 0;
  const stderr = opts?.stderr ?? '';
  return () => ({
    status,
    stdout: typeof raw === 'string' ? raw : JSON.stringify(raw),
    stderr,
  });
}

/** Env-probe injection so tests never touch the real DSH binary. */
const envPresent: (() => boolean) = () => true;
const envAbsent: (() => boolean) = () => false;

function dshFixture(id: string, overrides: Partial<HarnessFixture['options']> = {}): HarnessFixture {
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

const VALID_RAW: DshRawRun = {
  success: true,
  finalText: 'DSH-COMPLETE-ANSWER',
  wallTimeMs: 512,
  toolCalls: 3,
  invalidCalls: 0,
  retries: 1,
  inputTokens: 900,
  outputTokens: 300,
  cacheReadTokens: 100,
  contextPeak: 1000,
  compactions: 0,
  humanIntervention: 0,
  policyViolations: 0,
  resumeSuccess: false,
};

describe('adapters/dsh — adapter surface (contract a-face)', () => {
  it('passes validateHarnessAdapter (id/version/run/capabilities)', () => {
    expect(validateHarnessAdapter(dshAdapter)).toEqual([]);
    expect(dshAdapter.id).toBe(DSH_ADAPTER_ID);
    expect(dshAdapter.version).toBe(DSH_ADAPTER_VERSION);
    expect(typeof dshAdapter.run).toBe('function');
  });

  it('capabilities are an honest Record<CapabilityKey, boolean|"tbd"> and matrix drops when env absent', () => {
    const absent = dshCapabilities(false);
    expect(absent.matrix).toBe(false);
    expect(absent.file_edit).toBe(true);
    const present = dshCapabilities(true);
    expect(present.matrix).toBe(true);
    // every key present
    for (const k of ['tool_calls','file_edit','exec','subagent','mcp','planner','evaluator','memory','skill','resume','compaction','policy','matrix']) {
      expect(present).toHaveProperty(k);
    }
  });
});

describe('adapters/dsh — driver layer (injected mock DSH CLI)', () => {
  it('runs a fixture and returns a valid RunResult with §15 L3 metrics from the mock CLI', async () => {
    const fixture = dshFixture('Z001', {
      runCommand: mockCli(VALID_RAW),
      _envResolve: envPresent,
    });
    const result = await runDshFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    assertValidRunResult(result);
    expect(result.adapterId).toBe(DSH_ADAPTER_ID);
    expect(result.adapterVersion).toBe(DSH_ADAPTER_VERSION);
    expect(result.fixtureId).toBe('Z001');
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.toolCalls).toBe(3);
    expect(result.metrics.invalidCalls).toBe(0);
    expect(result.metrics.retries).toBe(1);
    expect(result.metrics.inputTokens).toBe(900);
    expect(result.metrics.outputTokens).toBe(300);
    expect(result.metrics.cacheReadTokens).toBe(100);
    expect(result.metrics.contextPeak).toBe(1000);
    expect(result.metrics.resumeSuccess).toBe(false);
    // cost computed from deepseek-chat pricing table
    expect(result.metrics.costUsd).toBeGreaterThan(0);
    // artifacts point at the workspace
    expect(result.artifacts?.some((a) => a.kind === 'workspace')).toBe(true);
    // no approx notes on a fully-exposed summary
    expect(result.notes?.join('') ?? '').not.toContain('approx');
  });

  it('macro: dshAdapter.run orchestrates and cleans up its temp workspace', async () => {
    const fixture = dshFixture('Z002', { runCommand: mockCli(VALID_RAW), _envResolve: envPresent });
    const result = await dshAdapter.run(fixture);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    expect(ws).toBeDefined();
    expect(fs.existsSync(ws!)).toBe(false); // cleaned by adapter.run
    expect(result.metrics.success).toBe(true);
  });
});

describe('adapters/dsh — collection normalization', () => {
  it('defaults missing §15 L3 fields to 0 / null and flags them approx in notes', async () => {
    // only success + tokens exposed; everything else absent
    const partial: DshRawRun = { success: true, finalText: 'ok', inputTokens: 50, outputTokens: 20 };
    const fixture = dshFixture('Z003', { runCommand: mockCli(partial), _envResolve: envPresent });
    const result = await runDshFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.inputTokens).toBe(50);
    expect(result.metrics.wallTimeMs).toBeGreaterThanOrEqual(0); // fallback wall clock
    expect(result.metrics.invalidCalls).toBe(0);
    expect(result.metrics.resumeSuccess).toBeNull();
    const notes = result.notes?.join('') ?? '';
    expect(notes).toContain('approx');
  });

  it('normalizeDshRun is a pure mapper usable directly', () => {
    const { acc, approxNotes } = normalizeDshRun({ success: true, toolCalls: 4 });
    expect(acc.success).toBe(true);
    expect(acc.toolCalls).toBe(4);
    expect(acc.invalidCalls).toBe(0);
    expect(approxNotes.some((n) => n.includes('invalidCalls'))).toBe(true);
    // empty input → fully defaulted + approxy
    const empty = normalizeDshRun(undefined);
    expect(empty.acc.success).toBe(false);
    expect(empty.approxNotes.length).toBeGreaterThan(0);
  });

  it('success is downgraded when DSH reports success but produces empty final text', async () => {
    const noText: DshRawRun = { ...VALID_RAW, finalText: '   ' };
    const fixture = dshFixture('Z004', { runCommand: mockCli(noText), _envResolve: envPresent });
    const result = await runDshFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('empty final text');
    expect(validateRunResult(result)).toEqual([]);
  });
});

describe('adapters/dsh — error & environment handling', () => {
  it('surface a run-time failure (CLI non-zero exit) as metrics.success=false, still a valid RunResult', async () => {
    const fixture = dshFixture('Z005', {
      runCommand: mockCli('', { status: 2, stderr: 'dsh exploded' }),
      _envResolve: envPresent,
    });
    const result = await runDshFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('dsh exploded');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('throws on hard setup error (missing fixture workspace)', async () => {
    await expect(
      runDshFixture({ id: 'ZM', workspaceRoot: path.join(tmpRoot, 'nope') }),
    ).rejects.toThrow(/fixture workspace missing/);
  });

  it('marks run pending-environment when DSH CLI is absent, without throwing', async () => {
    const fixture = dshFixture('Z006', { runCommand: mockCli(VALID_RAW), _envResolve: envAbsent });
    const result = await runDshFixture(fixture);
    expect(result.metrics.success).toBe(false); // defaulted, not a crash
    expect(result.notes?.join('')).toContain('pending-environment');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('probeDshEnv reports the injected resolver result', () => {
    expect(probeDshEnv('dsh', envPresent)).toBe(true);
    expect(probeDshEnv('dsh', envAbsent)).toBe(false);
  });
});