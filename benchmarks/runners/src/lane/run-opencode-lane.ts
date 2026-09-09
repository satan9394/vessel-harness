/**
 * task V1.1-F — opencode-go 真实模型 lane 驱动脚本（含 CC Switch 凭据转接）。
 *
 * 用法：`npx tsx benchmarks/runners/src/lane/run-opencode-lane.ts [--keep] [--db <cc-switch.db>]`
 *
 * 流程：
 *   1. （V1.1-F）凭据转接：从 CC Switch 库（~/.cc-switch/cc-switch.db，可 --db 覆盖）探查
 *      opencode-go 条目 → 经 CredentialStore（034/069 Windows DPAPI）加密落库；key 只在进程内
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
  migrateOpencodeGoCredential,
} from './index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REPORTS_DIR = path.join(REPO_ROOT, 'benchmarks', 'reports');

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');
  const dbPath = argValue('--db');

  // V1.1-F — must run BEFORE rendering the key resolver so the cached getter sees the migrated value.
  const store = createCredentialStore();
  const migrated = await migrateOpencodeGoCredential({ store, dbPath });
  // eslint-disable-next-line no-console
  console.log(
    `[V1.1-F] cc-switch opencode-go 凭据转接：synced=${migrated.synced}` +
      (migrated.rowId ? ` rowId=${migrated.rowId}` : '') +
      (migrated.baseUrl ? ` baseUrl=${migrated.baseUrl}` : '') +
      (migrated.reason ? ` reason=${migrated.reason}` : ''),
  );

  // key resolver：先 CredentialStore（034/069 DPAPI 落库），再回退 env，最后 undefined→pending。
  const keyResolver = credentialAwareOpencodeGoKey({ store });
  const keyPresent = (keyResolver() ?? '').length > 0;
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
      keySource: 'CredentialStore (DPAPI encrypted, from CC Switch)',
      modelSource: source.origin,
      modelNote: source.note,
      ccSwitchBaseUrl: migrated.baseUrl ?? null,
      ccSwitchRowId: migrated.rowId ?? null,
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