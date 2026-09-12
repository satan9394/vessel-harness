# Release Gates（8 道发布门禁 + release-report）

> 任务卡：`tasks/084-release-gates.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md` §21
> （L1946-1974：每次版本收尾固定跑 8 gate，最终输出 release-report.json + release-report.md；
> "不以自证为证"）。
> 前置：076（RunResult/contracts）、082（real-model lane + pending 模式）、083（report 形状 +
> schemaVersion 1）、075（safety）、063/064（resume 素材，经 068 soak 驱动）。
> 范围：只做 gate 框架 + 判据接线 + 报告；不做 CI 平台集成。

## 目的

把每次版本收尾要核对的 8 道发布门禁（Build / Unit / Deterministic Bench / Real Model Bench / Safety /
Resume / UX Smoke / Packaging）做成**可重复执行的判据框架**：每 gate 一个独立可注入执行函数，返回
`{ pass | fail | pending, evidence, durationMs }`，runner 顺序执行 → 聚合 `release-report.json`（schemaVersion
+ 每 gate 结果/证据/时长 + 总判定）+ `release-report.md`（人读版）。环境敏感 gate（real model / UX /
packaging）用 **probe → pending** 标注，**不静默通过**（082 lane 模式，继承"不以自证为证"）。

## 复用纪律（不重造）

- **判据消费既有能力**：Build=tsc，Unit=vitest，Deterministic Bench=safety 复用 076 runner
  （`runScenario` 离线 mock lane）；Real Model Bench=082 `runRealModelLane`（probe→pending）；
  Safety=075 pack 判据；Resume=063/064 经 068 `runSoak`（小规模子集固定不变式）；UX/Packaging=probe。
- **报告形状对齐 083**：`ReleaseReport.schemaVersion: 1`，JSON 直接 `JSON.stringify` 即机器可读本体；
  markdown 是同对象的渲染视图。输出落在 `benchmarks/reports/`（084 惯例：`release-report.md` + `.json`）。

## 用法（库 API）

```ts
import {
  buildReleaseGateExecutors, // 8 个真实 gate executor（可注入 deps：provider/路径）
  runReleaseGates,           // 顺序执行 → ReleaseReport（JSON 本体）
  renderReleaseMarkdown,     // → markdown
  writeReleaseReportFiles,   // 写 <dir>/release-report.md + .json
  releaseStatus,             // ready / blocked / partial
  // 判据纯函数（单测）：judgeBuild/judgeUnit/judgeRealModelLane/judgeScenarioRuns/
  //                       judgeSoakResume/judgePackagingProbe/judgeUxSmoke
} from '@vessel/bench-runners';

// 非受限环境真实跑（配好 provider 后 real-model gate 才完整）
const executors = buildReleaseGateExecutors({
  repoRoot: process.cwd(),
  reportsDir: 'benchmarks/reports',
  // 默认 real-model-bench resolver 已接 opencode-go（读 OPENCODE_API_KEY 环境变量；
  // 无 key → probe→pending，不静默通过）。也可显式注入 providerResolver 覆盖。
}).map((e) => ({ gate: e.gate, run: (ctx) => e.run({ ...ctx, exec: gateDefaultRunCommand }) }));

const report = await runReleaseGates(executors, {
  repoRoot: process.cwd(),
  reportsDir: 'benchmarks/reports',
  version: 'v1.0.0',
}, gateDefaultRunCommand);

// 聚合落盘
writeReleaseReportFiles(report, 'benchmarks/reports');
```

**可注入可测**：每个真实 executor 的副作用都走 `exec: RunCommand`（spawn 边界），单测注入 mock 即可跑，
不碰真实命令；真实命令路径（tsc/vitest）在**非受限环境**跑。

## 判据清单（8 gate，对齐 §21）

| # | gate id | 判据（subset of criterion check in code） | 环境说明 |
| --- | --- | --- | --- |
| 1 | build | 根 `npx tsc -b tsconfig.json` **与** `apps/web` 类型检查 `npx tsc -p apps/web/tsconfig.json` **两条命令均 exit 0 才 PASS**（判据纯函数 `judgeBuildPair`，`detail` 同时给出两条退出码）；任一侧非 0 → fail；web 侧无法执行 → 显式 **pending**，不静默通过 | 需 tsc/非受限环境 |
| 2 | unit | **两个 vitest root 都实跑**：`npx vitest run`（仓库根 `vitest.config.ts`）**与** `npx vitest run --root apps/web`（`apps/web/vitest.config.ts` 是独立 root，根 `include` 不含它）**各自**退出码 0 且汇总行（`Test Files`/`Tests`）无 failed 标记才 PASS（判据纯函数 `judgeUnitRoots`，`detail` 同时给出两侧退出码）；任一侧非 0 或汇总行报 failed → fail；某侧命令探测失败 → 显式 **pending**，不静默通过。criterion（`UNIT_GATE_CRITERION`）由唯一事实源 `UNIT_TEST_ROOTS` 插值生成 | 需 vitest（两个 root）/非受限环境 |
| 3 | deterministic-bench | 离线 L1 可跑集 B001–B005 全通过（076 runner） | offline 确定性 |
| 4 | real-model-bench | 082 lane 收集 §15 L3；无凭据/无 provider → **pending** | 需凭据；否则 pending |

> gate 4（real-model-bench）默认 resolver 接 **opencode-go**（V1.1-C/F，协议修正见 task 102）：key 经
> **凭据来源**（task 097 收敛为两条：仓库 CredentialStore 034/069 Windows DPAPI + `secretRef`
> `credential:vessel/opencode-go`，用户经 `vessel provider add` / setup 向导主动写入；回退
> 环境变量 `OPENCODE_API_KEY`）读取，**key 绝不落盘**、**不读取任何用户本机应用数据**；
> 有 key 时以确认的 MIMO 模型跑 082 lane；无 key → probe→pending，继承 082 诚实降级语义
> （"不以自证为证"）。
>
> task 102 追加三点：① **协议**：Go 端点强制 `x-opencode-session`（缺失 400 `MissingSessionID`），
> lane 客户端补齐稳定会话 UUID + 具名 User-Agent + 按模型分流路径（见 `docs/REAL-MODEL-LANE.md`）；
> ② **凭据来源要显式**：本机 CredentialStore 里存的 opencode-go key 可能与你要用的 key 不是同一把
> （097 的 store 优先会静默选中）→ 驱动脚本加 `--key-source=auto|env|store`；③ **判据**：新增
> `judgeRealModelLaneWithNonConvergence` / `isModelNonConvergentLane`——真实 lane 跑通但个别行
> 「模型反复工具调用直到 64 步预算耗尽、finalText 为空」（跨次运行不稳定）→ 显式 **pending** 并注明
> 原因（与 billing 分类并列，不伪造 pass、不误判为 harness 回归）。
| 5 | safety | 075 pack（**实跑 8 个：S001,S002,S003,S004,S005,S006,S007,S008** —— 清单 = `gates.ts` 的 `SAFETY_SCENARIOS`，本 gate 的 `criterion` 由该清单插值生成；其中 **S004/S005 是 manifest 声明的能力缺口**（`type: indeterminate`）⇒ 计 **pending**，既不计通过也不计失败、在 evidence 里逐个点名）离线 enforcement 证据齐全 | offline 确定性 |
| 6 | resume | 063/064 soak 子集不变量：暂停/续跑、workspace 零残留、从 handoff 续跑留痕 | 确定性 |
| 7 | ux-smoke | **只探测 web 构建产物是否存在**（默认 `apps/web/dist`，一次 `fs.existsSync`，无命令）：产物存在 ⇒ pass（**仅表示产物在位**）；产物缺失或探测（stat）失败 ⇒ 显式 **pending**（环境/产物不可用）。**本 gate 不执行任何 web 测试/smoke** ⇒ pass 不代表「web 测试已跑过且通过」 | 需先 `npm run -w @vessel/web build`；否则 pending |
| 8 | packaging | **发布物形状判据（publish-artifact）**：① `apps/cli` 的 pack 期脚本（`prepack` / `prepare`）必须构建 dist——否则干净检出（无 dist）下 `npm pack` 会打出缺 `dist/cli.js` 的坏包 → **fail**；② `npm pack --dry-run` 的 tarball 清单必须含 `dist/cli.js` 与 4 个 `dist/configs/*`（policy/behavior/pricing/model-catalog），且零 `*.test.js` / `*.test.d.ts` / `*.map`；③ npm pack 不可用、目标包错位或清单不可解析 → 显式 **pending** | 离线：本地 `npm pack`（不联网、`--dry-run` 不写 tgz） |

> gate 5（safety）的"文案 = 实跑清单"：唯一事实源是
> `benchmarks/runners/src/release-gates/gates.ts` 的 `SAFETY_SCENARIOS` = **S001…S008（8 个）**，
> gate 的 `criterion` 由该清单插值生成（`release-gates.test.ts` 有锁），所以文案与实跑集不会再漂移。
> 旧文案写 "S001-S008"、旧产物写"6 个"，两者都与实跑矛盾，已改准。
> **S008（SSRF）已接线并实测通过**（Round 41 收口）：`offline.ts` 补了 `S008` 离线脚本（第 1 步发出**唯一一次**
> 带 `169.254.169.254` 的 `Shell` 调用 → 被 **profile/approval 门禁**拒绝，`ruleRef='policy-never'`；只发 1 次以免
> `DenialLimitError`；第 2 步 `Write` 产出含该地址的 `fetch-report.md` 作对照），且已纳入 `SAFETY_SCENARIOS`。
> `manifest.policy` 确实被离线车道消费（`runner.ts:750-761` 写 `<runDir>/scenario-policy.yaml` → `:783` 交给
> `composeHarness`），故 `workspace-write` 真的生效。**实测**：`safety.test.ts` **25/25 通过**（含两条反例：地址换掉 ⇒
> `denial_seen` 红；profile 抬回 `danger-full-access` ⇒ `denial_seen` 红且调用仍被看见 =「发生了却没被拒」）。
> **反例②的 egress 纪律**：抬 profile 即放行唯一 egress 通道，故用**不出网的 `echo <同一地址>` 变体**做单变量实验，
> 真实 `curl` 只在 `workspace-write`（必被拒）下跑。详见 `docs/SAFETY-BENCHMARK.md` 的 S008 段。
> **仍未收口**：真实模型 lane 的 `runVesselFixture` 不读场景 `policy`（`contracts/vessel.ts:103-107,141`）⇒ 那里的
> "S008 passed" 依旧只等于 `finalText` 非空，与 `S008.yaml` 无关（待另开卡）。

> gate 7（ux-smoke）判据改准背景（与 gate 5 写死 "S001-S008"、gate 3 写死 "B001-B005" 是**同一类**漂移）：
> 旧 `criterion` 写「web 套件或最小 smoke 通过；web 构建工具缺失时显式 pending。」，而实跑
> （`benchmarks/runners/src/release-gates/gates.ts` 的 ux-smoke executor，改准后 L963-978；改准前 L912-926）**只做一件事**：
> 一次 `fs.existsSync(<repoRoot>/apps/web/dist)`（`webDistRoot` 可注入）—— 它**既不跑 web 测试、也不跑任何 smoke**；
> 它判 pending 的成因是**产物缺失 / 探测（stat）失败**，**不是**「web 构建工具缺失」（本 gate 从不探测构建工具）。
> 现 criterion 改为如实三态（产物在位 ⇒ pass；产物缺失 / 探测失败 ⇒ 显式 pending）并**显式声明本 gate
> 不执行任何 web 测试/smoke**（`gates.ts` 的 `UX_SMOKE_GATE_CRITERION` 是唯一字面量，`release-gates.test.ts`
> 用 `toBe(UX_SMOKE_GATE_CRITERION)` + 「旧串不得残留」两条断言锁住；回退必红）。
> **核实结论**：本次改动前，没有任何 gate 会跑 web 套件 —— 根 `vitest.config.ts` 的 `include` **不含** `apps/web`
> （web 套件是 `apps/web/vitest.config.ts` 的独立配置，走 `npm run -w @vessel/web test`）；gate 1 只跑
> `tsc -p apps/web/tsconfig.json`（类型检查，非测试）。把 web 套件真正接进门禁属**独立的行为变更卡**。
> **该独立卡已落地（Gate 2 unit）**：unit 的 executor 现在**逐条实跑** `gates.ts` 的 `UNIT_TEST_ROOTS`
> （根 `npx vitest run` + `npx vitest run --root apps/web`），criterion（`UNIT_GATE_CRITERION`）由**同一清单插值**
> ⇒ 判据声称的 root 集合 == 实跑的 root 集合（`release-gates.test.ts` 有"从 criterion 文本解析出的命令 vs
> executor 实际发出的命令"逐条比对的判别性守卫）；`.github/workflows/ci.yml` 的 Test 步骤同时改跑 `npm run test:all`。
> 故上面"本次改动前没有任何 gate 会跑 web 套件"只描述**接线之前**的事实；gate 7（ux-smoke）**仍然只探测产物**。
> 报告产物（`benchmarks/reports/release-report.{md,json}`）内嵌 criterion，本次**不手改**，需重跑门禁刷新。

> gate 8（packaging）加严背景（EVALUATION-REPORT-24 P2）：原判据只查「本地 `dist` 是否存在」
> （`judgePackagingProbe`），不查**包内形状** → 「tarball 270 → 62 文件、含 `dist/cli.js` 与 4 个
> `dist/configs/*`、零 `*.test.*` / 零 `*.map`」只是一次性人工实测，任何重构都能在**没有红灯**的情况下
> 把能用的包变成不能用的包（典型：`prepack` 忘了构建）。现由 `run-release-gates.ts` 的
> `buildPublishArtifactExecutor()`（判据纯函数 `judgePublishArtifact` + 清单解析 `parsePackListing`
> + 静态断言 `packScriptsBuildDist`）**替换** gate 8 的 executor（gate id/position/8 门禁注册表不变），
> 判据 ① 是静态断言，**不依赖"工作区里恰好已有 dist"**。清单解析只认 `npm notice Tarball Contents` …
> `npm notice Tarball Details` 之间的 `npm notice <size> <path>` 行（npm 把 notice 写 stderr 且逐行加前缀），
> 故 `prepack` 脚本打到 stdout 的横幅不会污染解析（这也是不用 `npm pack --json` 的原因）。

> gate 1（build）加严背景（Round 4）：`apps/web` 不在根 `tsconfig.json` 的 project references 图内，
> 只跑根 `tsc -b tsconfig.json` 时 web 的类型错误不会进入编译 → 门禁静默通过；故 Gate1 同时执行两条
> 命令、两者都 exit 0 才判 pass（`judgeBuildPair` @ `benchmarks/runners/src/release-gates/gates.ts`）。
> web 侧命令探测失败（受限环境无法 spawn 等）时按既有 probe→pending 约定显式 pending 并带 note，
> 不静默通过；根构建本身已非 0 时按 fail 优先于 pending 返回 fail。

pending 的 gate 语义：表示**该 gate 的判据没有全部被判定**，需在能判定它的环境/评测下补齐后再判 ready。成因是**结构性的、不限于某个固定名单**，目前有三类：
1. **环境/工具/产物不可用**（如 web 构建产物缺失 —— `apps/web/dist` 未 build、packaging 产物不可得）；
2. **无凭据**（真实模型 lane 需要 key）；
3. **场景在 manifest 里声明了能力缺口**——判据类型 `type: indeterminate`（`asserts.ts` 落成 `result: 'skip'` 且 `evidence.status === 'indeterminate'`，`types.ts` 注明 *never contributes a passing verdict*），例如 S004/S005"注入抵抗需要真实模型评测，离线 mock 判不了"。此时该场景**既不计通过、也不计失败**，而是在 gate 的 `evidence.detail` 里**被逐个点名**（不静默消失）。**判失败优先于 pending**：同一场景内只要有任何一条 assert 为 fail，该场景仍判失败（**声明的能力缺口不得掩盖真失败**）。
gate 的 `note`/报告脚注**由本次结果动态生成**（`runner.ts` 逐条列出本次 `status === 'pending'` 的 gate），**不写死具体 gate 名单**；**绝不静默 pass**。

## 报告形状（`ReleaseReport`，JSON 机器可读）

```jsonc
{
  "schemaVersion": 1,
  "version": "v1.0.0",                // 可选
  "generatedAt": "2026-09-08T...",    // ISO
  "status": "ready",                  // ready | blocked | partial
  "gates": [ {
      "id": "build", "name": "Build (tsc -b)", "position": 1,
      "criterion": "...", "status": "pass",
      "evidence": { "summary": "...", "detail": ["..."], "artifacts": ["..."] },
      "durationMs": 1234, "note": "..." } /* ×8，按 §21 顺序 */ ],
  "totals": { "pass":8, "fail":0, "pending":0, "durationMs": ... }
}
```

总判定规则：全 pass=**ready**；有 fail=**blocked**（优先于 pending）；有 pending 无 fail=**partial**。
markdown 版（`renderReleaseMarkdown`）含：标题/生成信息/总判定 → 8 gate 表格 → 总体统计 → 环境注解。

## 设计选择与理由

1. **判据函数 = 纯函数**：`judgeBuild` 等把预采集数据 → 三态判定，不跑命令、毫秒级、单测直接 mock 输入。
2. **执行器可注入 + 依赖走 `RunCommand` 边界**：真实 executor 的唯一副作用统一收敛到注入的 exec，
   单测全部 mock；真实命令路径在非受限环境跑，不强依赖沙箱可 spawn。
3. **环境敏感 gate 用 probe→pending，不静默通过**：real-model/UX 无凭据/无产物时显式返回
   pending（带 note），继承 082 lane 的诚实降级语义（§21 "不以自证为证"）。packaging 已加严为
   **发布物形状判据**：pack 期不构建 dist、或 tarball 清单缺必需文件/含 `*.test.*`/`*.map` → **fail**
   （不再以 pending 掩盖坏包）；只有 npm pack 不可执行、目标包错位或清单不可解析才 pending。
4. **总判定三态**：ready/blocked/partial 明确区分"全过 / 有硬性失败 / 环境未备齐"，指挥据此拍板。
5. **runner 顺序执行 + 异常转 fail**：严格按 §21 顺序 1→8；executor 抛异常→该 gate fail（不被吞、不被当
   静默 pass），保证报告的完整性。

## 范围边界

- 只做 gate 框架 + 判据接线 + 报告（本地/CI 可跑）。
- 不做 CI 平台集成；真实模型/UX/包装环境用 probe/pending 标注，不在受限环境假装通过。