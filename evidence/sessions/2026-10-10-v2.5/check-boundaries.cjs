// Run from the repository root: node evidence/sessions/2026-10-10-v2.5/check-boundaries.cjs
const fs = require('node:fs');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const path = require('node:path');
const base = __dirname;
const failures = [];
for (const name of ['core-baseline.json', 'protected-baseline.json']) {
  for (const item of JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'))) {
    if (!fs.existsSync(item.Path) || crypto.createHash('sha256').update(fs.readFileSync(item.Path)).digest('hex').toUpperCase() !== item.Hash) failures.push(item.Path);
  }
}
const coreDiff = cp.execFileSync('git', ['diff', '--numstat', '--', 'packages/core'], { encoding: 'utf8' }).trim();
if (coreDiff) failures.push('packages/core diff: ' + coreDiff);
const locks = cp.execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split(/\r?\n/).filter(file => /(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml|bun\.lockb?|yarn\.lock)$/.test(file));
failures.push(...locks);
const addedImplementation = cp.execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' }).split(/\r?\n/)
  .filter(file => /^(apps|packages|benchmarks)\//.test(file) && !/^(apps\/(web|local-server|cli)|packages\/shared)\//.test(file));
failures.push(...addedImplementation.map(file => 'out-of-scope new file: ' + file));
const result = { pass: !failures.length, coreDiffLines: coreDiff ? null : 0, protectedHashesUnchanged: !failures.length, failures };
console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length ? 1 : 0;
