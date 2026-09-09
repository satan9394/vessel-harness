/**
 * task V1.1-F — 真实模型验证驱动（真实 key：migrate → /v1/models → 最小连通 probe）。
 *
 * 用法：`npx tsx benchmarks/runners/src/lane/run-v11f-verify.ts [--db <cc-switch.db>] [--model <id>]`
 *
 * 流程：
 *   1. （可复用）凭据转接：CC Switch → CredentialStore（DPAPI 加密落库）。
 *   2. 真实 GET {base}/v1/models 拉取清单（key 经 CredentialStore 读取），确认 MIMO V2.5 系模型 id。
 *   3. 最小真实聊天 probe（仅 `ping`，maxTokens 极小），验证鉴权/响应/usage 连通。
 *   4. 证据（不含密钥）写 `benchmarks/reports/V1.1-F-verify.json`；失败如实 pending + reason。
 *
 * 密钥安全：key 只在进程内出现 + CredentialStore（DPAPI 密文）；证据文件/report 绝不含 key。
 * 真实网络调用只尝试一次；失败 → 记录 pending + reason（不反复重试）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCredentialStore } from '@vessel/application';
import {
  migrateOpencodeGoCredential,
  fetchOpencodeGoModels,
  selectMimoModel,
  probeOpencodeGoOnce,
  credentialAwareOpencodeGoKey,
  MIMO_V25_MODEL_ID,
} from './index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REPORTS_DIR = path.join(REPO_ROOT, 'benchmarks', 'reports');

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const dbPath = argValue('--db');
  const modelOverride = argValue('--model');

  const store = createCredentialStore();
  const migrated = await migrateOpencodeGoCredential({ store, dbPath });
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] migrate synced=${migrated.synced}${migrated.rowId ? ` rowId=${migrated.rowId}` : ''}${migrated.reason ? ` reason=${migrated.reason}` : ''}`);

  const keyResolver = credentialAwareOpencodeGoKey({ store });
  const hasKey = (keyResolver() ?? '').length > 0;
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] key=${hasKey ? 'present' : 'MISSING'}`);

  const evidence: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    migrated,
    hasKey,
    models: null,
    probe: null,
  };

  // 真实 GET /v1/models
  const { source, endpoint } = await fetchOpencodeGoModels(keyResolver);
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] model source=${source.origin}; count=${source.models.length}; note=${source.note}`);
  const selection = selectMimoModel(source.models, { preferred: modelOverride ?? MIMO_V25_MODEL_ID });
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] MIMO selection=${selection.selected} matchedV25=[${selection.matchedV25.join(', ')}] matchedMimo=[${selection.matchedMimo.join(', ')}]`);
  evidence.models = {
    origin: source.origin,
    count: source.models.length,
    note: source.note,
    selection,
  };

  // 最小真实聊天 probe（仅验证连通；成本最小化）。只尝试一次。
  if (hasKey && endpoint.hasKey) {
    const probeTarget = selection.selected ?? MIMO_V25_MODEL_ID;
    // eslint-disable-next-line no-console
    console.log(`[V1.1-F] probing model=${probeTarget} …`);
    const probe = await probeOpencodeGoOnce({ defaultModel: probeTarget }, {
      keyResolver,
      provider: undefined,
    });
    evidence.probe = probe;
    // eslint-disable-next-line no-console
    console.log(`[V1.1-F] probe ok=${probe?.ok ?? false}${probe?.error ? ` err=${probe.error}` : ''} usage=${JSON.stringify(probe?.usage ?? {})}`);
  } else {
    evidence.probe = null;
    // eslint-disable-next-line no-console
    console.log('[V1.1-F] probe skipped: no key');
  }

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, 'V1.1-F-verify.json'), JSON.stringify(evidence, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] evidence → benchmarks/reports/V1.1-F-verify.json`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[V1.1-F] verify driver failed:', err);
  process.exitCode = 1;
});