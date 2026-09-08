import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  codexAdapter,
  runCodexFixture,
  normalizeCodexRun,
  probeCodexEnv,
  CODEX_ADAPTER_ID,
  CODEX_ADAPTER_VERSION,
  codexCapabilities,
  type CodexRawRun,
  type ResultStub,
} from './codex.js';
import {
  validateRunResult,
  validateHarnessAdapter,
  assertValidRunResult,
} from '../contracts/validate.js';
import type { HarnessFixture } from '../contracts/types.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-codex-test-'));
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

/** A mock Codex CLI: returns a given JSON body / status on the injected command. */
function mockCli(raw: unknown, opts?: { status?: number; stderr?: string }): (argv: string[], c: { cwd: string }) => ResultStub {
  const status = opts?.status ?? 0;
  const stderr = opts?.stderr ?? '';
  return () => ({
    status,
    stdout: typeof raw === 'string' ? raw : JSON.stringify(raw),
    stderr,
  });
}

/** Env-probe injection so tests never touch the real Codex binary. */
const envPresent: () => boolean = () => true;
const envAbsent: () => boolean = () => false;

function codexFixture(id: string, overrides: Partial<HarnessFixture['options']> = {}): HarnessFixture {
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

const VALID_RAW: CodexRawRun = {
  success: true,
  finalText: 'CODEX-COMPLETE-ANSWER',
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

describe('adapters/codex — adapter surface (contract a-face)', () => {
  it('passes validateHarnessAdapter (id/version/run/capabilities)', () => {
    expect(validateHarnessAdapter(codexAdapter)).toEqual([]);
    expect(codexAdapter.id).toBe(CODEX_ADAPTER_ID);
    expect(codexAdapter.version).toBe(CODEX_ADAPTER_VERSION);
    expect(typeof codexAdapter.run).toBe('function');
  });

  it('capabilities are an honest Record<CapabilityKey, boolean|"tbd"> and matrix drops when env absent', () => {
    const absent = codexCapabilities(false);
    expect(absent.matrix).toBe(false);
    expect(absent.file_edit).toBe(true);
    const present = codexCapabilities(true);
    expect(present.matrix).toBe(true);
    // every key present
    for (const k of ['tool_calls','file_edit','exec','subagent','mcp','planner','evaluator','memory','skill','resume','compaction','policy','matrix']) {
      expect(present).toHaveProperty(k);
    }
  });
});

describe('adapters/codex — driver layer (injected mock Codex CLI)', () => {
  it('runs a fixture and returns a valid RunResult with §15 L3 metrics from the mock CLI', async () => {
    const fixture = codexFixture('C001', {
      runCommand: mockCli(VALID_RAW),
      _envResolve: envPresent,
    });
    const result = await runCodexFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    assertValidRunResult(result);
    expect(result.adapterId).toBe(CODEX_ADAPTER_ID);
    expect(result.adapterVersion).toBe(CODEX_ADAPTER_VERSION);
    expect(result.fixtureId).toBe('C001');
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

  it('drives the documented `codex exec -C <dir> --json <task>` command surface', async () => {
    let captured: string[] | null = null;
    const spy: (argv: string[], c: { cwd: string }) => ResultStub = (argv) => {
      captured = argv;
      return { status: 0, stdout: JSON.stringify(VALID_RAW), stderr: '' };
    };
    const fixture = codexFixture('C002', { runCommand: spy, _envResolve: envPresent });
    await runCodexFixture(fixture);
    expect(captured).not.toBeNull();
    expect(captured![0]).toBe('codex');
    expect(captured![1]).toBe('exec');
    expect(captured![2]).toBe('-C');
    expect(captured).toContain('--json');
    // task text is passed as the final arg
    expect(captured![captured!.length - 1]).toBe('Answer the question.');
  });

  it('macro: codexAdapter.run orchestrates and cleans up its temp workspace', async () => {
    const fixture = codexFixture('C003', { runCommand: mockCli(VALID_RAW), _envResolve: envPresent });
    const result = await codexAdapter.run(fixture);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    expect(ws).toBeDefined();
    expect(fs.existsSync(ws!)).toBe(false); // cleaned by adapter.run
    expect(result.metrics.success).toBe(true);
  });
});

describe('adapters/codex — collection normalization', () => {
  it('defaults missing §15 L3 fields to 0 / null and flags them approx in notes', async () => {
    // only success + tokens exposed; everything else absent
    const partial: CodexRawRun = { success: true, finalText: 'ok', inputTokens: 50, outputTokens: 20 };
    const fixture = codexFixture('C101', { runCommand: mockCli(partial), _envResolve: envPresent });
    const result = await runCodexFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.inputTokens).toBe(50);
    expect(result.metrics.wallTimeMs).toBeGreaterThanOrEqual(0); // fallback wall clock
    expect(result.metrics.invalidCalls).toBe(0);
    expect(result.metrics.resumeSuccess).toBeNull();
    const notes = result.notes?.join('') ?? '';
    expect(notes).toContain('approx');
  });

  it('normalizeCodexRun is a pure mapper usable directly', () => {
    const { acc, approxNotes } = normalizeCodexRun({ success: true, toolCalls: 4 });
    expect(acc.success).toBe(true);
    expect(acc.toolCalls).toBe(4);
    expect(acc.invalidCalls).toBe(0);
    expect(approxNotes.some((n) => n.includes('invalidCalls'))).toBe(true);
    // empty input → fully defaulted + approxy
    const empty = normalizeCodexRun(undefined);
    expect(empty.acc.success).toBe(false);
    expect(empty.approxNotes.length).toBeGreaterThan(0);
  });

  it('success is downgraded when Codex reports success but produces empty final text', async () => {
    const noText: CodexRawRun = { ...VALID_RAW, finalText: '   ' };
    const fixture = codexFixture('C102', { runCommand: mockCli(noText), _envResolve: envPresent });
    const result = await runCodexFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('empty final text');
    expect(validateRunResult(result)).toEqual([]);
  });
});

describe('adapters/codex — error & environment handling', () => {
  it('surface a run-time failure (CLI non-zero exit) as metrics.success=false, still a valid RunResult', async () => {
    const fixture = codexFixture('C201', {
      runCommand: mockCli('', { status: 2, stderr: 'codex exploded' }),
      _envResolve: envPresent,
    });
    const result = await runCodexFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('codex exploded');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('throws on hard setup error (missing fixture workspace)', async () => {
    await expect(
      runCodexFixture({ id: 'CM', workspaceRoot: path.join(tmpRoot, 'nope') }),
    ).rejects.toThrow(/fixture workspace missing/);
  });

  it('marks run pending-environment when Codex CLI is absent, without throwing', async () => {
    const fixture = codexFixture('C202', { runCommand: mockCli(VALID_RAW), _envResolve: envAbsent });
    const result = await runCodexFixture(fixture);
    expect(result.metrics.success).toBe(false); // defaulted, not a crash
    expect(result.notes?.join('')).toContain('pending-environment');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('probeCodexEnv reports the injected resolver result', () => {
    expect(probeCodexEnv('codex', envPresent)).toBe(true);
    expect(probeCodexEnv('codex', envAbsent)).toBe(false);
  });
});