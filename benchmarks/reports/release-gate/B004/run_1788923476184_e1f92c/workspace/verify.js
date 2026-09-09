// verify.js — runner-side compile/consistency check (fixture-provided command)
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const srcDir = path.resolve('src');
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'));
for (const f of files) {
  const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
  if (content.includes('oldName')) {
    console.error(`LEGACY SYMBOL REMAINS in src/${f}`);
    process.exit(1);
  }
}

const mod = await import(pathToFileURL(path.join(srcDir, 'index.js')).href);
if (typeof mod.userLabel !== 'function' || typeof mod.apiInfo !== 'function') {
  console.error('EXPORTS MISSING');
  process.exit(1);
}
console.log('RENAME OK: no legacy symbol in src/, imports resolve, exports intact');
