import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PolicyArtifacts, PolicyDeclaration } from '@cah/shared';
import { compilePolicy, compilePolicyYaml, parsePolicyYaml } from './Compiler.js';

export interface PolicyLoadOptions {
  /** system-scope builtin (configs/policy.default.yaml) */
  systemPath?: string;
  /** project-scope override (.harness/policy.yaml) — loaded when workspace trust passes */
  projectPath?: string;
  sessionOverrides?: { approval?: 'ask' | 'never'; profile?: string };
}

/**
 * policy/risk loader — scope merge (system > project > session) per
 * POLICY-SPEC §3.5 / §8. Project policy loads only when the workspace is trusted.
 */
export function loadPolicyArtifacts(opts: PolicyLoadOptions = {}): PolicyArtifacts {
  const decls: PolicyDeclaration[] = [];

  if (opts.systemPath && fs.existsSync(opts.systemPath)) {
    decls.push(parsePolicyYaml(fs.readFileSync(opts.systemPath, 'utf8')));
  }
  if (opts.projectPath && fs.existsSync(opts.projectPath)) {
    // workspace trust gate: project policy is honored only for trusted workspaces
    decls.push(parsePolicyYaml(fs.readFileSync(opts.projectPath, 'utf8')));
  }

  if (decls.length === 0) {
    throw new Error('policy loader: no policy declaration found');
  }

  const merged = mergeScopes(decls);
  if (opts.sessionOverrides?.approval) merged.approval = opts.sessionOverrides.approval;

  return compilePolicy(merged);
}

/** merge scopes: later declarations override scalars; arrays concatenate (dedup). */
export function mergeScopes(decls: PolicyDeclaration[]): PolicyDeclaration {
  const out: PolicyDeclaration = {
    version: decls[0]?.version ?? '0.1',
    profile: 'workspace-write',
    approval: 'never',
  };
  for (const d of decls) {
    if (d.version) out.version = d.version;
    if (d.profile) out.profile = d.profile;
    if (d.approval) out.approval = d.approval;
    out.guidance = [...(out.guidance ?? []), ...(d.guidance ?? [])];
    if (d.filesystem) {
      out.filesystem = {
        protected: [...(out.filesystem?.protected ?? []), ...(d.filesystem.protected ?? [])],
        deny_read: [...(out.filesystem?.deny_read ?? []), ...(d.filesystem.deny_read ?? [])],
        allow: [...(out.filesystem?.allow ?? []), ...(d.filesystem.allow ?? [])],
      };
    }
    if (d.shell) {
      out.shell = {
        deny: [...(out.shell?.deny ?? []), ...(d.shell.deny ?? [])],
        allow: [...(out.shell?.allow ?? []), ...(d.shell.allow ?? [])],
        scoped_rules: [...(out.shell?.scoped_rules ?? []), ...(d.shell.scoped_rules ?? [])],
      };
    }
    if (d.tools) {
      out.tools = {
        deny: [...(out.tools?.deny ?? []), ...(d.tools.deny ?? [])],
        rules: [...(out.tools?.rules ?? []), ...(d.tools.rules ?? [])],
      };
    }
    if (d.git) out.git = { ...(out.git ?? {}), ...d.git };
    if (d.network) out.network = { ...(out.network ?? {}), ...d.network };
    if (d.audit) out.audit = { ...(out.audit ?? {}), ...d.audit };
  }
  return out;
}

export { compilePolicy, compilePolicyYaml, parsePolicyYaml };

/** default system policy path relative to repo root */
export function defaultSystemPolicyPath(repoRoot: string): string {
  return path.join(repoRoot, 'configs', 'policy.default.yaml');
}
