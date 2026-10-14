import * as fs from 'node:fs';
import * as yaml from 'js-yaml';
import { BEHAVIOR_CATEGORIES } from '@vessel/shared';
import type { BehaviorEntry, BehaviorIR } from '@vessel/shared';
export type { BehaviorEntry, BehaviorIR, BehaviorChannel } from '@vessel/shared';

const KNOWN_KEYS = new Set(['version', 'entries', 'behavior', 'sourceRef']);
const ENTRY_KEYS = new Set(['id', 'class', 'channel', 'default', 'policy_ref', 'render', 'version', 'source', 'sourceRef', 'category', 'severity', 'enforcementChannel', 'applicability', 'assertions', 'priority', 'trust', 'signature', 'conflictDomain', 'permissions', 'requiredCapabilities']);
export const CAPABILITY_KEYS = new Set(['tools', 'parallelToolCalls', 'toolCallStreaming', 'structuredOutput', 'jsonSchema', 'reasoning', 'streaming', 'stopReason', 'multimodalInput', 'multimodalOutput', 'contextWindow', 'tokenUsage', 'costEstimation', 'promptCache', 'rateLimit', 'retry']);

/**
 * behavior/ir — load + validate the Behavior IR declaration (ARCHITECTURE §4.3).
 * Unknown keys fail loud; entries with channel=runtime_policy REQUIRE policy_ref
 * (双通道强制 — compiler rejects missing executable policy enforcement).
 */
export function loadBehaviorIR(filePath: string): BehaviorIR {
  if (!fs.existsSync(filePath)) {
    throw new Error(`behavior IR not found: ${filePath}`);
  }
  return parseBehaviorIR(fs.readFileSync(filePath, 'utf8'), filePath);
}

export function parseBehaviorIR(text: string, source = '<string>'): BehaviorIR {
  const doc = yaml.load(text) as Record<string, unknown>;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`behavior IR (${source}): object required`);
  for (const key of Object.keys(doc)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`behavior IR (${source}): unknown top-level key "${key}"`);
    }
  }
  const root = (doc.behavior ?? doc) as Record<string, unknown>;
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error(`behavior IR (${source}): object required`);
  for (const key of Object.keys(root)) if (!KNOWN_KEYS.has(key) || key === 'behavior') throw new Error(`behavior IR (${source}): unknown top-level key "${key}"`);
  if (!root.version) throw new Error(`behavior IR (${source}): version required`);
  if (!Array.isArray(root.entries)) throw new Error(`behavior IR (${source}): entries required`);

  const entries: BehaviorEntry[] = root.entries.map((raw, i) => {
    const e = raw as Record<string, unknown>;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`behavior IR (${source}): entry[${i}] object required`);
    for (const key of Object.keys(e)) {
      if (!ENTRY_KEYS.has(key)) {
        throw new Error(`behavior IR (${source}): entry[${i}] unknown key "${key}"`);
      }
    }
    const id = String(e.id ?? '');
    const channel = String(e.channel ?? '');
    if (!id) throw new Error(`behavior IR (${source}): entry[${i}] id required`);
    if (channel !== 'prompt_guidance' && channel !== 'runtime_policy') {
      throw new Error(`behavior IR (${source}): entry "${id}" channel must be prompt_guidance|runtime_policy`);
    }
    if (channel === 'runtime_policy' && (typeof e.policy_ref !== 'string' || !e.policy_ref.trim() || e.policy_ref.trim() !== e.policy_ref)) {
      throw new Error(`behavior IR (${source}): entry "${id}" channel=runtime_policy requires policy_ref`);
    }
    if (typeof e.render !== 'string' || !e.render) {
      throw new Error(`behavior IR (${source}): entry "${id}" render required`);
    }
    for (const field of ['version', 'source', 'sourceRef', 'signature', 'conflictDomain']) {
      if (e[field] !== undefined && (typeof e[field] !== 'string' || !(e[field] as string).trim())) throw new Error(`behavior IR (${source}): entry "${id}" ${field} must be a nonempty string`);
    }
    if (e.category !== undefined && !BEHAVIOR_CATEGORIES.includes(e.category as BehaviorEntry['category'] & string)) throw new Error(`behavior IR (${source}): entry "${id}" invalid category`);
    if (e.severity !== undefined && !['info', 'warning', 'critical'].includes(String(e.severity))) throw new Error(`behavior IR (${source}): entry "${id}" invalid severity`);
    if (e.trust !== undefined && !['trusted', 'untrusted'].includes(String(e.trust))) throw new Error(`behavior IR (${source}): entry "${id}" invalid trust`);
    if (e.enforcementChannel !== undefined && e.enforcementChannel !== channel) throw new Error(`behavior IR (${source}): entry "${id}" enforcementChannel must match channel`);
    if (e.priority !== undefined && (typeof e.priority !== 'number' || !Number.isFinite(e.priority))) throw new Error(`behavior IR (${source}): entry "${id}" invalid priority`);
    for (const field of ['applicability', 'assertions']) {
      if (e[field] !== undefined && (!Array.isArray(e[field]) || !(e[field] as unknown[]).every(v => typeof v === 'string' && v.trim()))) throw new Error(`behavior IR (${source}): entry "${id}" ${field} must be a string array`);
    }
    if (e.permissions !== undefined) {
      const p = e.permissions as Record<string, unknown>;
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`behavior IR (${source}): entry "${id}" invalid permissions`);
      for (const key of Object.keys(p)) if (!['allowedTools', 'deniedTools', 'maxToolCalls'].includes(key)) throw new Error(`behavior IR (${source}): entry "${id}" unknown permissions key "${key}"`);
      for (const key of ['allowedTools', 'deniedTools']) if (p[key] !== undefined && (!Array.isArray(p[key]) || !(p[key] as unknown[]).every(v => typeof v === 'string' && v.trim()))) throw new Error(`behavior IR (${source}): entry "${id}" invalid ${key}`);
      if (p.maxToolCalls !== undefined && (typeof p.maxToolCalls !== 'number' || !Number.isSafeInteger(p.maxToolCalls) || p.maxToolCalls < 0)) throw new Error(`behavior IR (${source}): entry "${id}" invalid maxToolCalls`);
    }
    if (e.requiredCapabilities !== undefined) {
      const requirements = e.requiredCapabilities as Record<string, unknown>;
      if (!requirements || typeof requirements !== 'object' || Array.isArray(requirements)) throw new Error(`behavior IR (${source}): entry "${id}" invalid requiredCapabilities`);
      for (const [key, value] of Object.entries(requirements)) {
        if (!CAPABILITY_KEYS.has(key)) throw new Error(`behavior IR (${source}): entry "${id}" unknown requiredCapabilities key "${key}"`);
        if (key === 'contextWindow' ? typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 : typeof value !== 'boolean') throw new Error(`behavior IR (${source}): entry "${id}" invalid requiredCapabilities.${key}`);
      }
    }
    return {
      ...e as unknown as BehaviorEntry,
      id,
      class: String(e.class ?? ''),
      channel,
      default: Boolean(e.default),
      policy_ref: e.policy_ref ? String(e.policy_ref) : undefined,
      render: e.render,
      sourceRef: String(e.sourceRef ?? e.source ?? source),
    };
  });

  if (new Set(entries.map(e => e.id)).size !== entries.length) throw new Error(`behavior IR (${source}): duplicate entry id`);
  return { version: String(root.version), entries, sourceRef: String(root.sourceRef ?? source) };
}
