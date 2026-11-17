import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const allowed = [
  'packages/runtime/src/process/Process.ts',
  'packages/runtime/src/process/Process.test.ts',
  'packages/runtime/src/sandbox/Sandbox.ts',
  'packages/runtime/src/sandbox/Sandbox.test.ts',
  'benchmarks/runners/src/asserts.ts',
  'apps/cli/src/providers/providerFactory.ts',
  'apps/cli/src/providers/providerFactory.failover.test.ts',
  'apps/cli/src/ui/TerminalStatusLine.ts',
  'apps/cli/src/ui/statusLine.test.ts',
  'packages/memory/src/reflection/autonomousReflection.ts',
  'packages/memory/src/reflection/autonomousReflection.test.ts',
  'packages/shared/src/toolPins.ts',
  'packages/shared/src/toolPins.test.ts',
  'tasks/371-codeql-seven-remediation.md',
];
const dir = 'evidence/sessions/2026-10-31-codeql-seven/';
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const sha = data => createHash('sha256').update(data).digest('hex');
const baseline = git(['rev-parse', 'HEAD']);
const changed = git(['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean);
const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
assert.deepEqual(changed.filter(path => !allowed.includes(path)), []);
assert.deepEqual(untracked.filter(path => !path.startsWith(dir)), []);
const before = path => execFileSync('git', ['show', `${baseline}:${path}`]);
const processPath = allowed[0];
const oldProcess = before(processPath).toString();
const newProcess = readFileSync(processPath, 'utf8');
const supervisionTail = source => source.slice(source.indexOf('    opts.onSpawn?.')).trimEnd();
assert.equal(supervisionTail(newProcess), supervisionTail(oldProcess));
const argvFunction = newProcess.slice(newProcess.indexOf('export function runCommand('), newProcess.indexOf('export function runShellCommand('));
const argvSpawn = argvFunction.slice(argvFunction.indexOf('spawn(command, args, {'));
assert.ok(argvSpawn.includes('spawn(command, args, {'));
assert.doesNotMatch(argvSpawn, /\bshell\s*:/);
assert.match(argvFunction, /if \(opts.shell\) return Promise.reject\(new TypeError/);
assert.equal((newProcess.match(/\bspawn\(command,/g) ?? []).length, 2);
const card = 'tasks/371-codeql-seven-remediation.md';
assert.ok(readFileSync(card).subarray(0, before(card).length).equals(before(card)), 'card edits must be append-only');
const protectedRoots = ['packages/tools/src/git/Worktree.ts', 'packages/tools/src/mcp/McpClient.ts', 'packages/core', 'apps/web', '.github', 'tasks/README.md', 'scripts/gate-batched.ps1', 'package.json', 'package-lock.json'];
const protectedPaths = git(['ls-files', '--', ...protectedRoots]).split('\n').filter(Boolean);
// Git applies .gitattributes when comparing; checkout CRLF/mixed endings can differ from blob bytes even at a clean baseline.
git(['diff', '--exit-code', 'HEAD', '--', ...protectedRoots]);
const protectedHashes = protectedPaths.map(path => {
  const current = readFileSync(path);
  return { path, sha256: sha(current) };
});
const diff = git(['diff', '--unified=3', 'HEAD']);
assert.doesNotMatch(diff, /^\+[^+].*\b(?:it|test|describe)\.skip\b/m);
git(['diff', '--check']);
writeFileSync(new URL('changes.patch', import.meta.url), diff + '\n');
const codeql = spawnSync('codeql', ['version'], { encoding: 'utf8', windowsHide: true });
const artifacts = changed.map(path => ({ path, sha256: sha(readFileSync(path)) }));
const result = {
  baseline, node: process.version, measuredAt: new Date().toISOString(),
  trackedChanged: changed, untracked, forbiddenChanges: [],
  supervisionTailByteEquivalent: true, argvSpawnHasNoShellKey: true, spawnPoints: 2,
  noAddedSkipDeclarations: true, cardAppendOnly: true,
  protectedCount: protectedHashes.length, protectedComparison: 'git diff --exit-code HEAD (repository line-ending normalization)', protectedHashes,
  codeql: { available: !codeql.error && codeql.status === 0, exit: codeql.status, error: codeql.error?.code ?? null, output: codeql.stdout ?? '' },
  sourceArtifactSha256: sha(artifacts.filter(item => item.path !== card).sort((a, b) => a.path.localeCompare(b.path)).map(item => `${item.path}\0${item.sha256}\n`).join('')),
  artifacts,
};
writeFileSync(new URL('scope-audit.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ changed: changed.length, protectedUnchanged: protectedHashes.length, supervisionPreserved: true, codeqlAvailable: result.codeql.available }));
