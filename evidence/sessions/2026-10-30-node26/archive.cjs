const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const log = fs.readFileSync(path.join(__dirname, 'full-gate.log'), 'utf8');
// Horizontal whitespace only: empty tsc summaries must not consume the next step.
const steps = [...log.matchAll(/^(\S+)[ \t]+exit=(\d+)[ \t]+(\d+)s([^\r\n]*)/gm)].map(m => ({
  name: m[1], exit: Number(m[2]), seconds: Number(m[3]),
  files: Number(/Test Files\s+(\d+) passed/.exec(m[4])?.[1] ?? 0),
  passed: Number(/Tests\s+(\d+) passed/.exec(m[4])?.[1] ?? 0),
  skipped: Number(/(\d+) skipped/.exec(m[4])?.[1] ?? 0),
}));
const root = steps.slice(0, 12).reduce((a, b) => ({ files: a.files + b.files, passed: a.passed + b.passed,
  skipped: a.skipped + b.skipped }), { files: 0, passed: 0, skipped: 0 });
if (steps.length !== 17 || steps.some(s => s.exit !== 0) || root.files !== 335 || root.passed !== 3725 || root.skipped !== 8) {
  throw new Error('Unexpected gate results');
}
const originalLogs = path.join(os.tmpdir(), 'vessel-gate-f4f6e2f3');
fs.cpSync(originalLogs, path.join(__dirname, 'full-gate-logs'), { recursive: true });
const result = {
  node: process.version,
  focused: { command: 'node node_modules/vitest/vitest.mjs run packages/policy packages/application packages/skills packages/agents',
    exit: 0, files: 71, passed: 691, skipped: 3 },
  full: { command: 'pwsh -NoProfile -File scripts/gate-batched.ps1', exit: 0, steps: steps.length, root,
    web: steps.find(s => s.name === 'web-root'), conformance: { runs: 25, passed: 25, cost: 0 }, originalLogs, results: steps },
};
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
