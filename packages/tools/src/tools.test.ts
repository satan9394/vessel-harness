import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToolRegistry, createFsTools, createSearchTools, createShellTool } from './index.js';
import { Sandbox } from '@cah/runtime';
import { globMatch } from './globmatch.js';

const FS_POLICY = { protected: ['.git', '.git/**', '.env'], denyRead: ['**/.ssh/**'], allow: [] };

describe('glob matcher', () => {
  it('matches ** and segment globs', () => {
    expect(globMatch('.git/**', '.git/config')).toBe(true);
    expect(globMatch('.git/**', '.git')).toBe(true);
    expect(globMatch('src/**/*.ts', 'src/a/b/c.ts')).toBe(true);
    expect(globMatch('**/.env', 'a/b/.env')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a.ts')).toBe(true);
    expect(globMatch('src/*.ts', 'src/a/b.ts')).toBe(false);
  });
});

describe('6 builtin tools', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-tools-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function registry(): ToolRegistry {
    const sandbox = new Sandbox();
    const tools = [
      ...createFsTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }),
      ...createSearchTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }),
      createShellTool({ workspaceRoot: dir, sandbox }),
    ];
    return new ToolRegistry(tools);
  }

  it('Read/Write/Edit/Glob/Grep/Shell are all registered and visible', () => {
    const r = registry();
    expect(r.listVisible().map((t) => t.name).sort()).toEqual(['Edit', 'Glob', 'Grep', 'Read', 'Shell', 'Write']);
  });

  it('Read returns file content; Write then Read round-trips', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'sub/hello.txt', content: 'hello world' } }, ctx);
    expect(w.error).toBeUndefined();
    const rd = await r.execute({ toolCallId: '2', toolName: 'Read', arguments: { path: 'sub/hello.txt' } }, ctx);
    expect(rd.content).toBe('hello world');
  });

  it('Edit replaces a literal substring once or all', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'f.txt', content: 'aXbXc' } }, ctx);
    const e1 = await r.execute({ toolCallId: '2', toolName: 'Edit', arguments: { path: 'f.txt', old_string: 'X', new_string: 'Y' } }, ctx);
    expect(e1.error).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8')).toBe('aYbXc');
    await r.execute({ toolCallId: '3', toolName: 'Edit', arguments: { path: 'f.txt', old_string: 'X', new_string: 'Z', replace_all: true } }, ctx);
    expect(fs.readFileSync(path.join(dir, 'f.txt'), 'utf8')).toBe('aYbZc');
  });

  it('Glob finds files by pattern', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'src/a.ts', content: '' } }, ctx);
    await r.execute({ toolCallId: '2', toolName: 'Write', arguments: { path: 'src/deep/b.ts', content: '' } }, ctx);
    const g = await r.execute({ toolCallId: '3', toolName: 'Glob', arguments: { pattern: 'src/**/*.ts' } }, ctx);
    expect(g.content).toContain('src/a.ts');
    expect(g.content).toContain('src/deep/b.ts');
  });

  it('Grep returns file:line matches', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: 'x.js', content: 'const needle_abc = 1;\nconsole.log(needle_abc);' } }, ctx);
    const g = await r.execute({ toolCallId: '2', toolName: 'Grep', arguments: { pattern: 'needle_abc' } }, ctx);
    expect(g.content).toContain('x.js:1');
    expect(g.content).toContain('x.js:2');
  });

  it('Shell runs a real command (node -e) and returns output', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    const s = await r.execute({ toolCallId: '1', toolName: 'Shell', arguments: { command: 'node -e "console.log(40+2)"' } }, ctx);
    expect(s.error).toBeUndefined();
    expect(s.content).toContain('42');
  });

  it('write to protected path (.env) is DENIED by the tool-layer guard', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    const w = await r.execute({ toolCallId: '1', toolName: 'Write', arguments: { path: '.env', content: 'SECRET=1' } }, ctx);
    expect(w.error?.errorClass).toBe('DENIED');
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(false);
  });

  it('path escape via ../ is rejected (canonical guard)', async () => {
    const r = registry();
    const ctx = { workspaceRoot: dir, cwd: dir, sandbox: new Sandbox() };
    const rd = await r.execute({ toolCallId: '1', toolName: 'Read', arguments: { path: '../../windows/system32/win.ini' } }, ctx);
    expect(rd.error).toBeDefined();
  });

  it('denied tools are removed from the visible set and rejected at execution', async () => {
    const sandbox = new Sandbox();
    const r = new ToolRegistry(
      [...createFsTools({ workspaceRoot: dir, fsPolicy: FS_POLICY }), createShellTool({ workspaceRoot: dir, sandbox })],
      { deniedTools: ['Shell'] },
    );
    expect(r.listVisible().map((t) => t.name)).not.toContain('Shell');
    const s = await r.execute({ toolCallId: '1', toolName: 'Shell', arguments: { command: 'ls' } }, { workspaceRoot: dir, cwd: dir, sandbox });
    expect(s.error?.errorClass).toBe('DENIED');
  });
});
