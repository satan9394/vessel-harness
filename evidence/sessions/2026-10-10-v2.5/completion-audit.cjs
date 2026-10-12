// Run only after run-gates.ps1 completes; records freshness and protected scope.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const base = __dirname;
const tracked = cp.execFileSync('git', ['diff', '--name-only', '--', 'apps', 'packages'], { encoding: 'utf8' });
const added = cp.execFileSync('git', ['ls-files', '--others', '--exclude-standard', 'apps', 'packages'], { encoding: 'utf8' });
const files = [...new Set((tracked + '\n' + added).trim().split(/\r?\n/).filter(Boolean))];
const source = files.map(file => ({ file, editedAt: fs.statSync(file).mtime.toISOString(), sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
const latest = source.map(item => item.editedAt).sort().at(-1);
const gates = JSON.parse(fs.readFileSync(path.join(base, 'final-gates.json'), 'utf8'));
const boundaries = JSON.parse(cp.execFileSync('node', [path.join(base, 'check-boundaries.cjs')], { encoding: 'utf8' }));
const state = JSON.parse(fs.readFileSync('.agent-state/run-state.json', 'utf8'));
const result = { pass: gates.length === 7 && gates.every(gate => gate.exitCode === 0 && Date.parse(gate.startedAt) > Date.parse(latest)) && boundaries.pass && state.workers.active === 0 && state.mission.status === 'completed' && state.workset.every(card => card.status === 'completed'),
  head: cp.execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), latestSourceEdit: latest, boundaries,
  allGatesAfterFinalSourceEdit: gates.every(gate => Date.parse(gate.startedAt) > Date.parse(latest)), gates, source, activeWorkers: state.workers.active,
  missionStatus: state.mission.status, workset: state.workset };
fs.writeFileSync(path.join(base, 'completion-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, latestSourceEdit: latest, gates: gates.length, sourceFiles: source.length, boundaries, activeWorkers: result.activeWorkers }, null, 2));
process.exitCode = result.pass ? 0 : 1;
