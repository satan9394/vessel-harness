// Reproduce the exact old/new expressions from trusted repository source, without network or CLI probes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const paths = {
  provider: 'apps/cli/src/providers/providerFactory.ts',
  terminal: 'apps/cli/src/ui/TerminalStatusLine.ts',
  reflection: 'packages/memory/src/reflection/autonomousReflection.ts',
  version: 'packages/shared/src/toolPins.ts',
};
const sources = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, {
  before: execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' }),
  after: readFileSync(path, 'utf8'),
}]));
function extractFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n}`));
  assert.ok(match, `missing ${name}`);
  return new Function(`return ${match[0].replaceAll(': string', '')}`)();
}
const beforeProvider = sources.provider.before.match(/const key = (.*);/)[1];
const beforeVersion = sources.version.before.match(/return (raw\.match\(.*)\s*;/)[1];
const afterPattern = sources.version.after.match(/const VERSION_PATTERN = (.*);/)[1];
const reflection = phase => {
  const pattern = sources.reflection[phase].match(/: (\/thin\.\?core\|.*?\/i)\.test\(detail\)/)[1];
  const regex = new Function(`return ${pattern}`)();
  return value => regex.test(value);
};
const implementations = {
  provider: { before: new Function('url', `return ${beforeProvider}`), after: extractFunction(sources.provider.after, 'withoutTrailingSlashes') },
  terminal: { before: extractFunction(sources.terminal.before, 'terminalText'), after: extractFunction(sources.terminal.after, 'terminalText') },
  reflection: { before: reflection('before'), after: reflection('after') },
  version: { before: new Function('raw', `return ${beforeVersion}`), after: new Function('raw', `return (${afterPattern}).exec(raw)?.[0] ?? null`) },
};
for (const value of ['https://', '', 'https://a/v1//', 'a////x', '////']) {
  assert.equal(implementations.provider.before(value), implementations.provider.after(value));
}
const link = '\x1b]8;;https://e.com\x1b\\link\x1b]8;;\x1b\\';
assert.equal(implementations.terminal.before(link), '');
assert.equal(implementations.terminal.after(link), 'link');
const makeInput = {
  provider: size => 'https://a/' + '/'.repeat(size) + 'x',
  terminal: size => '\x1b]'.repeat(size),
  reflection: size => 'core'.repeat(size),
  version: size => '9'.repeat(size),
};
function medianMs(fn, input) {
  for (let i = 0; i < 3; i++) fn(input);
  const times = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    fn(input);
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[3];
}
const measurements = [];
for (const [name, pair] of Object.entries(implementations)) {
  for (const size of name === 'version' ? [1024, 2048, 4096, 8192] : [1000, 2000, 4000, 8000]) {
    const input = makeInput[name](size);
    assert.equal(pair.before(input), pair.after(input));
    const row = { name, size, inputLength: input.length, beforeMs: medianMs(pair.before, input), afterMs: medianMs(pair.after, input) };
    measurements.push(row);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(new URL('redos-measurements.json', import.meta.url), JSON.stringify({
  baseline, node: process.version, measuredAt: new Date().toISOString(), samples: 7, warmups: 3,
  method: 'Median milliseconds per call; exact functions/expressions extracted from HEAD and working-tree source. Timings are observations, not test thresholds.',
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([name, phases]) => [name, Object.fromEntries(Object.entries(phases).map(([phase, text]) => [phase, createHash('sha256').update(text).digest('hex')]))])),
  oscRegression: { before: implementations.terminal.before(link), after: implementations.terminal.after(link) },
  measurements,
}, null, 2) + '\n');
