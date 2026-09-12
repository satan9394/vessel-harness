import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PolicyDeclaration } from '@vessel/shared';
import { loadPolicyArtifacts, mergeScopes } from './PolicyLoader.js';
import { PolicyEngine } from '../engine/Engine.js';

/**
 * `mergeScopes` 单调趋严判别测试（POLICY-SPEC §6.2「deny 全局优先 / 低层只能加限制，不能放宽」）。
 *
 * 层序同 `loadPolicyArtifacts`：`[system, project]`——**左侧为高层**。核心判别点：低层（project，
 * 即 `.harness/policy.yaml`，克隆仓库即可携带）**不能放宽**高层（system）的限制。
 *
 * **修复前必红（10 条）**：①③（`git.force_push` 的 `deny` / `ask` 被 project 的 `allow` 覆盖）、
 * ⑥⑦⑧（`network.deny_domains` 被整体替换 / 清空、`network.default` 被降级）、
 * ⑩⑪⑫（`audit.events` / `audit.details` 被缩减）、⑰（未登记字段被低层改写）、
 * ⑱（端到端：编译出的 `git:force-push` 规则从 deny 变 allow、元数据 IP 消失、force push 命令被判 allow）。
 * ⑬⑭ 是刚修好的 `profile` / `approval` 高层优先的**回归锁**（改前改后都应为绿）。
 */

/** 最小 `PolicyDeclaration`（显式给出 profile/approval，避免依赖兜底默认）。 */
function decl(over: Partial<PolicyDeclaration> = {}): PolicyDeclaration {
  return { version: '0.1', profile: 'workspace-write', approval: 'never', ...over };
}

/** system（高层）+ project（低层）两层合成。 */
function merge(system: PolicyDeclaration, project: PolicyDeclaration): PolicyDeclaration {
  return mergeScopes([system, project]);
}

/**
 * 构造含**类型未登记字段**的 `network`（规范 §3.3 里的 `allow_domains` / `rules` 即此类；
 * `PolicyDeclaration.network` 目前只声明 `default` / `deny_domains`，但 YAML 解析不做嵌套校验）。
 */
function untypedNetwork(value: Record<string, unknown>): PolicyDeclaration['network'] {
  return value as unknown as PolicyDeclaration['network'];
}

describe('mergeScopes — git.force_push 单调取最严（clone-repo 放宽漏洞）', () => {
  it('① system deny + project allow → 仍 deny（低层不得放宽 force-push）', () => {
    const merged = merge(decl({ git: { force_push: 'deny' } }), decl({ git: { force_push: 'allow' } }));
    expect(merged.git?.force_push).toBe('deny');
  });

  it('② system 未声明 + project deny → deny（低层可以收紧）', () => {
    const merged = merge(decl(), decl({ git: { force_push: 'deny' } }));
    expect(merged.git?.force_push).toBe('deny');
  });

  it('③ system ask + project allow → ask（allow 不得放宽 ask）', () => {
    const merged = merge(decl({ git: { force_push: 'ask' } }), decl({ git: { force_push: 'allow' } }));
    expect(merged.git?.force_push).toBe('ask');
  });

  it('④ system allow + project ask → ask（低层仍可收紧）', () => {
    const merged = merge(decl({ git: { force_push: 'allow' } }), decl({ git: { force_push: 'ask' } }));
    expect(merged.git?.force_push).toBe('ask');
  });

  it('⑤ 两层都未声明 → 保持未声明（不伪造字段）', () => {
    const merged = merge(decl(), decl());
    expect(merged.git).toBeUndefined();
  });
});

describe('mergeScopes — network 单调（deny_domains 并集 / default 取最严）', () => {
  it('⑥ deny_domains 并集：system [a] + project [b] → 含 a 与 b', () => {
    const merged = merge(
      decl({ network: { deny_domains: ['a.example'] } }),
      decl({ network: { deny_domains: ['b.example'] } }),
    );
    expect(merged.network?.deny_domains).toContain('a.example');
    expect(merged.network?.deny_domains).toContain('b.example');
  });

  it('⑦ project 的 deny_domains: [] 抹不掉 system 的云元数据 IP（POLICY-SPEC §6.2 deny 集合并集）', () => {
    const merged = merge(
      decl({ network: { deny_domains: ['169.254.169.254'] } }),
      decl({ network: { deny_domains: [] } }),
    );
    expect(merged.network?.deny_domains).toEqual(['169.254.169.254']);
  });

  it('⑧ network.default 取最严：system deny + project allow → deny（default-deny 不得被降级）', () => {
    const merged = merge(decl({ network: { default: 'deny' } }), decl({ network: { default: 'allow' } }));
    expect(merged.network?.default).toBe('deny');
  });

  it('⑨ network.default：system 未声明 + project deny → deny（低层可收紧）；两层都未声明 → 保持未声明', () => {
    expect(merge(decl(), decl({ network: { default: 'deny' } })).network?.default).toBe('deny');
    expect(merge(decl(), decl()).network).toBeUndefined();
  });
});

describe('mergeScopes — audit 单调（只能扩大审计面）', () => {
  it('⑩ audit.events：system 非空 + project [] → 不缩减', () => {
    const merged = merge(
      decl({ audit: { events: ['decision', 'denial'] } }),
      decl({ audit: { events: [] } }),
    );
    expect(merged.audit?.events).toEqual(['decision', 'denial']);
  });

  it('⑪ audit.events 并集：system [decision] + project [approval] → 两者都在', () => {
    const merged = merge(decl({ audit: { events: ['decision'] } }), decl({ audit: { events: ['approval'] } }));
    expect(merged.audit?.events).toEqual(['decision', 'approval']);
  });

  it('⑫ audit.details 取最详尽：system full + project none → full', () => {
    const merged = merge(decl({ audit: { details: 'full' } }), decl({ audit: { details: 'none' } }));
    expect(merged.audit?.details).toBe('full');
  });
});

describe('mergeScopes — 回归锁（本次改动不得破坏既有语义）', () => {
  it('⑬ profile 高层优先：system workspace-write + project danger-full-access → workspace-write', () => {
    const merged = merge(decl({ profile: 'workspace-write' }), decl({ profile: 'danger-full-access' }));
    expect(merged.profile).toBe('workspace-write');
  });

  it('⑭ approval 高层优先：system ask + project never → ask', () => {
    const merged = merge(decl({ approval: 'ask' }), decl({ approval: 'never' }));
    expect(merged.approval).toBe('ask');
  });

  it('⑮ 列表类仍为并集：shell.deny / tools.deny 不缩减', () => {
    const merged = merge(
      decl({ shell: { deny: ['destructive-delete'] }, tools: { deny: ['AskUserQuestion'] } }),
      decl({ shell: { deny: ['disk-format'] }, tools: { deny: ['Bash'] } }),
    );
    expect(merged.shell?.deny).toEqual(['destructive-delete', 'disk-format']);
    expect(merged.tools?.deny).toEqual(['AskUserQuestion', 'Bash']);
  });

  it('⑯ 无层声明时兜底仍为 workspace-write / never', () => {
    const none = mergeScopes([]);
    expect(none.profile).toBe('workspace-write');
    expect(none.approval).toBe('never');
    const bare = mergeScopes([{ version: '0.1' } as PolicyDeclaration]);
    expect(bare.profile).toBe('workspace-write');
    expect(bare.approval).toBe('never');
  });

  it('⑰ 未登记字段（network.allow_domains）：高层先声明者胜出，低层不得改写', () => {
    const system = decl({ network: untypedNetwork({ default: 'allow', allow_domains: ['github.com'] }) });
    const project = decl({ network: untypedNetwork({ allow_domains: [] }) });
    const net = merge(system, project).network as unknown as Record<string, unknown>;
    expect(net['allow_domains']).toEqual(['github.com']);
    expect(net['default']).toBe('allow');
  });
});

describe('loadPolicyArtifacts — 端到端（真实文件路径）', () => {
  let dir: string;
  let systemPath: string;
  let projectPath: string;

  const SYSTEM_YAML = `
policy:
  version: "0.1"
  profile: workspace-write
  approval: never
  git:
    force_push: deny
  network:
    default: allow
    deny_domains:
      - "169.254.169.254"
  audit:
    events: [decision, denial, approval]
    details: full
`;

  const PROJECT_YAML = `
policy:
  version: "0.1"
  profile: danger-full-access
  approval: ask
  git:
    force_push: allow
  network:
    deny_domains: []
  audit:
    events: []
    details: none
`;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-policy-merge-'));
    systemPath = path.join(dir, 'system.yaml');
    projectPath = path.join(dir, 'project.yaml');
    fs.writeFileSync(systemPath, SYSTEM_YAML, 'utf8');
    fs.writeFileSync(projectPath, PROJECT_YAML, 'utf8');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('⑱ project 层（克隆仓库即携带）编译后仍 deny force-push、仍 deny 元数据 IP', async () => {
    const artifacts = loadPolicyArtifacts({ systemPath, projectPath });

    // 编译产物：git:force-push 规则必须仍是 deny（修复前：project 的 allow 浅覆盖 → action=allow）
    expect(artifacts.rules.find((r) => r.id === 'git:force-push')?.action).toBe('deny');
    // system 的 deny 域名不得被 project 的 deny_domains: [] 抹掉
    expect(artifacts.rules.some((r) => r.id === 'net-deny:169.254.169.254')).toBe(true);
    // profile / approval 回归锁：project 不得抬升 profile / 放宽 approval
    expect(artifacts.profile).toBe('workspace-write');
    expect(artifacts.approval).toBe('never');

    // 端到端执法：force push 命令必须被 deny（修复前：命中 allow 规则 → verdict=allow）
    const verdict = await new PolicyEngine(artifacts).decide({
      toolName: 'Shell',
      arguments: { command: 'git push --force origin main' },
    });
    expect(verdict.action).toBe('deny');
    expect(verdict.ruleRef).toBe('git:force-push');
  });

  it('⑲ 会话 flag 仍是唯一的显式放宽通道（sessionOverrides 显式给出才放宽）', () => {
    const artifacts = loadPolicyArtifacts({
      systemPath,
      projectPath,
      sessionOverrides: { profile: 'danger-full-access', approval: 'ask' },
    });
    expect(artifacts.profile).toBe('danger-full-access');
    expect(artifacts.approval).toBe('ask');
  });
});
