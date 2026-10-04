/** Browser mirrors of application execution audit projections. */
export interface SandboxAudit {
  isolationTier: string;
  sandboxed: boolean;
  outcome: 'enforced' | 'fallback' | 'denied';
  allowedWritePaths?: string[];
  reason?: string;
  constraints?: { readOnlyPaths: string[]; memoryLimitBytes: number | null; privilegeReduction: string };
}

export interface SandboxAuditSnapshot {
  scope: 'execution';
  audits: { sessionId: string; toolName: string; ts: number; sandbox: SandboxAudit }[];
  observedAt: number;
}
