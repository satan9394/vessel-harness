import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { searchSkills, resolveSkill, createSkillSearchTool } from './SkillSearch.js';
import type { ToolExecutionContext } from '@cah/shared';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const mkSkill = (root: string, name: string, desc: string, extra = '') => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\nbody ${extra}`, 'utf8');
};

describe('skills/search — SkillSearch/Provenance (V0.3-M4)', () => {
  let ws: string;

  beforeEach(() => {
    ws = tmpDir('cah-sksearch-');
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('searchSkills finds by name and description across the project layer', () => {
    mkSkill(path.join(ws, '.dsh', 'skills'), 'sql-tuner', 'SQL 慢查询优化');
    mkSkill(path.join(ws, '.dsh', 'skills'), 'code-review', '代码审查方法论');
    expect(searchSkills('sql', ws, 'project').map((s) => s.name)).toContain('sql-tuner');
    expect(searchSkills('审查', ws, 'project').map((s) => s.name)).toContain('code-review');
    expect(searchSkills('zzz', ws, 'project')).toHaveLength(0);
  });

  it('same-name skills in higher layers shadow lower ones (nearest wins) but provenance lists all layers', () => {
    mkSkill(path.join(ws, '.dsh', 'skills'), 'dup', 'project-level dup');
    mkSkill(path.join(ws, '.agents', 'skills'), 'dup', 'project-agents dup');
    const res = resolveSkill('dup', ws, 'project');
    // .dsh/skills (rank 100) beats .agents/skills (rank 200)
    expect(res.winner?.sourcePath).toContain('.dsh');
    expect(res.layers).toHaveLength(2);
    expect(res.layers.map((l) => l.rank).sort()).toEqual([100, 200]);
  });

  it('searchSkills dedupes by name keeping the nearest layer', () => {
    mkSkill(path.join(ws, '.dsh', 'skills'), 'dup', 'has keyword');
    mkSkill(path.join(ws, '.agents', 'skills'), 'dup', 'has keyword too');
    const hits = searchSkills('keyword', ws, 'project');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sourcePath).toContain('.dsh');
  });

  it('provenance marks leaked/reverse-engineered skills UNTRUSTED', () => {
    const untrusted = path.join(ws, '.dsh', 'skills', 'leaky');
    fs.mkdirSync(untrusted, { recursive: true });
    fs.writeFileSync(path.join(untrusted, 'SKILL.md'), '---\nname: leaky\ndescription: leaked\n---\nUNTRUSTED RESEARCH DATA\nbody', 'utf8');
    mkSkill(path.join(ws, '.dsh', 'skills'), 'clean', 'clean skill');
    const leak = searchSkills('leaky', ws, 'project')[0]!;
    expect(leak.trusted).toBe(false);
    const clean = searchSkills('clean', ws, 'project')[0]!;
    expect(clean.trusted).toBe(true);
  });
});

describe('skills/search — SkillSearch tool', () => {
  let ws: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    ws = tmpDir('cah-sksearch-tool-');
    ctx = { workspaceRoot: ws, cwd: ws };
    mkSkill(path.join(ws, '.dsh', 'skills'), 'alpha-tool', 'alpha desc');
    mkSkill(path.join(ws, '.dsh', 'skills'), 'beta', 'beta desc');
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('searches by keyword through the tool', async () => {
    const tool = createSkillSearchTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({ keyword: 'alpha' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toContain('alpha-tool');
  });

  it('resolve view shows the winner scope', async () => {
    const tool = createSkillSearchTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({ resolve: 'alpha-tool' }, ctx);
    expect(r.content).toContain('winner=project');
  });

  it('requires a keyword or resolve argument', async () => {
    const tool = createSkillSearchTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({}, ctx);
    expect(r.error?.errorClass).toBe('INVALID_ARGS');
  });
});
