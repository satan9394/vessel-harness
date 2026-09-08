import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listIndex } from '../index.js';
import { loadSkillContent, createSkillTool, formatSkillBody, SKILL_CONTENT_MAX_CHARS } from './SkillLoader.js';
import type { ToolExecutionContext } from '@vessel/shared';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const SKILL_MD = (body: string) =>
  `---\nname: demo-skill\ndescription: 演示技能，用于正文注入测试\n---\n# Demo\n\n${body}`;

describe('skills/load — content loading (V0.3-M3)', () => {
  let ws: string;
  let skillDir: string;

  beforeEach(() => {
    ws = tmpDir('cah-skills-');
    // project-scope skill root: <ws>/.dsh/skills/<name>/SKILL.md
    skillDir = path.join(ws, '.dsh', 'skills', 'demo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('index exposes only name+description (progressive disclosure — no body)', () => {
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD('secret body not in index'), 'utf8');
    const idx = listIndex(ws, 'project');
    const entry = idx.find((e) => e.name === 'demo-skill');
    expect(entry).toBeDefined();
    expect(entry!.description).toContain('演示技能');
    // body must NOT leak into the index
    expect(JSON.stringify(idx)).not.toContain('secret body not in index');
  });

  it('loadSkillContent reads the full SKILL.md body at call time', () => {
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD('指令：先读后写。'), 'utf8');
    const loaded = loadSkillContent('demo-skill', ws, 'project');
    expect(loaded).toBeDefined();
    expect(loaded!.body).toContain('指令：先读后写');
    expect(loaded!.name).toBe('demo-skill');
    expect(loaded!.sourcePath).toContain('demo-skill');
  });

  it('unknown skill resolves to undefined', () => {
    expect(loadSkillContent('nope', ws, 'project')).toBeUndefined();
  });

  it('formatSkillBody frames the body with skill_content structure markers', () => {
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD('正文'), 'utf8');
    const loaded = loadSkillContent('demo-skill', ws, 'project')!;
    const text = formatSkillBody(loaded);
    expect(text).toContain('[skill:demo-skill');
    expect(text).toContain('<skill_content>');
    expect(text).toContain('</skill_content>');
  });

  it('truncates an over-long body with a marker (token discipline)', () => {
    const huge = 'x'.repeat(SKILL_CONTENT_MAX_CHARS + 500);
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD(huge), 'utf8');
    const loaded = loadSkillContent('demo-skill', ws, 'project')!;
    expect(loaded.truncated).toBe(true);
    expect(loaded.body.length).toBeLessThanOrEqual(SKILL_CONTENT_MAX_CHARS + 64);
    expect(loaded.body).toContain('截断');
  });
});

describe('skills/load — Skill tool', () => {
  let ws: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    ws = tmpDir('cah-skills-tool-');
    ctx = { workspaceRoot: ws, cwd: ws };
    const skillDir = path.join(ws, '.dsh', 'skills', 'demo-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD('tool-body'), 'utf8');
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('returns skill content on demand through the tool', async () => {
    const tool = createSkillTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({ name: 'demo-skill' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toContain('<skill_content>');
    expect(r.content).toContain('tool-body');
    const metaSkill = r.meta.skill as { name?: string } | undefined;
    expect(metaSkill?.name).toBe('demo-skill');
  });

  it('reports INVALID_ARGS for a missing skill', async () => {
    const tool = createSkillTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({ name: 'absent' }, ctx);
    expect(r.error?.errorClass).toBe('INVALID_ARGS');
  });

  it('requires the name argument', async () => {
    const tool = createSkillTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({}, ctx);
    expect(r.error?.errorClass).toBe('INVALID_ARGS');
  });
});
