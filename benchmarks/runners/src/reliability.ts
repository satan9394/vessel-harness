import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const categories = ['retry', 'crash', 'soft-delete', 'adapter-unavailable', 'unknown-tool', 'event-replay', 'capability-negotiation'] as const;
export interface ReliabilityFixture { id: string; category: typeof categories[number]; source: string; title: string }
const fixture = (id: string, category: ReliabilityFixture['category'], source: string, title: string): ReliabilityFixture => ({ id, category, source, title });
const adapter = 'benchmarks/runners/src/adapters/codex.test.ts';
const server = 'apps/local-server/src/server.test.ts';
const caps = 'packages/llm/src/capabilities.test.ts';
export const fixtures: ReliabilityFixture[] = [
  fixture('R01', 'retry', 'packages/core/src/agent-loop/AgentLoop.llm-retry-record.test.ts', '① 一次可重试失败 ⇒ 会话日志出现一条 llm/retry：字段如实、且在任何等待之前落盘'),
  ...['before_intent', 'after_intent', 'after_effect', 'after_outcome'].map((boundary, i) => fixture(`R0${i + 2}`, 'crash', 'packages/application/src/session/effect-recovery.test.ts', `recovers a real policy/executor process exit at ${boundary} through SessionController and explicit reconcile`)),
  fixture('R06', 'soft-delete', server, 'waits for recycling before acknowledging deletion, after durably removing the session index'),
  fixture('R07', 'soft-delete', server, 'reports recycling failure and retains the session for a successful retry'),
  fixture('R08', 'soft-delete', server, 'reports stale index on failed recycle rollback, retains metadata and repairs on retry'),
  fixture('R09', 'adapter-unavailable', adapter, 'marks run pending-environment when Codex CLI is absent, without throwing'),
  fixture('R10', 'adapter-unavailable', adapter, 'surface a run-time failure (CLI non-zero exit) as metrics.success=false, still a valid RunResult'),
  fixture('R11', 'unknown-tool', 'packages/tools/src/mcp/mcp.test.ts', 'unknown MCP tool calls surface as TOOL_FAILURE (never crash the registry)'),
  fixture('R12', 'event-replay', 'packages/application/src/projections/projections.test.ts', 'foldSession is idempotent: folding the same session twice never double-counts'),
  fixture('R13', 'capability-negotiation', caps, 'requires evidence for mandatory unknown capabilities and checks context size'),
  fixture('R14', 'capability-negotiation', caps, 'blocks stream and model-specific declarations without falling back to another model'),
];

export interface Assertion { title: string; fullName: string; status: string; failureMessages?: string[] }
export interface Suite { name: string; assertionResults: Assertion[] }
export function evaluate(selected: ReliabilityFixture[], suites: Suite[]) {
  const results = selected.map(f => {
    const matches = suites.filter(s => s.name.replaceAll('\\', '/').endsWith(`/${f.source}`))
      .flatMap(s => s.assertionResults).filter(a => a.title === f.title);
    const assertion = matches[0];
    const passed = matches.length === 1 && assertion?.status === 'passed';
    return { ...f, outcome: passed ? 'passed' : 'failed', live: false,
      ...(passed ? {} : { reason: matches.length !== 1 ? `Expected one assertion, found ${matches.length}` : assertion?.failureMessages?.join('\n') || `Assertion status: ${assertion?.status}` }) };
  });
  const coverage = Object.fromEntries(categories.map(c => [c, results.filter(f => f.category === c && f.outcome === 'passed').map(f => f.id)]));
  const errors = categories.filter(c => !coverage[c]?.length).map(c => `缺少类别 ${c}`);
  if (selected.length < 10 || selected.length > 20) errors.push('Expected 10–20 fixtures');
  if (new Set(selected.map(f => f.id)).size !== selected.length) errors.push('Duplicate fixture id');
  return { results, coverage, errors };
}

export function main(argv: string[]): number {
  // ponytail: this loop is offline-only; --live never launches an external agent.
  if (argv.length) { console.error('Offline-only runner: no arguments accepted; --live requires a separately authorized live runner.'); return 1; }
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const startedAt = new Date().toISOString();
  const out = path.join(root, 'evidence/sessions', `task274-reliability-${startedAt.replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(out, { recursive: true });
  const write = (name: string, value: unknown) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
    return result.stdout.trim();
  };
  try {
    const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
    const sources = [...new Set(fixtures.map(f => f.source)), 'benchmarks/runners/src/reliability.ts', 'vitest.config.ts', 'vitest.setup.ts', 'package.json', 'package-lock.json'];
    const sourceHashes = Object.fromEntries(sources.map(s => [s, hash(fs.readFileSync(path.join(root, s)))]));
    const npmPath = process.env.npm_execpath;
    if (!npmPath) throw new Error('Run through npm run bench:reliability to record the npm version');
    const npm = spawnSync(process.execPath, [npmPath, '--version'], { encoding: 'utf8' });
    if (npm.status !== 0) throw new Error('Cannot record npm version');
    const metadata = { head: git('rev-parse', 'HEAD'), node: process.version, npm: npm.stdout.trim(), startedAt,
      mode: 'offline', live: false, platform: process.platform, arch: process.arch,
      worktreeStatus: git('status', '--porcelain'), diffSha256: hash(git('diff', 'HEAD', '--')), sourceHashes };
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const args = [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...new Set(fixtures.map(f => f.source)),
      '--testNamePattern', fixtures.map(f => escape(f.title) + '$').join('|'), '--retry', '0', '--reporter=json', '--outputFile', path.join(out, 'vitest.json')];
    const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
    fs.writeFileSync(path.join(out, 'process.log'), `${run.stdout ?? ''}\n${run.stderr ?? ''}\n${run.error?.message ?? ''}`);
    const reportFile = path.join(out, 'vitest.json');
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) as { testResults: Suite[] } : { testResults: [] };
    const evaluated = evaluate(fixtures, report.testResults);
    if (run.status !== 0) evaluated.errors.push(`Vitest exit ${run.status}: ${run.error?.message ?? run.signal ?? 'see process.log'}`);
    if (git('rev-parse', 'HEAD') !== metadata.head || sources.some(s => hash(fs.readFileSync(path.join(root, s))) !== sourceHashes[s])) evaluated.errors.push('Source changed during execution');
    const entries = evaluated.results.map(f => {
      const evidence = path.relative(root, path.join(out, `${f.id}.json`)).replaceAll('\\', '/');
      write(`${f.id}.json`, { ...f, assertions: report.testResults.filter(s => s.name.replaceAll('\\', '/').endsWith(`/${f.source}`)).flatMap(s => s.assertionResults).filter(a => a.title === f.title) });
      return { ...f, evidence };
    });
    const success = !evaluated.errors.length && entries.every(f => f.outcome === 'passed');
    write('manifest.json', { ...metadata, finishedAt: new Date().toISOString(), categories: evaluated.coverage, fixtures: entries, errors: evaluated.errors, success });
    for (const error of evaluated.errors) console.error(error);
    console.log(`${entries.filter(f => f.outcome === 'passed').length}/${entries.length} passed; ${path.relative(root, out)}/manifest.json`);
    return success ? 0 : 1;
  } catch (error) {
    write('manifest.json', { startedAt, success: false, live: false, reason: String(error) });
    console.error(error); return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
