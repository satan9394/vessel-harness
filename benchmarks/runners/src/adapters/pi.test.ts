import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  piAdapter,
  runPiFixture,
  normalizePiRun,
  probePiEnv,
  PI_ADAPTER_ID,
  PI_ADAPTER_VERSION,
  piCapabilities,
  type PiRawRun,
  type ResultStub,
} from './pi.js';
import {
  validateRunResult,
  validateHarnessAdapter,
  assertValidRunResult,
} from '../contracts/validate.js';
import type { HarnessFixture } from '../contracts/types.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-pi-test-'));
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

/** A mock Pi CLI: returns a given JSON body / status on the injected command. */
function mockCli(raw: unknown, opts?: { status?: number; stderr?: string }): (argv: string[], c: { cwd: string }) => ResultStub {
  const status = opts?.status ?? 0;
  const stderr = opts?.stderr ?? '';
  return () => ({
    status,
    stdout: typeof raw === 'string' ? raw : JSON.stringify(raw),
    stderr,
  });
}

/** Env-probe injection so tests never touch the real Pi binary. */
const envPresent: () => boolean = () => true;
const envAbsent: () => boolean = () => false;

function piFixture(id: string, overrides: Partial<HarnessFixture['options']> = {}): HarnessFixture {
  return {
    id,
    workspaceRoot: makeFixture(id),
    options: {
      configRoot: REPO_ROOT,
      model: 'gpt-4o',
      ...overrides,
    },
  };
}

const VALID_RAW: PiRawRun = {
  success: true,
  finalText: 'PI-COMPLETE-ANSWER',
  wallTimeMs: 612,
  toolCalls: 5,
  invalidCalls: 1,
  retries: 2,
  inputTokens: 750,
  outputTokens: 280,
  cacheReadTokens: 110,
  contextPeak: 860,
  compactions: 0,
  humanIntervention: 0,
  policyViolations: 0,
  resumeSuccess: false,
};

describe('adapters/pi — adapter surface (contract a-face)', () => {
  it('passes validateHarnessAdapter (id/version/run/capabilities)', () => {
    expect(validateHarnessAdapter(piAdapter)).toEqual([]);
    expect(piAdapter.id).toBe(PI_ADAPTER_ID);
    expect(piAdapter.version).toBe(PI_ADAPTER_VERSION);
    expect(typeof piAdapter.run).toBe('function');
  });

  it('capabilities are an honest Record<CapabilityKey, boolean|"tbd"> and matrix drops when env absent', () => {
    const absent = piCapabilities(false);
    expect(absent.matrix).toBe(false);
    expect(absent.file_edit).toBe(true);
    expect(absent.mcp).toBe(false);
    const present = piCapabilities(true);
    expect(present.matrix).toBe(true);
    // every key present
    for (const k of ['tool_calls','file_edit','exec','subagent','mcp','planner','evaluator','memory','skill','resume','compaction','policy','matrix']) {
      expect(present).toHaveProperty(k);
    }
  });
});

describe('adapters/pi — driver layer (injected mock Pi CLI)', () => {
  it('runs a fixture and returns a valid RunResult with §15 L3 metrics from the mock CLI', async () => {
    const fixture = piFixture('P001', {
      runCommand: mockCli(VALID_RAW),
      _envResolve: envPresent,
    });
    const result = await runPiFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    assertValidRunResult(result);
    expect(result.adapterId).toBe(PI_ADAPTER_ID);
    expect(result.adapterVersion).toBe(PI_ADAPTER_VERSION);
    expect(result.fixtureId).toBe('P001');
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.toolCalls).toBe(5);
    expect(result.metrics.invalidCalls).toBe(1);
    expect(result.metrics.retries).toBe(2);
    expect(result.metrics.inputTokens).toBe(750);
    expect(result.metrics.outputTokens).toBe(280);
    expect(result.metrics.cacheReadTokens).toBe(110);
    expect(result.metrics.contextPeak).toBe(860);
    expect(result.metrics.resumeSuccess).toBe(false);
    // cost computed from gpt-4o pricing table
    expect(result.metrics.costUsd).toBeGreaterThan(0);
    // artifacts point at the workspace
    expect(result.artifacts?.some((a) => a.kind === 'workspace')).toBe(true);
    // no approx notes on a fully-exposed summary
    expect(result.notes?.join('') ?? '').not.toContain('approx');
  });

  it('drives the documented `pi run --workspace <dir> --task <file> --json <task>` command surface', async () => {
    let captured: string[] | null = null;
    const spy: (argv: string[], c: { cwd: string }) => ResultStub = (argv) => {
      captured = argv;
      return { status: 0, stdout: JSON.stringify(VALID_RAW), stderr: '' };
    };
    const fixture = piFixture('P002', { runCommand: spy, _envResolve: envPresent });
    await runPiFixture(fixture);
    expect(captured).not.toBeNull();
    expect(captured![0]).toBe('pi');
    expect(captured![1]).toBe('run');
    expect(captured).toContain('--json');
    expect(captured).toContain('--workspace');
    expect(captured).toContain('--task');
    // task text is passed as the final arg
    expect(captured![captured!.length - 1]).toBe('Answer the question.');
  });

  it('macro: piAdapter.run orchestrates and cleans up its temp workspace', async () => {
    const fixture = piFixture('P003', { runCommand: mockCli(VALID_RAW), _envResolve: envPresent });
    const result = await piAdapter.run(fixture);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    expect(ws).toBeDefined();
    expect(fs.existsSync(ws!)).toBe(false); // cleaned by adapter.run
    expect(result.metrics.success).toBe(true);
  });
});

describe('adapters/pi — collection normalization', () => {
  it('defaults missing §15 L3 fields to 0 / null and flags them approx in notes', async () => {
    // only success + tokens exposed; everything else absent
    const partial: PiRawRun = { success: true, finalText: 'ok', inputTokens: 50, outputTokens: 20 };
    const fixture = piFixture('P101', { runCommand: mockCli(partial), _envResolve: envPresent });
    const result = await runPiFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.inputTokens).toBe(50);
    expect(result.metrics.wallTimeMs).toBeGreaterThanOrEqual(0); // fallback wall clock
    expect(result.metrics.invalidCalls).toBe(0);
    expect(result.metrics.resumeSuccess).toBeNull();
    const notes = result.notes?.join('') ?? '';
    expect(notes).toContain('approx');
  });

  it('normalizePiRun is a pure mapper usable directly', () => {
    const { acc, approxNotes } = normalizePiRun({ success: true, toolCalls: 4 });
    expect(acc.success).toBe(true);
    expect(acc.toolCalls).toBe(4);
    expect(acc.invalidCalls).toBe(0);
    expect(approxNotes.some((n) => n.includes('invalidCalls'))).toBe(true);
    // empty input → fully defaulted + approxy
    const empty = normalizePiRun(undefined);
    expect(empty.acc.success).toBe(false);
    expect(empty.approxNotes.length).toBeGreaterThan(0);
  });

  it('success is downgraded when Pi reports success but produces empty final text', async () => {
    const noText: PiRawRun = { ...VALID_RAW, finalText: '   ' };
    const fixture = piFixture('P102', { runCommand: mockCli(noText), _envResolve: envPresent });
    const result = await runPiFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('empty final text');
    expect(validateRunResult(result)).toEqual([]);
  });
});

describe('adapters/pi — error & environment handling', () => {
  it('surface a run-time failure (CLI non-zero exit) as metrics.success=false, still a valid RunResult', async () => {
    const fixture = piFixture('P201', {
      runCommand: mockCli('', { status: 2, stderr: 'pi exploded' }),
      _envResolve: envPresent,
    });
    const result = await runPiFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('pi exploded');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('throws on hard setup error (missing fixture workspace)', async () => {
    await expect(
      runPiFixture({ id: 'PM', workspaceRoot: path.join(tmpRoot, 'nope') }),
    ).rejects.toThrow(/fixture workspace missing/);
  });

  it('marks run pending-environment when Pi CLI is absent, without throwing', async () => {
    const fixture = piFixture('P202', { runCommand: mockCli(VALID_RAW), _envResolve: envAbsent });
    const result = await runPiFixture(fixture);
    expect(result.metrics.success).toBe(false); // defaulted, not a crash
    expect(result.notes?.join('')).toContain('pending-environment');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('probePiEnv reports the injected resolver result', () => {
    expect(probePiEnv('pi', envPresent)).toBe(true);
    expect(probePiEnv('pi', envAbsent)).toBe(false);
  });
});