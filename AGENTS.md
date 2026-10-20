# Vessel — 项目级开发约定（AGENTS.md）

> 历史名：**Composable Agent Harness**（CLI 名 `cah`，**V0.9 起全面更名 Vessel**）。早期文档、`CHANGELOG.md` 的历史段落与旧提交信息里仍可见旧名与旧仓名，属历史，不必改。
>
> 本文件是个人开发工作流（personal-dev-workflow）在本仓库落地的记忆基座。
> 规则、决策、进度、教训全部落盘；对话只留文件指针。人只做两件事：提需求、拍板验收。

## 项目定位

一个可组合、可验证、可替换行为层的 Agent Harness（Composable Agent Harness）。
不是"开源 Claude Code"，不是"融合各家功能的聚合体"。核心三项：Agent Behavior IR + Behavior Compiler + Policy Runtime，并以 Cross-Harness Conformance Suite 证明其价值。

## 技术栈与运行环境

- 主语言 TypeScript，Runtime Node ≥20（本机 Node v24.14.0 / npm 11）。
- monorepo：npm workspaces（apps/*、packages/*、benchmarks/runners）；模块化单体，禁止提前微服务化。
- 包管理器锁定 **npm**：`package-lock.json` 是唯一权威，禁止在仓库内引入 pnpm/bun/yarn 锁文件（`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`bun.lockb`、`yarn.lock`）。不迁移 pnpm 的依据见 `docs/DESIGN-DECISIONS.md` 决策点 19。
- 测试 Vitest：**全量 = `npm run test:all`**（两个 root：根 `npx vitest run` + `npx vitest run --root apps/web`；**web 有独立 vitest 配置，根 `include` 不含它**——只跑根会漏掉 `apps/web` 的近百项，见纪律 26）；类型构建 `npx tsc -b tsconfig.json`；CLI 直跑 `npx tsx apps/cli/src/cli.ts`。
- Windows / PowerShell。删除铁律：所有删除走回收站（`[Microsoft.VisualBasic.FileIO.FileSystem]::Delete*`），禁止任何永久删除命令。
  **唯一的书面例外（2026-09-12 决策，Round 43）**：**"测试自己刚创建、且位于系统临时根（`os.tmpdir()`）之下的临时目录/文件"**允许用 Node 的删除 API 清理——本仓既有约定如此（`packages/**` 测试里约 82 处 `fs.rmSync(dir, { recursive: true, force: true })` 都在 `afterEach`/`finally` 里删自己建的 tmp 目录），**不要去把它们改成回收站**：每次全量测试会产生成百上千个临时目录，回收站化会让回收站爆满、磁盘只增不减、测试变慢，属于给用户添垃圾而非保护数据。
  例外成立的条件（必须**同时**满足，缺一不可）：① 该路径是**本次测试进程自己创建**的；② 它**位于 `os.tmpdir()` 之下**（不是仓库内、不是 `~/.vessel`、不是用户目录）；③ 无其它进程/用例在引用。
  **此例外之外一切照旧走回收站**——仓库内文件、`docs/`、`tasks/`、`configs/`、`~/.vessel` 状态、以及任何用户数据，永久删除一律禁止。

## 目录结构

- **`HANDOFF.md`：项目交接文档。** 新会话 / 新 Agent / 换人接手时**先读它**——现状、未完成清单、验证命令、已知约束与阅读顺序都在那里。**当用户输入「继续」或「继续未完成的」时**，严格遵照其 §0「快速接管协议」向用户汇报当前断点与未完成项，并直接执行下一步，杜绝漫谈与重头梳理。

- `docs/`：权威文档。MISSION-V0.x.md（执行任务书）、ARCHITECTURE.md（模块边界）、DESIGN-DECISIONS.md（21 决策点，实现必须遵守）、EVENT-SPEC.md（D5 事件词汇）、POLICY-SPEC.md、BEHAVIOR-IR-SPEC.md、BENCHMARK-SPEC.md、V0x-IMPLEMENTATION-NOTES.md（交付说明）、REVIEW-REPORT-V0x.md（独立核验报告）、V0x-PROGRESS.md（进度接力）。
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
6. 默认技术栈 TypeScript + Node；无任何永久删除（回收站纪律；**唯一例外见"技术栈与运行环境"一节的书面例外：测试自建且位于 `os.tmpdir()` 下的临时目录**）；禁止 force push（**唯一书面例外：2026-09-27 一次性全历史脱敏，见 `docs/DESIGN-DECISIONS.md` 决策点 20**）。
7. 新功能必须有 Vitest 测试；不得回归既有测试与 benchmark（**"全量"= `npm run test:all`**：根 + `--root apps/web` 两个 root 都跑过、加 `npx tsc -b` 干净，且**两项都在最后一次编辑之后**执行；只跑根不算全量）。
8. 测试隔离（task 106 起）：凡是会构造**默认** ProviderStore / UsageStore 的用例（`main()`、`runChat()` 的默认路径），
   必须显式注入临时 `VESSEL_PROVIDER_ROOT` / `VESSEL_USAGE_ROOT`（`mkdtemp` + afterEach 还原环境变量），
   断言不得读写真实 `~/.vessel`——机器上的 `current.json` 是真实供应商时，否则会打真网络/断言失败。
   默认 store 的根目录用 `providerStateRoot()`（`apps/cli/src/providers/defaultStore.ts`）断言；凭据后端用内存假后端注入。
9. 克制：不追求 Agent 数量（并行 1–3）；不加几十个 Provider；不做无关重构。

10. GitHub 治理（2026-09-27）：本仓在 GitHub 上**只做提交 → PR 审核 → CI 测试**；**不创建 GitHub Release、不向 npm 发布新版本**（历史遗留的 npm 快照冻结在 `0.10.0`，不再更新）。`main` 由规则集 `protect-default-branch` 保护：必须走 PR，且 CI 双腿（Windows + Linux）必须绿。

## 模型选型与执行规约（OpenAI 规范）

> 权威依据：[OpenAI Model Selection Guide](https://developers.openai.com/api/docs/guides/model-selection) 与 [GPT-6.1 Sol 规范](https://developers.openai.com/api/docs/models/gpt-6.1-sol)。后续演进可将该选型指南作为不同任务复杂度的尝试依据。

- **当前锁定开发模型：GPT-6.1 Sol (`gpt-6.1-sol`)**
  - **当前主力思考深度：二级思考（`reasoning.effort: medium`，总共 5 个思考等级：`none` / `low` / `medium` / `high` / `xhigh`）**：官方推荐用于「复杂的工程技术任务与预期需要反复修改验证的协同交付物（Complex technical work and coordinated deliverables you expect to revise）」。在代码重构、测试修复与系统级开发中平衡推理深度与执行延迟。
  - **切换规则（免重复确认）**：当前默认开发模型即为 GPT-6.1 Sol（二级思考）；后续若切换模型用户会主动显式说明，**未说明前恒以当前模型执行，杜绝多余询问**。
  - **分档与后续尝试（依据 OpenAI 选型指南）**：
    - **轻量微调：一级思考（`reasoning.effort: low`）**：适用于单文件局部编辑、明确的单点修补或文档同步。
    - **深度攻坚：三/四级思考（`reasoning.effort: high` / `xhigh`）**：当遇到复杂的多模块循环依赖排查或高阶架构设计时可作为后续尝试。
    - **排除项**：Luna（仅适合简单抽取/分诊，复杂 Monorepo 易出现深层类型漂移）；Astra（全功能旗舰，仅在不计成本与延迟时使用）。
- **Prompt 与任务书编写原则（面向 Medium/Low 思考深度）**：
  - **杜绝伪思维链与冗余角色扮演**：推理模型原生内置思维链（CoT），禁止注入 "think step by step" 或大段虚构头衔背景，直接陈述职责、范围与单点目标。
  - **显式使用分界符（Delimiters）**：用 Markdown 标题、XML 标签或代码块清晰隔离上下文、契约、禁止项与验收门禁。
  - **接口契约先行（Interface-First）**：中轻度思考下不依赖模型盲目发散推演，Prompt 必须直接给出关键 TypeScript 接口签名与核心断言用例。
  - **前缀缓存优化**：利用 Prompt Caching（缓存输入享 95% 折扣，低至 $0.1/1M），将通用架构规则、红线与稳定契约置于 Prompt 前半部。

## 开发工作流（六步循环）

拆卡 → 派活 → 交证 → 验证 → 验收 → 复盘。详见 `.agents/skills/personal-dev-workflow/`（Codex/OpenCode/DSH/Antigravity 均从此处发现）。做多步开发前先读其 `SKILL.md`。

<!-- pdw-entry -->
PDW 现行版本 **1.3.3-local**：完整 Skill 目录 + Node 运行器 + 项目级 `.pdw/`；零安装入口为仓库根 `pdw.ps1`（本块由 `pdw.mjs install` 写入，勿删标记）。
实质性 PDW / 多 Agent 任务：由协调者把目标编译成可执行契约（`node .agents/skills/personal-dev-workflow/scripts/pdw.mjs new --from <contract.json>`）并驱动运行器，**不把 JSON 配置或角色聊天推给用户**。自动执行后端目前仅 OC / Codex / AGY；CC、DSH 只能担任协调者或辅助模式，不得汇报成 CLI 自动接力已通过。
启动命令、旧状态（`.agent-state/`、`RUN_STATE.md`、`tasks/`）如何保留、以及回滚步骤见 `evidence/pdw-migration-1.3.1/MIGRATION.md`。
<!-- /pdw-entry -->

- 默认 `standard`：一卡一闭环，交证即停，不自动续下一卡。
- `bounded` 连续自治需显式授权并先定 Mission 信封；其机器真相源 `.agent-state/run-state.json`（已忽略），`RUN_STATE.md` 只是生成视图。
- 主会话 = 指挥：只留「目标 + 文件指针 + 结果摘要」；长期目标挂 goal。
- 每张任务卡一个隔离执行器（DSH 子代理默认），干完只回传工作证明（diff + 测试结果）。
- 大改动另派对抗性评审子代理（全新上下文，只见 diff 和验收标准，反向挑错）。
- 记忆全在文件里：本文件（规则）+ docs/（决策）+ tasks/（进度）。对话会忘，文件不会。

### 记录纪律（单一最佳位置，2026-10-12 立）

每个事实只写一处，**不把同一事实写进多处**（依据旧版 PDW 的 `references/memory-policy.md`；1.3.1 包已不含该文档，本条规则本身继续有效）。硬规则：

1. **动手前先建卡**：凡满足「可独立验收 / 需跨会话续接 / 会交接给他人 / 失败需各自回滚」任一条的工作，**先落一张任务卡**（`tasks/NNN-*.md`，含 Goal / Not Doing / Acceptance / Blast Radius / Expected Evidence / Result），再执行。规则是**先建卡、后动手**——补卡不算。
2. **单一最佳位置**：目标与验收 → **任务卡**；代码事实 → **git diff / commit**（不重抄）；长期决策 → **`docs/`**；稳定规则与真实教训 → **本文件**；用户可见的**版本级交付**才进 **`CHANGELOG.md`**；一次性过程记录才进 **`DEV_LOG.md`**。
3. **不重复记账**：同一事实禁止同时写"卡 + 日志 + CHANGELOG + RUN_STATE"四处。
4. **卡完成时收口**：更新卡首行状态 + `tasks/README.md` 路线表一行（+「最近已交付」段）。这是卡自己的索引，不是重复记录。
5. **无则免写**：没有可复用的教训就别往本文件加"教训"；没有过程记录要留就别写日志。

> 违规样例（本仓 2026-10-12 实例，已纠正）：把整张卡的目标与验收数字全塞进 `DEV_LOG.md` 却漏建卡 —— 任务卡才是目标/验收的源，日志只放过程记录。

## 既有版本状态（截至 2026-09-24）

- V0.1：PASS（63 测试 + REVIEW-REPORT-V01）。
- V0.2：PASS（104 测试 + REVIEW-REPORT-V02，含 Subagent/Planner/Evaluator Agent/MCP/Parallel/Git Worktree）。
- V0.3–V0.10：已合入（Memory/Skills → TaskRouter → Loop Engine → 多供应商 → TUI → 品牌哲学 IR → 更名 Vessel + 用量/价目 → 组合根抽离 + serve/web）。见 `CHANGELOG.md`。
- V1.0 全路线（Milestone A–G / 卡 032-084）：已验收合入，见 `docs/V1.0-CHECKPOINT.md`。
- V1.1 全路线（卡 V1.1-A..F）：已验收合入，见 `docs/V1.1-ROADMAP.md`。剩余为环境补齐项（opencode-go 余额、Packaging gate 需 dist），非阻塞。
- 2026-09-18：**CI 首次变绿并保持**（此前建仓起三次全红），根因是 `tsconfig.base.json` 缺 `exclude` 导致 `tsc -b` 把测试纳入 composite 构建。同时清零 CodeQL 10 条 + Dependabot 12 条告警。见 `tasks/123-ci-tsc-build-repair.md`。
- 2026-09-18（后续）：**Cross-Harness Conformance 驱动**（`npm run bench:conformance`，离线 25/25）、**soak 默认参数自洽修复**、**`vessel mcp` / `vessel diff`** 与 **TUI `/mcp` `/diff`**、**四处「两份实现」收敛**（MCP 装配 / mock 文案 / guide locale / mock 冒烟脚本）、**G-08 `vesselHome` 轻量收敛**、**B19 口径（v1 只记 deny）**、**文档诚实化收尾**（外部文档残余扫描 #2 / 已声明未实现项标注 / `toolIdByIndex` by-design / 能力矩阵 `stream-json` 登记）。见 `tasks/125`–`tasks/143`。可自主收尾队列**已清空**，剩余为外部阻塞项。
- 2026-09-19（方向 B 残留清算）：**真实模型 lane 接场景 policy**（`tasks/145`：`runVesselFixture` 此前忽略 `manifest.policy`，B005/S006 的 `danger-full-access` 失效；现按 `runner.ts` 同口径覆写）；**B2–B5 已核实闭合**（`tasks/146`：B15/B11/B21 零产零消、`stage` 的 sandbox/guard、`BENCHMARK-SPEC` 漂移、M14 detail 均早有可执行守卫）。
- 2026-09-24（V1.2 开放生态与极致透明可观察性）：**全量交付验收并合入**（Commit `4886acc`，卡 157–162）：第三方模型自省探测（`/v1/models` 探针与端点回退）、OpenAI 协议 Reasoning 深度思考流解包、Claude 插件生态全兼容（`plugin.json` 与 Hook Policy 映射）、Session Topic 实体与持久化检索、Web 树状侧边栏与 Talking 详情抽屉。
- 2026-09-24（V1.3 双向子 Agent 网关体系）：**完成对抗审查与架构拆解**（卡 163–167，见 `docs/V1.3-ROADMAP.md`）：Inbound MCP 子代理服务器、虚拟人类代理与交互拦截（攻克无头死锁）、Outbound 异构子代理运行时（Worktree 租约与锁自愈）、跨 Agent 保全度自动化双盲评测套件（机械验证保全度 $\ge 90\%$）。Codex 首席架构师开工包已落盘在 `tasks/167-epic-universal-subagent-mesh.md`。
- 当前 HEAD 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **182 文件 / 2276 passed + 6 skipped**、web **12 文件 / 129 passed**、web `vite build` exit 0、CLI 冒烟 exit 0；CI 在 Windows + Linux 两腿绿；CodeQL/Dependabot/Secret scanning 告警 0。


## 构建与依赖纪律（2026-09-18 确立，来自 CI 修复）

- **`tsconfig.base.json` 的 `exclude` 不可删**：测试文件必须排除在 composite 构建之外（跨包测试 import 无法全部表达为 project reference，补 references 会撞真正的包级循环 `TS6202`）。测试的类型检查由 `npm run typecheck:tests`（`tsconfig.test.json`，非 composite、`noEmit`、`paths` 指向各包 `src`）单独负责——**改动测试类型相关配置后必须跑它**。
- **project reference 与 src import 必须一致**：某包的 `src` 直接 `import '@vessel/x'`，其 `tsconfig.json` 就必须 `references` 到 `x`；否则 `tsc -b` 会经 `dist` 解析、依赖构建顺序而 flaky（`benchmarks/runners` 曾缺 engine/policy/runtime/telemetry 四条）。
- **`npm ci` 是硬门禁**（CI install 步故意不写 `|| npm install`）：`package.json` 与 `package-lock.json` 不一致必须回仓库修，不许靠回退安装静默掩盖。改依赖后跑 `npm ci` 验证。
- **CI 覆盖 `apps/web`**：`apps/web` 不在 `tsc -b` 图内（独立 `noEmit` 配置），CI 另有 `typecheck` + `vite build` 两步；升级 vite/React/plugin 后必须本地跑 `npm run -w @vessel/web build`（peer 不一致只有构建会暴露）。
- **测试超时不是断言**：真实 IO / 大队列用例要显式给足超时（如 1500 任务的队列用例 120s、真实 job holder 用例 120s），慢 runner 上默认 30s 会产生与回归无关的红。
- **版本**：dev 依赖已到 TypeScript 7 / vite 8 / vitest 5 / React 19 / js-yaml 5；升大版本前先看该包的移除项（如 TS7 移除 `baseUrl`，`paths` 必须 `./`）。

### 查看 Web UI 的正确入口（2026-10-18，卡 225 更新）

- **生产/直连模式（`vessel serve` / `vessel web`）**：自卡 225 起，后端服务（`createVesselServer`）内置 `resolveStaticDir()` 双重探测——未显式指定 `staticDir` 时，优先自动托管 `apps/web/dist`（若存在且含 `index.html`），并内置 SPA 页面路由回退支持（非 `/api/` 且无扩展名的前端深链 GET 请求直接回退返回 `index.html`，扩展名资源保留精确 404）；若未构建 `apps/web/dist` 则优雅回退到 `apps/local-server/public/` 着陆页。
- **开发/热更模式（Vite dev server）**：本地热更开发调试仍推荐使用 Vite：`cd apps/web && npx vite --port 5173 --strictPort --host 127.0.0.1`（API 由 dev 代理到 `127.0.0.1:5678`，故须先 `vessel serve`）。
- **必须带 `--host 127.0.0.1`**：不带时 vite 只监听 IPv6 `[::1]:5173`；而 `browser-skill` 驱动的 Chrome 走 IPv4 `127.0.0.1`，会 `ERR_CONNECTION_REFUSED`。
- **dev 代理必须 `changeOrigin: false`**（`apps/web/vite.config.ts` 已如此）：**Vite 8 代理默认 `changeOrigin: true`**，会把 Host 改写成上游 `127.0.0.1:5678`；后端 `trustedOrigin()` 用 `req.headers.host` 构造 `url.origin` 与浏览器 `Origin` 比对，于是全部**带 Origin 的写请求**（`POST/PUT/PATCH/DELETE`，如 `behavior/compose`、供应商增删/测试/拉取、**用真实供应商新建会话**）被判 `cross_origin_denied` → **403**（GET 不带 Origin 才侥幸通过）。修代理侧，不要放宽后端同源门禁。
- **本宿主（OpenCode）会回收子进程**：后台起的长驻服务（`vessel serve` / vite / bsk daemon）在宿主重启后会被取消（表现为 `! Shell cancelled`），需重新拉起；这不是代码错误。

## 禁做清单（「别这样做」，来自踩坑与决策）

- 不要在实现里照搬 Claude Code / Codex / DSH 源码大段实现（clean-room，任务书 §19）。
- 不要给 core 加机制 import（薄核纪律）。
- 不要把安全规则只写进 prompt（软约束引导、硬约束执法）。
- 不要大批量并行后台 subagent（本环境实测会中途失败；并发 1–3、串行里程碑、进度落盘）。
- 不要在沙箱受限会话里期待 `npx vitest run` 可用（esbuild spawn EPERM）——非沙箱环境为准，或走 scripts/dev-test 通道。
- 不要做任何永久删除（回收站铁律，全项目通用；**唯一书面例外见上方"技术栈与运行环境"：测试自建且位于 `os.tmpdir()` 下的临时目录**）。
- 不要只做功能列表不验证：每张卡必须跑对应测试并留证据。
- **不要自动驱动本机其他 agent**（`dsh` / `opencode` / `codex` / `claude` / `pi`）：它们是用户自己的工具，会消耗其配额并在其机器上留下会话记录。为基准/调试/验证而调用它们**必须逐次获得用户显式同意**，且执行前先说明"将调用哪些 agent、大概消耗什么"；`npm run bench:conformance -- --live` **永不自动跑**。需要跨 harness 证据时优先用**离线车道**（只跑 Vessel 自适配器）。见 `tasks/153`。

---

## 远端 GitHub 状态（2026-10-06）

- 本项目已转为**纯本地开发**，不再向 GitHub 提交。
- 远端 `satan9394/vessel-harness` 的 **GitHub Actions 已整体停用**
  （`actions/permissions.enabled = false`）：不再触发任何 CI / CodeQL / Dependabot 运行。
- CodeQL 默认扫描已从 `configured` 改为 `not-configured`。
- 本地 `main` 领先 `origin/main`（未推送），按约定**不推送**。
- 恢复方式（如需）：`gh api --method PUT repos/satan9394/vessel-harness/actions/permissions --input -`
  （body `{"enabled":true}`）；CodeQL 用 `PATCH repos/satan9394/vessel-harness/code-scanning/default-setup`
  （body `{"state":"configured"}`）。
<!-- pdw-skill-sync -->
## PDW 技能同步（默认配置，2026-10-17 重切后；源 = GitHub）

- **唯一技能源**：GitHub `satan9394/personal-dev-workflow`，分支 `main`（滚动，无 tag / 无 Release），子路径 `skills/personal-dev-workflow/`。
- **本地镜像（离线兜底）**：`C:\work\.agents_four_skills\personal-dev-workflow`——只在取不到 GitHub 时使用，且版本串须与远端一致才可采用。
- **本地副本**：`.agents\skills\personal-dev-workflow\`（9 文件，与源逐字节一致）。
- **改 `.pdw\config.json` 前必须先经用户确认**：模型、思考档位（`reasoning_effort` / `model#variant`）、上限与 `prompt_guidance` 的任何改动，先给出 diff 与预期效果、等用户明确确认后再落盘；确认前不动文件。改前把原文件备份到 `.pdw\skill-upgrade-<YYYYMMDD>\config.json.bak-<用途>-<YYYYMMDD>`。
- **首选一条命令自更新**：`node .agents\skills\personal-dev-workflow\scripts\update.mjs --project <项目根>`（`--dry-run` 只看差异）。它自带备份、原子替换与 `doctor` 复核，幂等、不动 `.pdw\config.json`、不删除文件、不 commit/push；无差异只回「已是最新（<版本>）」。
- 手工兜底（脚本不可用或需人工判断时）：
  1. 取远端到临时目录：`git clone --depth 1 --branch main https://github.com/satan9394/personal-dev-workflow <临时目录>`；网络不可用时退回本地镜像，并在报告中写明用了兜底。
  2. 用远端 `skills/personal-dev-workflow/` 的 9 个文件与本地副本逐字节比对（sha256；缺文件也算差异）；**版本串相同不代表内容相同**，重切过的包按散列判新旧。
  3. 无差异 → 只回一句「已是最新（<版本>）」，不改任何文件。
  4. 有差异 → 备份本地副本到 `.pdw\skill-upgrade-<YYYYMMDD>\` → 用远端 9 文件整份替换（保留 `agents/ assets/ references/ scripts/` 四层）→ **不要动 `.pdw\config.json`** → 跑 `node .agents\skills\personal-dev-workflow\scripts\pdw.mjs doctor --project <项目根>` → 报告散列与 doctor 结果。
- 不要直接改本地镜像；镜像是 GitHub 的下游副本。
<!-- /pdw-skill-sync -->
