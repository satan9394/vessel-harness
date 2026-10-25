import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatProvider } from '@vessel/shared';
import { loadManifest } from './manifest.js';
import { runCodexFixture } from './adapters/codex.js';
import { runVesselFixture } from './contracts/vessel.js';
import type { HarnessFixture } from './contracts/types.js';
import { assertNoLeakPaths, FixtureLeakError, FixtureSetupError, matchLeakGlob, runScenario } from './runner.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function fixture(leakGlobs?: unknown) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-leak-guard-'));
  roots.push(root);
  const fixtureRoot = path.join(root, 'benchmarks/fixtures/X001');
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.mkdirSync(path.join(root, 'benchmarks/scenarios'), { recursive: true });
  const manifest = {
    id: 'X001', fixture: 'fixtures/X001', pass: [{ type: 'no_mutation' }],
    ...(leakGlobs === undefined ? {} : { leak_globs: leakGlobs }),
  };
  fs.writeFileSync(path.join(root, 'benchmarks/scenarios/X001.yaml'), yaml.dump(manifest));
  const write = (rel: string, content: string | Buffer = 'criteria') => {
    const full = path.join(fixtureRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };
  write('task.md', 'Read the workspace.');
  const run = (provider: ChatProvider | null = null) => runScenario({
    scenarioId: 'X001', repoRoot: root, reportsDir: path.join(root, 'reports'), provider,
    model: 'mock-model', policyPath: path.join(REPO_ROOT, 'configs/policy.default.yaml'),
    behaviorIRPath: path.join(REPO_ROOT, 'configs/behavior.default.yaml'),
  });
  return { root, fixtureRoot, write, run };
}

describe('fixture leak boundary', () => {
  it.each(['sub/RUBRICS.json', 'rubrics.json', 'deep/RuBrIc.JsOn'])('rejects builtin %s before provider execution', async (rel) => {
    const f = fixture();
    f.write(rel);
    const chat = vi.fn<ChatProvider['chat']>(async () => { throw new Error('must not execute'); });
    const error = await f.run({ id: 'leak-probe', chat }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(FixtureLeakError);
    expect(error).toBeInstanceOf(FixtureSetupError);
    expect((error as Error).message).toContain(rel);
    expect((error as Error).message).toMatch(/builtin: RUBRICS?\.json/);
    expect((error as Error).message).toContain('out of the fixture');
    expect((error as Error).message).toContain('scenario manifest\'s leak_globs');
    expect(chat).not.toHaveBeenCalled();
  });

  it('filters declared files, retains empty directories and unchanged bytes', async () => {
    const f = fixture(['**/RUBRICS.json', 'answers/**', 'sub/*.json']);
    const bytes = Buffer.from([0, 255, 13, 10, 128, 42]);
    f.write('rubrics.json');
    f.write('sub/RUBRICS.json');
    f.write('answers/deep/golden.txt');
    f.write('sub/a.json');
    f.write('sub/deep/a.json', bytes);
    f.write('keep.bin', bytes);
    fs.mkdirSync(path.join(f.fixtureRoot, 'empty'));
    const report = await f.run();
    expect(report.success).toBe(true);
    for (const rel of ['rubrics.json', 'sub/RUBRICS.json', 'answers/deep/golden.txt', 'sub/a.json']) {
      expect(fs.existsSync(path.join(report.workspace, rel)), rel).toBe(false);
      expect(fs.existsSync(path.join(f.fixtureRoot, rel)), 'source preserved').toBe(true);
    }
    for (const rel of ['sub/deep/a.json', 'keep.bin']) {
      expect(fs.readFileSync(path.join(report.workspace, rel))).toEqual(bytes);
    }
    for (const rel of ['empty', 'answers/deep']) {
      expect(fs.statSync(path.join(report.workspace, rel)).isDirectory()).toBe(true);
      expect(fs.readdirSync(path.join(report.workspace, rel))).toEqual([]);
    }
  });

  it.each([
    ['sub/a.json', 'sub/*.json', true],
    ['sub/deep/a.json', 'sub/*.json', false],
    ['sub/deep/a.json', 'sub/**/*.json', true],
    ['sub/a.json', 'sub/**/*.json', true],
    ['a.json', '**/*.json', true],
    ['sub/deep/a.json', '**/*.json', true],
    ['sub\\RUBRICS.json', '/sub/rubrics.json', true],
    ['deep/sub/rubrics.json', '/sub/rubrics.json', false],
    ['RUBRICSXjson', 'RUBRICS.json', false],
    ['rubrics.json', 'RUBRICS.json', true],
  ])('matches %s against %s = %s', (rel, pattern, expected) => {
    expect(matchLeakGlob(rel, pattern)).toBe(expected);
  });

  it('rejects declared paths that survive copying, listing every hit', () => {
    const f = fixture();
    f.write('answers/a.json');
    f.write('answers/b.json');
    f.write('RUBRICS.json');
    let error: unknown;
    try {
      assertNoLeakPaths(f.fixtureRoot, { declared: ['answers/**', 'RUBRICS.json'] });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(FixtureLeakError);
    for (const hit of ['RUBRICS.json (declared: RUBRICS.json)', 'answers/a.json (declared: answers/**)', 'answers/b.json (declared: answers/**)']) {
      expect((error as Error).message).toContain(hit);
    }
  });

  it('an empty declaration still enforces builtin red lines', async () => {
    const f = fixture([]);
    f.write('rubric.json');
    await expect(f.run()).rejects.toThrow(FixtureLeakError);
  });

  it('does not follow directory links during the post-prepare scan', () => {
    const f = fixture();
    const outside = path.join(f.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'RUBRICS.json'), 'outside');
    fs.symlinkSync(outside, path.join(f.fixtureRoot, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => assertNoLeakPaths(f.fixtureRoot, { declared: [] })).not.toThrow();
  });

  it('preserves B002 tests and all existing fixture trees without a filter', async () => {
    const fixtures = path.join(REPO_ROOT, 'benchmarks/fixtures');
    // Synthetic offline runs exercise the shared copy through the runner.
    for (const entry of fs.readdirSync(fixtures, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const f = fixture();
      const source = path.join(fixtures, entry.name);
      fs.cpSync(source, f.fixtureRoot, { recursive: true });
      const report = await f.run();
      const check = (dir: string, rel = ''): void => {
        for (const childEntry of fs.readdirSync(dir, { withFileTypes: true })) {
          const child = path.join(rel, childEntry.name);
          const target = path.join(report.workspace, child);
          if (childEntry.isDirectory()) {
            expect(fs.statSync(target).isDirectory()).toBe(true);
            check(path.join(dir, childEntry.name), child);
          } else if (childEntry.isFile()) {
            expect(fs.readFileSync(target)).toEqual(fs.readFileSync(path.join(dir, childEntry.name)));
          }
        }
      };
      check(source);
      if (entry.name === 'B002') {
        for (const rel of ['tests/mod_a.test.js', 'tests/util.test.js']) {
          expect(fs.readFileSync(path.join(report.workspace, rel))).toEqual(fs.readFileSync(path.join(source, rel)));
        }
      }
    }
  }, 60_000);
});

describe('adapter fixture leak boundary', () => {
  for (const [name, run] of [['codex', runCodexFixture], ['vessel', runVesselFixture]] as const) {
    it(`${name} excludes declared criteria before execution without touching the source`, async () => {
      const f = fixture();
      f.write('RUBRICS.json');
      const runCommand = vi.fn(() => { throw new Error('must not execute a real CLI'); });
      const input: HarnessFixture = {
        id: 'X001', workspaceRoot: f.fixtureRoot, leakGlobs: ['RUBRICS.json'],
        options: { configRoot: REPO_ROOT, keepWorkspace: true, _envResolve: () => false, runCommand },
      };
      const result = await run(input);
      const workspace = result.artifacts!.find((artifact) => artifact.kind === 'workspace')!.path;
      roots.push(workspace);
      expect(fs.existsSync(path.join(workspace, 'RUBRICS.json'))).toBe(false);
      expect(fs.readFileSync(path.join(workspace, 'task.md'))).toEqual(fs.readFileSync(path.join(f.fixtureRoot, 'task.md')));
      expect(fs.existsSync(path.join(f.fixtureRoot, 'RUBRICS.json'))).toBe(true);
      expect(runCommand).not.toHaveBeenCalled();
    });

    it(`${name} throws FixtureLeakError for undeclared criteria before execution`, async () => {
      const f = fixture();
      f.write('RUBRICS.json');
      const chat = vi.fn<ChatProvider['chat']>(async () => { throw new Error('must not execute'); });
      const runCommand = vi.fn(() => { throw new Error('must not execute a real CLI'); });
      // Unique test-owned prefix also identifies the workspace when staging rejects.
      const id = path.basename(f.root);
      try {
        await expect(run({
          id, workspaceRoot: f.fixtureRoot,
          options: { configRoot: REPO_ROOT, provider: { id: 'leak-probe', chat }, _envResolve: () => false, runCommand },
        })).rejects.toBeInstanceOf(FixtureLeakError);
        expect(chat).not.toHaveBeenCalled();
        expect(runCommand).not.toHaveBeenCalled();
      } finally {
        for (const dir of fs.readdirSync(os.tmpdir())) {
          if (dir.startsWith(`cah-${name}-${id}-`)) roots.push(path.join(os.tmpdir(), dir));
        }
      }
    });
  }
});

describe('leak_globs manifest validation', () => {
  it.each([null, 'answers/**', [1], ['ok', false]])('rejects invalid value %j', (value) => {
    const f = fixture(value);
    expect(() => loadManifest(f.root, 'X001')).toThrow('leak_globs must be a string array');
  });

  it('retains string arrays and accepts omission', () => {
    expect(loadManifest(fixture(['answers/**']).root, 'X001').leak_globs).toEqual(['answers/**']);
    expect(loadManifest(fixture([]).root, 'X001').leak_globs).toEqual([]);
    expect(loadManifest(fixture().root, 'X001').leak_globs).toBeUndefined();
  });
});
