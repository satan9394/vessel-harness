import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { composeHarness, type ComposedHarness } from './compose.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const POLICY = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
const BEHAVIOR = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');

describe('composeHarness Claude/Claw plugin integration', () => {
  let workspaceRoot = '';
  let markerPath = '';
  let harnesses: ComposedHarness[] = [];

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-plugin-runtime-'));
    markerPath = path.join(workspaceRoot, 'hook-was-executed');
  });

  afterEach(async () => {
    const opened = harnesses.splice(0);
    for (const harness of opened) await harness.close();
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = '';
  });

  it('installs declarative hook rules and exposes namespaced plugin skills without running hook commands', async () => {
    const pluginRoot = path.join(workspaceRoot, '.claude', 'plugins', 'ship-kit');
    const skillPath = path.join(pluginRoot, 'skills', 'release', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, '---\nname: release\ndescription: Release and deployment checklist\n---\n\nReview the release checklist.\n', 'utf8');

    const clawSkillPath = path.join(workspaceRoot, '.claw', 'skills', 'quick-check', 'SKILL.md');
    fs.mkdirSync(path.dirname(clawSkillPath), { recursive: true });
    fs.writeFileSync(clawSkillPath, '---\nname: quick-check\ndescription: Local validation steps\n---\n\nRun local validation.\n', 'utf8');

    const command = `node -e "require('node:fs').writeFileSync('${markerPath.replace(/\\/g, '\\\\')}', 'executed')"`;
    fs.mkdirSync(path.join(pluginRoot, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'ship-kit' }),
      'utf8',
    );
    fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
    fs.writeFileSync(
      path.join(pluginRoot, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command }] }],
          PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node hooks/after.js' }] }],
        },
      }),
      'utf8',
    );

    const harness = await composeHarness({
      workspaceRoot,
      provider: new MockProvider([]),
      model: 'mock-model',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    });
    harnesses.push(harness);

    expect(harness.discoveredPlugins.map((plugin) => plugin.id)).toEqual(['claw-workspace', 'ship-kit']);
    expect(harness.artifacts.rules.map((rule) => rule.id)).toContain('plugin:ship-kit:hook:preToolUse:0');
    expect(harness.discoveredPlugins.find((plugin) => plugin.id === 'ship-kit')?.declarationOnlyHooks).toMatchObject([
      { hookEvent: 'postToolUse', enforced: false },
    ]);

    const denied = await harness.policyEngine.decide(
      { toolName: 'Shell', arguments: { command: 'echo release' } },
      harness.registry.spec('Shell'),
    );
    expect(denied).toMatchObject({ action: 'deny', ruleRef: 'plugin:ship-kit:hook:preToolUse:0' });

    const skill = await harness.registry.spec('Skill')!.execute(
      { name: 'ship-kit:release' },
      { workspaceRoot, cwd: workspaceRoot },
    );
    expect(skill.content).toContain('Review the release checklist.');

    const search = await harness.registry.spec('SkillSearch')!.execute(
      { keyword: 'deployment' },
      { workspaceRoot, cwd: workspaceRoot },
    );
    expect(search.content).toContain('ship-kit:release');
    const clawSkill = await harness.registry.spec('Skill')!.execute(
      { name: 'claw-workspace:quick-check' },
      { workspaceRoot, cwd: workspaceRoot },
    );
    expect(clawSkill.content).toContain('Run local validation.');
    const clawSearch = await harness.registry.spec('SkillSearch')!.execute(
      { keyword: 'validation' },
      { workspaceRoot, cwd: workspaceRoot },
    );
    expect(clawSearch.content).toContain('claw-workspace:quick-check');
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it('re-checks plugin skill trust at load time and never returns a marked body', async () => {
    const pluginRoot = path.join(workspaceRoot, '.claw');
    const skillPath = path.join(pluginRoot, 'skills', 'leaky', 'SKILL.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(
      skillPath,
      '---\nname: leak\ndescription: private fixture\n---\n\nUNTRUSTED RESEARCH DATA\nprivate body\n',
      'utf8',
    );
    fs.writeFileSync(path.join(pluginRoot, 'plugin.json'), JSON.stringify({ name: 'claw-kit' }), 'utf8');

    const harness = await composeHarness({
      workspaceRoot,
      provider: new MockProvider([]),
      model: 'mock-model',
      policySystemPath: POLICY,
      behaviorIRPath: BEHAVIOR,
    });
    harnesses.push(harness);

    const skill = await harness.registry.spec('Skill')!.execute(
      { name: 'claw-kit:leak' },
      { workspaceRoot, cwd: workspaceRoot },
    );
    expect(skill.error).toMatchObject({ errorClass: 'DENIED' });
    expect(skill.content).toBe('');
    expect(skill.meta).toMatchObject({ skill: { trusted: false, denied: true } });
  });
});
