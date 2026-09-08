import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  claudeAdapter,
  runClaudeFixture,
  normalizeClaudeRun,
  probeClaudeEnv,
  CLAUDE_ADAPTER_ID,
  CLAUDE_ADAPTER_VERSION,
  CLAUDE_PRINT_FLAG,
  claudeCapabilities,
  type ClaudeRawRun,
  type ResultStub,
} from './claude.js';
import {
  validateRunResult,
  validateHarnessAdapter,
  assertValidRunResult,
} from '../contracts/validate.js';
import type { HarnessFixture } from '../contracts/types.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-claude-test-'));
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

/** A mock Claude Code CLI: returns a given JSON body / status on the injected command. */
function mockCli(raw: unknown, opts?: { status?: number; stderr?: string }): (argv: string[], c: { cwd: string }) => ResultStub {
  const status = opts?.status ?? 0;
  const stderr = opts?.stderr ?? '';
  return () => ({
    status,
    stdout: typeof raw === 'string' ? raw : JSON.stringify(raw),
    stderr,
  });
}

/** Env-probe injection so tests never touch the real claude binary. */
const envPresent: () => boolean = () => true;
const envAbsent: () => boolean = () => false;

function claudeFixture(id: string, overrides: Partial<HarnessFixture['options']> = {}): HarnessFixture {
  return {
    id,
    workspaceRoot: makeFixture(id),
    options: {
      configRoot: REPO_ROOT,
      model: 'claude-sonnet-4-5',
      ...overrides,
    },
  };
}

const VALID_RAW: ClaudeRawRun = {
  success: true,
  finalText: 'CLAUDE-COMPLETE-ANSWER',
  wallTimeMs: 812,
  toolCalls: 6,
  invalidCalls: 0,
  retries: 1,
  inputTokens: 980,
  outputTokens: 240,
  cacheReadTokens: 420,
  contextPeak: 1400,
  compactions: 0,
  humanIntervention: 0,
  policyViolations: 0,
  resumeSuccess: false,
};

describe('adapters/claude — adapter surface (contract a-face)', () => {
  it('passes validateHarnessAdapter (id/version/run/capabilities)', () => {
    expect(validateHarnessAdapter(claudeAdapter)).toEqual([]);
    expect(claudeAdapter.id).toBe(CLAUDE_ADAPTER_ID);
    expect(claudeAdapter.version).toBe(CLAUDE_ADAPTER_VERSION);
    expect(typeof claudeAdapter.run).toBe('function');
  });

  it('capabilities are an honest Record<CapabilityKey, boolean|"tbd"> and matrix drops when env absent', () => {
    const absent = claudeCapabilities(false);
    expect(absent.matrix).toBe(false);
    expect(absent.file_edit).toBe(true);
    expect(absent.mcp).toBe(false);
    const present = claudeCapabilities(true);
    expect(present.matrix).toBe(true);
    // every key present
    for (const k of ['tool_calls','file_edit','exec','subagent','mcp','planner','evaluator','memory','skill','resume','compaction','policy','matrix']) {
      expect(present).toHaveProperty(k);
    }
  });
});

describe('adapters/claude — driver layer (injected mock claude CLI)', () => {
  it('runs a fixture and returns a valid RunResult with §15 L3 metrics from the mock CLI', async () => {
    const fixture = claudeFixture('C001', {
      runCommand: mockCli(VALID_RAW),
      _envResolve: envPresent,
    });
    const result = await runClaudeFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    assertValidRunResult(result);
    expect(result.adapterId).toBe(CLAUDE_ADAPTER_ID);
    expect(result.adapterVersion).toBe(CLAUDE_ADAPTER_VERSION);
    expect(result.fixtureId).toBe('C001');
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.toolCalls).toBe(6);
    expect(result.metrics.invalidCalls).toBe(0);
    expect(result.metrics.retries).toBe(1);
    expect(result.metrics.inputTokens).toBe(980);
    expect(result.metrics.outputTokens).toBe(240);
    expect(result.metrics.cacheReadTokens).toBe(420);
    expect(result.metrics.contextPeak).toBe(1400);
    expect(result.metrics.resumeSuccess).toBe(false);
    // cost computed from pricing table (never zero when tokens > 0)
    expect(result.metrics.costUsd).toBeGreaterThan(0);
    // artifacts point at the workspace
    expect(result.artifacts?.some((a) => a.kind === 'workspace')).toBe(true);
    // no approx notes on a fully-exposed summary
    expect(result.notes?.join('') ?? '').not.toContain('approx');
  });

  it('drives the documented headless print surface `claude -p --output-format json <task>`', async () => {
    let captured: string[] | null = null;
    const spy: (argv: string[], c: { cwd: string }) => ResultStub = (argv) => {
      captured = argv;
      return { status: 0, stdout: JSON.stringify(VALID_RAW), stderr: '' };
    };
    const fixture = claudeFixture('C002', { runCommand: spy, _envResolve: envPresent });
    await runClaudeFixture(fixture);
    expect(captured).not.toBeNull();
    expect(captured![0]).toBe('claude');
    expect(captured![1]).toBe(CLAUDE_PRINT_FLAG);
    expect(captured).toContain('--output-format');
    expect(captured).toContain('json');
    // task text is passed as the final arg
    expect(captured![captured!.length - 1]).toBe('Answer the question.');
  });

  it('macro: claudeAdapter.run orchestrates and cleans up its temp workspace', async () => {
    const fixture = claudeFixture('C003', { runCommand: mockCli(VALID_RAW), _envResolve: envPresent });
    const result = await claudeAdapter.run(fixture);
    const ws = result.artifacts?.find((a) => a.kind === 'workspace')?.path;
    expect(ws).toBeDefined();
    expect(fs.existsSync(ws!)).toBe(false); // cleaned by adapter.run
    expect(result.metrics.success).toBe(true);
  });
});

describe('adapters/claude — collection normalization', () => {
  it('defaults missing §15 L3 fields to 0 / null and flags them approx in notes', async () => {
    // only success + tokens exposed; everything else absent
    const partial: ClaudeRawRun = { success: true, finalText: 'ok', inputTokens: 60, outputTokens: 30 };
    const fixture = claudeFixture('C101', { runCommand: mockCli(partial), _envResolve: envPresent });
    const result = await runClaudeFixture(fixture);
    expect(validateRunResult(result)).toEqual([]);
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.inputTokens).toBe(60);
    expect(result.metrics.wallTimeMs).toBeGreaterThanOrEqual(0); // fallback wall clock
    expect(result.metrics.invalidCalls).toBe(0);
    expect(result.metrics.resumeSuccess).toBeNull();
    const notes = result.notes?.join('') ?? '';
    expect(notes).toContain('approx');
  });

  it('normalizeClaudeRun is a pure mapper usable directly', () => {
    const { acc, approxNotes } = normalizeClaudeRun({ success: true, toolCalls: 4 });
    expect(acc.success).toBe(true);
    expect(acc.toolCalls).toBe(4);
    expect(acc.invalidCalls).toBe(0);
    expect(approxNotes.some((n) => n.includes('invalidCalls'))).toBe(true);
    // empty input → fully defaulted + approxy
    const empty = normalizeClaudeRun(undefined);
    expect(empty.acc.success).toBe(false);
    expect(empty.approxNotes.length).toBeGreaterThan(0);
  });

  it('success is downgraded when Claude Code reports success but produces empty final text', async () => {
    const noText: ClaudeRawRun = { ...VALID_RAW, finalText: '   ' };
    const fixture = claudeFixture('C102', { runCommand: mockCli(noText), _envResolve: envPresent });
    const result = await runClaudeFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('empty final text');
    expect(validateRunResult(result)).toEqual([]);
  });
});

describe('adapters/claude — error & environment handling', () => {
  it('surface a run-time failure (CLI non-zero exit) as metrics.success=false, still a valid RunResult', async () => {
    const fixture = claudeFixture('C201', {
      runCommand: mockCli('', { status: 2, stderr: 'claude exploded' }),
      _envResolve: envPresent,
    });
    const result = await runClaudeFixture(fixture);
    expect(result.metrics.success).toBe(false);
    expect(result.notes?.join('')).toContain('claude exploded');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('throws on hard setup error (missing fixture workspace)', async () => {
    await expect(
      runClaudeFixture({ id: 'CM', workspaceRoot: path.join(tmpRoot, 'nope') }),
    ).rejects.toThrow(/fixture workspace missing/);
  });

  it('marks run pending-environment when Claude Code is absent, without throwing', async () => {
    const fixture = claudeFixture('C202', { runCommand: mockCli(VALID_RAW), _envResolve: envAbsent });
    const result = await runClaudeFixture(fixture);
    expect(result.metrics.success).toBe(false); // defaulted, not a crash
    expect(result.notes?.join('')).toContain('pending-environment');
    expect(validateRunResult(result)).toEqual([]);
  });

  it('probeClaudeEnv reports the injected resolver result', () => {
    expect(probeClaudeEnv('claude', envPresent)).toBe(true);
    expect(probeClaudeEnv('claude', envAbsent)).toBe(false);
  });
});