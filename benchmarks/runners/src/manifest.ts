import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import type { ScenarioManifest } from './types.js';

const KNOWN_KEYS = new Set([
  'id', 'type', 'goal', 'fixture', 'task_file', 'hidden', 'policy', 'harness', 'pass', 'measured', 'mode',
]);
const PASS_KEYS = new Set([
  'type', 'target', 'golden', 'golden_expr', 'json_path', 'family', 'metric', 'limit',
  'command', 'pattern', 'include', 'expected', 'paths', 'record', 'source', 'stage',
]);
const HARNESS_KEYS = new Set(['subagent', 'mcp', 'planner', 'evaluator', 'taskRouter', 'engine']);

export function loadManifest(repoRoot: string, scenarioId: string): ScenarioManifest {
  const p = path.join(repoRoot, 'benchmarks', 'scenarios', `${scenarioId}.yaml`);
  if (!fs.existsSync(p)) {
    throw new Error(`scenario manifest not found: ${p}`);
  }
  const doc = yaml.load(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
  for (const key of Object.keys(doc)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`manifest ${scenarioId}: unknown key "${key}"`);
  }
  if (doc.id !== scenarioId) throw new Error(`manifest ${scenarioId}: id mismatch`);
  if (!Array.isArray(doc.pass) || doc.pass.length === 0) {
    throw new Error(`manifest ${scenarioId}: pass required`);
  }
  const pass = (doc.pass as Record<string, unknown>[]).map((raw, i) => {
    for (const key of Object.keys(raw)) {
      if (!PASS_KEYS.has(key)) throw new Error(`manifest ${scenarioId}: pass[${i}] unknown key "${key}"`);
    }
    if (typeof raw.type !== 'string') throw new Error(`manifest ${scenarioId}: pass[${i}] type required`);
    return raw as unknown as ScenarioManifest['pass'][number];
  });
  const harnessRaw = doc.harness as Record<string, unknown> | undefined;
  if (harnessRaw) {
    for (const key of Object.keys(harnessRaw)) {
      if (!HARNESS_KEYS.has(key)) throw new Error(`manifest ${scenarioId}: harness unknown key "${key}"`);
    }
  }
  return {
    id: String(doc.id),
    type: String(doc.type ?? 'behavior'),
    goal: String(doc.goal ?? ''),
    fixture: String(doc.fixture),
    task_file: String(doc.task_file ?? 'task.md'),
    hidden: doc.hidden as ScenarioManifest['hidden'] | undefined,
    policy: doc.policy as ScenarioManifest['policy'] | undefined,
    harness: doc.harness as ScenarioManifest['harness'] | undefined,
    pass,
    measured: Array.isArray(doc.measured) ? doc.measured.map(String) : [],
    mode: String(doc.mode ?? 'both'),
  };
}
