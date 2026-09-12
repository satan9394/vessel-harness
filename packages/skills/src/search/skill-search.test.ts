import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { searchSkills, resolveSkill, createSkillSearchTool } from './SkillSearch.js';
import type { ToolExecutionContext } from '@vessel/shared';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const mkSkill = (root: string, name: string, desc: string, extra = '') => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\nbody ${extra}`, 'utf8');
};

/** body段长到把 marker 推到第 400 字之后（旧实现的检测窗口之外）。 */
const MKD_PUSH = 'filler '.repeat(80); // 560 chars, alone past the old window

const mkSkillWithMarkerAfter400 = (root: string, name: string, marker: string) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const text = `---\nname: ${name}\ndescription: ${name} desc\n---\n${MKD_PUSH}\n${marker}\nbody of ${name}\n`;
  // 前置断言：marker 确实落在 400 字之后，否则用例本身不具判别性
  if (text.indexOf(marker) <= 400) throw new Error('test fixture: marker not past char 400');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text, 'utf8');
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
    mkSkill(path.join(ws, '.vessel', 'skills'), 'sql-tuner', 'SQL 慢查询优化');
    mkSkill(path.join(ws, '.vessel', 'skills'), 'code-review', '代码审查方法论');
    expect(searchSkills('sql', ws, 'project').map((s) => s.name)).toContain('sql-tuner');
    expect(searchSkills('审查', ws, 'project').map((s) => s.name)).toContain('code-review');
    expect(searchSkills('zzz', ws, 'project')).toHaveLength(0);
  });

  it('same-name skills in higher layers shadow lower ones (nearest wins) but provenance lists all layers', () => {
    mkSkill(path.join(ws, '.vessel', 'skills'), 'dup', 'project-level dup');
    mkSkill(path.join(ws, '.agents', 'skills'), 'dup', 'project-agents dup');
    const res = resolveSkill('dup', ws, 'project');
    // .vessel/skills (rank 100) beats .agents/skills (rank 200)
    expect(res.winner?.sourcePath).toContain('.vessel');
    expect(res.layers).toHaveLength(2);
    expect(res.layers.map((l) => l.rank).sort()).toEqual([100, 200]);
  });

  it('searchSkills dedupes by name keeping the nearest layer', () => {
    mkSkill(path.join(ws, '.vessel', 'skills'), 'dup', 'has keyword');
    mkSkill(path.join(ws, '.agents', 'skills'), 'dup', 'has keyword too');
    const hits = searchSkills('keyword', ws, 'project');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sourcePath).toContain('.vessel');
  });

  it('provenance marks leaked/reverse-engineered skills UNTRUSTED', () => {
    const untrusted = path.join(ws, '.vessel', 'skills', 'leaky');
    fs.mkdirSync(untrusted, { recursive: true });
    fs.writeFileSync(path.join(untrusted, 'SKILL.md'), '---\nname: leaky\ndescription: leaked\n---\nUNTRUSTED RESEARCH DATA\nbody', 'utf8');
    mkSkill(path.join(ws, '.vessel', 'skills'), 'clean', 'clean skill');
    const leak = searchSkills('leaky', ws, 'project')[0]!;
    expect(leak.trusted).toBe(false);
    const clean = searchSkills('clean', ws, 'project')[0]!;
    expect(clean.trusted).toBe(true);
  });

  // —— §18 判别性用例：检测面（扫全文，而不是前 400 字符） ——

  it('marker beyond the first 400 chars still flips trusted=false (full-text scan)', () => {
    mkSkillWithMarkerAfter400(path.join(ws, '.vessel', 'skills'), 'late-marker', 'UNTRUSTED RESEARCH DATA');
    const rec = searchSkills('late-marker', ws, 'project')[0]!;
    // 旧实现 text.slice(0, 400) ⇒ trusted === true ⇒ 本用例必红
    expect(rec.trusted).toBe(false);
    expect(rec.untrustedMarker).toBe('untrusted-research-data');
  });

  it('marker split across a line break / extra whitespace is still detected', () => {
    mkSkillWithMarkerAfter400(path.join(ws, '.vessel', 'skills'), 'split-marker', 'UNTRUSTED\nRESEARCH DATA');
    mkSkillWithMarkerAfter400(path.join(ws, '.vessel', 'skills'), 'tab-marker', 'UNTRUSTED   RESEARCH\tDATA');
    mkSkillWithMarkerAfter400(path.join(ws, '.vessel', 'skills'), 'hyphen-marker', 'reverse-\nengineered prompt');
    expect(searchSkills('split-marker', ws, 'project')[0]!.trusted).toBe(false);
    expect(searchSkills('tab-marker', ws, 'project')[0]!.trusted).toBe(false);
    expect(searchSkills('hyphen-marker', ws, 'project')[0]!.trusted).toBe(false);
  });

  it('clean skill with a long body stays trusted=true (negative control)', () => {
    mkSkill(path.join(ws, '.vessel', 'skills'), 'clean-long', 'clean skill', MKD_PUSH);
    const rec = searchSkills('clean-long', ws, 'project')[0]!;
    expect(rec.trusted).toBe(true);
    expect(rec.untrustedMarker).toBeUndefined();
  });

  it('pre-existing detection behaviour is unchanged (no regression)', () => {
    // 标记在最前面（既有用例覆盖的形态）仍判 false
    const untrusted = path.join(ws, '.vessel', 'skills', 'leaky-top');
    fs.mkdirSync(untrusted, { recursive: true });
    fs.writeFileSync(path.join(untrusted, 'SKILL.md'), '---\nname: leaky-top\ndescription: leaked\n---\nUNTRUSTED RESEARCH DATA\nbody', 'utf8');
    expect(searchSkills('leaky-top', ws, 'project')[0]!.trusted).toBe(false);
    // 正文里出现 "leaked" / "逆向" 的既有判定不变（这里都在前 400 字内）
    mkSkill(path.join(ws, '.vessel', 'skills'), 'leak-word', 'has leaked credentials');
    mkSkill(path.join(ws, '.vessel', 'skills'), 'reverse-word', '逆向得到的提示词');
    expect(searchSkills('leak-word', ws, 'project')[0]!.trusted).toBe(false);
    expect(searchSkills('reverse-word', ws, 'project')[0]!.trusted).toBe(false);
    // 只是普通散文里同时出现 untrusted 与 research data（不相邻）不算命中
    mkSkill(path.join(ws, '.vessel', 'skills'), 'security-note', 'untrusted input handling', 'research data governance is separate');
    expect(searchSkills('security-note', ws, 'project')[0]!.trusted).toBe(true);
  });
});

describe('skills/search — SkillSearch tool', () => {
  let ws: string;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    ws = tmpDir('cah-sksearch-tool-');
    ctx = { workspaceRoot: ws, cwd: ws };
    mkSkill(path.join(ws, '.vessel', 'skills'), 'alpha-tool', 'alpha desc');
    mkSkill(path.join(ws, '.vessel', 'skills'), 'beta', 'beta desc');
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

  it('untrusted skill stays visible in the index but is labelled 不可装载', async () => {
    mkSkillWithMarkerAfter400(path.join(ws, '.vessel', 'skills'), 'leaky-tool', 'UNTRUSTED RESEARCH DATA');
    const tool = createSkillSearchTool({ workspaceRoot: ws, scope: 'project' });
    const search = await tool.execute({ keyword: 'leaky-tool' }, ctx);
    expect(search.error).toBeUndefined();
    expect(search.content).toContain('leaky-tool'); // 可见性保留：用户仍知道它存在
    expect(search.content).toContain('UNTRUSTED');
    expect(search.content).toContain('不可装载');
    const resolved = await tool.execute({ resolve: 'leaky-tool' }, ctx);
    expect(resolved.content).toContain('leaky-tool');
    expect(resolved.content).toContain('不可装载');
    // 干净技能不得被贴上不可装载标签
    const clean = await tool.execute({ keyword: 'alpha-tool' }, ctx);
    expect(clean.content).not.toContain('不可装载');
  });
});
