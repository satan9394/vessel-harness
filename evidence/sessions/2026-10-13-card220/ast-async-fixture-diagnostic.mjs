import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-ast-async-'));
try {
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  const parser = pathToFileURL(path.join(repo, 'node_modules/typescript-parser/lib/typescript.js')).href;
  const source = fs.readFileSync(path.join(repo, 'packages/context/src/ast/symbolGraph.ts'), 'utf8').replace("'typescript-parser'", JSON.stringify(parser));
  const fixture = fs.readFileSync(path.join(repo, 'evidence/sessions/2026-10-08-v2.3/card197-check.ts'), 'utf8');
  const variants = [
    ['synchronous', source],
    ['awaited-utf8', source.replace("fs.readFileSync(absolute, 'utf8')", "await fs.promises.readFile(absolute, 'utf8')")],
    ['awaited-buffer', source.replace("fs.readFileSync(absolute, 'utf8')", "(await fs.promises.readFile(absolute)).toString('utf8')")],
  ];
  for (const [label, code] of variants) {
    const variant = path.join(tmp, `${label}.ts`);
    fs.writeFileSync(variant, code);
    const script = path.join(tmp, `${label}-check.ts`);
    fs.writeFileSync(script, fixture.replace("'../../../packages/context/src/ast/symbolGraph.js'", JSON.stringify(pathToFileURL(variant).href)));
    const result = spawnSync(process.execPath, ['--import', 'tsx', script], { cwd: repo, encoding: 'utf8', timeout: 30000 });
    console.log(`=== ${label}: exact original fixture and thresholds ===`);
    console.log(result.stdout); console.log(result.stderr); console.log(`exit=${result.status}`);
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
