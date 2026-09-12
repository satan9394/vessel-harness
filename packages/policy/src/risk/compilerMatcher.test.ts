import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compilePolicyYaml } from './Compiler.js';
import { PolicyEngine } from '../engine/Engine.js';
import type { PolicyRule } from '@vessel/shared';

// Shell/Bash scoped-rule matchers (POLICY-SPEC §3.3). `parseMatcher` is
// module-private, so the predicates are exercised *indirectly* through the
// public compile entry (`compilePolicyYaml`) — no public surface was widened
// for these tests. Two documented shapes:
//   - without `*`: literal prefix match (legacy `startsWith`, unchanged);
//   - with `*`: anchored glob (`*` → `.*`, everything else escaped literally).
const MATCHER_POLICY = `
policy:
  version: "0.1"
  profile: workspace-write
  approval: never
  shell:
    scoped_rules:
      - id: shell-force-push
        match: "Shell(git push --force*)"
        action: deny
        reason: "force push rewrites shared history — denied by default"
      - id: shell-git-status
        match: "Shell(git status)"
        action: allow
        reason: "readonly prefix without glob — legacy prefix semantics"
      - id: shell-mid-wildcard
        match: "Shell(git * --force*)"
        action: deny
        reason: "wildcard in the middle of the command matcher"
      - id: shell-cleanup-glob
        match: "Bash(rm -rf ./node_modules*)"
        action: deny
        reason: "glob form of the workspace cleanup rule"
      - id: shell-cleanup-recursive
        match: "Bash(rm -rf ./node_modules)"
        action: deny
        reason: "existing default-config matcher (no glob)"
  tools:
    rules:
      - id: tool-read-secrets
        match: 'Read(path=glob "**/.env")'
        action: deny
        reason: "credentials"
`;

function compiledRule(id: string, yamlText: string = MATCHER_POLICY): PolicyRule {
  const found = compilePolicyYaml(yamlText).rules.find((r) => r.id === id);
  if (!found) throw new Error(`rule not compiled: ${id}`);
  return found;
}

const shellCall = (command: string) => ({ toolName: 'Shell', arguments: { command } });

/** 仓库自带系统策略（只读，不在本卡改动范围内） */
const DEFAULT_POLICY_PATH = fileURLToPath(new URL('../../../../configs/policy.default.yaml', import.meta.url));

describe('policy/risk — Compiler `Shell(...)`/`Bash(...)` matcher: `*` glob support', () => {
  it('`Shell(git push --force*)` 命中真实 force push（本次修复的核心判别点）', () => {
    const rule = compiledRule('shell-force-push');
    expect(rule.match(shellCall('git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('git push --force'))).toBe(true);
    expect(rule.match(shellCall('git push --force-with-lease origin main'))).toBe(true);
    // 命令尾随空白由原有的 trim() 归一化，语义不变
    expect(rule.match(shellCall('  git push --force origin main  '))).toBe(true);
  });

  it('`Shell(git push --force*)` 不过度拦截：普通 push 与其他命令为 false', () => {
    const rule = compiledRule('shell-force-push');
    expect(rule.match(shellCall('git push origin main'))).toBe(false);
    expect(rule.match(shellCall('git commit -m x'))).toBe(false);
    expect(rule.match(shellCall('git commit -m "push --force"'))).toBe(false);
    expect(rule.match(shellCall('git push origin --force-with-lease-feature'))).toBe(false);
  });

  it('带 `*` 的 matcher 整体锚定：前缀多出其他文本不命中（也不是正则）', () => {
    const rule = compiledRule('shell-force-push');
    expect(rule.match(shellCall('sudo git push --force origin main'))).toBe(false);
    expect(rule.match(shellCall('echo git push --force origin main'))).toBe(false);
    // 工具面不变：谓词仍只认 Shell 工具
    expect(rule.match({ toolName: 'Read', arguments: { command: 'git push --force origin main' } })).toBe(false);
  });

  it('中段通配 `Shell(git * --force*)` 命中带 --force 的命令，不命中其他 git 命令', () => {
    const rule = compiledRule('shell-mid-wildcard');
    expect(rule.match(shellCall('git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('git push --force-with-lease origin main'))).toBe(true);
    expect(rule.match(shellCall('git push origin main'))).toBe(false);
    expect(rule.match(shellCall('git commit -m x'))).toBe(false);
  });

  it('含 `*` 时正则元字符逐字转义：`./` 里的 `.` 不是任意字符', () => {
    const rule = compiledRule('shell-cleanup-glob');
    expect(rule.match(shellCall('rm -rf ./node_modules'))).toBe(true);
    expect(rule.match(shellCall('rm -rf ./node_modules/foo'))).toBe(true);
    // 若 `.` 被当成正则通配（`^rm -rf ./node_modules.*$` 未转义）这条会误命中
    expect(rule.match(shellCall('rm -rf X/node_modules/foo'))).toBe(false);
    expect(rule.match(shellCall('rm -rf ./dist'))).toBe(false);
  });

  it('不含 `*` 的 matcher 保持原有 startsWith 前缀语义（回归护栏，刻意不改全等）', () => {
    const rule = compiledRule('shell-git-status');
    expect(rule.match(shellCall('git status'))).toBe(true);
    expect(rule.match(shellCall('git status --short'))).toBe(true);
    // 前缀关系 ⇒ 既有语义即为 true；本卡不动它（未顺手改成全等）
    expect(rule.match(shellCall('git statusx'))).toBe(true);
    expect(rule.match(shellCall('git statu'))).toBe(false);
    expect(rule.match(shellCall('git commit -m x'))).toBe(false);
  });

  it('不含 `*` 的 `Bash(rm -rf ./node_modules)` 对子路径命中，既有行为不变', () => {
    const rule = compiledRule('shell-cleanup-recursive');
    expect(rule.match(shellCall('rm -rf ./node_modules/foo'))).toBe(true);
    expect(rule.match(shellCall('rm -rf ./node_modules'))).toBe(true);
    // 既有的字面前缀语义（无 `./` 即不命中）——本卡不改变，如实断言
    expect(rule.match(shellCall('rm -rf node_modules'))).toBe(false);
  });

  it('`Write(path=...)` 类路径 matcher 已走 globMatch，本次无需改动（对照用例）', () => {
    const rule = compiledRule('tool-read-secrets');
    expect(rule.match({ toolName: 'Read', arguments: { path: 'a/.env' } })).toBe(true);
    expect(rule.match({ toolName: 'Read', arguments: { path: '.env' } })).toBe(true);
    expect(rule.match({ toolName: 'Read', arguments: { path: 'x.env' } })).toBe(false);
  });
});

describe('policy/risk — force-push 拦截端到端（系统默认策略真正生效）', () => {
  it('configs/policy.default.yaml 的 shell-force-push 现在真的命中 force push', () => {
    const yamlText = fs.readFileSync(new URL('../../../../configs/policy.default.yaml', import.meta.url), 'utf8');
    const rule = compiledRule('shell-force-push', yamlText);
    expect(rule.match(shellCall('git push --force origin main'))).toBe(true);
    expect(rule.match(shellCall('git push --force-with-lease origin main'))).toBe(true);
    expect(rule.match(shellCall('git push origin main'))).toBe(false);
  });

  it('PolicyEngine 的 force-push 裁决来自 shell-force-push 规则（ruleRef 可判别）', async () => {
    // 与 default 配置同形的 scoped rule；此处刻意不含 git.force_push，
    // 使裁决只能由 scoped matcher 产生（修复前 ruleRef 会是 policy-never）。
    const engine = new PolicyEngine(compilePolicyYaml(MATCHER_POLICY));
    const denied = await engine.decide(shellCall('git push --force origin main'));
    expect(denied.action).toBe('deny');
    expect(denied.ruleRef).toBe('shell-force-push');

    const normal = await engine.decide(shellCall('git push origin main'));
    expect(normal.ruleRef).not.toBe('shell-force-push');
  });
});
