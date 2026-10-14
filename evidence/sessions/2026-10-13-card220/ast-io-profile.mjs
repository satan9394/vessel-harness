import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-ast-io-'));
const file = path.join(root, 'api.ts');
const results = { nativeUtf8: [], bufferDecode: [], explicitFd: [], asyncUtf8: [], freshFdRead: [], retainedFdRead: [] };
const fdStages = [];
const identityStages = [];
let retainedFd;
try {
  for (let index = 0; index < 20; index++) for (const method of Object.keys(results)) {
    const expected = `export interface Contract { execute(): number }; export function execute() { return 1 }; export const edit${index} = ${index};`;
    fs.writeFileSync(file, expected);
    const start = performance.now();
    let text;
    if (method === 'nativeUtf8') text = fs.readFileSync(file, 'utf8');
    if (method === 'bufferDecode') text = fs.readFileSync(file).toString('utf8');
    if (method === 'asyncUtf8') text = await fs.promises.readFile(file, 'utf8');
    if (method === 'explicitFd') {
      const opening = performance.now();
      const fd = fs.openSync(file, 'r');
      const opened = performance.now();
      let readEnd;
      try { text = fs.readFileSync(fd, 'utf8'); readEnd = performance.now(); } finally { fs.closeSync(fd); }
      fdStages.push({ openMs: opened - opening, readMs: readEnd - opened, closeMs: performance.now() - readEnd });
    }
    if (method === 'freshFdRead' || method === 'retainedFdRead') {
      if (method === 'retainedFdRead') retainedFd ??= fs.openSync(file, 'r');
      const fd = method === 'retainedFdRead' ? retainedFd : fs.openSync(file, 'r');
      try {
        let size;
        if (method === 'retainedFdRead') {
          const identityStart = performance.now();
          const lexical = fs.lstatSync(file);
          const afterLstat = performance.now();
          const current = fs.statSync(file);
          const afterStat = performance.now();
          const held = fs.fstatSync(fd);
          identityStages.push({ lstatMs: afterLstat - identityStart, statMs: afterStat - afterLstat, fstatMs: performance.now() - afterStat });
          if (!lexical.isFile() || current.ino !== held.ino || current.dev !== held.dev) throw new Error('Identity changed');
          size = held.size;
        } else size = fs.fstatSync(fd).size;
        const buffer = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const read = fs.readSync(fd, buffer, offset, size - offset, offset);
          if (!read) break;
          offset += read;
        }
        text = buffer.subarray(0, offset).toString('utf8');
      } finally { if (method === 'freshFdRead') fs.closeSync(fd); }
    }
    results[method].push(performance.now() - start);
    if (text !== expected) throw new Error('Fresh read mismatch');
  }
  console.log(JSON.stringify({ methods: Object.fromEntries(Object.entries(results).map(([method, samples]) => [method,
    { samples, mean: samples.reduce((a,b) => a+b,0)/samples.length, peak: Math.max(...samples) }])), fdStages, identityStages }, null, 2));
} finally { if (retainedFd !== undefined) fs.closeSync(retainedFd); fs.rmSync(root, { recursive: true, force: true }); }
