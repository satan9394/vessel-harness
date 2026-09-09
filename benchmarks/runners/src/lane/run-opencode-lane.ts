/**
 * task V1.1-F / 097 — opencode-go 真实模型 lane 驱动脚本。
 *
 * 用法：`npx tsx benchmarks/runners/src/lane/run-opencode-lane.ts [--keep]`
 *
 * 流程：
 *   1. 凭据来源（task 097 收敛为两条）：仓库 CredentialStore（034/069 Windows DPAPI 密文，
 *      用户经 `vessel provider add` / setup 向导主动写入）→ 环境变量 `OPENCODE_API_KEY`。
 *      **不读取任何用户本机应用数据**（V1.1-F 的 cc-switch 应用库路径已移除）。key 只在进程内
 *      出现，绝不写明文/git/日志/报告。
 *   2. fetchOpencodeGoModels() 拉 /v1/models（key 经 credentialAware 读取；无 key → 内置参考清单）。
 *   3. selectMimoModel/defaultMimoLaneModels 映射 pro/flash 档（MIMO V2.5 优先）。
 *   4. runRealModelLane 以 credentialAware provider resolver 跑 LANE_SCENARIOS（含 B024-027），
 *      报告写 benchmarks/reports/<runId>.md + .json。
 *
 * 无 key / 网络受限 → lane 走 pending-environment 降级（不 throw、不触真实 API），报告如实标注。
 * 报告/日志不含任何密钥片段。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCredentialStore } from '@vessel/application';
import {
  LANE_SCENARIOS,
  runRealModelLane,
  fetchOpencodeGoModels,
  defaultMimoLaneModels,
  opencodeGoProviderResolver,
  credentialAwareOpencodeGoKey,
  OPENCODE_GO_CREDENTIAL_SOURCES,
} from './index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REPORTS_DIR = path.join(REPO_ROOT, 'benchmarks', 'reports');

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');

  // 凭据来源：CredentialStore（DPAPI 密文）→ env OPENCODE_API_KEY。不读任何本机应用数据。
  const store = createCredentialStore();
  const keyResolver = credentialAwareOpencodeGoKey({ store });
  const keyPresent = (keyResolver() ?? '').length > 0;
  // eslint-disable-next-line no-console
  console.log(`[097] opencode-go 凭据来源：${OPENCODE_GO_CREDENTIAL_SOURCES.join(' → ')}`);
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] opencode-go key=${keyPresent ? 'present' : 'MISSING (pending)'} → base https://opencode.ai/zen/go/v1`);

  const { source, endpoint } = await fetchOpencodeGoModels(keyResolver);
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] model source=${source.origin}; note=${source.note}`);
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] MIMO target from list: ${defaultMimoLaneModels(source.models).map((m) => `${m.displayName}(${m.tier})`).join(', ') || '(none)'}`);

  const models = defaultMimoLaneModels(source.models);
  if (models.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[V1.1-F] 无可选 MIMO 模型 → 用默认档跑（记录实际清单，留给验收）。');
  }
  const report = await runRealModelLane({
    models: models.length > 0 ? models : [],
    scenarios: LANE_SCENARIOS,
    providerResolver: opencodeGoProviderResolver({ keyResolver }),
    repoRoot: REPO_ROOT,
    reportsDir: REPORTS_DIR,
    keepWorkspace: keep,
  });

  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] lane degraded=${report.degraded} rows=${report.rows.length} → ${report.reportMdPath}`);
  void endpoint;
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'V1.1-F-openmodel-lane.json'),
    JSON.stringify({
      keyPresent,
      keySource: OPENCODE_GO_CREDENTIAL_SOURCES.join(' / '),
      modelSource: source.origin,
      modelNote: source.note,
      runId: report.runId,
    }, null, 2),
    'utf8',
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[V1.1-C] lane driver failed:', err);
  process.exitCode = 1;
});