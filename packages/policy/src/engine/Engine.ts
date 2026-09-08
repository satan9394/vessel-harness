import type { PolicyArtifacts, Verdict } from '@vessel/shared';

export interface PermissionSpec {
  requiredPermission?: 'read' | 'workspace-write' | 'danger-full-access';
}

/**
 * policy/engine — authoritative decision listener on the BeforeTool chain
 * (POLICY-SPEC §4.2). Decision order:
 *   ① denied_tools → ② deny rules → ③ hook override (seam) → ④ ask rules
 *   → ⑤ allow rules → ⑥ profile compare
 * then guard monotonic narrowing + fail-closed (approval:never is enforced
 * service-side BEFORE waterfall dispatch — responders cannot bypass it).
 */
export class PolicyEngine {
  private artifacts: PolicyArtifacts;

  constructor(artifacts: PolicyArtifacts) {
    this.artifacts = artifacts;
  }

  /** Re-read artifacts (e.g. after policy reload). */
  update(artifacts: PolicyArtifacts): void {
    this.artifacts = artifacts;
  }

  async decide(call: { toolName: string; arguments: Record<string, unknown> }, spec?: PermissionSpec): Promise<Verdict> {
    const path: string[] = [];
    const a = this.artifacts;

    // ① denied_tools — unconditional, before everything
    if (a.deniedTools.includes(call.toolName)) {
      const v: Verdict = {
        action: 'deny',
        decisionPath: [`denied_tools:${call.toolName}`],
        ruleRef: `denied_tools:${call.toolName}`,
        reason: `tool denied: ${call.toolName}`,
      };
      return v;
    }

    // ② deny rules (most restrictive first — any deny wins over narrower allow)
    for (const rule of a.rules) {
      if (rule.action === 'deny' && rule.match(call)) {
        return {
          action: 'deny',
          decisionPath: [...path, `rule:${rule.id}`],
          ruleRef: rule.id,
          reason: rule.reason ?? `denied by rule ${rule.id}`,
        };
      }
    }

    // ③ hook override — seam only in v0.1 (external hooks.json bridge lands v0.2)
    // ④ ask rules
    let askRef: string | undefined;
    for (const rule of a.rules) {
      if (rule.action === 'ask' && rule.match(call)) {
        askRef = rule.id;
        path.push(`ask:${rule.id}`);
        break;
      }
    }

    // ⑤ allow rules
    let allowRef: string | undefined;
    if (!askRef) {
      for (const rule of a.rules) {
        if (rule.action === 'allow' && rule.match(call)) {
          allowRef = rule.id;
          path.push(`allow:${rule.id}`);
          break;
        }
      }
    }

    // ⑥ profile compare (no rule matched): required_permission × profile
    let needsApproval = false;
    if (!askRef && !allowRef) {
      let req = spec?.requiredPermission ?? 'danger-full-access'; // unregistered => danger (D6)
      // readonly shell allowlist: string parsing is only readonly *identification*,
      // but allowlisted commands run without approval under workspace-write
      if (req === 'danger-full-access' && call.toolName === 'Shell' && this.isShellAllowed(call)) {
        req = 'read';
      }
      if (a.profile === 'read-only' && req !== 'read') {
        needsApproval = true;
        path.push(`profile:read-only:${req}`);
      } else if (a.profile === 'workspace-write' && req === 'danger-full-access') {
        needsApproval = true;
        path.push(`profile:workspace-write:${req}`);
      } else {
        path.push(`profile:${a.profile}:${req}`);
      }
    }

    // fail-closed: ask with no responder / approval:never => denied service-side
    if (askRef || needsApproval) {
      if (a.approval === 'never') {
        return {
          action: 'deny',
          decisionPath: [...path, 'approval:never'],
          ruleRef: askRef ?? 'policy-never',
          reason: askRef ? `approval required but approval=never: ${askRef}` : 'approval required but approval=never (profile)',
        };
      }
      return {
        action: 'ask',
        decisionPath: [...path, 'approval:ask'],
        ruleRef: askRef,
        reason: askRef ? `requires approval: ${askRef}` : 'requires approval (profile)',
      };
    }

    return {
      action: 'allow',
      decisionPath: path.length ? path : ['no-rule:allow'],
      ruleRef: allowRef,
    };
  }

  /** readonly shell allowlist check (identification only — not the primary defense). */
  private isShellAllowed(call: { toolName: string; arguments: Record<string, unknown> }): boolean {
    const cmd = String(call.arguments.command ?? '').trim();
    const lower = cmd.toLowerCase();
    return (this.artifacts.shellAllow ?? []).some((prefix) => {
      const p = prefix.toLowerCase();
      return lower === p || lower.startsWith(p + ' ');
    });
  }
}
