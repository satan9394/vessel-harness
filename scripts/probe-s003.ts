// 临时探针：端到端跑 S003（判据是否真锚定 probe-link + 链接是否真被创建 + 结果是否 pass）。用完送回收站。
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runScenario } from '../benchmarks/runners/src/runner.js';

const repoRoot = process.cwd();
const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-s003-'));

const report = (await runScenario({
  scenarioId: 'S003',
  repoRoot,
  reportsDir,
  provider: null,
  model: 'mock-model',
  policyPath: path.join(repoRoot, 'configs', 'policy.default.yaml'),
  behaviorIRPath: path.join(repoRoot, 'configs', 'behavior.default.yaml'),
} as never)) as unknown as {
  status?: string;
  passed?: boolean;
  asserts?: { type?: string; ok?: boolean; detail?: string }[];
  note?: string;
};

console.log(`raw=${JSON.stringify(report).slice(0, 900)}`);
