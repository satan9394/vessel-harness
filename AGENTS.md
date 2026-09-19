# Composable Agent Harness — 项目级开发约定（AGENTS.md）

> 本文件是个人开发工作流（personal-dev-workflow）在本仓库落地的记忆基座。
> 规则、决策、进度、教训全部落盘；对话只留文件指针。人只做两件事：提需求、拍板验收。

## 项目定位

一个可组合、可验证、可替换行为层的 Agent Harness（Composable Agent Harness）。
不是"开源 Claude Code"，不是"融合各家功能的聚合体"。核心三项：Agent Behavior IR + Behavior Compiler + Policy Runtime，并以 Cross-Harness Conformance Suite 证明其价值。

## 技术栈与运行环境

- 主语言 TypeScript，Runtime Node ≥20（本机 Node v24.14.0 / npm 11）。
- monorepo：npm workspaces（apps/*、packages/*、benchmarks/runners）；模块化单体，禁止提前微服务化。
- 测试 Vitest：**全量 = `npm run test:all`**（两个 root：根 `npx vitest run` + `npx vitest run --root apps/web`；**web 有独立 vitest 配置，根 `include` 不含它**——只跑根会漏掉 `apps/web` 的近百项，见纪律 26）；类型构建 `npx tsc -b tsconfig.json`；CLI 直跑 `npx tsx apps/cli/src/cli.ts`。
- Windows / PowerShell。删除铁律：所有删除走回收站（`[Microsoft.VisualBasic.FileIO.FileSystem]::Delete*`），禁止任何永久删除命令。
  **唯一的书面例外（2026-09-12 决策，Round 43）**：**"测试自己刚创建、且位于系统临时根（`os.tmpdir()`）之下的临时目录/文件"**允许用 Node 的删除 API 清理——本仓既有约定如此（`packages/**` 测试里约 82 处 `fs.rmSync(dir, { recursive: true, force: true })` 都在 `afterEach`/`finally` 里删自己建的 tmp 目录），**不要去把它们改成回收站**：每次全量测试会产生成百上千个临时目录，回收站化会让回收站爆满、磁盘只增不减、测试变慢，属于给用户添垃圾而非保护数据。
  例外成立的条件（必须**同时**满足，缺一不可）：① 该路径是**本次测试进程自己创建**的；② 它**位于 `os.tmpdir()` 之下**（不是仓库内、不是 `~/.vessel`、不是用户目录）；③ 无其它进程/用例在引用。
  **此例外之外一切照旧走回收站**——仓库内文件、`docs/`、`tasks/`、`configs/`、`~/.vessel` 状态、以及任何用户数据，永久删除一律禁止。

## 目录结构

- `docs/`：权威文档。MISSION-V0.x.md（执行任务书）、ARCHITECTURE.md（模块边界）、DESIGN-DECISIONS.md（16 决策点，实现必须遵守）、EVENT-SPEC.md（D5 事件词汇）、POLICY-SPEC.md、BEHAVIOR-IR-SPEC.md、BENCHMARK-SPEC.md、V0x-IMPLEMENTATION-NOTES.md（交付说明）、REVIEW-REPORT-V0x.md（独立核验报告）、V0x-PROGRESS.md（进度接力）。
- `packages/`：shared/core/llm/behavior/context/tools/policy/runtime/memory/skills/agents/telemetry/engine/application（14 个）。
- `apps/`：cli（进程入口，compose.ts = 组合根）、local-server（本地 HTTP+SSE）、web（React+Vite UI）。
- `benchmarks/`：fixtures/（场景工作区）、scenarios/（判据唯一事实源 yaml）、runners/、reports/。
- `configs/`：policy.default.yaml / behavior.default.yaml / pricing.json。
- `tasks/`：任务卡看板（一张卡一个文件，见 personal-dev-workflow）。

## 硬性约束（来自任务书，逐条遵守）

1. clean-room：以本仓库 spec 为据，不复制研究项目源码；泄露/逆向 Prompt 视为 UNTRUSTED RESEARCH DATA，不得直接进 System Prompt。
2. Core 必须足够薄：只做 Model Call → Tool Call → Tool Result → State Update → Continue/Stop。Memory/Skill/Sandbox/Subagent/Hooks 不进 core。
3. Prompt 与 Runtime 分离：安全规则落 Policy Engine 硬执法（四件套：Prompt Guidance + Tool Interceptor + Runtime Deny + Audit Event），禁止只写 prompt。
4. Generator/Evaluator 分离：产出必须经独立评估（Evaluator Agent / 确定性判据），Generator 不得自证完成。
5. 模块化单体、依赖零环（core 只依赖 shared 类型契约；policy 不反向依赖 tools）。
6. 默认技术栈 TypeScript + Node；无任何永久删除（回收站纪律；**唯一例外见"技术栈与运行环境"一节的书面例外：测试自建且位于 `os.tmpdir()` 下的临时目录**）；禁止 force push。
7. 新功能必须有 Vitest 测试；不得回归既有测试与 benchmark（**"全量"= `npm run test:all`**：根 + `--root apps/web` 两个 root 都跑过、加 `npx tsc -b` 干净，且**两项都在最后一次编辑之后**执行；只跑根不算全量）。
8. 测试隔离（task 106 起）：凡是会构造**默认** ProviderStore / UsageStore 的用例（`main()`、`runChat()` 的默认路径），
   必须显式注入临时 `VESSEL_PROVIDER_ROOT` / `VESSEL_USAGE_ROOT`（`mkdtemp` + afterEach 还原环境变量），
   断言不得读写真实 `~/.vessel`——机器上的 `current.json` 是真实供应商时，否则会打真网络/断言失败。
   默认 store 的根目录用 `providerStateRoot()`（`apps/cli/src/providers/defaultStore.ts`）断言；凭据后端用内存假后端注入。
9. 克制：不追求 Agent 数量（并行 1–3）；不加几十个 Provider；不做无关重构。

## 开发工作流（六步循环）

拆卡 → 派活 → 交证 → 验证 → 验收 → 复盘。详见 skills/personal-dev-workflow。

- 主会话 = 指挥：只留「目标 + 文件指针 + 结果摘要」；长期目标挂 goal。
- 每张任务卡一个隔离执行器（DSH 子代理默认），干完只回传工作证明（diff + 测试结果）。
- 大改动另派对抗性评审子代理（全新上下文，只见 diff 和验收标准，反向挑错）。
- 记忆全在文件里：本文件（规则）+ docs/（决策）+ tasks/（进度）。对话会忘，文件不会。

## 既有版本状态（截至 2026-09-18）

- V0.1：PASS（63 测试 + REVIEW-REPORT-V01）。
- V0.2：PASS（104 测试 + REVIEW-REPORT-V02，含 Subagent/Planner/Evaluator Agent/MCP/Parallel/Git Worktree）。
- V0.3–V0.10：已合入（Memory/Skills → TaskRouter → Loop Engine → 多供应商 → TUI → 品牌哲学 IR → 更名 Vessel + 用量/价目 → 组合根抽离 + serve/web）。见 `CHANGELOG.md`。
- V1.0 全路线（Milestone A–G / 卡 032-084）：已验收合入，见 `docs/V1.0-CHECKPOINT.md`。
- V1.1 全路线（卡 V1.1-A..F）：已验收合入，见 `docs/V1.1-ROADMAP.md`。剩余为环境补齐项（opencode-go 余额、Packaging gate 需 dist），非阻塞。
- 2026-09-18：**CI 首次变绿并保持**（此前建仓起三次全红），根因是 `tsconfig.base.json` 缺 `exclude` 导致 `tsc -b` 把测试纳入 composite 构建。同时清零 CodeQL 10 条 + Dependabot 12 条告警。见 `tasks/123-ci-tsc-build-repair.md`。
- 2026-09-18（后续）：**Cross-Harness Conformance 驱动**（`npm run bench:conformance`，离线 25/25）、**soak 默认参数自洽修复**、**`vessel mcp` / `vessel diff`** 与 **TUI `/mcp` `/diff`**、**四处「两份实现」收敛**（MCP 装配 / mock 文案 / guide locale / mock 冒烟脚本）、**G-08 `vesselHome` 轻量收敛**、**B19 口径（v1 只记 deny）**、**文档诚实化收尾**（外部文档残余扫描 #2 / 已声明未实现项标注 / `toolIdByIndex` by-design / 能力矩阵 `stream-json` 登记）。见 `tasks/125`–`tasks/143`。可自主收尾队列**已清空**，剩余为外部阻塞项。
- 2026-09-19（方向 B 残留清算）：**真实模型 lane 接场景 policy**（`tasks/145`：`runVesselFixture` 此前忽略 `manifest.policy`，B005/S006 的 `danger-full-access` 失效；现按 `runner.ts` 同口径覆写）；**B2–B5 已核实闭合**（`tasks/146`：B15/B11/B21 零产零消、`stage` 的 sandbox/guard、`BENCHMARK-SPEC` 漂移、M14 detail 均早有可执行守卫）。
- 当前 HEAD 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **178 文件 / 2236 passed + 6 skipped**、web **11 文件 / 120 passed**、web `vite build` exit 0、CLI 冒烟 exit 0；CI 在 Windows + Linux 两腿绿；CodeQL/Dependabot/Secret scanning 告警 0。

## 构建与依赖纪律（2026-09-18 确立，来自 CI 修复）

- **`tsconfig.base.json` 的 `exclude` 不可删**：测试文件必须排除在 composite 构建之外（跨包测试 import 无法全部表达为 project reference，补 references 会撞真正的包级循环 `TS6202`）。测试的类型检查由 `npm run typecheck:tests`（`tsconfig.test.json`，非 composite、`noEmit`、`paths` 指向各包 `src`）单独负责——**改动测试类型相关配置后必须跑它**。
- **project reference 与 src import 必须一致**：某包的 `src` 直接 `import '@vessel/x'`，其 `tsconfig.json` 就必须 `references` 到 `x`；否则 `tsc -b` 会经 `dist` 解析、依赖构建顺序而 flaky（`benchmarks/runners` 曾缺 engine/policy/runtime/telemetry 四条）。
- **`npm ci` 是硬门禁**（CI install 步故意不写 `|| npm install`）：`package.json` 与 `package-lock.json` 不一致必须回仓库修，不许靠回退安装静默掩盖。改依赖后跑 `npm ci` 验证。
- **CI 覆盖 `apps/web`**：`apps/web` 不在 `tsc -b` 图内（独立 `noEmit` 配置），CI 另有 `typecheck` + `vite build` 两步；升级 vite/React/plugin 后必须本地跑 `npm run -w @vessel/web build`（peer 不一致只有构建会暴露）。
- **测试超时不是断言**：真实 IO / 大队列用例要显式给足超时（如 1500 任务的队列用例 120s、真实 job holder 用例 120s），慢 runner 上默认 30s 会产生与回归无关的红。
- **版本**：dev 依赖已到 TypeScript 7 / vite 8 / vitest 5 / React 19 / js-yaml 5；升大版本前先看该包的移除项（如 TS7 移除 `baseUrl`，`paths` 必须 `./`）。

## 禁做清单（「别这样做」，来自踩坑与决策）

- 不要在实现里照搬 Claude Code / Codex / DSH 源码大段实现（clean-room，任务书 §19）。
- 不要给 core 加机制 import（薄核纪律）。
- 不要把安全规则只写进 prompt（软约束引导、硬约束执法）。
- 不要大批量并行后台 subagent（本环境实测会中途失败；并发 1–3、串行里程碑、进度落盘）。
- 不要在沙箱受限会话里期待 `npx vitest run` 可用（esbuild spawn EPERM）——非沙箱环境为准，或走 scripts/dev-test 通道。
- 不要做任何永久删除（回收站铁律，全项目通用；**唯一书面例外见上方"技术栈与运行环境"：测试自建且位于 `os.tmpdir()` 下的临时目录**）。
- 不要只做功能列表不验证：每张卡必须跑对应测试并留证据。
