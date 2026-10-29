import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const evidence = import.meta.dirname;
const repo = path.resolve(evidence, '../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(evidence, name + '.json'), 'utf8'));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const cleanupCommand = "$ports = @(5694,5695,5696,5697,5698); $owned = @(20208,21216,10656,28356); $listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports } | Select-Object LocalPort,OwningProcess); $processes = @(Get-Process -Id $owned -ErrorAction SilentlyContinue | Select-Object Id,ProcessName); $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -in $owned } | Select-Object ProcessId,ParentProcessId,Name); @{ listeners=$listeners; processes=$processes; children=$children } | ConvertTo-Json -Compress -Depth 4";
const cleanup = JSON.parse(execFileSync('pwsh', ['-NoProfile', '-Command', cleanupCommand], { encoding: 'utf8', windowsHide: true, timeout: 30000 }));
cleanup.checkedAt = new Date().toISOString(); cleanup.checkedPorts = [5694, 5695, 5696, 5697, 5698]; cleanup.ownedPids = [20208, 21216, 10656, 28356]; cleanup.command = cleanupCommand;
cleanup.downloads = 'No browser downloads were triggered. Screenshot JPEGs were written directly under TEMP and encoded to PNG in evidence.';
fs.writeFileSync(path.join(evidence, 'cleanup.json'), JSON.stringify(cleanup, null, 2));
if (cleanup.listeners.length || cleanup.processes.length || cleanup.children.length) throw new Error('fixture cleanup failed');
const headers = read('t1-header');
for (const m of headers.matrices) {
  if (m.documentWidth > m.innerWidth || m.spans.length !== 3 || m.spans.some(s => s.scrollWidth > s.clientWidth + 1 || s.whiteSpace !== 'nowrap' || s.flexShrink !== '0' || s.height > 20)) throw new Error('header assertion failed');
}
const shots = read('screenshots');
for (const [w, h] of [[960, 600], [720, 450], [1440, 900], [1920, 900]]) {
  const shot = shots.find(s => s.target === `t1-header-${w}.png`);
  if (!shot || shot.size[0] !== w || shot.size[1] !== h) throw new Error(`screenshot dimensions ${w}`);
}
const drawer = read('t2-drawer');
if (drawer.measurements.map(m => m.length).join(',') !== '298,300,301,570,301,570' || drawer.expansionRequests.length !== 1 || drawer.console.length) throw new Error('drawer browser assertion failed');
const expected = read('t2-final-fixture').stages.find(s => s.requestedLength === 570).result.output;
if (drawer.measurements.filter(m => m.length === 570).some(m => m.text !== expected)) throw new Error('expanded output differs from original');
for (const n of ['t2-focused-final', 'web-tests-final', 'web-types-final', 'runtime-build', 'web-build-final']) if (read(n).exitCode !== 0) throw new Error(`check failed: ${n}`);
const products = ['apps/local-server/src/server.ts', 'apps/local-server/src/teamRoutes.ts', 'apps/local-server/src/teamStageApi.test.ts', 'apps/web/src/api.ts', 'apps/web/src/components/team/TeamNodeDrawer.tsx', 'apps/web/src/components/team/TeamNodeDrawer.test.tsx', 'apps/web/src/components/team/TeamStagesPanel.tsx', 'packages/agents/src/team/teamApproveAndRun.test.ts'];
const cards = ['tasks/362-narrow-width-layout-squeeze.md', 'tasks/364-team-drawer-truncation-affordance.md', 'tasks/361-card175-fixture-residuals.md'];
const changed = execFileSync('git', ['diff', '--name-only'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8', windowsHide: true }).trim().split('\n').filter(Boolean);
const outside = [...changed, ...untracked].filter(p => !products.includes(p) && !cards.includes(p) && !p.startsWith('evidence/sessions/2026-10-30-closeout/'));
if (outside.length) throw new Error(`outside scope: ${outside.join(', ')}`);
const cardChecks = cards.map(p => {
  const original = execFileSync('git', ['show', `HEAD:${p}`], { cwd: repo, windowsHide: true });
  const current = fs.readFileSync(path.join(repo, p));
  if (!current.subarray(0, original.length).equals(original)) throw new Error(`nonappend card edit ${p}`);
  return { path: p, originalPrefixUnchanged: true, originalBytes: original.length, appendedBytes: current.length - original.length };
});
const root = read('startup').root;
const css = dir => fs.readdirSync(path.join(dir, 'assets')).find(name => name.endsWith('.css'));
const initialCss = path.join(root, 'web', 'assets', css(path.join(root, 'web')));
const finalCss = path.join(root, 'web-final', 'assets', css(path.join(root, 'web-final')));
const cssMatches = hash(initialCss) === hash(finalCss);
if (!cssMatches) throw new Error('T1 CSS changed after drawer work');
const proof = { checkedAt: new Date().toISOString(), verdicts: { T1: 'PASS', T2: 'PASS', T3: 'PASS' }, baselineHead: '4ffce9a', expectedHead: 'af0bb33', currentHead: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), products: products.map(p => ({ path: p, sha256: hash(path.join(repo, p)) })), cards: cardChecks, changed, untracked, outside, cssMatches, cssSha256: hash(finalCss), fullGateRun: false, externalAgentCliRun: false, subagents: false, commitPush: false };
fs.writeFileSync(path.join(evidence, 'scope-audit.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ verdicts: proof.verdicts, listeners: cleanup.listeners.length, processes: cleanup.processes.length, children: cleanup.children.length, outside, cssMatches }));
