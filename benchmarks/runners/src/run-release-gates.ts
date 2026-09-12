/**
 * task V1.1-E/F / 097 — Release Gates 实跑驱动（产出 V1.1 release-report）。
 *
 * 用法：`npx tsx benchmarks/runners/src/run-release-gates.ts [--key-source=auto|env|store] [--models=<id,...>]`
 *
 * 流程：
 *   1. （V1.1-F / 097）凭据来源：仓库 CredentialStore（034/069 DPAPI 密文，用户经
 *      `vessel provider add` / setup 向导主动写入）→ 环境变量 `OPENCODE_API_KEY`；
 *      **不读取任何用户本机应用数据**。real-model-bench gate 用 credentialAware resolver
 *      （凭证库优先，env 回退）→ 有 key 时真实跑 082 lane。
 *      task 102：`--key-source` 可显式指定来源（本机 store 里的 opencode-go key 与用户新提供的
 *      key 可能不是同一把 → 默认优先级会静默选中失效 key 并返回 401 CreditsError）。
 *      `--models=` 可把 gate 4 的模型档收敛到指定 id（最小配额）。
 *   2. buildReleaseGateExecutors() 装配 8 个 §21 / 084 gate executor。
 *   3. 按 V1.1-E 任务卡要求，把 deterministic-bench 的 L1 可跑集从 084 默认的 B001-B005
 *      扩展为「L1 B001-B027 可跑集」（B001-B005 + B016-B027，全部 offline 确定性），
 *      纳入 V1.1-D（B024-B027）→ 复用 076 runner 的 runScenario + 084 的 judgeScenarioRuns。
 *   4. runReleaseGates() 顺序实跑 8 gate（每 gate 经注入的 exec: RunCommand 跑真实命令/判据），
 *      聚合 release-report.json + .md 写到 benchmarks/reports/（084 惯例）。
 *
 * 密钥安全：key 只经 CredentialStore（DPAPI 密文）/ env 转接，进程内使用，绝不落盘；
 * 报告不含任何密钥片段。
 * 受限环境：真实命令（tsc/vitest）经 execFile 实跑；unavailable 的 gate 按 084 语义 probe→pending，
 *   由 runner 如实汇总为 partial，不伪造 pass。
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCredentialStore } from '@vessel/application';
import type { ChatProvider } from '@vessel/shared';
import {
  buildReleaseGateExecutors,
  gateDefinition,
  judgeScenarioRuns,
  runReleaseGates,
  writeReleaseReportFiles,
  type GateExecutor,
  type GateVerdict,
  type ReleaseContext,
  type ReleaseGateResult,
  type RunCommand,
} from './release-gates/index.js';
import {
  credentialStoreOpencodeGoKey,
  envOpencodeGoKey,
  OPCODE_GO_CRED_ACCOUNT,
  OPCODE_GO_CRED_SERVICE,
  OPENCODE_API_KEY_ENV,
  OPENCODE_GO_CREDENTIAL_SOURCES,
  opencodeGoProviderResolver,
  fetchOpencodeGoModels,
  defaultLaneModels,
  explicitLaneModels,
  type LaneModel,
} from './lane/index.js';
import { runScenario } from './runner.js';

const execFileAsync = promisify(execFile);

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REPORTS_DIR = path.join(REPO_ROOT, 'benchmarks', 'reports');

/** `--name=value` 取值（缺省 undefined）。 */
function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/**
 * L1 确定性可跑集（V1.1-E 扩展）：084 默认 B001-B005 + B016-B027（V1.0 新能力 feature-lane +
 * V1.1-D streaming/interrupt/steering/resume）。全部 mode=offline，经 076 runner 的 mock lane 确定性跑。
 */
export const L1_DETERMINISTIC_RUNNABLE_SET: readonly string[] = [
  'B001', 'B002', 'B003', 'B004', 'B005',
  'B016', 'B017', 'B018', 'B019', 'B020',
  'B021', 'B022', 'B023', 'B024', 'B025', 'B026', 'B027',
];

/**
 * Windows-friendly real command runner (injected into the 8 gate executors).
 *
 * V1.1-E 实跑发现：084 的 gateDefaultRunCommand 用 child_process.execFile{shell:false} 直调
 * `npx`/`npm`——在 Windows 上它们是 `npx.cmd`/`npm.cmd` shim，无 shell 时 spawn 直接 ENOENT，
 * 导致 Build/Unit/Packaging gate 在 Windows 永远拿不到真实命令输出（被吞成 exit 1 / pending）。
 * 这里用 `shell: true` 重走命令，使真实命令在非受限 Windows 环境可跑（框架注解：受限沙箱可注入
 * 自己的 RunCommand 作为 spawn 边界，`-b` io 若 EPERM 则降级）。不修改 084 框架源码。
 */
function windowsFriendlyRunCommand(): RunCommand {
  return async (command, args, opts) => {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd: opts.cwd,
        env: opts.env,
        timeout: opts.timeoutMs ?? 120_000,
        windowsHide: true,
        shell: true, // 解析 npx.cmd / npm.cmd shim（Windows）
      });
      return { code: 0, stdout: String(stdout), stderr: String(stderr) };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      return {
        code: typeof e.code === 'number' ? e.code : 1,
        stdout: String(e.stdout ?? ''),
        stderr: String(e.stderr ?? e.message),
      };
    }
  };
}

/** 构造 determinstic-bench executor：全 L1 可跑集离线跑（纳入 V1.1-D）。 */
export function buildDeterministicBenchExecutor(provider: ChatProvider | null = null): GateExecutor {
  return {
    gate: gateDefinition('deterministic-bench'),
    run: async (ctx: ReleaseContext & { exec: unknown }): Promise<GateVerdict> => {
      const passed: boolean[] = [];
      for (const id of L1_DETERMINISTIC_RUNNABLE_SET) {
        try {
          const r = await runScenario({
            scenarioId: id,
            repoRoot: ctx.repoRoot,
            reportsDir: path.join(ctx.reportsDir, 'release-gate'),
            provider,
            model: 'mock-model',
            policyPath: path.join(ctx.repoRoot, 'configs', 'policy.default.yaml'),
            behaviorIRPath: path.join(ctx.repoRoot, 'configs', 'behavior.default.yaml'),
          });
          passed.push(r.success === true);
        } catch (err) {
          return {
            status: 'fail',
            evidence: { summary: `离线场景 ${id} 执行异常`, detail: [String(err)] },
          };
        }
      }
      return judgeScenarioRuns({ scenarioIds: [...L1_DETERMINISTIC_RUNNABLE_SET], passed });
    },
  };
}

// ---------------------------------------------------------------------------
// V1.1-E 证据注解 —— unit gate 归因（注解机制保留，归因逻辑改为证据驱动）
// ---------------------------------------------------------------------------

/**
 * 从 unit gate 的 evidence 提取到的失败事实（全部来自真实命令输出，不做推断）。
 *
 * 限定：084 的 `compactLines()` 只保留命令输出的**尾部**（stdout 末 12 行 + stderr 末 6 行，
 * 去空行后至多 18 行），所以路径列表可能不全 —— 注解文案必须保留这条限定，不得据此断言「唯一」。
 */
interface UnitFailureFacts {
  /** 失败行（含 `FAIL` 标记或 `❯` 堆栈行）上出现的 `*.test.ts(x)` 路径（去重、正斜杠）。 */
  failedTestFiles: string[];
  /** evidence 中出现的**全部** `*.test.ts(x)` 路径（不区分是否为失败行）。 */
  allTestFiles: string[];
  /** `Test Files  N failed | ...` 的 N（拿不到则 undefined）。 */
  failedFileCount?: number;
  /** `Tests  N failed | ...` 的 N（拿不到则 undefined）。 */
  failedTestCount?: number;
  /** `Tests  ... | M passed | ...` 的 M（拿不到则 undefined）。 */
  passedTestCount?: number;
  /** 原样的 vitest 汇总行（如 `Test Files  1 failed | 128 passed (129)`）。 */
  statLines: string[];
}

const TEST_FILE_PATH_RE = /[\w./\\-]*\.test\.tsx?/g;
const FAILURE_MARKER_RE = /\bFAIL\b|❯|\bAssertionError\b|^\s*×/;

/** 提取 `N failed` / `M passed`（兼容 `1,388` 千分位写法）。 */
function vitestCount(segment: string, word: 'failed' | 'passed'): number | undefined {
  const m = segment.match(new RegExp(`(\\d[\\d,]*)\\s+${word}`, 'i'));
  if (!m || m[1] === undefined) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** 收集一段文本里出现的 `*.test.ts(x)` 路径（去重，反斜杠归一为正斜杠）。 */
function collectTestFilePaths(text: string, into: string[]): void {
  for (const m of text.matchAll(TEST_FILE_PATH_RE)) {
    const p = m[0].replace(/\\/g, '/').replace(/^\.\//, '');
    if (!into.includes(p)) into.push(p);
  }
}

/** 从 unit gate 的 evidence 提取失败事实（无副作用、不猜测、不做归因）。 */
function extractUnitFailureFacts(gate: ReleaseGateResult): UnitFailureFacts {
  const lines = [...(gate.evidence.detail ?? []), gate.evidence.summary]
    .flatMap((l) => String(l).split('\n'))
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const failedTestFiles: string[] = [];
  const allTestFiles: string[] = [];
  const statLines: string[] = [];
  let failedFileCount: number | undefined;
  let failedTestCount: number | undefined;
  let passedTestCount: number | undefined;

  for (const line of lines) {
    collectTestFilePaths(line, allTestFiles);
    if (FAILURE_MARKER_RE.test(line)) collectTestFilePaths(line, failedTestFiles);
    // 只认 vitest 的稳定汇总行（"Test Files"/"Tests" 起首的合计行）。
    if (!/^\s*(Test Files|Tests)\s+\d/i.test(line)) continue;
    statLines.push(line);
    if (/^\s*Test Files\s/i.test(line)) {
      failedFileCount ??= vitestCount(line, 'failed');
    } else {
      failedTestCount ??= vitestCount(line, 'failed');
      passedTestCount ??= vitestCount(line, 'passed');
    }
  }

  return { failedTestFiles, allTestFiles, failedFileCount, failedTestCount, passedTestCount, statLines };
}

/** 既有注解里提到的那个 flaky 文件（task 072）。 */
const PROCESS_TREE_TEST_FILE = 'packages/runtime/src/sandbox/backend/process-tree.test.ts';

/**
 * 由 evidence 推导 unit gate 的 note（**不改变任何 gate 的 status/判据**）：
 *  - 分支 A：vitest 汇总行 `Test Files  1 failed` **且**失败行只命中 process-tree.test.ts
 *            → 才写既有「process-tree 计时 flaky」注解，并附上归因依据；
 *  - 分支 B：其它/混合失败（含只拿到统计行、或失败文件非 process-tree 的情况）
 *            → 如实列出可提取的 stats / 失败文件，并明确「未自动归因」；
 *  - 分支 C：连失败文件与统计都提取不到 → 只说「未自动归因，见 evidence.detail」。
 *  三种分支都**绝不**出现「唯一失败为 X」这类未经验证的断言。
 */
function deriveUnitFailureNote(gate: ReleaseGateResult): string {
  const facts = extractUnitFailureFacts(gate);
  const [onlyFailedFile] = facts.failedTestFiles;
  const stats = facts.statLines.join('；');

  const onlyProcessTree =
    facts.failedFileCount === 1 &&
    facts.failedTestFiles.length === 1 &&
    onlyFailedFile !== undefined &&
    onlyFailedFile.endsWith('process-tree.test.ts');

  if (onlyProcessTree) {
    return (
      '唯一失败为既有 process-tree 计时 flaky（packages/runtime/src/sandbox/backend/process-tree.test.ts，' +
      'task 072）：整机并行高负载下 30s 超时；隔离单跑 11/11 通过。非 V1.1-E 回归（该文件自 072 未改动），' +
      '按项目惯例视为环境性 flaky。' +
      `（归因依据：unit evidence 的 vitest 汇总行「${facts.statLines[0] ?? 'Test Files 1 failed'}」` +
      `+ 失败行只命中 ${PROCESS_TREE_TEST_FILE}。）`
    );
  }

  const parts: string[] = ['unit 失败；失败摘要见 evidence.detail（未自动归因）'];
  if (stats.length > 0) {
    parts.push(`vitest 汇总行：${stats}`);
  } else {
    parts.push('evidence.detail 未包含 vitest 汇总行（Test Files/Tests）');
  }
  parts.push(
    `失败用例数=${facts.failedTestCount ?? '未能提取'}；通过用例数=${facts.passedTestCount ?? '未能提取'}`,
  );
  if (facts.failedTestFiles.length > 0) {
    parts.push(
      `失败行出现的测试文件：${facts.failedTestFiles.join(', ')}（仅命令输出尾部截取，可能不全，也可能含非失败文件）`,
    );
  } else if (facts.allTestFiles.length > 0) {
    parts.push(
      `evidence.detail 出现的测试文件（未标注为失败）：${facts.allTestFiles.join(', ')}（仅尾部截取，可能不全）`,
    );
  } else {
    parts.push('evidence.detail 未出现任何 *.test.ts 路径');
  }
  parts.push('本注解不推断失败原因；请以 evidence.detail 与重跑结果为准，勿据此忽略回归');
  return `${parts.join('；')}。`;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[V1.1-E/F] repoRoot=' + REPO_ROOT);

  // V1.1-F / 097 — 凭据来源：CredentialStore（DPAPI 密文）→ env OPENCODE_API_KEY。
  // 不读取任何用户本机应用数据（cc-switch 应用库路径已于 task 097 移除）。
  // task 102：`--key-source` 显式选源（默认 auto 保持 097 优先级）。只打印来源名/长度，不出密钥。
  const store = createCredentialStore();
  const storeKey = credentialStoreOpencodeGoKey(store)();
  const envKey = envOpencodeGoKey();
  const keySourceMode = argValue('key-source') ?? 'auto';
  let key: string | undefined;
  let keySourceLabel: string;
  if (keySourceMode === 'env') {
    key = envKey;
    keySourceLabel = `env ${OPENCODE_API_KEY_ENV}`;
  } else if (keySourceMode === 'store') {
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
  // eslint-disable-next-line no-console
  console.log(`[097] opencode-go 凭据来源：${OPENCODE_GO_CREDENTIAL_SOURCES.join(' → ')}`);
  // eslint-disable-next-line no-console
  console.log(
    `[102] key-source=${keySourceMode} → ${keySourceLabel}（storeLen=${storeKey?.length ?? 0} envLen=${envKey?.length ?? 0}` +
      `${storeKey && envKey ? ` same=${storeKey === envKey}` : ''}）`,
  );
  const providerResolver = opencodeGoProviderResolver({ keyResolver });

  // V1.1-F — real-model gate 用 lane 默认模型档（task 111 起默认 flash=deepseek-flash，MIMO V2.5 系回退；
  // live 拉取为准；无 key 时回退内置参考清单；显式 `--models=mimo-v2.5` 保留 mimo 复跑能力）。
  const { source } = await fetchOpencodeGoModels(keyResolver);
  const autoModels = defaultLaneModels(source.models);
  const explicitModels = argValue('models');
  const laneModels: LaneModel[] = explicitModels
    ? explicitLaneModels(
        explicitModels.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
        ['flash'],
      )
    : autoModels;
  // eslint-disable-next-line no-console
  console.log(`[V1.1-F] real-model gate models: ${laneModels.map((m) => `${m.displayName}(${m.tier})`).join(', ') || '(none)'}（source=${source.origin}）`);

  const base = buildReleaseGateExecutors({ providerResolver, models: laneModels.length > 0 ? laneModels : undefined });
  // 覆盖 deterministic-bench → 全 L1 可跑集（含 V1.1-D B024-B027）
  const executors = base.map((e) =>
    e.gate.id === 'deterministic-bench' ? buildDeterministicBenchExecutor() : e,
  );

  const report = await runReleaseGates(
    executors,
    { repoRoot: REPO_ROOT, reportsDir: REPORTS_DIR, version: 'v1.1.0' },
    windowsFriendlyRunCommand(),
  );

  // V1.1-E 证据注解（不改变判据 verdict，仅补充环境/范围说明，保证 .md/.json 一致）：
  // task 113：note 一律**由 unit gate 的 evidence 推导**。旧实现无条件写「唯一失败为 process-tree
  // 计时 flaky」——env 泄漏（VESSEL_OPENCODE_GO_BASE_URL）导致 2 例 baseUrl 断言失败时仍这么写，
  // 会把真实回归当成环境性 flaky 忽略（宣称与证据不符）。现在只有证据确实只指向 process-tree.test.ts
  // 时才写该注解，否则如实标注「未自动归因」。
  for (const g of report.gates) {
    if (g.status !== 'fail' || g.id !== 'unit') continue;
    const derived = deriveUnitFailureNote(g);
    g.note = g.note ? `${g.note} ${derived}` : derived;
  }
  // deterministic-bench 已从 084 默认 B001-B005 扩到全 L1（含 V1.1-D B024-B027），补注范围。
  const bench = report.gates.find((g) => g.id === 'deterministic-bench');
  if (bench) bench.note = '扩至 L1 全离线可跑集（B001-B005 + B016-B027，含 V1.1-D streaming/interrupt/steering/resume）。';
  // task 102：real-model-bench 的凭据来源/模型档写进 gate note（不含密钥）。
  const realModel = report.gates.find((g) => g.id === 'real-model-bench');
  if (realModel) {
    const extra = `凭据来源=${keySourceLabel}；模型档=${laneModels.map((m) => m.defaultModel).join(',') || '(none)'}（task 102：Go 端点 x-opencode-session + 具名 UA + 路径分流）。`;
    realModel.note = realModel.note ? `${realModel.note} ${extra}` : extra;
  }

  const { mdPath, jsonPath } = writeReleaseReportFiles(report, REPORTS_DIR);
  // eslint-disable-next-line no-console
  console.log(
    `[V1.1-E] status=${report.status} pass=${report.totals.pass} fail=${report.totals.fail} pending=${report.totals.pending} durationMs=${report.totals.durationMs}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[V1.1-E] md=${mdPath} json=${jsonPath}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[V1.1-E] release-gates run failed:', err);
  process.exitCode = 1;
});