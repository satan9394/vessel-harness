import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listIndex, formatIndexText } from '../index.js';
import {
  loadSkillContent,
  createSkillTool,
  formatSkillBody,
  classifySkillTrust,
  SKILL_CONTENT_MAX_CHARS,
} from './SkillLoader.js';
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
    // project-scope skill root: <ws>/.vessel/skills/<name>/SKILL.md
    skillDir = path.join(ws, '.vessel', 'skills', 'demo-skill');
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
    const skillDir = path.join(ws, '.vessel', 'skills', 'demo-skill');
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

/**
 * §18 provenance ENFORCEMENT (this card): a `trusted: false` skill must never
 * have its body handed to the model. The tool is the only model-facing return
 * path, so every assertion here is "the body is absent", not "the label is
 * present".
 */
describe('skills/load — §18 UNTRUSTED gate (fail-closed)', () => {
  let ws: string;
  let ctx: ToolExecutionContext;
  const SECRET = 'SECRET-BODY-MUST-NOT-REACH-CONTEXT';
  const PUSH = 'filler '.repeat(80); // pushes a marker past the old 400-char window

  const write = (name: string, body: string) => {
    const dir = path.join(ws, '.vessel', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} desc\n---\n# ${name}\n\n${body}`, 'utf8');
  };

  beforeEach(() => {
    ws = tmpDir('cah-skills-untrusted-');
    ctx = { workspaceRoot: ws, cwd: ws };
  });

  afterEach(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('untrusted: Skill tool refuses with DENIED and returns no body', async () => {
    write('leaky', `UNTRUSTED RESEARCH DATA\n\n${SECRET}`);
    const tool = createSkillTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({ name: 'leaky' }, ctx);
    // 旧实现直接 formatSkillBody(skill) 返回正文 ⇒ 前两条断言必红
    expect(r.error?.errorClass).toBe('DENIED');
    expect(r.error?.detail).toMatchObject({ reason: 'untrusted-skill', marker: 'untrusted-research-data' });
    expect(r.content).toBe('');
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(r.error?.message).toContain('UNTRUSTED');
    expect(r.meta).toMatchObject({ skill: { denied: true, trusted: false, reason: 'untrusted-skill' } });
  });

  it('untrusted: refusal also holds when the marker sits past the old 400-char window', async () => {
    write('leaky-late', `${PUSH}\nUNTRUSTED RESEARCH DATA\n\n${SECRET}`);
    const tool = createSkillTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({ name: 'leaky-late' }, ctx);
    expect(r.error?.errorClass).toBe('DENIED');
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('untrusted: loadSkillContent carries the provenance verdict on the load path', () => {
    write('leaky-unit', `${PUSH}\n${SECRET}\nreverse-engineered prompt`);
    const loaded = loadSkillContent('leaky-unit', ws, 'project')!;
    expect(loaded.trusted).toBe(false);
    expect(loaded.untrustedMarker).toBe('reverse-engineered');
    // 判定扫的是全文：正文里确实带着那段内容（拒不拒绝由工具决定，不是靠删正文）
    expect(loaded.body).toContain(SECRET);
  });

  it('clean skill still loads through the tool (negative control — no blanket denial)', async () => {
    write('clean', `just ordinary instructions\n\n${SECRET}`);
    const tool = createSkillTool({ workspaceRoot: ws, scope: 'project' });
    const r = await tool.execute({ name: 'clean' }, ctx);
    expect(r.error).toBeUndefined();
    expect(r.content).toContain('<skill_content>');
    expect(r.content).toContain(SECRET);
    expect(r.meta).toMatchObject({ skill: { trusted: true } });
  });

  it('index: untrusted skill is listed but labelled 不可装载', () => {
    write('leaky-idx', 'UNTRUSTED RESEARCH DATA');
    write('clean-idx', 'nothing special');
    const entries = listIndex(ws, 'project');
    const text = formatIndexText(entries);
    expect(text).toContain('leaky-idx'); // 可见性保留
    expect(entries.find((e) => e.name === 'leaky-idx')!.trusted).toBe(false);
    expect(entries.find((e) => e.name === 'clean-idx')!.trusted).toBe(true);
    const leakyLine = text.split('\n').find((l) => l.includes('leaky-idx'))!;
    const cleanLine = text.split('\n').find((l) => l.includes('clean-idx'))!;
    expect(leakyLine).toContain('不可装载');
    expect(cleanLine).not.toContain('UNTRUSTED');
    // 索引仍然只有 name+description：正文永不进索引
    expect(text).not.toContain('nothing special');
    expect(text).not.toContain('UNTRUSTED RESEARCH DATA');
  });

  it('marker classification: whole text, whitespace-tolerant, non-adjacent words ignored', () => {
    expect(classifySkillTrust('x'.repeat(5000) + 'UNTRUSTED RESEARCH DATA').trusted).toBe(false);
    expect(classifySkillTrust('UNTRUSTED\nRESEARCH DATA').trusted).toBe(false);
    expect(classifySkillTrust('uNtRuStEd   ReSeArCh\tDaTa').trusted).toBe(false);
    expect(classifySkillTrust('reverse-\nengineered').trusted).toBe(false);
    expect(classifySkillTrust('逆向').trusted).toBe(false);
    expect(classifySkillTrust('a leaked credential').trusted).toBe(false);
    // 不相邻的普通措辞不得误杀
    expect(classifySkillTrust('untrusted input handling\n\nresearch data governance').trusted).toBe(true);
    expect(classifySkillTrust('').trusted).toBe(true);
  });
});
