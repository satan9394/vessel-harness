import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  discoverClaudePlugins,
  mapClaudeHooksToDeclarations,
  mapClaudeHooksToPolicyRules,
} from './pluginLoader.js';

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-plugin-loader-'));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function writeSkill(root: string, name: string, body = 'ordinary skill body', description = `${name} description`): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, 'utf8');
  return file;
}

describe('discoverClaudePlugins', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = tempWorkspace();
  });

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('discovers a Claude plugin and namespaces all declared skills', () => {
    const pluginRoot = path.join(workspace, '.claude', 'plugins', 'review-kit');
    const skillRoot = path.join(pluginRoot, 'skills');
    const first = writeSkill(skillRoot, 'review');
    const second = writeSkill(skillRoot, 'release');
    writeJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {
      name: 'review-kit',
      version: '1.2.0',
      author: { name: 'Example Author' },
      skills: ['./skills'],
    });

    const [plugin] = discoverClaudePlugins(workspace);
    expect(plugin).toBeDefined();
    expect(plugin!.id).toBe('review-kit');
    expect(plugin!.manifest.author).toBe('Example Author');
    expect(plugin!.isTrusted).toBe(true);
    expect(plugin!.skills.map((skill) => skill.name).sort()).toEqual(['review-kit:release', 'review-kit:review']);
    expect(plugin!.skills.map((skill) => skill.sourcePath).sort()).toEqual([first, second].sort());
  });

  it('discovers the .claw root and auto-indexes .claw/skills', () => {
    const pluginRoot = path.join(workspace, '.claw');
    const skillFile = writeSkill(path.join(pluginRoot, 'skills'), 'local-route');
    writeJson(path.join(pluginRoot, 'plugin.json'), {
      name: 'claw-local',
      skill_paths: ['./skills'],
    });

    const plugins = discoverClaudePlugins(workspace);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.skills).toMatchObject([
      {
        name: 'claw-local:local-route',
        sourcePath: skillFile,
        trusted: true,
      },
    ]);
  });

  it('keeps provenance visible while marking a skill containing a §18 marker untrusted', () => {
    const pluginRoot = path.join(workspace, 'plugins', 'unsafe-skill');
    writeSkill(path.join(pluginRoot, 'skills'), 'leaky', 'UNTRUSTED RESEARCH DATA\nsecret body');
    writeJson(path.join(pluginRoot, 'plugin.json'), {
      name: 'unsafe-skill',
      skills: ['./skills'],
    });

    const [plugin] = discoverClaudePlugins(workspace);
    expect(plugin!.isTrusted).toBe(false);
    expect(plugin!.skills[0]).toMatchObject({
      name: 'unsafe-skill:leaky',
      trusted: false,
      untrustedMarker: 'untrusted-research-data',
    });
  });

  it('adapts workspace .claude/skills and .claw/skills roots when no plugin manifest exists', () => {
    const claudeSkill = writeSkill(path.join(workspace, '.claude', 'skills'), 'review');
    const clawSkill = writeSkill(path.join(workspace, '.claw', 'skills'), 'route');

    const plugins = discoverClaudePlugins(workspace);
    expect(plugins.map((plugin) => plugin.id)).toEqual(['claude-workspace', 'claw-workspace']);
    expect(plugins[0]!.skills).toMatchObject([{ name: 'claude-workspace:review', sourcePath: claudeSkill, trusted: true }]);
    expect(plugins[1]!.skills).toMatchObject([{ name: 'claw-workspace:route', sourcePath: clawSkill, trusted: true }]);
  });

  it('fails closed for a manifest path escape without indexing outside the plugin', () => {
    const pluginRoot = path.join(workspace, '.claude', 'plugins', 'escape');
    writeJson(path.join(pluginRoot, 'plugin.json'), {
      name: 'escape',
      skills: ['../../outside-skills'],
    });
    const outside = path.join(workspace, 'outside-skills');
    writeSkill(outside, 'should-not-load');

    const [plugin] = discoverClaudePlugins(workspace);
    expect(plugin).toBeDefined();
    expect(plugin!.isTrusted).toBe(false);
    expect(plugin!.skills).toEqual([]);
    expect(plugin!.skills.some((skill) => skill.sourcePath.startsWith(outside))).toBe(false);
  });

  it('ignores malformed and nameless manifests without aborting other discovery', () => {
    const goodRoot = path.join(workspace, '.claw', 'plugins', 'good');
    writeJson(path.join(goodRoot, 'plugin.json'), { name: 'good' });
    const malformed = path.join(workspace, 'plugins', 'broken', 'plugin.json');
    fs.mkdirSync(path.dirname(malformed), { recursive: true });
    fs.writeFileSync(malformed, '{not-json', 'utf8');
    writeJson(path.join(workspace, 'plugins', 'nameless', 'plugin.json'), { description: 'missing name' });

    const plugins = discoverClaudePlugins(workspace);
    expect(plugins.map((plugin) => plugin.id)).toEqual(['good']);
  });

  it('maps pre-call hooks to fail-closed rules and preserves post-call hooks as non-executable declarations', () => {
    const rules = mapClaudeHooksToPolicyRules('hook-kit', {
      preToolUse: ['Bash'],
      postToolUse: ['node hooks/after.js'],
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: 'plugin:hook-kit:hook:preToolUse:0',
      action: 'deny',
      domain: 'tools',
      hookEvent: 'preToolUse',
    });
    expect(rules[0]!.match({ toolName: 'Shell', arguments: {} })).toBe(true);
    expect(rules[0]!.match({ toolName: 'Read', arguments: {} })).toBe(false);

    const declarations = mapClaudeHooksToDeclarations('hook-kit', {
      postToolUse: ['node hooks/after.js'],
    });
    expect(declarations).toEqual([{
      id: 'plugin:hook-kit:hook:postToolUse:0',
      pluginId: 'hook-kit',
      hookEvent: 'postToolUse',
      source: 'node hooks/after.js',
      enforced: false,
      reason: expect.stringContaining('never executed'),
    }]);
    expect('match' in declarations[0]!).toBe(false);
    expect('action' in declarations[0]!).toBe(false);
  });

  it('normalizes official matcher-shaped hooks and exposes their policy rules', () => {
    const pluginRoot = path.join(workspace, '.claude', 'matcher-plugin');
    writeJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), {
      name: 'matcher-plugin',
      hooks: {
        PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node hook.js' }] }],
      },
    });

    const [plugin] = discoverClaudePlugins(workspace);
    expect(plugin!.policyRules).toHaveLength(1);
    expect(plugin!.policyRules![0]!.hookEvent).toBe('preToolUse');
    expect(plugin!.policyRules![0]!.match({ toolName: 'Write', arguments: {} })).toBe(true);
    expect(plugin!.policyRules![0]!.match({ toolName: 'Shell', arguments: {} })).toBe(false);
  });

  it('exposes postToolUse in an unenforced declaration without creating a pre-call blocker', () => {
    const pluginRoot = path.join(workspace, 'plugins', 'post-hook');
    writeJson(path.join(pluginRoot, 'plugin.json'), {
      name: 'post-hook',
      hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node after.js' }] }] },
    });

    const [plugin] = discoverClaudePlugins(workspace);
    expect(plugin!.policyRules).toBeUndefined();
    expect(plugin!.declarationOnlyHooks).toMatchObject([
      { hookEvent: 'postToolUse', source: 'Write', enforced: false },
    ]);
  });

  it('loads the standard hooks/hooks.json event map as bounded declarations', () => {
    const pluginRoot = path.join(workspace, 'plugins', 'claude-security');
    writeJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'), { name: 'claude-security' });
    writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
      description: 'Hook metadata is retained as data.',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh hooks/check.sh' }] }],
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh hooks/metrics.sh', if: 'Bash(python *)' }] }],
        PostToolUseFailure: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh hooks/failure.sh' }] }],
      },
    });

    const [plugin] = discoverClaudePlugins(workspace);
    expect(plugin!.manifest.hooks?.preToolUse).toEqual([{ matcher: 'Bash', commands: ['sh hooks/check.sh'] }]);
    expect(plugin!.manifest.hooks?.postToolUse).toEqual([
      { matcher: 'Bash', commands: ['sh hooks/metrics.sh'], condition: 'Bash(python *)' },
    ]);
    expect(plugin!.policyRules).toMatchObject([
      { hookEvent: 'preToolUse', matcher: 'Bash', commands: ['sh hooks/check.sh'] },
    ]);
    expect(plugin!.policyRules![0]!.match({ toolName: 'Shell', arguments: {} })).toBe(true);
    expect(plugin!.policyRules![0]!.match({ toolName: 'Write', arguments: {} })).toBe(false);
    expect(plugin!.declarationOnlyHooks).toMatchObject([
      { hookEvent: 'postToolUse', matcher: 'Bash', commands: ['sh hooks/metrics.sh'], condition: 'Bash(python *)', enforced: false },
      { hookEvent: 'PostToolUseFailure', matcher: 'Bash', commands: ['sh hooks/failure.sh'], enforced: false },
    ]);
  });

  it('loads a manifest-referenced hooks file only from within the plugin root', () => {
    const pluginRoot = path.join(workspace, '.claude', 'plugins', 'referenced-hooks');
    writeJson(path.join(pluginRoot, 'plugin.json'), { name: 'referenced-hooks', hooks: './custom/hooks.json' });
    writeJson(path.join(pluginRoot, 'custom', 'hooks.json'), {
      hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'node guard.js' }] }] },
    });

    const [plugin] = discoverClaudePlugins(workspace);
    expect(plugin!.isTrusted).toBe(true);
    expect(plugin!.policyRules).toMatchObject([{ matcher: 'Write', commands: ['node guard.js'] }]);

    const escapedRoot = path.join(workspace, '.claw', 'escaped-hooks');
    writeJson(path.join(escapedRoot, 'plugin.json'), { name: 'escaped-hooks', hooks: '../../outside-hooks.json' });
    writeJson(path.join(workspace, 'outside-hooks.json'), { hooks: { PreToolUse: ['Bash'] } });
    const escaped = discoverClaudePlugins(workspace).find((item) => item.id === 'escaped-hooks');
    expect(escaped!.isTrusted).toBe(false);
    expect(escaped!.policyRules).toBeUndefined();
  });

  it('marks malformed hook files untrusted and fails closed on compound tool matchers', () => {
    const pluginRoot = path.join(workspace, 'plugins', 'bad-hooks');
    writeJson(path.join(pluginRoot, 'plugin.json'), { name: 'bad-hooks' });
    fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), '{bad json', 'utf8');

    const malformed = discoverClaudePlugins(workspace).find((item) => item.id === 'bad-hooks');
    expect(malformed!.isTrusted).toBe(false);

    const [rule] = mapClaudeHooksToPolicyRules('compound', { preToolUse: ['Bash|Write'] });
    expect(rule!.match({ toolName: 'Shell', arguments: {} })).toBe(true);
    expect(rule!.match({ toolName: 'Write', arguments: {} })).toBe(true);
  });

  it('marks oversized hook configuration untrusted without parsing it', () => {
    const pluginRoot = path.join(workspace, 'plugins', 'oversized-hooks');
    writeJson(path.join(pluginRoot, 'plugin.json'), { name: 'oversized-hooks' });
    fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), `{"hooks":{},"padding":"${'x'.repeat(270_000)}"}`, 'utf8');

    const plugin = discoverClaudePlugins(workspace).find((item) => item.id === 'oversized-hooks');
    expect(plugin!.isTrusted).toBe(false);
    expect(plugin!.manifest.hooks).toBeUndefined();
  });
});
