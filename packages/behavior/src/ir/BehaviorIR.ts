import * as fs from 'node:fs';
import * as yaml from 'js-yaml';

export type BehaviorChannel = 'prompt_guidance' | 'runtime_policy';

export interface BehaviorEntry {
  id: string;
  class: string;
  channel: BehaviorChannel;
  default?: boolean;
  policy_ref?: string;
  render: string;
}

export interface BehaviorIR {
  version: string;
  entries: BehaviorEntry[];
}

const KNOWN_KEYS = new Set(['version', 'entries', 'behavior']);
const ENTRY_KEYS = new Set(['id', 'class', 'channel', 'default', 'policy_ref', 'render']);

/**
 * behavior/ir — load + validate the Behavior IR declaration (ARCHITECTURE §4.3).
 * Unknown keys fail loud; entries with channel=runtime_policy REQUIRE policy_ref
 * (双通道强制 — compiler warns when the policy side has no matching rule).
 */
export function loadBehaviorIR(filePath: string): BehaviorIR {
  if (!fs.existsSync(filePath)) {
    throw new Error(`behavior IR not found: ${filePath}`);
  }
  return parseBehaviorIR(fs.readFileSync(filePath, 'utf8'), filePath);
}

export function parseBehaviorIR(text: string, source = '<string>'): BehaviorIR {
  const doc = yaml.load(text) as Record<string, unknown>;
  for (const key of Object.keys(doc)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`behavior IR (${source}): unknown top-level key "${key}"`);
    }
  }
  const root = (doc.behavior ?? doc) as { version?: string; entries?: unknown };
  if (!root.version) throw new Error(`behavior IR (${source}): version required`);
  if (!Array.isArray(root.entries)) throw new Error(`behavior IR (${source}): entries required`);

  const entries: BehaviorEntry[] = root.entries.map((raw, i) => {
    const e = raw as Record<string, unknown>;
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
    if (channel === 'runtime_policy' && !e.policy_ref) {
      throw new Error(`behavior IR (${source}): entry "${id}" channel=runtime_policy requires policy_ref`);
    }
    if (typeof e.render !== 'string' || !e.render) {
      throw new Error(`behavior IR (${source}): entry "${id}" render required`);
    }
    return {
      id,
      class: String(e.class ?? ''),
      channel,
      default: Boolean(e.default),
      policy_ref: e.policy_ref ? String(e.policy_ref) : undefined,
      render: e.render,
    };
  });

  return { version: String(root.version), entries };
}
