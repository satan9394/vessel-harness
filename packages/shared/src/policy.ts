/**
 * @vessel/shared — policy contracts (POLICY-SPEC D6 v0.1 subset).
 */

export type ProfileMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type ApprovalPolicy = 'ask' | 'never';

export type VerdictAction = 'allow' | 'deny' | 'ask';

export interface Verdict {
  action: VerdictAction;
  /** decisionPath audit trail: which stage/rule produced the terminal decision */
  decisionPath: string[];
  ruleRef?: string;
  reason?: string;
  /** allow with rewritten arguments (updatedInput semantics) */
  updatedInput?: Record<string, unknown>;
}

/** A compiled runtime rule (deny/ask/allow). `match` evaluates against a tool call. */
export interface PolicyRule {
  id: string;
  domain: 'filesystem' | 'shell' | 'tools' | 'git' | 'network';
  action: VerdictAction;
  reason?: string;
  /** matcher function; returns true when the call matches */
  match(call: { toolName: string; arguments: Record<string, unknown> }): boolean;
}

/** Metadata only: deliberately not assignable to PolicyRule or executable by the engine. */
export interface PolicyDeclarationOnly {
  id: string;
  domain: 'network';
  enforced: false;
  reason: string;
  match?: never;
  action?: never;
}

/** The four artifacts produced by the Policy Compiler, plus unimplemented declarations. */
export interface PolicyArtifacts {
  /** Prompt Guidance — soft channel, injected at BeforeModel; produces no audit facts. */
  promptGuidance: string[];
  /** Tool Interceptor — deny tools removed from the visible schema + execution rejected. */
  deniedTools: string[];
  /** Runtime Deny rules — hard channel evaluated by the engine. */
  rules: PolicyRule[];
  /** Unimplemented declarations, never runtime rules or evidence of enforcement. */
  declarationOnly?: PolicyDeclarationOnly[];
  /** profile mode + approval policy (service-enforced) */
  profile: ProfileMode;
  approval: ApprovalPolicy;
  /** filesystem guard config for the file tools (defense in depth at tool layer) */
  fsConfig?: {
    protected: string[];
    denyRead: string[];
    /** task 073 explicit authorization paths ({path, mode}); enforced when confinement on */
    allow?: { path: string; mode: 'read' | 'write' }[];
    /** task 073 allow-set confinement flag — see tools/guards.ts */
    confinement?: boolean;
  };
  /** readonly shell command prefixes (readonly identification; exempt from approval) */
  shellAllow?: string[];
}

export interface PolicyDeclaration {
  version: string;
  profile: ProfileMode;
  approval: ApprovalPolicy;
  filesystem?: {
    protected?: string[];
    deny_read?: string[];
    allow?: { path: string; mode: 'read' | 'write' }[];
    /** task 073: when true, enforce allow-set confinement (workspace root + explicit allow dirs) */
    confinement?: boolean;
  };
  shell?: {
    deny?: string[];
    allow?: string[];
    scoped_rules?: { id: string; match: string; action: VerdictAction; reason?: string }[];
  };
  tools?: {
    deny?: string[];
    rules?: { id: string; match: string; action: VerdictAction; reason?: string }[];
  };
  git?: { force_push?: VerdictAction };
  network?: { default?: 'allow' | 'deny'; deny_domains?: string[] };
  audit?: { events?: string[]; details?: string };
  guidance?: string[];
}
