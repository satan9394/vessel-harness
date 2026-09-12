/**
 * task V1.1-E/F / 097 — Release Gates 实跑驱动（产出 V1.1 release-report）。
 *
 * 用法：`npx tsx benchmarks/runners/src/run-release-gates.ts [--key-source=auto|env|store] [--models=<id,...>]`
 * （Round 14：`main()` 已加 ESM entry 判定，被 import 时不执行 → 模块可被单测安全导入，
 *   见 run-release-gates.note.test.ts。）
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
 *      同时把 packaging gate 的 executor 换成 buildPublishArtifactExecutor()（EVALUATION-REPORT-24 P2：
 *      判「发布物形状」而非只查本地 dist 是否存在——离线 `npm pack --dry-run` 清单 + pack 期脚本静态断言）。
 *   4. runReleaseGates() 顺序实跑 8 道 §21 门禁 + 第 9 道「安装态冒烟」（V1.1-G，**默认 pending**，
 *      仅 `VESSEL_GATE_INSTALL_SMOKE=1` 时真跑 pack→install→首跑→**覆盖升级**（Round 20 追加：
 *      同项目再装一版新产物，重判两条硬判据 + 溯源「安装树来自本次 pack」）；
 *      未启用时零命令零 IO），
 *      聚合 release-report.json + .md 写到 benchmarks/reports/（084 惯例）。
 *
 * 密钥安全：key 只经 CredentialStore（DPAPI 密文）/ env 转接，进程内使用，绝不落盘；
 * 报告不含任何密钥片段。
 * 受限环境：真实命令（tsc/vitest）经 execFile 实跑；unavailable 的 gate 按 084 语义 probe→pending，
 *   由 runner 如实汇总为 partial，不伪造 pass。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createCredentialStore } from '@vessel/application';
import type { ChatProvider } from '@vessel/shared';
import {
  buildReleaseGateExecutors,
  gateDefinition,
  judgeScenarioRuns,
  runReleaseGates,
  writeReleaseReportFiles,
  type CommandOutcome,
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
// 发布物形状门禁 —— EVALUATION-REPORT-24 P2：把终评的一次性人工实测（tarball 270 → 62 文件、
// 含 dist/cli.js 与 4 个 dist/configs/*、零 *.test.* / 零 *.map）固化成**确定性、离线、可回归**
// 的 gate 判据，并入既有 §21 Gate 8 `packaging`（不新增第 9 道门禁、不改 084 的 8 门禁注册表）。
//
// 为什么需要：原 packaging gate 只查「本地 dist 是否存在」→ 任何重构都能在**没有红灯**的情况下
// 把能用的包变成不能用的包（典型：`prepack` 忘了构建 → 干净检出打出的包没有 dist/cli.js）。
// ---------------------------------------------------------------------------

/** 被发布/安装的包目录（相对 repoRoot）：`apps/cli`（`bin.vessel` → `dist/cli.js`）。 */
export const PUBLISH_PACKAGE_REL_DIR = 'apps/cli';

/** 发布包名（用于确认实测 tarball 就是判据目标包，而非工作区里的别的包）。 */
export const PUBLISH_PACKAGE_NAME = '@vessel/cli';

/** 必须入包的**包内**相对路径（npm tarball 清单口径，已去 `package/` 前缀）。 */
export const PUBLISH_ARTIFACT_REQUIRED: readonly string[] = [
  'dist/cli.js',
  'dist/configs/policy.default.yaml',
  'dist/configs/behavior.default.yaml',
  'dist/configs/pricing.json',
  'dist/configs/model-catalog.json',
];

/** 必须**不入包**的形态：编译产物里的测试与 sourcemap（`*.test.js.map` 由 `.map$` 覆盖）。 */
export const PUBLISH_ARTIFACT_FORBIDDEN_RE = /\.test\.js$|\.test\.d\.ts$|\.map$/;

/**
 * npm 在 pack 期**真正执行**的包内生命周期脚本（以本机 npm 11 源码为据）：
 * `npm pack <dir>` → `libnpmpack` 跑 `prepack`（npm/lib/commands/pack.js:53-61 → libnpmpack/lib/index.js:19-28），
 * 随后 pacote 的 DirFetcher 再跑 `prepare`（pacote/lib/dir.js:30-58）。两者都不做构建 → 干净检出无 dist。
 */
export const PACK_LIFECYCLE_SCRIPTS = ['prepack', 'prepare'] as const;

/** §21 Gate 8 packaging 的 criterion（含发布物形状判据；注册表仍在 gates.ts，仅此处覆盖文案）。 */
export const PUBLISH_ARTIFACT_CRITERION =
  'build 产物检查（npm pack / 等价产物）存在且完整；工具缺失时显式 pending。' +
  '发布物形状（publish-artifact）判据：① `apps/cli` 的 pack 期脚本（prepack / prepare）必须构建 dist——' +
  '否则干净检出（无 dist）时 `npm pack` 会打出缺 `dist/cli.js` 的坏包 → **fail**；' +
  '② `npm pack --dry-run` 的 tarball 清单必须含 `dist/cli.js` 与 4 个 `dist/configs/*`' +
  '（policy.default.yaml / behavior.default.yaml / pricing.json / model-catalog.json），' +
  '且不得含任何 `*.test.js` / `*.test.d.ts` / `*.map`；' +
  '③ npm pack 不可用、目标包错位或输出无法解析时显式 **pending**，不静默通过。';

/** npm 自身日志行（notice/warn/error/ERR!）——区分「npm 真跑了并失败」与「spawn 级失败（工具缺失）」。 */
const NPM_LOG_LINE_RE = /(^|\n)\s*npm\s+(?:notice|warn|error|ERR!)/;

/** 取文本尾部若干非空行（证据用）。 */
function tailLines(text: string, n = 4): string[] {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-n);
}

/** 归一化 tarball 清单条目：分隔符 → `/`、去 `./` 与 `package/` 前缀（npm 各版本/各输出口径不同）。 */
export function normalizePackEntry(raw: string): string {
  return String(raw).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^package\//, '');
}

/**
 * 解析 `npm pack --dry-run` 输出里的 tarball 清单 + 被打包的包名。
 *
 * 为什么**不**解析 `--json`：`apps/cli` 的 `prepack`（scripts/copy-configs.mjs）用 `console.log`
 * 往 **stdout** 打自己的横幅与文件清单，与 npm 的 JSON 混在同一路 stdout（终评实测：`--json`
 * 输出被 `[copy-configs] …` 污染 → `JSON.parse` 失败）。而 npm 的 tarball 清单只以
 * `npm notice Tarball Contents` … `npm notice Tarball Details` 之间的
 * `npm notice <size> <path>` 形态出现——本机 npm 11 的 `lib/utils/tar.js#logTar` 把 notice 一律写
 * **stderr**、且每行加 `npm notice ` 前缀（npm/lib/utils/format.js:44-54 逐行加 prefix）。
 * 脚本横幅既不落在这两行之间、也不带 `<size>` 前缀 → **天然被排除**，污染无从注入。
 */
export function parsePackListing(output: string): { entries: string[]; parsed: boolean; packedName?: string } {
  const text = String(output);
  const lines = text.split(/\r?\n/);
  const entries: string[] = [];

  const start = lines.findIndex((l) => l.includes('Tarball Contents'));
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (line.includes('Tarball Details')) break; // 清单段结束（其后是 name/version/shasum…）
      // `${formatBytes(size, false)} ${path}` → 尺寸 token 一定是 `\d+` 或 `\d+.\d+(B|kB|MB|GB)`。
      const m = line.match(/^\s*npm\s+notice\s+\d+(?:\.\d+)?(?:[kKmMgG]?B)\s+(.+?)\s*$/);
      const raw = m?.[1];
      if (raw === undefined) continue;
      const p = normalizePackEntry(raw);
      if (p.length > 0 && !entries.includes(p)) entries.push(p);
    }
  }

  // 包名行：`npm notice package: @vessel/cli@0.10.0`（unicode 开启时是 `npm notice 📦  @vessel/cli@0.10.0`）。
  const nameMatch = text.match(/npm\s+notice\s+(?:📦\s+)?(?:package:\s*)?(@?[^\s@]+)@[^\s]+\s*$/m);
  const packedName = nameMatch?.[1];
  return packedName === undefined
    ? { entries, parsed: entries.length > 0 }
    : { entries, parsed: entries.length > 0, packedName };
}

/**
 * 脚本文本（含 `npm run <script>` 间接引用，深度 ≤3）里是否真的调用 TypeScript 编译器（`tsc`）。
 *
 * 这是「干净检出下 `npm pack` 能否产出 dist」唯一可离线、可重复判定的信号：本仓的 `dist/` 只由
 * `tsc -b` 产出。局限（如实记录）：若将来把构建藏进自定义脚本（如 `node scripts/build.mjs` 内部调
 * tsc），本静态断言判不出来 → 该 gate 变红并要求把 `tsc` 显式写进 pack 期脚本链。这是**刻意**的
 * 保守方向：宁可红得显眼，也不放过「干净检出打出坏包」。
 */
function scriptRunsTsc(text: string, scripts: Record<string, string>, seen: Set<string>, depth = 0): boolean {
  if (depth > 3) return false;
  if (/\btsc\b/.test(text)) return true;
  for (const m of text.matchAll(/\b(?:npm|pnpm|yarn)\s+run(?:-script)?\s+([\w:.-]+)/g)) {
    const name = m[1];
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const next = scripts[name];
    if (next !== undefined && scriptRunsTsc(next, scripts, seen, depth + 1)) return true;
  }
  return false;
}

/**
 * 从包 manifest 判定 pack 期（prepack / prepare）是否会构建 dist。
 * 返回 `builds=false` 即表示：干净检出（无 dist）下 pack 出的 tarball 不含 dist/cli.js。
 */
export function packScriptsBuildDist(manifest: unknown): { builds: boolean; scripts: string[] } {
  const rawScripts = ((manifest ?? {}) as { scripts?: Record<string, unknown> }).scripts ?? {};
  const scripts: Record<string, string> = {};
  for (const [name, text] of Object.entries(rawScripts)) {
    if (typeof text === 'string') scripts[name] = text;
  }

  const lines: string[] = [];
  let builds = false;
  for (const name of PACK_LIFECYCLE_SCRIPTS) {
    const text = scripts[name];
    if (text === undefined) continue;
    lines.push(`${name}: ${text}`);
    if (scriptRunsTsc(text, scripts, new Set([name]))) builds = true;
  }
  if (lines.length === 0) lines.push(`(manifest 无 ${PACK_LIFECYCLE_SCRIPTS.join(' / ')} 脚本)`);
  return { builds, scripts: lines };
}

/** 判定发布物形状所需的事实（全部来自真实文件/真实命令输出，不做推断）。 */
export interface PublishArtifactFacts {
  /** pack 期脚本（prepack / prepare）是否构建 dist —— 干净检出能否打出完整包的静态断言。 */
  packScriptsBuild: boolean;
  /** prepack / prepare 脚本原文（证据行）。 */
  packScriptLines: string[];
  /** npm pack 是否成功（exit 0）。 */
  packOk: boolean;
  /** npm 自身是否输出了日志 —— 区分「npm 真跑了并失败」与「spawn 级失败（工具缺失）」。 */
  packRan: boolean;
  /** npm pack 输出尾部（证据，≤4 行）。 */
  packOutputTail?: string[];
  /** 实测 tarball 清单（归一化后的包内相对路径）。 */
  entries: string[];
  /** 是否从输出里解析出清单段（Tarball Contents）。 */
  listingParsed: boolean;
  /** 实测被 pack 的包名（拿到才做目标身份断言）。 */
  packedName?: string;
}

/**
 * 判定发布物形状（纯函数，无 IO；分支顺序即优先级）：
 *  ① pack 期脚本不构建 dist → **fail**（干净检出会打出缺 dist/cli.js 的坏包，这是本卡的核心价值）；
 *  ② npm pack 非 0 退出：npm 真跑了 → fail（包产不出来）；无 npm 日志（spawn 级失败/工具缺失）→ pending；
 *  ③ 解析不出清单段 → pending（不静默通过）；
 *  ④ 实测被打包的包不是 @vessel/cli → pending（探测错位，不拿别的包的清单冒充判据）；
 *  ⑤ 缺必需文件 / 含违禁文件 → fail；否则 pass。
 */
export function judgePublishArtifact(facts: PublishArtifactFacts): GateVerdict {
  const present = new Set(facts.entries);
  const missing = PUBLISH_ARTIFACT_REQUIRED.filter((f) => !present.has(f));
  const forbidden = facts.entries.filter((f) => PUBLISH_ARTIFACT_FORBIDDEN_RE.test(f));

  const scriptLines = facts.packScriptLines.map((l) => `pack 期脚本: ${l}`);
  const outputLines = (facts.packOutputTail ?? []).map((l) => `npm pack 输出: ${l}`);
  /** 证据行：pack 期脚本 + 判据行（可选 npm 原始输出尾部），至多 10 行。 */
  const evidence = (rows: string[], includeOutput = false): string[] =>
    [...scriptLines, ...rows, ...(includeOutput ? outputLines : [])].slice(0, 10);

  const shapeRows: string[] = [];
  if (facts.listingParsed) {
    shapeRows.push(`实测 tarball 文件数=${facts.entries.length}`);
    if (missing.length > 0) shapeRows.push(`缺: ${missing.join(', ')}`);
    if (forbidden.length > 0) {
      const shown = forbidden.slice(0, 5).join(', ');
      shapeRows.push(`多(违禁): ${shown}${forbidden.length > 5 ? ` … 共 ${forbidden.length} 个` : ''}`);
    }
    if (missing.length === 0 && forbidden.length === 0) {
      shapeRows.push('实测清单：必需文件齐全、零 *.test.* / 零 *.map');
    }
  }

  // ① 干净检出前提（静态、确定性、不依赖"本地恰好已有 dist"）。
  if (!facts.packScriptsBuild) {
    // 实测清单只作对照：本地 dist 存在与否**不参与**本分支判定（这正是"可回归"的要害）。
    const compareRows = facts.listingParsed
      ? ['当前工作区实测仅供对照（本地 dist 恰好存在，不代表干净检出）']
      : ['npm pack 未产出可解析清单，无可对照的实测清单'];
    return {
      status: 'fail',
      evidence: {
        summary:
          'pack 期脚本（prepack / prepare）不构建 dist —— 干净检出（无 dist）下 `npm pack` 会打出缺 ' +
          'dist/cli.js 的坏包，安装后无可用入口',
        detail: evidence(
          [...shapeRows, ...compareRows, '判据：干净检出时包内不会出现 dist/cli.js → 本 gate 必须变红'],
          !facts.packOk,
        ),
      },
    };
  }

  // ② npm pack 未成功。
  if (!facts.packOk) {
    return facts.packRan
      ? {
          status: 'fail',
          evidence: {
            summary: 'npm pack --dry-run 非 0 退出（npm 已执行且失败）—— 发布物无法产出',
            detail: evidence(['npm pack 退出码非 0'], true),
          },
        }
      : {
          status: 'pending',
          pending: true,
          evidence: {
            summary: 'npm pack 不可用（spawn 级失败，无 npm 日志）—— 未判定包内形状',
            detail: evidence(['npm pack 探测失败（未执行）'], true),
          },
          note:
            'packaging gate: 当前环境跑不了 npm pack → 显式 pending，不静默通过；' +
            'pack 期脚本静态断言已独立执行（见 detail）。',
        };
  }

  // ③ 解析不出清单 → 如实 pending（不伪造成 pass/fail）。
  if (!facts.listingParsed) {
    return {
      status: 'pending',
      pending: true,
      evidence: {
        summary: 'npm pack 输出里未找到 Tarball Contents 段（清单不可解析）—— 未判定包内形状',
        detail: evidence(['npm pack 成功但清单段缺失'], true),
      },
      note:
        'packaging gate: npm 输出形态变化导致清单不可解析 → 显式 pending，不静默通过；' +
        'pack 期脚本静态断言已独立执行（见 detail）。',
    };
  }

  // ④ 探测错位：打出来的不是目标包 → 不拿别的包的清单冒充判据。
  if (facts.packedName !== undefined && facts.packedName !== PUBLISH_PACKAGE_NAME) {
    return {
      status: 'pending',
      pending: true,
      evidence: {
        summary: `npm pack 实测被打包的包为 ${facts.packedName}（期望 ${PUBLISH_PACKAGE_NAME}）—— 探测错位，未判定目标包形状`,
        detail: evidence(shapeRows),
      },
      note: `packaging gate: 请确认 pack 作用域（cwd=${PUBLISH_PACKAGE_REL_DIR}）后再判；显式 pending，不静默通过。`,
    };
  }

  // ⑤ 形状：必须含 / 必须不含。
  if (missing.length > 0 || forbidden.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`缺 ${missing.length} 个必需文件（${missing.join(', ')}）`);
    if (forbidden.length > 0) parts.push(`含 ${forbidden.length} 个 *.test.*/*.map 文件（应为 0）`);
    return {
      status: 'fail',
      evidence: { summary: `发布物形状不符：${parts.join('；')}`, detail: evidence(shapeRows) },
    };
  }

  return {
    status: 'pass',
    evidence: {
      summary:
        `发布物形状符合预期（${facts.entries.length} 个文件：含 dist/cli.js 与 4 个 dist/configs/*，` +
        '零 *.test.* / 零 *.map）',
      detail: evidence(shapeRows),
    },
  };
}

/**
 * 发布物形状 executor（方案 A：**并入** Gate 8 `packaging` —— 复用 gate id/position/criterion 位，
 * 不新增门禁 id，故无需改 gates.ts 的 8 门禁注册表与 types.ts 的 GateId 联合）。
 *
 * 离线：`npm pack` 对 directory spec 是纯本地操作（不查 registry），并显式传 `--offline` 把「不联网」
 * 变成机械保证；`--dry-run` 不落 .tgz（libnpmpack/lib/index.js:38 仅在 `dryRun === false` 时写文件），
 * 但会执行 pack 期脚本（prepack 的 copy-configs.mjs 为幂等覆盖式复制，不删除任何文件）。
 * 确定性：判定 ① 不依赖本地 dist 是否存在；判定 ⑤ 以真实 tarball 清单为准；命令行显式传
 * `--no-color`（不受 `color`/`FORCE_COLOR` 影响 → 清单行无 ANSI）与 `--loglevel=notice`
 * （不受 .npmrc/env 的 loglevel 影响 → `npm notice` 行一定输出），避免环境配置改变判据输入。
 */
export function buildPublishArtifactExecutor(): GateExecutor {
  return {
    gate: {
      ...gateDefinition('packaging'),
      name: 'Packaging (build artifacts + publish shape)',
      criterion: PUBLISH_ARTIFACT_CRITERION,
    },
    run: async (ctx: ReleaseContext & { exec: RunCommand }): Promise<GateVerdict> => {
      const packageDir = path.join(ctx.repoRoot, PUBLISH_PACKAGE_REL_DIR);
      const manifestPath = path.join(packageDir, 'package.json');

      let manifest: unknown;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch (err) {
        return {
          status: 'pending',
          pending: true,
          evidence: {
            summary: `无法读取 ${PUBLISH_PACKAGE_REL_DIR}/package.json —— 未判定 pack 期是否构建 dist`,
            detail: [`path=${manifestPath}`, `err=${String(err)}`],
          },
          note: 'packaging gate: 读不到目标包 manifest → 显式 pending，不静默通过。',
        };
      }

      const staticCheck = packScriptsBuildDist(manifest);

      const outcome = await ctx
        .exec('npm', ['pack', '--dry-run', '--offline', '--no-color', '--loglevel=notice'], {
          cwd: packageDir,
          timeoutMs: 120_000,
        })
        .catch((err: unknown) => ({ code: 1, stdout: '', stderr: String(err) }));
      const output = `${outcome.stderr}\n${outcome.stdout}`;
      const listing = parsePackListing(output);

      return judgePublishArtifact({
        packScriptsBuild: staticCheck.builds,
        packScriptLines: staticCheck.scripts,
        packOk: outcome.code === 0,
        packRan: NPM_LOG_LINE_RE.test(output),
        packOutputTail: tailLines(output),
        entries: listing.entries,
        listingParsed: listing.parsed,
        ...(listing.packedName === undefined ? {} : { packedName: listing.packedName }),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// V1.1-G — 安装态冒烟门禁（第 9 道，**可选 / opt-in**）
//
// EVALUATION-REPORT-24 点名的「最大缺口」：「打包 → 安装 → 首跑 → 升级」整条链路只靠人工实测一次。
// 既有 packaging gate 只判**发布物形状**（tarball 清单里有 dist/cli.js 与 4 个 dist/configs/*），
// 判不出「装进一个项目后 CLI 真能跑、并且真的从**包内**读到自己那份 configs」。
// 本段把那次人工实测（N 个 tarball → 全新空项目 `npm i` → 首跑）固化成**确定性、可回归**的判据。
//
// 判别力（为什么不能只断言 `--version` exit 0）：
//   - `--version` / `--help` / `policy status` 的三个出口都不校验配置、恒 exit 0
//     ——「命令跑起来了」与「包内配置读得到」是两件事；
//   - 有判别力的是**读路径**：① `policy status` 报的 system 层路径必须逐字落在
//     `<项目>/node_modules/@vessel/cli/dist/configs/policy.default.yaml`
//     （apps/cli/src/cli.ts:199-215 `builtinConfigRoot()` 的①「包内·模块目录」命中）；
//     ② `usage` 不得打印「未找到内置配置」（apps/cli/src/cli.ts:232-246 的守卫只在
//     `<builtinConfigRoot>/configs/{pricing.json,model-catalog.json}` 缺失时触发）。
//     两条同时成立 ⇒ policy / pricing / model-catalog 确实从**包内 dist/configs** 读到。
//   包坏了时的红灯：prepack 没构建 / files 少带 configs / 自家依赖图不自洽 / 装完无入口
//     —— 上述任一条会红（system 路径落到 ④ 回落分支 = fail；出现缺配置警告 = fail）。
//
// Round 20 —— **升级 / 覆盖安装路径**（同一门禁内追加阶段，不新增第 10 道）：
//   缺口：原实现只覆盖「全新空项目 pack → install → 首跑」，**没覆盖「装过一版再装一版」**——
//   即"升级后还能不能用"与"升级会不会把旧产物留在安装树里"。
//   阶段序列（首装+首跑已 pass 才会进入）：对**同一个项目目录**再 pack 一轮 → `npm install`
//   覆盖安装 → 重跑同样的两条硬判据 + 一条**升级特有**的溯源判据。
//   升级特有判据（形式：**双向溯源**，见 `InstallSmokeUpgradeFacts` 的 version / sha256 字段）：
//     ① 安装树 `node_modules/@vessel/cli/package.json` 的 `version` 必须逐字等于**本轮** pack
//        产出的新版本号（由 `bumpInstallSmokeVersion` 从首装版本确定性 +patch 得到，必然 ≠ 首装版本）；
//     ② 安装树 `dist/cli.js` 的 sha256 必须等于**本轮 pack 源**（stage 目录）里同一文件的 sha256
//        （stage 副本由 `installSmokeUpgradeEntryMarker` 追加一行注释 → 字节确定性地不同于首轮产物，
//         故判据 ② 对「没真正覆盖安装」的旧树同样会红，自带判别力）。
//   为什么可稳定判定：① 读的是 npm 自己解包出来的 manifest（旧产物残留 ⇒ version 仍是旧版 ⇒ 必红）；
//   ② 比的是**字节**（刻意**不用 mtime**：mtime 被解包时间/归档归一化污染，同一份源码两次 pack 的
//   mtime 不可比），两侧输入都由本进程直接读取（不做 tar 解析、不依赖外部工具）。两条合起来把
//   brief 举的两个例子（"不得同时存在两个版本的入口" / "入口内容来自本次安装"）都机械化了。
//   口径与首装**同一套**（不新造）：环境性（离线装不上 / npm 不可用 / 超时 / 输出不可解析 /
//   版本号不可区分）→ pending；包坏了（pack 或 install 非环境性失败 / tarball 数不足 /
//   自家依赖未满足 / 升级后无入口 / CLI 非 0 / 读路径落包外 / 缺配置警告 / 升级后仍是旧版本或
//   入口字节与本次 pack 不符）→ fail。
//
// 永不假失败（pending 的四条通道，全部**不**判 fail）：
//   ① 未启用（默认；零命令零 IO）② npm 不可用（spawn 级失败：**没有** npm 自己的日志行）
//   ③ 超时（按**实测耗时 ≥ 传入 timeoutMs** 判定 —— execFile 的超时被 catch 成 exit 1，
//      错误文案里未必有 "timeout"，不能只靠文本）
//   ④ 环境不具备：离线装不上且原因是网络/缓存/解析（ENOTCACHED / EAI_AGAIN / ENOTFOUND /
//      registry 404 / registry.npmjs.org …）或资源耗尽（ENOMEM / heap out of memory / SIGKILL）
//      ——此时**离线无法区分**「缓存缺第三方依赖」与「依赖真不可达」，也分不清「机器跑不动」。
//   刻意**不做** registry 可达性探测（那要联网，违反本仓「不联网」）：改用 npm 错误文本 + 依赖图反解。
//   反向判别：若离线解析失败的名字命中**本仓 workspace 包名**（来自 root package.json 的 workspaces），
//   那就是「自家 tarball 集合满足不了自家依赖范围」= 真的坏了 → **fail**（不是 pending）。
//
// 不拖慢 / 不拖脆既有 8 道：本门禁是第 9 道，**默认（未设 VESSEL_GATE_INSTALL_SMOKE=1）直接返回 pending**，
// 不执行任何命令与 IO；既有 8 道的注册表（gates.ts 的 GATE_DEFINITIONS / GATE_ORDER）与判据
// **一个字节都不改**（本 id 只加在 types.ts 的 GateId 联合里，不进 §21 注册表 → 既有单测断言不受扰）。
// ---------------------------------------------------------------------------

/** 启用开关（唯一开关）：只有显式等于 `1` 才真跑；其余一切取值 = 默认关闭（pending）。 */
export const INSTALL_SMOKE_ENV_VAR = 'VESSEL_GATE_INSTALL_SMOKE';

/** 入口包（= 发布包；`bin.vessel` → `dist/cli.js`）。 */
export const INSTALL_SMOKE_ROOT_PACKAGE = PUBLISH_PACKAGE_NAME;

/**
 * 安装态 CLI 入口（**项目内相对**路径）。
 * 刻意用相对路径 + `cwd=项目目录`：Windows 上 RunCommand 走 `shell: true`，argv 不做引号转义，
 * 绝对路径里的空白会把命令拆开 —— 相对路径（`node_modules/@vessel/...`）永不带空白。
 */
export const INSTALL_SMOKE_ENTRY_REL = 'node_modules/@vessel/cli/dist/cli.js';

/** 安装态 system 层策略文件（项目内相对路径）——「读路径落在包内」的**唯一**期望值。 */
export const INSTALL_SMOKE_SYSTEM_CONFIG_REL = 'node_modules/@vessel/cli/dist/configs/policy.default.yaml';

/**
 * 入口文件在**包内**的相对路径（tarball 清单口径）。
 * 升级溯源要拿「本轮 pack 源」的入口字节去比安装树的入口字节，故需要这条**包内**路径；
 * 它与 `INSTALL_SMOKE_ENTRY_REL` 指向同一个文件（单测断言二者的拼接恒等，防两处漂移）。
 */
export const INSTALL_SMOKE_PACKED_ENTRY_REL = 'dist/cli.js';

/** 安装态入口包的 manifest（版本溯源用）——与入口同一目录链，避免硬编码漂移。 */
export const INSTALL_SMOKE_PACKAGE_REL = 'node_modules/@vessel/cli/package.json';

/** 升级轮版本号后缀（仅用于**退化分支**：上游版本号不是 `x.y.z` 形态时）。 */
export const INSTALL_SMOKE_UPGRADE_VERSION_FALLBACK = '0.0.1-install-smoke';

/**
 * 由**首装**版本号构造「升级轮」版本号（纯函数、确定性：同一输入必得同一输出）。
 *
 * `0.10.0` → `0.10.1`。为什么是 +patch 的**正式版本**（不带 prerelease 后缀）：
 *  ① 语义上就是一次升级（semver 严格大于原版本）；
 *  ② 依赖范围兼容：闭包内其它包若写 `^0.10.0` / `~0.10.0`，`0.10.1` 仍被满足
 *     （`0.10.1-install-smoke` 这种 prerelease **不会**被 `^0.10.0` 满足 → 反而会触发离线去 registry
 *      找包 → 误判；本仓当前无包依赖 `@vessel/cli`，但判据不该依赖这条脆弱前提）。
 * 退化分支（版本号不是 `x.y.z`）：返回固定的合法 semver `0.0.1-install-smoke`，保证与首装版本不同。
 */
export function bumpInstallSmokeVersion(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version).trim());
  if (m === null) return INSTALL_SMOKE_UPGRADE_VERSION_FALLBACK;
  const patch = Number(m[3] ?? '0') + 1;
  return `${m[1] ?? '0'}.${m[2] ?? '0'}.${patch}`;
}

/**
 * 升级轮**入口文件的字节差异标记**（纯函数：只由版本号决定，稳定可测）。
 *
 * 为什么要它：升级特有的判据② 是「安装树 `dist/cli.js` 的 sha256 == 本轮 pack 源的 sha256」。
 * 若两轮产物**字节完全相同**，这条判据对「没真正覆盖安装」的旧树同样成立 → 判别力归零。
 * 因此升级轮在 stage 副本的入口末尾追加这一行 JS 行注释（**永不影响 CLI 行为**，
 * 且只写 stage 副本、绝不碰仓库里的 `apps/cli/dist/cli.js`），使「本轮产物」在字节层面
 * 确定性地不同于首轮产物 —— 判据②由此获得独立判别力（删除它 ⇒ 见单测注释里标红的用例）。
 */
export function installSmokeUpgradeEntryMarker(version: string): string {
  return `\n// install-smoke upgrade marker: ${version}\n`;
}

/** 「内置配置缺失」警告标记（apps/cli/src/cli.ts:241 逐字文案；只有包内 configs 读不到才打印）。 */
export const MISSING_BUILTIN_CONFIG_MARKER = '未找到内置配置';

/** 第 9 道门禁的 criterion（进 release-report 的 criterion 列）。 */
export const INSTALL_SMOKE_CRITERION =
  '安装态冒烟（install-smoke，**可选**：VESSEL_GATE_INSTALL_SMOKE=1 时执行；**含升级 / 覆盖安装路径**）：' +
  '把入口包的 workspace 运行时依赖闭包逐个 `npm pack --offline` 成 tarball → 在**全新空项目**里' +
  ' `npm install <全部 tarball> --offline --no-audit --no-fund` → 以**安装态**跑 CLI，断言 ' +
  '① `policy status --json` 的 system 层路径逐字等于' +
  ' `<项目>/node_modules/@vessel/cli/dist/configs/policy.default.yaml` 且该文件真实存在；' +
  '② `usage` 不打印「未找到内置配置」（两条同时成立才算首装 pass；`--version`/`--help` 恒 exit 0，**不作判据**）。' +
  '随后对**同一个项目目录**再 pack 一轮（入口包版本号确定性 +patch 成新版本）→ `npm install <新 tarball 集> --offline` ' +
  '**覆盖升级** → 重跑上述两条硬判据，并追加**升级特有溯源判据**：③ 安装树 `@vessel/cli` 的 `package.json` version 逐字等于' +
  '本轮新版本号（仍是旧版本 ⇒ 旧产物残留）；④ 安装树 `dist/cli.js` 的 sha256 逐字等于本轮 pack 源同一文件。' +
  '环境不具备（未启用 / npm 不可用 / 离线装不上（缓存缺第三方依赖或解析不可达）/ 资源耗尽 / 超时 / 输出不可解析 / ' +
  '升级轮新旧版本号不可区分）→ 显式 **pending**；' +
  '包真的坏了（自家 workspace 依赖未被同批 tarball 满足 / tarball 缺文件 / 装完无入口 / CLI 跑不起来 / ' +
  '读路径落到包外 / 出现缺配置警告 / **升级后安装树仍是旧版本或入口字节不是本轮 pack 产物**）→ **fail**；' +
  '两者都不静默通过。';

/** 是否显式启用（默认关闭 → 门禁 pending，不拖慢既有 8 道）。 */
export function installSmokeRequested(env: Record<string, string | undefined>): boolean {
  return env[INSTALL_SMOKE_ENV_VAR] === '1';
}

/** 从 `policy status` 输出取 system 层路径：优先 `--json`（稳定），退回人类输出行。 */
export function parseSystemLayerPath(output: string): string | undefined {
  const text = String(output);
  const braceAt = text.indexOf('{');
  if (braceAt >= 0) {
    try {
      const doc = JSON.parse(text.slice(braceAt)) as { layers?: Array<{ layer?: string; path?: string }> };
      const sys = doc.layers?.find((l) => l.layer === 'system');
      if (typeof sys?.path === 'string' && sys.path.length > 0) return sys.path;
    } catch {
      // 不是 JSON（人类输出）→ 走下面的行解析
    }
  }
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*system\b/.test(line)) continue;
    const m = line.match(/(\S*policy\.default\.yaml)/);
    if (m?.[1] !== undefined) return m[1];
  }
  return undefined;
}

/** system 层路径是否**逐字**落在安装态包内（分隔符归一 + Windows 大小写不敏感）。 */
export function systemPathInInstalledPackage(systemPath: string | undefined, projectDir: string): boolean {
  if (systemPath === undefined || systemPath.trim().length === 0) return false;
  const expected = path.resolve(projectDir, ...INSTALL_SMOKE_SYSTEM_CONFIG_REL.split('/'));
  const norm = (p: string): string => {
    const abs = path.resolve(p);
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  };
  return norm(systemPath) === norm(expected);
}

/** 输出里是否出现「未找到内置配置」警告（包内 configs 读不到的**唯一**可观测信号）。 */
export function hasMissingBuiltinConfigWarn(output: string): boolean {
  return String(output).includes(MISSING_BUILTIN_CONFIG_MARKER);
}

/**
 * npm 是否根本没跑起来（工具缺失 / spawn 级失败）。
 * **必须**先排除 npm 自己的日志行：`npm error ENOENT …` 是 npm 真跑了并失败（→ fail），
 * 而 `'npm' is not recognized …` / 空输出才是工具缺失（→ pending）。
 */
export function isNpmToolMissing(text: string): boolean {
  const t = String(text);
  if (NPM_LOG_LINE_RE.test(t)) return false;
  return (
    t.trim().length === 0 ||
    /ENOENT|not recognized|command not found|不是内部或外部命令|系统找不到指定的文件/i.test(t)
  );
}

/**
 * 「环境不具备」的证据（而不是包坏了）——两类，命中即 pending：
 *  ① **网络 / 缓存 / 解析**（离线）：ENOTCACHED / EAI_AGAIN / ENOTFOUND / registry 404 …
 *     —— 离线环境下**无法证伪**「第三方依赖只是本机缓存里没有」；
 *  ② **资源耗尽**（ENOMEM / heap out of memory / SIGKILL）—— 机器原因，不是发布物缺陷。
 */
export function isEnvironmentBlockedText(text: string): boolean {
  return /ENOTCACHED|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_SOCKET_TIMEOUT|ENETUNREACH|fetch failed|only-if-cached|network is unreachable|registry\.npmjs\.org|E404|404 Not Found|ENOMEM|heap out of memory|SIGKILL/i.test(
    String(text),
  );
}

/** 正则转义（把包名安全地嵌进正则）。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从 npm 安装失败输出里反解「哪些**本仓 workspace 包**没被解析到」。
 *
 * 语义：离线安装时若某个自家包的范围没被同批 tarball 满足，npm 只能去 registry 找它 →
 * 失败文案里出现该包名（`@vessel/llm` 与 URL 编码 `@vessel%2fllm` 两种形态都认）。
 * 命中 ⇒「自家依赖图不自洽」= 真的坏了（fail）；命中不了（纯第三方包）⇒ pending（缓存缺失）。
 */
export function unresolvedWorkspaceDeps(text: string, workspaceNames: readonly string[]): string[] {
  const t = String(text);
  return workspaceNames.filter((name) => {
    const encoded = escapeRegExp(name).replace(/\//g, '(?:/|%2[fF])');
    return [
      `(?:request to \\S*|No matching version found for |404 Not Found - GET \\S*)${encoded}(?![\\w-])`,
      `${encoded}@[^\\s']*' is not in this registry`,
    ].some((form) => new RegExp(form, 'i').test(t));
  });
}

/** 一个 workspace 包（名 + 目录）。 */
export interface WorkspacePackage {
  name: string;
  dir: string;
}

/** 解析 root package.json 的 workspaces → 包名/目录（只认含 `name` 的目录；解析不了则返回 `[]`）。 */
export function resolveWorkspacePackages(repoRoot: string): WorkspacePackage[] {
  let patterns: string[] = [];
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const ws = doc.workspaces;
    patterns = Array.isArray(ws) ? ws : (ws?.packages ?? []);
  } catch {
    return [];
  }
  const out: WorkspacePackage[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.length === 0) continue;
    let dirs: string[] = [];
    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      try {
        dirs = fs
          .readdirSync(path.join(repoRoot, base), { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => path.join(repoRoot, base, d.name));
      } catch {
        dirs = [];
      }
    } else {
      dirs = [path.join(repoRoot, pattern)];
    }
    for (const dir of dirs) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: unknown };
        if (typeof pkg.name === 'string' && pkg.name.length > 0) out.push({ name: pkg.name, dir });
      } catch {
        // 不是包目录 → 跳过
      }
    }
  }
  return out;
}

/**
 * 入口包的**运行时依赖闭包**（只跟 `dependencies`，不跟 devDependencies —— `npm i <tarball>` 时
 * npm 也只装 dependencies）。返回闭包内包目录 + 未解析到的包名（正常情况下只有入口包缺失才会非空）。
 *
 * 为什么取闭包而不是全 workspace：`apps/web` / `benchmarks/runners` 带着 react/vite 等重依赖，
 * 把它们塞进判据只会让结论变成「本机缓存里有没有 react」，与「CLI 装进项目能不能跑」无关。
 */
export function resolveInstallClosure(
  repoRoot: string,
  rootName: string = INSTALL_SMOKE_ROOT_PACKAGE,
): { packages: WorkspacePackage[]; unresolved: string[] } {
  const all = resolveWorkspacePackages(repoRoot);
  const byName = new Map(all.map((p) => [p.name, p]));
  const ordered: WorkspacePackage[] = [];
  const seen = new Set<string>();
  const unresolved: string[] = [];
  const queue: string[] = [rootName];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const pkg = byName.get(name);
    if (pkg === undefined) {
      unresolved.push(name);
      continue;
    }
    ordered.push(pkg);
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(pkg.dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      for (const dep of Object.keys(doc.dependencies ?? {})) if (byName.has(dep)) queue.push(dep);
    } catch {
      // manifest 读不了：由后面的 pack 阶段如实暴露
    }
  }
  return { packages: ordered, unresolved };
}

/**
 * **升级（覆盖安装）阶段**采集到的事实（Round 20）。
 *
 * 与首装阶段同构：字段语义逐条对应 `InstallSmokeFacts` 的同名字段（同一套 pending/fail 口径），
 * 只多出「升级特有」的溯源字段（version / sha256）。executor 只**采集**，判定全在 `judgeInstallSmoke`。
 */
export interface InstallSmokeUpgradeFacts {
  /** 是否真的执行了升级阶段（首装 + 首跑已 pass 才会为 true）。 */
  attempted: boolean;
  /** 升级阶段准备是否成功（读入口包 manifest + 复制 dist 到 stage + 构造新版本号 + stage 副本 pack 成功）。 */
  prepOk: boolean;
  /** 升级轮 npm 是否真的跑起来（false = 工具缺失 / spawn 级失败 → pending）。 */
  npmAvailable: boolean;
  /** 升级轮任一命令按 timeoutMs **实测**超时。 */
  timedOut: boolean;
  /** 升级轮全部 tarball 是否 pack 成功 / 失败是否环境性。 */
  packOk: boolean;
  packBlockedByEnv: boolean;
  /** 升级轮产出的 tarball 数（应等于闭包包数 `facts.expectedPackages`）。 */
  tarballCount: number;
  /** 升级轮 `npm install <新 tarball 集>` 进入**同一项目目录**是否 exit 0。 */
  installOk: boolean;
  installBlockedByEnv: boolean;
  /** 升级轮离线解析失败里命中的**本仓 workspace 包名**（非空 → fail）。 */
  workspaceDepMissing: string[];
  /** 升级后 `<项目>/node_modules/@vessel/cli/dist/cli.js` 是否仍存在。 */
  cliEntryExists: boolean;
  /** 升级后 `policy status --json` 是否 exit 0（硬判据 ① 的退出码部分）。 */
  policyStatusOk: boolean;
  /** 升级后解析出的 system 层路径（原始值）。 */
  systemPath?: string;
  /** 升级后 system 层路径是否仍逐字落在包内。 */
  systemPathInPackage: boolean;
  /** 升级后该包内配置文件是否仍存在。 */
  systemConfigFileExists: boolean;
  /** 升级后 `usage` 是否打印「未找到内置配置」。 */
  usageWarnsMissingConfig: boolean;
  /** 首装版本号（round 1 tarball 内的 version）。 */
  previousVersion: string;
  /** **本轮** pack 出的新版本号（= `bumpInstallSmokeVersion(previousVersion)`）。 */
  upgradedVersion: string;
  /** 升级后安装树 `node_modules/@vessel/cli/package.json` 的 version（读不到 → undefined）。 */
  installedVersion?: string;
  /** 升级后安装树入口 `dist/cli.js` 的 sha256（读不到 → undefined）。 */
  installedEntrySha256?: string;
  /** **本轮 pack 源**（stage 目录）入口 `dist/cli.js` 的 sha256（读不到 → undefined）。 */
  packedEntrySha256?: string;
}

/** 判定安装态冒烟所需的事实（全部来自真实命令输出 / 真实文件，不做推断）。 */
export interface InstallSmokeFacts {
  /** 是否显式启用（`VESSEL_GATE_INSTALL_SMOKE=1`）。 */
  enabled: boolean;
  /** 临时目录路径可用（含空白时 Windows `shell:true` 的 argv 拼接会失真 → pending，不判 fail）。 */
  tempPathUsable: boolean;
  /** npm 是否真的跑起来了（false = 工具缺失 / spawn 级失败）。 */
  npmAvailable: boolean;
  /** 任一命令按 timeoutMs **实测**超时（不看错误文案）。 */
  timedOut: boolean;
  /** workspace 闭包是否解析出来（root package.json 的 workspaces 里有入口包）。 */
  closureResolved: boolean;
  /** 全部 tarball 是否 pack 成功。 */
  packOk: boolean;
  /** pack 失败原因是**环境不具备**（离线 / 网络 / 缓存 / 资源耗尽 → pending 而非 fail）。 */
  packBlockedByEnv: boolean;
  /** 产出的 tarball 数 / 闭包内包数。 */
  tarballCount: number;
  expectedPackages: number;
  /** 空项目 `npm install <tarballs>` 是否 exit 0。 */
  installOk: boolean;
  /** install 失败原因是**环境不具备**（离线 / 网络 / 缓存 / 资源耗尽 → pending）。 */
  installBlockedByEnv: boolean;
  /** 离线解析失败里命中的**本仓 workspace 包名**（非空 = 自家依赖图不自洽 → fail）。 */
  workspaceDepMissing: string[];
  /** 装完 `<项目>/node_modules/@vessel/cli/dist/cli.js` 是否存在。 */
  cliEntryExists: boolean;
  /** `policy status --json` 是否 exit 0。 */
  policyStatusOk: boolean;
  /** 解析出的 system 层路径（原始值，未归一）。 */
  systemPath?: string;
  /** system 层路径是否逐字落在安装态包内。 */
  systemPathInPackage: boolean;
  /** 该包内配置文件是否真实存在。 */
  systemConfigFileExists: boolean;
  /** `usage` 是否打印「未找到内置配置」（= pricing/model-catalog 读路径没命中包内 configs）。 */
  usageWarnsMissingConfig: boolean;
  /** 证据行（命令退出码 / 路径 / 输出尾部）。 */
  detail: string[];
  /** 升级（覆盖安装）阶段的事实；未尝试时为 undefined（= 只判首装，行为同 Round 20 之前）。 */
  upgrade?: InstallSmokeUpgradeFacts;
}

/**
 * 判定安装态冒烟（纯函数，无 IO；分支顺序即优先级）。
 *
 * pending 通道（**环境不具备**，绝不判 fail）：未启用 → 路径不可用 → 闭包解析不出 → npm 不可用 →
 *   超时 → pack 因环境原因失败 → install 因环境原因失败 → system 路径不可解析；
 *   **升级阶段同构**：准备失败 → npm 不可用 → 超时 → 升级轮 pack 环境性失败 → 升级轮 install 环境性失败
 *   → 升级后 system 路径不可解析 → 新旧版本号不可区分（判据输入不成立）。
 * fail 通道（**包真的坏了**）：pack 非环境性失败 → tarball 数不足 → install 非环境性失败 →
 *   自家 workspace 依赖未被满足 → 装完无入口 → `policy status` 非 0 → 读路径落包外 →
 *   包内配置文件不存在 → 出现缺配置警告；
 *   **升级阶段同构** + 两条升级特有：安装树 version 仍是旧版本 → 入口 `dist/cli.js` 字节 != 本轮 pack 源。
 *
 * `facts.upgrade` 为 undefined 时（首装阶段自身就失败/未启用）行为与 Round 20 之前**逐字一致**。
 */
export function judgeInstallSmoke(facts: InstallSmokeFacts): GateVerdict {
  const detail = (...rows: string[]): string[] => [...rows, ...facts.detail].slice(0, 12);
  const pending = (summary: string, note: string, rows: string[]): GateVerdict => ({
    status: 'pending',
    pending: true,
    evidence: { summary, detail: detail(...rows) },
    note,
  });
  const fail = (summary: string, rows: string[]): GateVerdict => ({
    status: 'fail',
    evidence: { summary, detail: detail(...rows) },
  });

  if (!facts.enabled) {
    return pending(
      `安装态冒烟未启用（${INSTALL_SMOKE_ENV_VAR}≠1）—— 未执行 pack / install / 首跑`,
      `install-smoke gate: 默认不跑（避免拖慢既有 8 道门禁）；设 ${INSTALL_SMOKE_ENV_VAR}=1 后重跑，不静默通过。`,
      ['未启用：零命令执行'],
    );
  }
  if (!facts.tempPathUsable) {
    return pending(
      '临时目录路径含空白，Windows `shell:true` 的命令拼接不可靠 —— 未执行冒烟',
      'install-smoke gate: 环境性（路径形态）不可判定 → 显式 pending，不静默通过。',
      [],
    );
  }
  if (!facts.closureResolved) {
    return pending(
      `无法从 root package.json 的 workspaces 解析出入口包 ${INSTALL_SMOKE_ROOT_PACKAGE} —— 未执行冒烟`,
      'install-smoke gate: 仓库布局与判据预期不符 → 显式 pending，不静默通过。',
      [],
    );
  }
  if (!facts.npmAvailable) {
    return pending(
      'npm 不可用（spawn 级失败，无 npm 日志）—— 未判定安装态',
      'install-smoke gate: 当前环境跑不了 npm pack / npm install → 显式 pending，不静默通过。',
      [],
    );
  }
  if (facts.timedOut) {
    return pending(
      '安装态冒烟超时（按实测耗时 ≥ 传入 timeoutMs 判定）—— 未判定安装态',
      'install-smoke gate: 超时属环境性未完成 → 显式 pending（可加大超时或换机器重跑），不静默通过。',
      [],
    );
  }
  if (!facts.packOk) {
    return facts.packBlockedByEnv
      ? pending(
          'npm pack 因环境原因失败（离线 / 网络 / 缓存 / 资源耗尽）—— 环境不具备，未判定安装态',
          'install-smoke gate: 环境不具备（离线缓存或机器资源）→ 显式 pending，不静默通过。',
          [],
        )
      : fail('npm pack 失败（npm 已执行且非环境原因）—— 发布物产不出来', []);
  }
  if (facts.tarballCount < facts.expectedPackages) {
    return fail(
      `pack 声称成功但 tarball 只有 ${facts.tarballCount}/${facts.expectedPackages} 个 —— 至少一个包没产出发布物`,
      [],
    );
  }
  if (!facts.installOk) {
    if (facts.workspaceDepMissing.length > 0) {
      return fail(
        `空项目离线安装失败：自家 workspace 依赖未被同批 tarball 满足（${facts.workspaceDepMissing.join(', ')}）` +
          ' —— 依赖图不自洽，装进任何项目都会失败',
        [],
      );
    }
    return facts.installBlockedByEnv
      ? pending(
          'npm install 因环境原因失败（离线 / 网络 / 解析 / 资源耗尽）—— 环境不具备（缓存缺第三方依赖），未判定安装态',
          'install-smoke gate: 离线无法证伪「依赖只是没缓存」→ 显式 pending，不静默通过。',
          [],
        )
      : fail('空项目安装失败（npm 非 0 退出且非环境原因）—— 装不起来', []);
  }
  if (!facts.cliEntryExists) {
    return fail('安装完成但 node_modules/@vessel/cli/dist/cli.js 不存在 —— 包内无可用入口', []);
  }
  if (!facts.policyStatusOk) {
    return fail('安装态 `policy status` 非 0 退出 —— CLI 装完跑不起来', []);
  }
  if (facts.systemPath === undefined) {
    return pending(
      '`policy status` 输出里解析不出 system 层路径（输出形态变化）—— 未判定读路径',
      'install-smoke gate: 判据输入不可解析 → 显式 pending，不静默通过。',
      [],
    );
  }
  if (!facts.systemPathInPackage) {
    return fail(
      `system 层路径落在**包外**（${facts.systemPath}）—— 包内 configs 没被读到，安装态会走 cwd 兜底路径`,
      [],
    );
  }
  if (!facts.systemConfigFileExists) {
    return fail(`system 层路径指向包内但文件不存在（${INSTALL_SMOKE_SYSTEM_CONFIG_REL}）—— tarball 缺 configs`, []);
  }
  if (facts.usageWarnsMissingConfig) {
    return fail(
      '`usage` 打印「未找到内置配置」—— pricing.json / model-catalog.json 未从包内读到（成本会静默降级成兜底价）',
      [],
    );
  }

  // -------------------------------------------------------------------------
  // 升级 / 覆盖安装阶段（Round 20）——到这里说明首装 + 首跑**全部通过**（否则上面已 return）。
  // 分支顺序刻意与首装阶段**逐条对齐**（pending/fail 划分同一套，不新造）：环境性 → pending，
  // 包坏了 → fail；两条升级特有判据（版本残留 / 入口字节溯源）放在同一序列的末尾。
  // 这里与首装阶段是**镜像**而非抽取：首装分支顺序被既有单测逐条锁死，抽取会改动其判定顺序。
  // -------------------------------------------------------------------------
  const up = facts.upgrade;
  if (up !== undefined && up.attempted) {
    if (!up.prepOk) {
      return pending(
        '升级阶段的「新版本产物」构造不出来（读不到入口包 manifest / 复制 dist 或 pack stage 副本失败）—— 未判定升级态',
        'install-smoke gate: 升级轮的判据输入构造不出来（本门禁自身构造的 stage 副本，非仓库发布物缺陷）→ 显式 pending，不静默通过。',
        [],
      );
    }
    if (!up.npmAvailable) {
      return pending(
        '升级轮 npm 不可用（spawn 级失败，无 npm 日志）—— 未判定升级态',
        'install-smoke gate: 当前环境跑不了升级轮的 npm pack / npm install → 显式 pending，不静默通过。',
        [],
      );
    }
    if (up.timedOut) {
      return pending(
        '升级覆盖安装超时（按实测耗时 ≥ 传入 timeoutMs 判定）—— 未判定升级态',
        'install-smoke gate: 超时属环境性未完成 → 显式 pending（可加大超时或换机器重跑），不静默通过。',
        [],
      );
    }
    if (!up.packOk) {
      return up.packBlockedByEnv
        ? pending(
            '升级轮 npm pack 因环境原因失败（离线 / 网络 / 缓存 / 资源耗尽）—— 环境不具备，未判定升级态',
            'install-smoke gate: 环境不具备（离线缓存或机器资源）→ 显式 pending，不静默通过。',
            [],
          )
        : fail('升级轮 npm pack 失败（npm 已执行且非环境原因）—— 新版本发布物产不出来', []);
    }
    if (up.tarballCount < facts.expectedPackages) {
      return fail(
        `升级轮 pack 声称成功但 tarball 只有 ${up.tarballCount}/${facts.expectedPackages} 个 —— 至少一个包没产出新发布物`,
        [],
      );
    }
    if (!up.installOk) {
      if (up.workspaceDepMissing.length > 0) {
        return fail(
          `覆盖升级失败：自家 workspace 依赖未被同批 tarball 满足（${up.workspaceDepMissing.join(', ')}）` +
            ' —— 依赖图不自洽，升级装不进任何项目',
          [],
        );
      }
      return up.installBlockedByEnv
        ? pending(
            '升级轮 npm install 因环境原因失败（离线 / 网络 / 解析 / 资源耗尽）—— 环境不具备（缓存缺第三方依赖），未判定升级态',
            'install-smoke gate: 离线无法证伪「依赖只是没缓存」→ 显式 pending，不静默通过。',
            [],
          )
        : fail('覆盖升级安装失败（npm 非 0 退出且非环境原因）—— 新版本装不起来', []);
    }
    // 升级特有判据的**前置条件**：新旧版本号必须不同，否则「安装树版本 == 新版本号」这条
    // 判据对旧产物同样成立、判别力归零 → 判据输入不成立，显式 pending（绝不借此静默通过）。
    if (up.previousVersion === up.upgradedVersion) {
      return pending(
        `升级轮版本号与首装版本号相同（${up.upgradedVersion}）—— 无法区分「已升级」与「旧产物残留」，未判定升级态`,
        'install-smoke gate: 升级判据输入不成立（版本号不可区分）→ 显式 pending，不静默通过。',
        [],
      );
    }
    if (!up.cliEntryExists) {
      return fail('升级完成但 node_modules/@vessel/cli/dist/cli.js 不存在 —— 升级后包内无可用入口', []);
    }
    if (!up.policyStatusOk) {
      return fail('升级后 `policy status` 非 0 退出 —— CLI 升级后跑不起来', []);
    }
    if (up.systemPath === undefined) {
      return pending(
        '升级后 `policy status` 输出里解析不出 system 层路径（输出形态变化）—— 未判定升级后的读路径',
        'install-smoke gate: 判据输入不可解析 → 显式 pending，不静默通过。',
        [],
      );
    }
    if (!up.systemPathInPackage) {
      return fail(
        `升级后 system 层路径落在**包外**（${up.systemPath}）—— 升级后包内 configs 没被读到`,
        [],
      );
    }
    if (!up.systemConfigFileExists) {
      return fail(
        `升级后 system 层路径指向包内但文件不存在（${INSTALL_SMOKE_SYSTEM_CONFIG_REL}）—— 新 tarball 缺 configs`,
        [],
      );
    }
    if (up.usageWarnsMissingConfig) {
      return fail(
        '升级后 `usage` 打印「未找到内置配置」—— 升级后 pricing.json / model-catalog.json 不再从包内读到',
        [],
      );
    }
    // 升级特有判据 ①（版本溯源）：安装树必须已经是**本轮**新版本。
    // 旧版本产物残留（npm 判定“已是最新”而跳过重装、或装错树）⇒ 这里读到的是旧版本号 ⇒ fail。
    if (up.installedVersion !== up.upgradedVersion) {
      return fail(
        `升级后安装树仍是旧版本（安装树 version=${up.installedVersion ?? '(读不到)'}，期望 ${up.upgradedVersion}）` +
          ' —— 覆盖安装没生效，旧产物残留在安装树里',
        [`升级溯源：previous=${up.previousVersion} → upgraded=${up.upgradedVersion}`],
      );
    }
    // 升级特有判据 ②（字节溯源）：安装态入口必须与**本轮 pack 源**逐字节相同。
    // 用 sha256 而非 mtime：mtime 会被解包时间 / 归档归一化污染（两次 pack 同一份源码的 mtime 不可比），
    // 而 sha256 两侧输入都由本进程直接读取（同一份 stage/dist/cli.js），是无中间解析的确定性比对。
    // 判别力来源：stage 入口被 installSmokeUpgradeEntryMarker 追加过标记 ⇒ 本轮字节 ≠ 首轮字节 ⇒
    // 若安装树没被真正覆盖（仍是首轮字节），这里必然不等 → fail。
    if (
      up.installedEntrySha256 === undefined ||
      up.packedEntrySha256 === undefined ||
      up.installedEntrySha256 !== up.packedEntrySha256
    ) {
      return fail(
        `升级后 ${INSTALL_SMOKE_PACKED_ENTRY_REL} 与**本轮 pack 产物**不一致` +
          `（安装树 sha256=${up.installedEntrySha256 ?? '(读不到)'}，pack 源 sha256=${up.packedEntrySha256 ?? '(读不到)'}）` +
          ' —— 入口不是本次安装写下的，旧产物/污染仍在',
        [`升级溯源：判据 = 安装树入口字节 == 本轮 pack 源入口字节`],
      );
    }
    return {
      status: 'pass',
      evidence: {
        summary:
          `安装态冒烟通过（${facts.expectedPackages} 个 tarball → 全新空项目离线安装 exit 0 → ` +
          `覆盖升级到 ${up.upgradedVersion} 后仍 exit 0 → system 层路径在包内 + \`usage\` 无缺配置警告 + ` +
          '安装树版本与入口字节均来自本次 pack）',
        detail: detail(
          '判据：读路径落在包内，而不是「命令 exit 0」',
          `升级判据：安装树 version=${up.upgradedVersion}（≠ 首装 ${up.previousVersion}）+ 入口 sha256 与 pack 源一致`,
        ),
      },
    };
  }
  return {
    status: 'pass',
    evidence: {
      summary:
        `安装态冒烟通过（${facts.expectedPackages} 个 tarball → 全新空项目离线安装 exit 0 → ` +
        'system 层路径在包内 + `usage` 无缺配置警告）',
      detail: detail('判据：读路径落在包内，而不是「命令 exit 0」'),
    },
  };
}

/** 一条命令的执行结果（含**实测**超时标志）。 */
interface StepResult {
  outcome: CommandOutcome;
  timedOut: boolean;
}

/**
 * 跑一条命令并判定是否超时。
 * 超时判定以**实测耗时**为准：RunCommand 的约定是「失败一律 code=1」，execFile 超时被 catch 后
 * 错误码不是数字 → 落成 1，与真实 exit 1 无法从 code 区分；文案也未必含 "timeout"。
 */
async function runStep(
  ctx: ReleaseContext & { exec: RunCommand },
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; timeoutMs: number },
): Promise<StepResult> {
  const started = Date.now();
  let outcome: CommandOutcome;
  try {
    outcome = await ctx.exec(command, args, opts);
  } catch (err) {
    outcome = { code: 1, stdout: '', stderr: String(err) };
  }
  const elapsedMs = Date.now() - started;
  const text = `${outcome.stdout}\n${outcome.stderr}`;
  const timedOut = outcome.code !== 0 && (elapsedMs >= opts.timeoutMs || /ETIMEDOUT|timed out|SIGTERM/i.test(text));
  return { outcome, timedOut };
}

/** 安装态冒烟 executor 的可注入参数（超时 / 环境变量口子）。 */
export interface InstallSmokeOptions {
  /** 单次 `npm pack` 超时（默认 300s：首次要跑各包 prepack 构建）。 */
  packTimeoutMs?: number;
  /** `npm install` 超时（默认 600s）。 */
  installTimeoutMs?: number;
  /** 单次 CLI 探测超时（默认 60s）。 */
  cliTimeoutMs?: number;
  /** 读环境变量的口子（默认 `process.env`；测试注入 `{}` 即走「未启用」的零命令分支）。 */
  env?: Record<string, string | undefined>;
}

/**
 * 读安装态入口包 manifest 的 version（读不到 → undefined，由纯判据判 fail，不做「存在即算过」的弱断言）。
 * executor 侧只**采集事实**，判定一律回 `judgeInstallSmoke`。
 */
function readInstalledPackageVersion(projectDir: string): string | undefined {
  try {
    const doc = JSON.parse(
      fs.readFileSync(path.join(projectDir, ...INSTALL_SMOKE_PACKAGE_REL.split('/')), 'utf8'),
    ) as { version?: unknown };
    return typeof doc.version === 'string' && doc.version.length > 0 ? doc.version : undefined;
  } catch {
    return undefined;
  }
}

/** 文件 sha256（读不到 → undefined；判定侧对 undefined 一律 fail，不静默通过）。 */
function sha256File(file: string): string | undefined {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return undefined;
  }
}

/**
 * 安装态冒烟 executor（第 9 道门禁，**可选**）。
 *
 * 真实动作（仅在 `VESSEL_GATE_INSTALL_SMOKE=1` 时）：
 *   阶段 1（首装）：闭包内每个包 `npm pack --offline`（跑真实 prepack 构建，与「干净检出 npm pack」
 *     同语义 → 不落 .tgz 到仓库，全部进临时目录）→ 全新空项目
 *     `npm install <相对路径 tarball…> --offline --no-audit --no-fund`
 *     → 安装态跑 `--version`（仅证据）/ `policy status --json` / `usage`。
 *   阶段 2（升级，Round 20；**仅当阶段 1 判定 pass**）：把入口包的 `dist` 复制到 stage 目录，把
 *     `package.json` 的 version 确定性 +patch（`bumpInstallSmokeVersion`）并给入口追加
 *     `installSmokeUpgradeEntryMarker` 注释（本轮产物在版本与**字节**上都确定性地不同于首轮）
 *     → 对闭包再 pack 一轮
 *     （入口包用 stage 副本 + `--ignore-scripts`：dist 已由阶段 1 的 prepack 构建好，不再重复构建；
 *      其余包与阶段 1 同样跑真实 prepack）→ 对**同一个项目目录** `npm install <新 tarball 集> --offline`
 *     **覆盖升级** → 重跑 `policy status --json` / `usage` 两条硬判据 + 升级特有两项溯源
 *     （安装树 version == 本轮新版本号；安装树 `dist/cli.js` sha256 == 本轮 pack 源同文件）。
 *
 * 隔离：整条链在 `fs.mkdtempSync(os.tmpdir())` 里进行（`finally` 清理）；CLI 探测注入
 * `VESSEL_USAGE_ROOT` / `VESSEL_PROVIDER_ROOT` 指向临时目录，**绝不读写真实 `~/.vessel`**。
 * 不联网：每一处 npm 调用都带 `--offline`。
 */
export function buildInstallSmokeExecutor(opts: InstallSmokeOptions = {}): GateExecutor {
  return {
    gate: {
      id: 'install-smoke',
      name: 'Install Smoke (opt-in, gate 9)',
      criterion: INSTALL_SMOKE_CRITERION,
      position: 9,
    },
    run: async (ctx: ReleaseContext & { exec: RunCommand }): Promise<GateVerdict> => {
      const env = opts.env ?? process.env;
      const facts: InstallSmokeFacts = {
        enabled: installSmokeRequested(env),
        tempPathUsable: true,
        npmAvailable: true,
        timedOut: false,
        closureResolved: false,
        packOk: false,
        packBlockedByEnv: false,
        tarballCount: 0,
        expectedPackages: 0,
        installOk: false,
        installBlockedByEnv: false,
        workspaceDepMissing: [],
        cliEntryExists: false,
        policyStatusOk: false,
        systemPathInPackage: false,
        systemConfigFileExists: false,
        usageWarnsMissingConfig: false,
        detail: [],
      };
      // 默认（未启用）：立即 pending 返回，**零命令、零 IO** —— 这是既有 8 道门禁不被拖慢的关键。
      if (!facts.enabled) return judgeInstallSmoke(facts);

      const packTimeoutMs = opts.packTimeoutMs ?? 300_000;
      const installTimeoutMs = opts.installTimeoutMs ?? 600_000;
      const cliTimeoutMs = opts.cliTimeoutMs ?? 60_000;

      const closure = resolveInstallClosure(ctx.repoRoot);
      facts.expectedPackages = closure.packages.length;
      facts.closureResolved = closure.packages.some((p) => p.name === INSTALL_SMOKE_ROOT_PACKAGE);
      facts.detail.push(`闭包 ${closure.packages.length} 个包：${closure.packages.map((p) => p.name).join(', ') || '(空)'}`);
      if (!facts.closureResolved) return judgeInstallSmoke(facts);

      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-install-smoke-'));
      try {
        // tarballs 必须放在**项目目录内**：install 用 `./tarballs/<f>.tgz` 相对规格（见下），
        // 相对路径的基准是 npm 的 cwd = projectDir。
        const projectDir = path.join(tmpRoot, 'project');
        const tarballsDir = path.join(projectDir, 'tarballs');
        fs.mkdirSync(tarballsDir, { recursive: true });
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(
          path.join(projectDir, 'package.json'),
          JSON.stringify({ name: 'vessel-install-smoke', version: '0.0.0', private: true }, null, 2),
          'utf8',
        );
        if (/\s/.test(tarballsDir)) {
          facts.tempPathUsable = false;
          facts.detail.push(`临时目录含空白：${tarballsDir}`);
          return judgeInstallSmoke(facts);
        }

        // ① 逐个 pack（真实 prepack = 真实构建；--offline 把「不联网」变成机械保证）
        for (const pkg of closure.packages) {
          const step = await runStep(
            ctx,
            'npm',
            ['pack', '--offline', '--no-color', '--pack-destination', tarballsDir],
            { cwd: pkg.dir, timeoutMs: packTimeoutMs },
          );
          const text = `${step.outcome.stdout}\n${step.outcome.stderr}`;
          if (step.timedOut) {
            facts.timedOut = true;
            facts.detail.push(`npm pack ${pkg.name} 超时（>${packTimeoutMs}ms）`);
            return judgeInstallSmoke(facts);
          }
          if (step.outcome.code !== 0) {
            facts.detail.push(`npm pack ${pkg.name} exit=${step.outcome.code}`, ...tailLines(text));
            if (isNpmToolMissing(text)) {
              facts.npmAvailable = false;
              return judgeInstallSmoke(facts);
            }
            facts.packBlockedByEnv = isEnvironmentBlockedText(text);
            return judgeInstallSmoke(facts);
          }
        }
        facts.packOk = true;

        const tarballs = fs.readdirSync(tarballsDir).filter((f) => f.endsWith('.tgz'));
        facts.tarballCount = tarballs.length;
        facts.detail.push(`tarball ${tarballs.length}/${closure.packages.length} 个`);
        if (tarballs.length < closure.packages.length) return judgeInstallSmoke(facts);

        // ② 全新空项目安装（显式离线；tarball 用**项目内相对路径**，不带空白）
        const specs = tarballs.map((f) => `./tarballs/${f}`);
        const install = await runStep(
          ctx,
          'npm',
          ['install', ...specs, '--offline', '--no-audit', '--no-fund', '--no-color'],
          { cwd: projectDir, timeoutMs: installTimeoutMs },
        );
        const installText = `${install.outcome.stdout}\n${install.outcome.stderr}`;
        facts.detail.push(`npm install exit=${install.outcome.code}`);
        if (install.timedOut) {
          facts.timedOut = true;
          return judgeInstallSmoke(facts);
        }
        if (install.outcome.code !== 0) {
          if (isNpmToolMissing(installText)) {
            facts.npmAvailable = false;
            return judgeInstallSmoke(facts);
          }
          facts.installBlockedByEnv = isEnvironmentBlockedText(installText);
          facts.workspaceDepMissing = unresolvedWorkspaceDeps(
            installText,
            closure.packages.map((p) => p.name),
          );
          facts.detail.push(...tailLines(installText));
          return judgeInstallSmoke(facts);
        }
        facts.installOk = true;

        // ③ 安装态首跑：判别力在**读路径**，不在「命令 exit 0」
        const cliEnv: Record<string, string | undefined> = {
          ...process.env,
          VESSEL_USAGE_ROOT: path.join(tmpRoot, 'vessel-usage'),
          VESSEL_PROVIDER_ROOT: path.join(tmpRoot, 'vessel-providers'),
        };
        facts.cliEntryExists = fs.existsSync(path.join(projectDir, ...INSTALL_SMOKE_ENTRY_REL.split('/')));
        if (!facts.cliEntryExists) return judgeInstallSmoke(facts);

        const version = await runStep(ctx, 'node', [INSTALL_SMOKE_ENTRY_REL, '--version'], {
          cwd: projectDir,
          env: cliEnv,
          timeoutMs: cliTimeoutMs,
        });
        facts.timedOut = facts.timedOut || version.timedOut;
        // `--version` **恒 exit 0、零判别力** —— 只作证据，绝不参与判定。
        facts.detail.push(`--version exit=${version.outcome.code}（仅证据，不作判据）`);

        const status = await runStep(ctx, 'node', [INSTALL_SMOKE_ENTRY_REL, 'policy', 'status', '--json'], {
          cwd: projectDir,
          env: cliEnv,
          timeoutMs: cliTimeoutMs,
        });
        facts.timedOut = facts.timedOut || status.timedOut;
        facts.policyStatusOk = status.outcome.code === 0;
        if (!facts.timedOut) {
          const sysPath = parseSystemLayerPath(status.outcome.stdout);
          if (sysPath !== undefined) facts.systemPath = sysPath;
          facts.systemPathInPackage = systemPathInInstalledPackage(sysPath, projectDir);
          facts.systemConfigFileExists = fs.existsSync(
            path.join(projectDir, ...INSTALL_SMOKE_SYSTEM_CONFIG_REL.split('/')),
          );
          facts.detail.push(`policy status exit=${status.outcome.code}；system 层路径=${sysPath ?? '(未解析出)'}`);
        }
        if (facts.timedOut || !facts.policyStatusOk) return judgeInstallSmoke(facts);

        const usage = await runStep(ctx, 'node', [INSTALL_SMOKE_ENTRY_REL, 'usage'], {
          cwd: projectDir,
          env: cliEnv,
          timeoutMs: cliTimeoutMs,
        });
        facts.timedOut = facts.timedOut || usage.timedOut;
        facts.usageWarnsMissingConfig = hasMissingBuiltinConfigWarn(
          `${usage.outcome.stdout}\n${usage.outcome.stderr}`,
        );
        facts.detail.push(`usage exit=${usage.outcome.code}；缺配置警告=${String(facts.usageWarnsMissingConfig)}`);

        // ------------------------------------------------------------------
        // 阶段 2（Round 20）：升级 / 覆盖安装 —— 对**同一个项目目录**装一版新产物。
        // 只有首装 + 首跑**全部通过**才做升级（否则升级只会把同一个坏包问题再报一遍）。
        // ------------------------------------------------------------------
        const firstInstall = judgeInstallSmoke(facts);
        if (firstInstall.status !== 'pass') return firstInstall;

        const up: InstallSmokeUpgradeFacts = {
          attempted: true,
          prepOk: false,
          npmAvailable: true,
          timedOut: false,
          packOk: false,
          packBlockedByEnv: false,
          tarballCount: 0,
          installOk: false,
          installBlockedByEnv: false,
          workspaceDepMissing: [],
          cliEntryExists: false,
          policyStatusOk: false,
          systemPathInPackage: false,
          systemConfigFileExists: false,
          usageWarnsMissingConfig: false,
          previousVersion: '',
          upgradedVersion: '',
        };
        facts.upgrade = up;
        facts.detail.push('升级阶段：同项目覆盖安装新版本产物（再 pack → 再 install → 重跑判据 + 溯源）');

        // 升级轮入口包：把**阶段 1 的 prepack 已构建好**的 dist 复制进 stage，只把 package.json 的
        // version 确定性 +patch（`bumpInstallSmokeVersion`）→ 这就是「新版本产物」；pack 时用
        // `--ignore-scripts` 跳过 prepack（stage 里没有 tsconfig/源码树，且 dist 已就绪，不重复构建）。
        const rootPkg = closure.packages.find((p) => p.name === INSTALL_SMOKE_ROOT_PACKAGE);
        const upgradeTarballsDir = path.join(projectDir, 'tarballs-upgrade');
        const stageDir = path.join(tmpRoot, 'stage', 'cli');
        try {
          if (rootPkg === undefined) throw new Error(`闭包内缺少入口包 ${INSTALL_SMOKE_ROOT_PACKAGE}`);
          const rootManifest = JSON.parse(
            fs.readFileSync(path.join(rootPkg.dir, 'package.json'), 'utf8'),
          ) as Record<string, unknown>;
          up.previousVersion = typeof rootManifest.version === 'string' ? rootManifest.version : '';
          up.upgradedVersion = bumpInstallSmokeVersion(up.previousVersion);
          fs.mkdirSync(stageDir, { recursive: true });
          fs.mkdirSync(upgradeTarballsDir, { recursive: true });
          fs.cpSync(path.join(rootPkg.dir, 'dist'), path.join(stageDir, 'dist'), { recursive: true });
          fs.writeFileSync(
            path.join(stageDir, 'package.json'),
            JSON.stringify({ ...rootManifest, version: up.upgradedVersion }, null, 2),
            'utf8',
          );
          // 让本轮产物在**字节层面**也确定性地不同于首轮（见 installSmokeUpgradeEntryMarker）：
          // 追加的是一行 JS 注释，只落在 stage 副本上，仓库里的 dist 一个字节都不动。
          fs.appendFileSync(
            path.join(stageDir, ...INSTALL_SMOKE_PACKED_ENTRY_REL.split('/')),
            installSmokeUpgradeEntryMarker(up.upgradedVersion),
            'utf8',
          );
          facts.detail.push(`升级溯源：${INSTALL_SMOKE_ROOT_PACKAGE} ${up.previousVersion} → ${up.upgradedVersion}`);
          up.prepOk = true;
        } catch (err) {
          facts.detail.push(`升级阶段准备失败：${String(err)}`);
          return judgeInstallSmoke(facts);
        }

        // ① 再 pack 一轮（入口包用 stage 副本；其余包与阶段 1 同样跑真实 prepack 构建）
        for (const pkg of closure.packages) {
          const isRoot = pkg.name === INSTALL_SMOKE_ROOT_PACKAGE;
          const args = ['pack', '--offline', '--no-color', '--pack-destination', upgradeTarballsDir];
          if (isRoot) args.push('--ignore-scripts');
          const step = await runStep(ctx, 'npm', args, {
            cwd: isRoot ? stageDir : pkg.dir,
            timeoutMs: packTimeoutMs,
          });
          const text = `${step.outcome.stdout}\n${step.outcome.stderr}`;
          if (step.timedOut) {
            up.timedOut = true;
            facts.detail.push(`升级轮 npm pack ${pkg.name} 超时（>${packTimeoutMs}ms）`);
            return judgeInstallSmoke(facts);
          }
          if (step.outcome.code !== 0) {
            facts.detail.push(`升级轮 npm pack ${pkg.name} exit=${step.outcome.code}`, ...tailLines(text));
            if (isNpmToolMissing(text)) {
              up.npmAvailable = false;
              return judgeInstallSmoke(facts);
            }
            if (isRoot) {
              // 入口包的 stage 副本是**本门禁自己构造**的（不是仓库里的可发布物）：它 pack 不出来属于
              // 「判据输入构造不出来」，而不是「发布物坏了」（阶段 1 已经成功 pack 过同一个包）
              // → 走 prepOk=false 的 pending 通道，绝不把本门禁自身的构造失败算成包坏了。
              up.prepOk = false;
              return judgeInstallSmoke(facts);
            }
            up.packBlockedByEnv = isEnvironmentBlockedText(text);
            return judgeInstallSmoke(facts);
          }
        }
        up.packOk = true;

        const upgradeTarballs = fs.readdirSync(upgradeTarballsDir).filter((f) => f.endsWith('.tgz'));
        up.tarballCount = upgradeTarballs.length;
        facts.detail.push(`升级轮 tarball ${upgradeTarballs.length}/${closure.packages.length} 个`);
        if (upgradeTarballs.length < closure.packages.length) return judgeInstallSmoke(facts);

        // ② 覆盖升级：同一个项目目录、同一份 package.json（npm 会把 file: 依赖换成新 tarball）
        const upgradeSpecs = upgradeTarballs.map((f) => `./tarballs-upgrade/${f}`);
        const upgradeInstall = await runStep(
          ctx,
          'npm',
          ['install', ...upgradeSpecs, '--offline', '--no-audit', '--no-fund', '--no-color'],
          { cwd: projectDir, timeoutMs: installTimeoutMs },
        );
        const upgradeText = `${upgradeInstall.outcome.stdout}\n${upgradeInstall.outcome.stderr}`;
        facts.detail.push(`升级 npm install exit=${upgradeInstall.outcome.code}`);
        if (upgradeInstall.timedOut) {
          up.timedOut = true;
          return judgeInstallSmoke(facts);
        }
        if (upgradeInstall.outcome.code !== 0) {
          if (isNpmToolMissing(upgradeText)) {
            up.npmAvailable = false;
            return judgeInstallSmoke(facts);
          }
          up.installBlockedByEnv = isEnvironmentBlockedText(upgradeText);
          up.workspaceDepMissing = unresolvedWorkspaceDeps(
            upgradeText,
            closure.packages.map((p) => p.name),
          );
          facts.detail.push(...tailLines(upgradeText));
          return judgeInstallSmoke(facts);
        }
        up.installOk = true;

        // ③ 升级后**重跑同样两条硬判据**（读路径在包内 / 无缺配置警告）
        up.cliEntryExists = fs.existsSync(path.join(projectDir, ...INSTALL_SMOKE_ENTRY_REL.split('/')));
        if (!up.cliEntryExists) return judgeInstallSmoke(facts);

        const upgradeStatus = await runStep(
          ctx,
          'node',
          [INSTALL_SMOKE_ENTRY_REL, 'policy', 'status', '--json'],
          { cwd: projectDir, env: cliEnv, timeoutMs: cliTimeoutMs },
        );
        up.timedOut = up.timedOut || upgradeStatus.timedOut;
        up.policyStatusOk = upgradeStatus.outcome.code === 0;
        if (!up.timedOut) {
          const upgradedSysPath = parseSystemLayerPath(upgradeStatus.outcome.stdout);
          if (upgradedSysPath !== undefined) up.systemPath = upgradedSysPath;
          up.systemPathInPackage = systemPathInInstalledPackage(upgradedSysPath, projectDir);
          up.systemConfigFileExists = fs.existsSync(
            path.join(projectDir, ...INSTALL_SMOKE_SYSTEM_CONFIG_REL.split('/')),
          );
          facts.detail.push(
            `升级后 policy status exit=${upgradeStatus.outcome.code}；system 层路径=${upgradedSysPath ?? '(未解析出)'}`,
          );
        }
        if (up.timedOut || !up.policyStatusOk) return judgeInstallSmoke(facts);

        const upgradeUsage = await runStep(ctx, 'node', [INSTALL_SMOKE_ENTRY_REL, 'usage'], {
          cwd: projectDir,
          env: cliEnv,
          timeoutMs: cliTimeoutMs,
        });
        up.timedOut = up.timedOut || upgradeUsage.timedOut;
        up.usageWarnsMissingConfig = hasMissingBuiltinConfigWarn(
          `${upgradeUsage.outcome.stdout}\n${upgradeUsage.outcome.stderr}`,
        );

        // ④ 升级特有溯源：安装树版本 + 入口字节 vs **本轮 pack 源**（executor 只采集，判定在纯函数里）
        up.installedVersion = readInstalledPackageVersion(projectDir);
        up.installedEntrySha256 = sha256File(
          path.join(projectDir, ...INSTALL_SMOKE_ENTRY_REL.split('/')),
        );
        up.packedEntrySha256 = sha256File(
          path.join(stageDir, ...INSTALL_SMOKE_PACKED_ENTRY_REL.split('/')),
        );
        facts.detail.push(`升级后 usage exit=${upgradeUsage.outcome.code}；缺配置警告=${String(up.usageWarnsMissingConfig)}`);
        facts.detail.push(
          `升级溯源：安装树 version=${up.installedVersion ?? '(读不到)'}（期望 ${up.upgradedVersion}）；` +
            `入口 sha256 安装树=${up.installedEntrySha256 ?? '(读不到)'} pack 源=${up.packedEntrySha256 ?? '(读不到)'}`,
        );
        return judgeInstallSmoke(facts);
      } finally {
        try {
          fs.rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
          // 清理失败不影响判定（临时目录由 OS 回收）
        }
      }
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
export interface UnitFailureFacts {
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

/**
 * 归一化 evidence 里的测试文件路径：去首尾空白、反斜杠 → 正斜杠、去 `./` 前缀。
 * 收集（`collectTestFilePaths`）与判定（`isProcessTreeTestFile`）共用同一套规则，避免两处漂移。
 */
export function normalizeTestFilePath(raw: string): string {
  return String(raw).trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

/** 收集一段文本里出现的 `*.test.ts(x)` 路径（去重，路径按 normalizeTestFilePath 归一）。 */
function collectTestFilePaths(text: string, into: string[]): void {
  for (const m of text.matchAll(TEST_FILE_PATH_RE)) {
    const p = normalizeTestFilePath(m[0]);
    if (!into.includes(p)) into.push(p);
  }
}

/**
 * 从 unit gate 的 evidence 提取失败事实（无副作用、不猜测、不做归因）。
 * 导出以便单测（Round 14 加固点 ③）——调用点行为不变。
 */
export function extractUnitFailureFacts(gate: ReleaseGateResult): UnitFailureFacts {
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

/**
 * 既有注解里提到的那个 flaky 文件（task 072）。导出以便单测（不改任何 gate 判定）。
 */
export const PROCESS_TREE_TEST_FILE = 'packages/runtime/src/sandbox/backend/process-tree.test.ts';

/**
 * 判定某个 evidence 路径是否**就是** process-tree.test.ts 本身（Round 14 加固点 ①）。
 *
 * 旧实现用 `path.endsWith('process-tree.test.ts')`，于是 `foo-process-tree.test.ts`、
 * `other/process-tree.test.ts` 这类**同后缀 / 同 basename 的其它文件**也会命中，而分支 A 的
 * 注记文案里**硬编码**了 process-tree 的路径 → 把「别人的失败」写成「process-tree 计时 flaky」。
 *
 * 现规则（选定：**归一化后按仓库相对路径全等**；明确**不采用** basename 全等）：
 *  - 分隔符归一 + 去 `./` 后与 `PROCESS_TREE_TEST_FILE` 全等；或
 *  - 绝对路径以 `` `/${PROCESS_TREE_TEST_FILE}` `` 结尾（vitest 打印绝对路径时的等价形式）。
 * 两条都要求**整条目录链**一致，故 `foo-process-tree.test.ts` 与 `other/process-tree.test.ts`
 * 一律不得命中（这就是本次加固的核心判别点）。
 */
export function isProcessTreeTestFile(file: string): boolean {
  const normalized = normalizeTestFilePath(file);
  return (
    normalized === PROCESS_TREE_TEST_FILE || normalized.endsWith(`/${PROCESS_TREE_TEST_FILE}`)
  );
}

/**
 * 由 evidence 推导 unit gate 的 note（**不改变任何 gate 的 status/判据**）：
 *  - 分支 A：vitest 汇总行 `Test Files  1 failed` **且**失败行只命中 process-tree.test.ts
 *            → 写既有「process-tree 计时 flaky」注解，但只给**条件式**归因（Round 14 加固点 ②）：
 *              单跑通过 → 按项目惯例视为环境性 flaky；单跑同样失败 → 即为真实回归，必须修复。
 *              旧文案把「非 V1.1-E 回归 / 11-11」当**既定事实**断言 —— 那是历史记录，不是本次证据。
 *  - 分支 B：其它/混合失败（含只拿到统计行、或失败文件非 process-tree 的情况）
 *            → 如实列出可提取的 stats / 失败文件，并明确「未自动归因」；
 *  - 分支 C：连失败文件与统计都提取不到 → 只说「未自动归因，见 evidence.detail」。
 *  三种分支都**绝不**出现「唯一失败为 X」这类未经验证的断言。
 *
 * 导出以便单测（Round 14 加固点 ③）——调用点行为不变。
 */
export function deriveUnitFailureNote(gate: ReleaseGateResult): string {
  const facts = extractUnitFailureFacts(gate);
  const [onlyFailedFile] = facts.failedTestFiles;
  const stats = facts.statLines.join('；');

  const onlyProcessTree =
    facts.failedFileCount === 1 &&
    facts.failedTestFiles.length === 1 &&
    onlyFailedFile !== undefined &&
    isProcessTreeTestFile(onlyFailedFile);

  if (onlyProcessTree) {
    const stat = facts.statLines[0] ?? 'Test Files 1 failed';
    return (
      `本门禁证据指向 ${PROCESS_TREE_TEST_FILE}（task 072 记录的计时敏感用例）：` +
      `vitest 汇总行「${stat}」+ 失败行只命中该文件（受命令输出尾部截取限制，可能不全）。` +
      '该文件的历史记录（历史事实，非本次证据）：整机并行高负载下 30s 超时，隔离单跑 11/11 通过。' +
      '据此按条件判定：若该文件除本门禁外单跑通过，则按项目惯例视为环境性 flaky；' +
      '若单跑同样失败，即为真实回归，必须修复——不得据此忽略回归。'
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

/**
 * 把证据推导出的注记写到 unit gate 的 `note` 上（**只补注，绝不触碰 status/判据**）。
 *
 * 只有 `status === 'fail'` **且** `id === 'unit'` 才写；其余 gate（含 `pass` 的 unit）原样返回、
 * 不产生任何 note。既有 note 保留并在其后追加（084 惯例，同 main() 里的调用点）。
 * 导出以便单测（Round 14 加固点 ③）；判据与调用点行为等价抽取，未改动任何语义。
 */
export function annotateUnitFailureNote(gate: ReleaseGateResult): void {
  if (gate.status !== 'fail' || gate.id !== 'unit') return;
  const derived = deriveUnitFailureNote(gate);
  gate.note = gate.note ? `${gate.note} ${derived}` : derived;
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
  // 覆盖 deterministic-bench → 全 L1 可跑集（含 V1.1-D B024-B027）；
  // 覆盖 packaging → 判「发布物形状」（EVALUATION-REPORT-24 P2：原实现只查本地 dist 是否存在）。
  const executors = base.map((e) => {
    if (e.gate.id === 'deterministic-bench') return buildDeterministicBenchExecutor();
    if (e.gate.id === 'packaging') return buildPublishArtifactExecutor();
    return e;
  });
  // V1.1-G（EVALUATION-REPORT-24「最大缺口」）：第 9 道「安装态冒烟」——**默认 pending**，
  // 仅 `VESSEL_GATE_INSTALL_SMOKE=1` 时才真跑（pack → install → 首跑）。未启用时 executor
  // 立即返回、零命令零 IO，故既有 8 道门禁既不变慢也不变脆；报告里仍如实列出该行（不静默通过）。
  executors.push(buildInstallSmokeExecutor());

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
  // Round 14：分支 A 文案改为**条件式**（单跑通过才算 flaky；单跑同样失败即真实回归）；写入逻辑抽成
  // annotateUnitFailureNote（行为等价）以便 run-release-gates.note.test.ts 单测。
  for (const g of report.gates) {
    annotateUnitFailureNote(g);
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

/**
 * ESM entry 判定（Round 14 加固点 ⑤，与 `apps/cli/src/cli.ts` 同惯例）。
 *
 * 此前 `main()` **无条件**在模块顶层执行 —— 该模块因此无法被单测导入：一 `import` 就真跑
 * 8 道门禁（含递归 vitest / 真网络 / 凭据读取），这正是 `deriveUnitFailureNote` 长期零单测
 * （见 EVALUATION-REPORT-18 覆盖缺口）的直接障碍。
 *
 * 判定：进程入口路径 == 本文件路径 才算「被当脚本直接执行」。
 *  - `npx tsx benchmarks/runners/src/run-release-gates.ts` → argv[1] 即本文件 → **行为完全不变**；
 *  - 被 vitest / 其它模块 import 时 argv[1] 是测试运行器 → 不执行 main()（无副作用）。
 * fail-safe：拿不到入口路径、或比较抛错时一律按「直接执行」处理，保持旧行为，绝不静默不跑门禁。
 */
function shouldRunAsScript(): boolean {
  const invoked = process.argv[1];
  if (typeof invoked !== 'string' || invoked.length === 0) return true;
  const normalize = (p: string): string => {
    const abs = path.resolve(p);
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  };
  try {
    return normalize(invoked) === normalize(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
}

if (shouldRunAsScript()) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[V1.1-E] release-gates run failed:', err);
    process.exitCode = 1;
  });
}