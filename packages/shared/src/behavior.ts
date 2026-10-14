export const BEHAVIOR_CATEGORIES = ['Instruction', 'Workflow', 'Constraint', 'ToolStrategy', 'Verification', 'ResourceBudget', 'ContextStrategy'] as const;
export type BehaviorCategory = typeof BEHAVIOR_CATEGORIES[number];
export const BEHAVIOR_COMPATIBILITY_LEVELS = ['Importable', 'Renderable', 'Mappable', 'Enforceable', 'Verified'] as const;
export type BehaviorCompatibility = typeof BEHAVIOR_COMPATIBILITY_LEVELS[number];
export type BehaviorChannel = 'prompt_guidance' | 'runtime_policy';
export interface BehaviorPermissions {
  allowedTools?: string[];
  deniedTools?: string[];
  maxToolCalls?: number;
}
export interface BehaviorEntry {
  id: string;
  class: string;
  channel: BehaviorChannel;
  default?: boolean;
  policy_ref?: string;
  render: string;
  version?: string;
  source?: string;
  sourceRef?: string;
  category?: BehaviorCategory;
  severity?: 'info' | 'warning' | 'critical';
  enforcementChannel?: BehaviorChannel;
  applicability?: string[];
  assertions?: string[];
  priority?: number;
  trust?: 'trusted' | 'untrusted';
  signature?: string;
  conflictDomain?: string;
  permissions?: BehaviorPermissions;
  requiredCapabilities?: CapabilityRequirements;
}
export interface BehaviorIR {
  version: string;
  entries: BehaviorEntry[];
  sourceRef?: string;
}
export interface BehaviorAssertionResult {
  assertionId: string;
  passed: boolean;
  evidence: string;
  snapshotHash: string;
}
export interface BehaviorDiagnostic {
  entryId: string;
  severity: 'warning' | 'error';
  code: string;
  message: string;
  sourceRef: string;
}
export interface BehaviorEntryInspection {
  id: string;
  category: BehaviorCategory;
  sourceRef: string;
  priority: number;
  channel: BehaviorChannel;
  compatibility: BehaviorCompatibility;
  policyRef: string | null;
  policyRuleIds: string[];
  assertions: string[];
  assertionResults: BehaviorAssertionResult[];
  provenance: Record<string, { sourceRef: string; priority: number; strategy: 'immutable' | 'replace' | 'deduplicate' | 'narrow' }>;
}
export interface BehaviorLayerInspection {
  level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
  status: 'available' | 'unavailable';
  sourceRefs: string[];
  snapshot: unknown;
  snapshotHash?: string;
  reason?: string;
}
export interface BehaviorInspection {
  version: string;
  snapshotHash: string;
  entries: BehaviorEntryInspection[];
  layers: BehaviorLayerInspection[];
  diagnostics: BehaviorDiagnostic[];
}
import type { CapabilityRequirements } from './capabilities.js';

