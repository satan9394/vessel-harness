/**
 * task V1.1-C — opencode-go 真实模型 lane 驱动脚本。
 *
 * 用法：`npx tsx benchmarks/runners/src/lane/run-opencode-lane.ts [--keep]`
 *
 * 流程：
 *   1. 读 OPENCODE_API_KEY（仅 env；无 key → 记录 pending，不落盘）。
 *   2. fetchOpencodeGoModels() 拉 /v1/models（无 key → 内置参考清单）。
 *   3. selectMimoModel/defaultMimoLaneModels 映射 pro/flash 档（MIMO V2.5 优先）。
 *   4. runRealModelLane 以 opencodeGoProviderResolver 跑 LANE_SCENARIOS（含 B024-027），
 *      报告写 benchmarks/reports/<runId>.md + .json。
 *
 * 无 key / 网络受限 → lane 走 pending-environment 降级（不 throw、不触真实 API），报告如实标注。
 * 报告/日志不含任何密钥片段。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANE_SCENARIOS,
  runRealModelLane,
  fetchOpencodeGoModels,
  defaultMimoLaneModels,
  opencodeGoProviderResolver,
  OPENCODE_API_KEY_ENV,
} from './index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REPORTS_DIR = path.join(REPO_ROOT, 'benchmarks', 'reports');

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');
  const hasKey = typeof process.env[OPENCODE_API_KEY_ENV] === 'string' && process.env[OPENCODE_API_KEY_ENV]!.length > 0;

  // eslint-disable-next-line no-console
  console.log(`[V1.1-C] OPENCODE_API_KEY=${hasKey ? 'present' : 'MISSING (pending)'} → base https://opencode.ai/zen/go/v1`);
  const { source, endpoint } = await fetchOpencodeGoModels();
  // eslint-disable-next-line no-console
  console.log(`[V1.1-C] model source=${source.origin}; note=${source.note}`);
  // eslint-disable-next-line no-console
  console.log(`[V1.1-C] MIMO target from list: ${defaultMimoLaneModels(source.models).map((m) => `${m.displayName}(${m.tier})`).join(', ') || '(none)'}`);

  const models = defaultMimoLaneModels(source.models);
  if (models.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[V1.1-C] 无可选 MIMO 模型 → 用默认档跑（记录实际清单，留给验收）。');
  }
  const report = await runRealModelLane({
    models: models.length > 0 ? models : [],
    scenarios: LANE_SCENARIOS,
    providerResolver: opencodeGoProviderResolver(),
    repoRoot: REPO_ROOT,
    reportsDir: REPORTS_DIR,
    keepWorkspace: keep,
  });

  // eslint-disable-next-line no-console
  console.log(`[V1.1-C] lane degraded=${report.degraded} rows=${report.rows.length} → ${report.reportMdPath}`);
  void endpoint;
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'V1.1-C-openmodel-lane.json'),
    JSON.stringify({ hasKey, modelSource: source, runId: report.runId }, null, 2),
    'utf8',
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[V1.1-C] lane driver failed:', err);
  process.exitCode = 1;
});