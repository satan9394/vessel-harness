import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../../..');
process.chdir(root);
const baseline = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'baseline.json'), 'utf8'));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split(/\r?\n/);
const current = Object.fromEntries(files.filter(p => fs.existsSync(p) && fs.statSync(p).isFile())
  .map(p => [p, createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const changed = [...new Set([...Object.keys(baseline), ...files])].filter(p => baseline[p] !== current[p]);
const core = changed.filter(p => p.startsWith('packages/core/'));
const missing = Object.keys(baseline).filter(p => !(p in current));
console.log(JSON.stringify({ coreChanged: core, baselineFilesMissing: missing, changedSinceV22: changed }, null, 2));
if (core.length || missing.length) process.exitCode = 1;
