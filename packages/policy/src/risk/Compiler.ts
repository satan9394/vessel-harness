import * as yaml from 'js-yaml';
import type {
  PolicyArtifacts,
  PolicyDeclaration,
  PolicyRule,
  ProfileMode,
  VerdictAction,
} from '@vessel/shared';
import { globMatch } from './globmatch.js';
const KNOWN_TOP_KEYS = new Set([
  'version', 'profile', 'approval', 'filesystem', 'shell', 'network', 'git', 'tools', 'audit', 'session', 'guidance',
]);

const SHELL_DENY_SETS: Record<string, RegExp[]> = {
  'destructive-delete': [
    /^(rm|rmdir)\s+-[a-z]*r/i,
    /^del\s+\/s/i,
    /^rmdir\s+\/s/i,
    /^Remove-Item\s+-Recurse/i,
  ],
  'disk-format': [/^mkfs/i, /^format\s/i, /^diskpart/i],
  'partition-write': [/^fdisk/i, /^parted/i, /^gdisk/i],
};

/**
 * Compile a `Shell(...)` / `Bash(...)` command matcher into a predicate
 * (POLICY-SPEC §3.3 — the `*` shape is defined as "命令前缀").
 *
 * - No `*` → legacy semantics kept verbatim: literal *prefix* match
 *   (`startsWith`), so `Bash(rm -rf ./node_modules)` behaves exactly as before.
 * - With `*` → anchored glob: `*` becomes `.*` (spaces included, so a trailing
 *   `*` means "any suffix"), every other character is escaped literally, and
 *   the whole pattern is anchored. `Shell(git push --force*)` therefore matches
 *   `git push --force origin main` — the pre-fix literal `startsWith` never did.
 */
function shellCommandPredicate(
  prefix: string,
): (call: { toolName: string; arguments: Record<string, unknown> }) => boolean {
  const matches = prefix.includes('*')
    ? (() => {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
        const re = new RegExp(`^${escaped}$`);
        return (cmd: string) => re.test(cmd);
      })()
    : (cmd: string) => cmd.startsWith(prefix);
  return (call) => call.toolName === 'Shell' && matches(String(call.arguments.command ?? '').trim());
}

/**
 * Parse a `Bash(...)` / `Shell(...)` / `Write(path=...)` style matcher into
 * (domain, predicate) per POLICY-SPEC §3.3.
 */
function parseMatcher(match: string): { domain: 'shell' | 'filesystem' | 'tools'; predicate: (call: { toolName: string; arguments: Record<string, unknown> }) => boolean; label: string } {
  const shellMatch = /^(Bash|Shell)\((.*)\)$/.exec(match);
  if (shellMatch) {
    const prefix = shellMatch[2]!.replace(/^"(.*)"$/, '$1');
    return {
      domain: 'shell',
      label: `Shell(${prefix})`,
      predicate: shellCommandPredicate(prefix),
    };
  }
  const pathMatch = /^(Read|Write|Edit)\(path=(glob\s+)?"?([^")]+)"?\)$/.exec(match);
  if (pathMatch) {
    const toolName = pathMatch[1]!;
    const glob = pathMatch[3]!;
    return {
      domain: 'filesystem',
      label: `${toolName}(${glob})`,
      predicate: (call) => {
        if (call.toolName !== toolName) return false;
        const p = String(call.arguments.path ?? call.arguments.file_path ?? '');
        return globMatch(glob, p.replace(/\\/g, '/'));
      },
    };
  }
  // bare tool name or tool(prefix)
  const bare = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(match);
  if (bare) {
    return {
      domain: 'tools',
      label: bare[1]!,
      predicate: (call) => call.toolName === bare[1],
    };
  }
  return {
    domain: 'tools',
    label: match,
    predicate: () => false, // unknown syntax — never matches (fail-closed elsewhere)
  };
}

function fsPathRule(toolNames: string[], glob: string, action: VerdictAction, id: string, reason?: string): PolicyRule {
  return {
    id,
    domain: 'filesystem',
    action,
    reason,
    match: (call) => {
      if (!toolNames.includes(call.toolName)) return false;
      const p = String(call.arguments.path ?? '');
      return globMatch(glob, p.replace(/\\/g, '/'));
    },
  };
}

/**
 * policy/risk — Policy Compiler (POLICY-SPEC §1.1): one declaration expands to
 * the four artifacts (Prompt Guidance / Tool Interceptor / Runtime Deny / Audit).
 * Any safety claim with enforcement but no runtime rule => compile error (双通道强制).
 */
export function compilePolicy(declaration: PolicyDeclaration): PolicyArtifacts {
  // fail loud on unknown keys
  for (const key of Object.keys(declaration)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      throw new Error(`policy compile error: unknown top-level key "${key}"`);
    }
  }
  if (!declaration.version) throw new Error('policy compile error: version required');
  if (!declaration.profile) throw new Error('policy compile error: profile required');
  if (!declaration.approval) throw new Error('policy compile error: approval required');

  const profile: ProfileMode = declaration.profile;
  const approval = declaration.approval;
  const promptGuidance: string[] = [];
  const deniedTools: string[] = [];
  const rules: PolicyRule[] = [];

  // guidance (soft channel — produces no audit facts)
  for (const g of declaration.guidance ?? []) promptGuidance.push(g);
  if (declaration.filesystem?.protected?.length) {
    promptGuidance.push(`不要改写受保护路径：${declaration.filesystem.protected.join(', ')}（硬执法，不可豁免）。`);
  }
  if (declaration.filesystem?.deny_read?.length) {
    promptGuidance.push(`不要读取凭据/敏感文件：${declaration.filesystem.deny_read.join(', ')}（硬执法）。`);
  }
  if (declaration.filesystem?.confinement) {
    const allowed = declaration.filesystem.allow ?? [];
    const spec = allowed.length
      ? `显式授权路径：${allowed.map((a) => `${a.path}(${a.mode})`).join(', ')}`
      : '无显式授权路径（仅工作区根可达）';
    promptGuidance.push(`文件访问被限制在允许集合：工作区根 + 显式授权路径。${spec}。越界读写会硬拒绝。`);
  }
  if (declaration.shell?.deny?.length) {
    promptGuidance.push(`破坏性命令（${declaration.shell.deny.join(', ')}）被硬拦截，先说明原因与范围再考虑受管替代。`);
  }
  if (declaration.git?.force_push) {
    promptGuidance.push('不要 force push 重写共享分支历史。');
  }

  // Tool Interceptor: bare-name deny removes tools from the visible schema
  for (const t of declaration.tools?.deny ?? []) deniedTools.push(t);

  // Runtime Deny rules
  for (const p of declaration.filesystem?.protected ?? []) {
    rules.push(fsPathRule(['Write', 'Edit'], p, 'deny', `fs-protected:${p}`, '.git/受保护路径不可写（硬执法）'));
  }
  for (const d of declaration.filesystem?.deny_read ?? []) {
    rules.push(fsPathRule(['Read', 'Grep'], d, 'deny', `fs-deny-read:${d}`, '凭据文件禁止读取'));
  }

  // task 073 — allow-set confinement lexical pre-check at the Executor seam.
  // Authoritative canonical allow-set enforcement lives in tools/guards.ts
  // `assertConfined` (has workspace root + realpath). This rule gives a second,
  // earlier hard deny (→ audit/denial via AgentLoop) for the unambiguous lexical
  // cases: `..` escapes and absolute paths not covered by an absolute allow entry.
  // Workspace-relative paths are left to the tool guard so the lexical rule never
  // false-positives on normal workspace ops.
  const confinement = declaration.filesystem?.confinement;
  if (confinement === true) {
    const allowAbs = (declaration.filesystem?.allow ?? [])
      .filter((a) => a.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(a.path))
      .map((a) => a.path);
    const coversAbs = (abs: string): boolean => {
      const norm = abs.replace(/[\\/]+/g, '/');
      return allowAbs.some((ap) => {
        const aNorm = ap.replace(/[\\/]+/g, '/');
        return norm === aNorm || norm.startsWith(aNorm.replace(/\/$/, '') + '/');
      });
    };
    rules.push({
      id: 'fs-confinement',
      domain: 'filesystem',
      action: 'deny',
      reason: 'path outside filesystem confinement allow set (workspace root + explicit allow)',
      match: (call) => {
        if (!['Read', 'Write', 'Edit'].includes(call.toolName)) return false;
        const p = String(call.arguments.path ?? '');
        if (!p) return false;
        const hasDotDot = p.split(/[\\/]+/).includes('..');
        if (hasDotDot) return true;
        // absolute path not covered by an explicit absolute allow → deny
        const isAbsolute = p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p);
        if (isAbsolute && !coversAbs(p)) return true;
        return false;
      },
    });
  }

  for (const cat of declaration.shell?.deny ?? []) {
    const regexes = SHELL_DENY_SETS[cat];
    if (!regexes) {
      throw new Error(`policy compile error: unknown shell.deny category "${cat}"`);
    }
    rules.push({
      id: `shell-deny:${cat}`,
      domain: 'shell',
      action: 'deny',
      reason: `dangerous command category: ${cat} (never_auto, any profile)`,
      match: (call) => {
        if (call.toolName !== 'Shell') return false;
        const cmd = String(call.arguments.command ?? '');
        return regexes.some((re) => re.test(cmd));
      },
    });
  }

  for (const sr of declaration.shell?.scoped_rules ?? []) {
    const parsed = parseMatcher(sr.match);
    rules.push({
      id: sr.id ?? `shell-scoped:${sr.match}`,
      domain: parsed.domain,
      action: sr.action,
      reason: sr.reason,
      match: parsed.predicate,
    });
  }

  for (const tr of declaration.tools?.rules ?? []) {
    const parsed = parseMatcher(tr.match);
    rules.push({
      id: tr.id ?? `tools-rule:${tr.match}`,
      domain: parsed.domain,
      action: tr.action,
      reason: tr.reason,
      match: parsed.predicate,
    });
  }

  if (declaration.git?.force_push) {
    const action = declaration.git.force_push;
    rules.push({
      id: 'git:force-push',
      domain: 'git',
      action,
      reason: 'force push 重写共享分支历史',
      match: (call) => {
        if (call.toolName !== 'Shell') return false;
        const cmd = String(call.arguments.command ?? '');
        return /^git\s+push\s+(-f|--force)\b/.test(cmd);
      },
    });
  }

  for (const d of declaration.network?.deny_domains ?? []) {
    rules.push({
      id: `net-deny:${d}`,
      domain: 'network',
      action: 'deny',
      reason: `denied domain: ${d}`,
      match: () => false, // no WebFetch tool in v0.1 six-tool plane; declared for audit completeness
    });
  }

  // 双通道强制: every safety claim with enforcement produced at least one runtime
  // rule above (per-domain check happens in behavior/compiler via policy_ref).

  return {
    promptGuidance,
    deniedTools,
    rules,
    profile,
    approval,
    fsConfig: {
      protected: declaration.filesystem?.protected ?? [],
      denyRead: declaration.filesystem?.deny_read ?? [],
      allow: declaration.filesystem?.allow ?? [],
      confinement: declaration.filesystem?.confinement === true,
    },
    shellAllow: declaration.shell?.allow ?? [],
  };
}

export function parsePolicyYaml(text: string): PolicyDeclaration {
  const doc = yaml.load(text) as { policy?: PolicyDeclaration } | PolicyDeclaration;
  const decl = (doc as { policy?: PolicyDeclaration }).policy ?? (doc as PolicyDeclaration);
  if (!decl || typeof decl !== 'object') {
    throw new Error('policy compile error: expected a `policy:` mapping');
  }
  return decl;
}

export function compilePolicyYaml(text: string): PolicyArtifacts {
  return compilePolicy(parsePolicyYaml(text));
}
