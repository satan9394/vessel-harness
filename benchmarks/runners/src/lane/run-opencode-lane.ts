/**
 * task V1.1-F / 097 / 102 — opencode-go 真实模型 lane 驱动脚本。
 *
 * 用法：`npx tsx benchmarks/runners/src/lane/run-opencode-lane.ts [选项]`
 *
 * 选项：
 *   --scenarios=B001,S001   只跑给定场景子集（默认 LANE_SCENARIOS 全集）
 *   --model=mimo-v2.5       显式指定模型（可逗号分隔；默认从 /v1/models 自动选 MIMO V2.5 系）
 *   --tier=flash|pro|both   模型档（决定跑哪些场景；默认 flash）
 *   --max-tokens=N          单次补全 max_tokens（推理模型需留思维链预算；默认 8192）
 *   --probe-only            只做一次最小连通探针（不跑 lane，最省配额）
 *   --key-source=auto|env|store  凭据来源选择（默认 auto = CredentialStore → env，097 既有优先级）
 *   --keep                  保留 lane 的临时工作区
 *   --label=xxx             报告里附加的标签（写入 <REPORTS>/V1.1-F-openmodel-lane.json）
 *
 * 流程：
 *   1. 凭据来源（task 097 收敛为两条）：仓库 CredentialStore（034/069 Windows DPAPI 密文，
 *      用户经 `vessel provider add` / setup 向导主动写入）→ 环境变量 `OPENCODE_API_KEY`。
 *      **不读取任何用户本机应用数据**（V1.1-F 的 cc-switch 应用库路径已移除）。key 只在进程内
 *      出现，绝不写明文/git/日志/报告。
 *   2. task 102 协议：provider 走 `OpencodeGoProvider` —— 每会话一个稳定 `x-opencode-session` UUID
 *      （重试复用）+ 具名 User-Agent + 按模型分流路径（mimo-v2.5 → /chat/completions）。
 *   3. fetchOpencodeGoModels() 拉 /v1/models（key 经 credentialAware 读取；无 key → 内置参考清单）。
 *   4. runRealModelLane 跑场景子集，报告写 benchmarks/reports/<runId>.md + .json。
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
  probeOpencodeGoOnce,
  resolveOpencodeGoRoute,
  credentialStoreOpencodeGoKey,
  envOpencodeGoKey,
  OPCODE_GO_CRED_SERVICE,
  OPCODE_GO_CRED_ACCOUNT,
  OPENCODE_API_KEY_ENV,
  OPENCODE_GO_CREDENTIAL_SOURCES,
  OPENCODE_GO_DEFAULT_MAX_TOKENS,
  type LaneModel,
  type LaneScenarioEntry,
  type LaneScenarioTier,
} from './index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REPORTS_DIR = path.join(REPO_ROOT, 'benchmarks', 'reports');

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function buildModels(explicit: string | undefined, auto: readonly string[], tier: LaneScenarioTier): LaneModel[] {
  const ids = explicit
    ? explicit.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
    : auto;
  const tiers: ('pro' | 'flash')[] = tier === 'both' ? ['pro', 'flash'] : [tier === 'pro' ? 'pro' : 'flash'];
  const out: LaneModel[] = [];
  for (const id of ids) {
    for (const t of tiers) {
      out.push({ id: `opencode-go:${id}`, displayName: `OpenCode Go ${id}`, tier: t, defaultModel: id });
    }
  }
  return out;
}

function pickScenarios(spec: string | undefined, tier: LaneScenarioTier): LaneScenarioEntry[] {
  const wanted = spec ? new Set(spec.split(',').map((s) => s.trim()).filter((s) => s.length > 0)) : null;
  const tiers = tier === 'both' ? null : new Set([tier]);
  return LANE_SCENARIOS.filter(
    (s) => (!wanted || wanted.has(s.id)) && (!tiers || tiers.has(s.tier as 'pro' | 'flash')),
  );
}

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');
  const probeOnly = process.argv.includes('--probe-only');
  const tier = (argValue('tier') ?? 'flash') as LaneScenarioTier;
  const maxTokens = Number(argValue('max-tokens') ?? OPENCODE_GO_DEFAULT_MAX_TOKENS);
  const label = argValue('label') ?? 'run';
  const explicitModels = argValue('model');

  // 凭据来源：CredentialStore（DPAPI 密文）→ env OPENCODE_API_KEY。不读任何本机应用数据。
  // task 102：`--key-source` 可显式选择来源（诊断/实跑用；默认 auto 保持 097 的优先级）。
  // 只打印「来源名 + 长度 + 是否一致」，绝不出任何密钥片段。
  const store = createCredentialStore();
  const storeResolver = credentialStoreOpencodeGoKey(store);
  const envResolver = envOpencodeGoKey;
  const storeKey = storeResolver();
  const envKey = envResolver();
  const keySource = argValue('key-source') ?? 'auto';
  let key: string | undefined;
  let keySourceLabel: string;
  if (keySource === 'env') {
    key = envKey;
    keySourceLabel = `env ${OPENCODE_API_KEY_ENV}`;
  } else if (keySource === 'store') {
    key = storeKey;
    keySourceLabel = `CredentialStore ${OPCODE_GO_CRED_SERVICE}/${OPCODE_GO_CRED_ACCOUNT}`;
  } else if (typeof storeKey === 'string' && storeKey.length > 0) {
    key = storeKey;
    keySourceLabel = `CredentialStore ${OPCODE_GO_CRED_SERVICE}/${OPCODE_GO_CRED_ACCOUNT}`;
  } else if (typeof envKey === 'string' && envKey.length > 0) {
    key = envKey;
    keySourceLabel = `env ${OPENCODE_API_KEY_ENV}`;
  } else {
    key = undefined;
    keySourceLabel = 'none';
  }
  const keyResolver = (): string | undefined => key;
  const keyPresent = (key ?? '').length > 0;
  // eslint-disable-next-line no-console
  console.log(`[097] opencode-go 凭据来源：${OPENCODE_GO_CREDENTIAL_SOURCES.join(' → ')}`);
  // eslint-disable-next-line no-console
  console.log(
    `[102] key-source=${keySource} → ${keySourceLabel}（storeLen=${storeKey?.length ?? 0} envLen=${envKey?.length ?? 0}` +
      `${storeKey && envKey ? ` same=${storeKey === envKey}` : ''}）`,
  );
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] opencode-go key=${keyPresent ? 'present' : 'MISSING (pending)'} → base https://opencode.ai/zen/go/v1`);

  const { source, endpoint } = await fetchOpencodeGoModels(keyResolver);
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] model source=${source.origin}; note=${source.note}`);
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] MIMO target from list: ${defaultMimoLaneModels(source.models).map((m) => `${m.displayName}(${m.tier})`).join(', ') || '(none)'}`);

  const autoIds = defaultMimoLaneModels(source.models).map((m) => m.defaultModel);
  const models = buildModels(explicitModels, autoIds, tier);
  const scenarios = pickScenarios(argValue('scenarios'), tier);
  // eslint-disable-next-line no-console
  console.log(`[102] models=${models.map((m) => `${m.defaultModel}/${m.tier}`).join(', ') || '(none)'} scenarios=${scenarios.map((s) => s.id).join(', ') || '(none)'}`);
  for (const m of models) {
    const info = resolveOpencodeGoRoute(m.defaultModel);
    // eslint-disable-next-line no-console
    console.log(`[102] route ${m.defaultModel} → ${info.route} (${info.wire}, ${info.support})`);
  }

  // 最小连通探针（1 次调用，最省配额）——协议头是否被接受的第一手证据。
  const probeModel = models[0]?.defaultModel ?? autoIds[0];
  const probe = probeModel
    ? await probeOpencodeGoOnce({ defaultModel: probeModel }, { keyResolver, maxTokens: Math.min(maxTokens, 512) })
    : null;
  // eslint-disable-next-line no-console
  console.log(
    `[102] probe model=${probeModel ?? '(none)'} → ${probe === null ? 'SKIPPED (no key)' : probe.ok ? `ok content=${probe.content.length}B reasoning=${probe.reasoningChars}B usage=${JSON.stringify(probe.usage)}` : `FAILED kind=${probe.errorKind ?? '?'} ${probe.error ?? ''}`}`,
  );

  if (probeOnly) {
    fs.writeFileSync(
      path.join(REPORTS_DIR, `V1.1-F-openmodel-probe-${label}.json`),
      JSON.stringify({ keyPresent, model: probeModel ?? null, probe }, null, 2),
      'utf8',
    );
    return;
  }

  const report = await runRealModelLane({
    models: models.length > 0 ? models : [],
    scenarios,
    providerResolver: opencodeGoProviderResolver({ keyResolver, defaultMaxTokens: maxTokens }),
    repoRoot: REPO_ROOT,
    reportsDir: REPORTS_DIR,
    keepWorkspace: keep,
  });

  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] lane degraded=${report.degraded} rows=${report.rows.length} → ${report.reportMdPath}`);
  fs.writeFileSync(
    path.join(REPORTS_DIR, 'V1.1-F-openmodel-lane.json'),
    JSON.stringify({
      label,
      keyPresent,
      keySource: keySourceLabel,
      keySourceMode: keySource,
      keySourceAllowed: OPENCODE_GO_CREDENTIAL_SOURCES.join(' / '),
      modelSource: source.origin,
      modelNote: source.note,
      runId: report.runId,
      models: models.map((m) => ({ id: m.id, tier: m.tier, route: resolveOpencodeGoRoute(m.defaultModel).route })),
      scenarios: scenarios.map((s) => s.id),
      probe,
      summary: report.modelSummaries.map((s) => ({
        modelId: s.modelId,
        passed: s.passed,
        failed: s.failed,
        pendingEnvironment: s.pendingEnvironment,
        skipped: s.skipped,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
      })),
    }, null, 2),
    'utf8',
  );
  void endpoint;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[V1.1-C] lane driver failed:', err);
  process.exitCode = 1;
});
