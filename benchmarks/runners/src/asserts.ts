import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionRecord } from '@vessel/shared';
import type { TelemetryCounters } from '@vessel/telemetry';
import { runCommand } from '@vessel/runtime';
import type { AssertResult, AssertionSpec } from './types.js';

/** minimal glob -> regex (runner-local; supports **, *, ?) */
function globToRegExp(pattern: string): RegExp {
  const parts = pattern
    .split(/(\*\*|\*|\?)/g)
    .map((p) => {
      if (p === '**') return '.*';
      if (p === '*') return '[^/]*';
      if (p === '?') return '[^/]';
      return p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${parts}$`);
}

const TOOL_FAMILY: Record<string, string> = {
  Read: 'file_read',
  Write: 'file_write',
  Edit: 'file_write',
  Glob: 'search',
  Grep: 'search',
  Shell: 'exec',
};

export interface AssertContext {
  workspace: string;
  sessionRecords: readonly SessionRecord[];
  counters: TelemetryCounters;
  finalText: string;
  snapshotBefore: Map<string, string>;
}

function walk(dir: string, base: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === '.harness') continue;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (e.isDirectory()) walk(full, base, out);
    else if (e.isFile()) out.push(rel);
  }
}

function currentSnapshot(workspace: string): Map<string, string> {
  const out = new Map<string, string>();
  const files: string[] = [];
  walk(workspace, workspace, files);
  for (const rel of files) {
    const p = path.join(workspace, rel);
    try {
      const data = fs.readFileSync(p);
      out.set(rel, crypto.createHash('sha256').update(data).digest('hex'));
    } catch {
      // unreadable — treat as missing
    }
  }
  return out;
}

function toolFamiliesUsed(records: readonly SessionRecord[]): { seen: Set<string>; readonlyExec: boolean } {
  const seen = new Set<string>();
  let readonlyExec = false;
  for (const r of records) {
    if (r.type === 'tool/call') {
      const f = TOOL_FAMILY[(r as { toolName: string }).toolName] ?? 'other';
      seen.add(f);
    }
    if (r.type === 'tool/result') {
      const meta = (r as { meta?: Record<string, unknown> }).meta ?? {};
      if (meta.readonly === true) readonlyExec = true;
    }
  }
  return { seen, readonlyExec };
}

function readTarget(target: string | undefined, ctx: AssertContext): string {
  if (!target || target === 'final_text') return ctx.finalText;
  if (target.startsWith('file:')) {
    const p = path.join(ctx.workspace, target.slice(5));
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  }
  return '';
}

function getByPath(obj: unknown, jsonPath: string): unknown {
  return jsonPath.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

export async function runAssert(spec: AssertionSpec, ctx: AssertContext, index: number): Promise<AssertResult> {
  const id = `a${index + 1}`;
  const base = { id, type: spec.type, target: spec.target ?? '' };

  switch (spec.type) {
    case 'file_content': {
      const text = readTarget(spec.target, ctx);
      if (spec.json_path && spec.golden_expr) {
        // JSON field comparison with independently recomputed golden (B005)
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(text) as Record<string, unknown>;
        } catch (err) {
          return { ...base, result: 'fail', evidence: { error: `invalid JSON: ${(err as Error).message}` } };
        }
        const actual = getByPath(parsed, spec.json_path);
        const vars = Object.entries(parsed).filter(([, v]) => typeof v === 'number');
        const fn = new Function(...vars.map(([k]) => k), `return (${spec.golden_expr});`);
        const golden = fn(...vars.map(([, v]) => v)) as number;
        const ok = Number(actual) === Number(golden);
        return {
          ...base,
          result: ok ? 'pass' : 'fail',
          evidence: { jsonPath: spec.json_path, actual, golden, expr: spec.golden_expr },
        };
      }
      const missing = (spec.golden ?? []).filter((g) => !text.includes(g));
      return {
        ...base,
        result: missing.length === 0 ? 'pass' : 'fail',
        evidence: { missing, textTail: text.slice(-400) },
      };
    }

    case 'no_mutation': {
      const now = currentSnapshot(ctx.workspace);
      let same = now.size === ctx.snapshotBefore.size;
      if (same) {
        for (const [k, v] of now) {
          if (ctx.snapshotBefore.get(k) !== v) { same = false; break; }
        }
      }
      return {
        ...base,
        result: same ? 'pass' : 'fail',
        evidence: { before: ctx.snapshotBefore.size, after: now.size },
      };
    }

    case 'tool_family_seen': {
      const { seen } = toolFamiliesUsed(ctx.sessionRecords);
      const ok = seen.has(spec.family ?? '');
      return { ...base, result: ok ? 'pass' : 'fail', evidence: { family: spec.family, seen: [...seen] } };
    }

    case 'no_tool_family': {
      const { seen, readonlyExec } = toolFamiliesUsed(ctx.sessionRecords);
      const family = spec.family ?? '';
      let ok = !seen.has(family);
      if (family === 'exec' && readonlyExec) ok = true; // readonly commands are allowed (B001 adapter rule)
      return { ...base, result: ok ? 'pass' : 'fail', evidence: { family, seen: [...seen], readonlyExec } };
    }

    case 'metric_le':
    case 'metric_ge': {
      const value = metricValue(spec.metric ?? '', ctx.counters);
      const limit = spec.limit ?? 0;
      const ok = spec.type === 'metric_le' ? value <= limit : value >= limit;
      return { ...base, result: ok ? 'pass' : 'fail', evidence: { metric: spec.metric, value, limit } };
    }

    case 'run_check': {
      const cmd = spec.command ?? '';
      const r = await runCommand(cmd, [], { cwd: ctx.workspace, timeoutMs: 60_000, shell: true, maxOutputBytes: 1024 * 1024 });
      return {
        ...base,
        result: r.exitCode === 0 ? 'pass' : 'fail',
        evidence: { exitCode: r.exitCode, stdoutTail: r.stdout.slice(-500), stderrTail: r.stderr.slice(-300) },
      };
    }

    case 'file_absent': {
      const re = new RegExp(spec.pattern ?? '');
      const includeRe = spec.include ? globToRegExp(spec.include.replace(/\\/g, '/')) : null;
      const files: string[] = [];
      walk(ctx.workspace, ctx.workspace, files);
      const hits: string[] = [];
      for (const rel of files) {
        if (includeRe && !includeRe.test(rel)) continue;
        try {
          const content = fs.readFileSync(path.join(ctx.workspace, rel), 'utf8');
          if (re.test(content)) hits.push(rel);
        } catch { /* skip */ }
      }
      return { ...base, result: hits.length === 0 ? 'pass' : 'fail', evidence: { pattern: spec.pattern, hits } };
    }

    case 'file_exists': {
      const missing = (spec.paths ?? []).filter((p) => !fs.existsSync(path.join(ctx.workspace, p)));
      return { ...base, result: missing.length === 0 ? 'pass' : 'fail', evidence: { missing } };
    }

    case 'git_diff_scope': {
      const changed = changedFiles(ctx);
      const ok = changed.size >= (spec.expected ?? 1);
      return { ...base, result: ok ? 'pass' : 'fail', evidence: { changed: [...changed], expected: spec.expected } };
    }

    case 'event_seen': {
      // tool/call with toolName matching the pattern (V0.2: Subagent / mcp__<server>__<tool>)
      const re = new RegExp(spec.pattern ?? '');
      const seen = ctx.sessionRecords.some((r) => r.type === 'tool/call' && re.test((r as { toolName: string }).toolName));
      return { ...base, result: seen ? 'pass' : 'fail', evidence: { pattern: spec.pattern } };
    }

    case 'record_seen': {
      // session record of a given type (+ optional source field), e.g. user/message with source=plan
      const ok = ctx.sessionRecords.some(
        (r) => r.type === spec.record && (spec.source === undefined || (r as { source?: string }).source === spec.source),
      );
      return { ...base, result: ok ? 'pass' : 'fail', evidence: { record: spec.record, source: spec.source } };
    }

    default:
      return { ...base, result: 'skip', evidence: { reason: `unknown assert type: ${spec.type}` } };
  }
}

function changedFiles(ctx: AssertContext): Set<string> {
  const before = ctx.snapshotBefore;
  const now = currentSnapshot(ctx.workspace);
  const changed = new Set<string>();
  for (const [k, v] of now) {
    if (before.get(k) !== v) changed.add(k);
  }
  for (const k of before.keys()) {
    if (!now.has(k)) changed.add(k);
  }
  return changed;
}

function metricValue(metric: string, c: TelemetryCounters): number {
  switch (metric) {
    case 'M02': return c.turns;
    case 'M03': return c.toolCalls;
    case 'M04': return c.invalidArgs;
    case 'M05': return c.retries;
    case 'M09': return c.compactions;
    case 'M12': return c.denials;
    case 'M13': return c.evaluatorRejects;
    case 'M14': return c.approvalAsks;
    default: return 0;
  }
}
