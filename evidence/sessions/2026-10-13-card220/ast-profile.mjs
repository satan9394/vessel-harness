import fs from 'node:fs';
import ts from 'typescript-parser';

const originalRead = fs.readFileSync;
const reads = [];
fs.readFileSync = function(...args) {
  const start = performance.now();
  try { return Reflect.apply(originalRead, this, args); }
  finally {
    const file = String(args[0]);
    if (file.includes('vessel-card197-proof-')) reads.push({ file, durationMs: performance.now() - start });
  }
};
ts.performance.enable();
try {
  await import('../2026-10-08-v2.3/card197-check.ts');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.readFileSync = originalRead;
  const compilerMeasures = {};
  ts.performance.forEachMeasure((name, value) => { compilerMeasures[name] = value; });
  console.log(JSON.stringify({ compilerMeasures, fixtureReads: reads,
    totalReadMs: reads.reduce((sum, read) => sum + read.durationMs, 0),
    processPlatform: process.platform, nodeVersion: process.version }, null, 2));
}
