import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WorkspaceFingerprinter } from '../packages/tools/src/filesystem/workspaceFingerprint.js';

// Measures the whole compute call, including traversal, content reads and Git.
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-fingerprint-bench-'));
const git = promisify(execFile);
try {
  for (let i = 0; i < 50; i++) fs.writeFileSync(path.join(fixture, `file-${i}.ts`), 'export const value = 1;\n'.repeat(40));
  for (const [name, root] of [['fixture-50-files', fixture], ['actual-repository', path.resolve(process.argv[2] ?? '.')]]) {
    const elapsed: number[] = [];
    let count = 0;
    for (let run = 0; run < 11; run++) {
      const start = performance.now();
      const result = await WorkspaceFingerprinter.compute(root!);
      elapsed.push(performance.now() - start); count = result.fileCount;
    }
    const warm = elapsed.slice(1).sort((a, b) => a - b);
    const warmP95Ms = warm[Math.ceil(warm.length * 0.95) - 1]!;
    const accepted = name === 'fixture-50-files'
      ? count === 50 && warm[9]! <= 50
      : count <= 2000 && elapsed[0]! <= 1500 && warmP95Ms <= 1000;
    console.log(JSON.stringify({ name, root, fileCount: count, coldMs: elapsed[0], warmMedianMs: warm[5], warmMaxMs: warm[9],
      warmP95Ms, samplesMs: elapsed, within25ms: elapsed.every(value => value < 25), accepted }));
    if (!accepted) process.exitCode = 1;
  }
  if (process.argv.includes('--components')) {
    const root = path.resolve(process.argv[2] ?? '.');
    const options = { encoding: 'buffer' as const, windowsHide: true, maxBuffer: 64 * 1024 * 1024 };
    for (const args of [['--version'], ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-t', '-z', '--', '.'],
      ['-C', root, 'diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--', '.']]) {
      const elapsed: number[] = [];
      for (let run = 0; run < 5; run++) {
        const start = performance.now(); await git('git', args, options); elapsed.push(performance.now() - start);
      }
      console.log(JSON.stringify({ component: `git ${args.join(' ')}`, samplesMs: elapsed }));
    }
    const { stdout } = await git('git', ['-C', root, 'ls-files', '--cached', '-z', '--', '.'], options);
    const names = stdout.toString('utf8').split('\0').filter(Boolean)
      .filter(name => !name.split('/').some(part => ['.git', 'node_modules', 'dist', '.tmp'].includes(part)))
      .map(name => path.join(root, name)).filter(name => fs.existsSync(name) && fs.lstatSync(name).isFile());
    for (const [component, operation] of [
      ['lstatSync', (name: string) => fs.lstatSync(name)],
      ['readFileSync', (name: string) => fs.readFileSync(name)],
    ] as const) {
      const start = performance.now(); for (const name of names) operation(name);
      console.log(JSON.stringify({ component, fileCount: names.length, elapsedMs: performance.now() - start }));
    }
    const start = performance.now(); let next = 0;
    await Promise.all(Array.from({ length: 32 }, async () => {
      while (next < names.length) await fs.promises.readFile(names[next++]!);
    }));
    console.log(JSON.stringify({ component: 'readFile-32-concurrent', fileCount: names.length, elapsedMs: performance.now() - start }));
  }
} finally { fs.rmSync(fixture, { recursive: true, force: true }); }
