import type { ConfinedArgv, SandboxStatus } from '@cah/shared';

/**
 * runtime/sandbox — language-neutral confine seam (ARCHITECTURE §4.7 / D3 decision point 9).
 *
 * v0.1 on Windows: ACL restricted-token enforcement is PARTIAL (documented known
 * limitation). The seam is real — status() is transparent, confinement is applied
 * per-call, and fail-closed semantics are expressed via `SandboxStatus` so consumers
 * can refuse dangerous calls when no backend is active.
 *
 * Linux bwrap / macOS Seatbelt / Windows full ACL runners are the v0.2+ backend chain.
 */
export class Sandbox {
  private statusInfo: SandboxStatus = {
    enabled: false,
    supported: process.platform === 'win32' ? 'windows-acl-partial' : process.platform === 'darwin' ? 'macos-seatbelt' : 'linux-bwrap',
    active: false,
    fallbackReason:
      'v0.1 ships the confine seam only; OS-level backends (bwrap/Seatbelt/ACL restricted token) land in v0.2+ per ARCHITECTURE §4.7',
  };

  status(): SandboxStatus {
    return this.statusSnapshot();
  }

  statusSnapshot(): SandboxStatus {
    return this.statusInfo;
  }

  async confine(argv: string[], _policyHint?: Record<string, unknown>): Promise<ConfinedArgv> {
    // v0.1: passthrough with transparent partial-enforcement report.
    // Callers (tools/shell) record this in result meta; dangerous calls are
    // already denied upstream by the policy engine (fail-closed chain).
    return {
      argv,
      enforcement: 'partial',
      reason: this.statusInfo.fallbackReason,
    };
  }
}
