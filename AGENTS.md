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

- `docs/`：权威文档。MISSION-V0.x.md（执行任务书）、ARCHITECTURE.md（模块边界）、DESIGN-DECISIONS.md（23 决策点，实现必须遵守）、EVENT-SPEC.md（D5 事件词汇）、POLICY-SPEC.md、BEHAVIOR-IR-SPEC.md、BENCHMARK-SPEC.md、V0x-IMPLEMENTATION-NOTES.md（交付说明）、REVIEW-REPORT-V0x.md（独立核验报告）、V0x-PROGRESS.md（进度接力）。
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

## 执行角色与模型路由（PDW）

> 分工按读写定职责；模型与档位以 `pwsh pdw.ps1 doctor` 为准（看 `effective_model`，Codex 角色的档位看并列的 `reasoning_effort`；任一角色不 ready 时退出码非 0）。本节只写机器推不出来的部分，协调者用哪个模型不锁定。

| 职责 | 执行体 | 写权限 | 唯一产出 |
|---|---|---|---|
| 协调者 | 当前宿主会话 | 只写卡与契约 | 读卡 → 写契约 → `run` → 处理分歧 → 收口；不写产品代码 |
| `scan` | PDW / OpenCode | 只读（`--agent plan`） | 实现位置、调用链、根因；不推演修法 |
| `test-plan` | PDW / OpenCode | 只读 | 每条验收用哪条命令能真跑、缺哪条判据 |
| `implement` / `repair` | PDW / Codex | workspace-write，唯一写者 | 代码 + 自验命令结果；只改契约 scope；浏览器验收放 `checks` |
| `review` | PDW / OpenCode | 只读 | 逐条 AC + 原始证据；同模型换会话不等于跨模型独立 |
| `planner` | PDW / OpenCode | 只读 | 默认关闭，仅契约 `planner: true` 时启用；只规划不实现 |

- **档位词表按后端分列，以模型声明的 `variants` 为准**（`opencode debug config` 可查）：DeepSeek V4.1 Flash 实测 `low/high/max/off`，写 `medium` 不会变成中等思考；GPT-6.1 Sol 实测 `low/medium/high/xhigh/max/ultra`。换模型后重新核对，不沿用旧结论。
- **加一个供应商**：在 `~/.config/opencode/opencode.json` 的 `providers`（v2 是复数，v1 才是 `provider`）里配好 `models` / `variants`，角色值写 `<provider>/<model-id>`。三个坑：密钥在 `settings.apiKey`，`opencode auth list` 看不见，目录里有不等于能用；`variants` 不一定包含你要的档位；model id 可能自带 `/`，值里会出现两个斜杠。改完跑 `doctor` 再做一次真实任务。
- **迭代口径**：改"选择"（哪个模型、开不开 planner、限额）→ 只改 `.pdw/config.json`；改"机制"（加 backend、加目录发现、改证据规则）→ 走上游 `satan9394/personal-dev-workflow`，不在项目副本打补丁；9 个技能文件永不在项目内分叉（`update.mjs` 逐字节覆盖，改了也留不住）。版本号不是身份，只认 sha256。
- **Codex 提示规约（仅 `implement` / `repair`）**：接口契约先行，用标题 / XML 标签 / 代码块隔离上下文与禁止项；不注入 "think step by step"、不写大段角色扮演；稳定契约放 Prompt 前部以复用前缀缓存。

### PDW 本机适配（实测，核对日期 2026-10-25）

- `pdw.mjs doctor`：五角色 `ready`；`opencode v2.1.4`、`codex-cli 0.164.0`、`authentication: not_checked`。
- `opencode run --model provider/model#variant` 可用：`review` 的 `#max` 在任务 `20261024095132-1bac7e` 实跑 exit 0（2026-10-24）。
- `codex exec --sandbox workspace-write` 可写仓库；`--sandbox read-only` 不可写。浏览器需四个参数，见下方 `pdw-entry` 段。
- `pdw.mjs init` 的模型探测已支持 OC 2.x 的 `providers` 键（2026-10-24 重切修好，本机实测能解析出模型）；识别不到时仍必须显式填 `model`。
- 技能正文已不再写死本机 provider 与 OpenCode 小版本（2026-10-24 修）；`planner` 的 AGY 只是上游默认值，本机以 `.pdw/config.json` 为准。
- **cc-switch 会重写全局配置**：它的 OpenCode 集成在切换供应商时写入单数 `provider` 块（v1 形态），日志里把带 `capabilities` 的 v2 块判为 invalid 但保留原样。OpenCode 2.1.4 忽略单数块，真正生效的是复数 `providers`；手动删单数块约 18 秒会被重新写回（2026-10-25 实测）。每次用 cc-switch 切换供应商后跑一次 `pwsh pdw.ps1 doctor`；若 `opencode models` 里 `commandcode` 消失，说明复数块被整体覆盖，按卡 286 的字段重建。
- **契约草稿放 `.pdw/contracts/`**，不要放 `.pdw/tasks/`：无参 `status` 会把 `tasks` 下每个目录当任务读 `state.json`，遇到没有该文件的草稿目录会 ENOENT。

## 开发工作流（六步循环）

拆卡 → 派活 → 交证 → 验证 → 验收 → 复盘。详见 `.agents/skills/personal-dev-workflow/`（Codex / Antigravity 读项目副本；OpenCode 读全局 skills 根下的镜像，两份必须同步，见下方「PDW 技能同步」）。做多步开发前先读其 `SKILL.md`。

<!-- pdw-entry -->
PDW 现行版本 **1.3.3-local**：完整 Skill 目录 + Node 运行器 + 项目级 `.pdw/`；零安装入口为仓库根 `pdw.ps1`（本块由 `pdw.mjs install` 写入，勿删标记）。
实质性 PDW / 多 Agent 任务：由协调者把目标编译成可执行契约（`node .agents/skills/personal-dev-workflow/scripts/pdw.mjs new --from <contract.json>`）并驱动运行器，**不把 JSON 配置或角色聊天推给用户**。自动执行后端目前仅 OC / Codex / AGY；CC、DSH 只能担任协调者或辅助模式，不得汇报成 CLI 自动接力已通过。
启动命令、旧状态（`.agent-state/`、`RUN_STATE.md`、`tasks/`）如何保留、以及回滚步骤见 `evidence/pdw-migration-1.3.1/MIGRATION.md`。

**UI 类契约的浏览器验收默认放在 `checks` 里**：implement 角色跑在 Codex 的 OS 沙箱内，**默认配置下**起不了浏览器（2026-10-24 实测：`codex sandbox` 默认是只读，连仓库内写文件都被拒；`workspace-write` 下 Chrome 也要 `--no-sandbox --user-data-dir=<工作区内路径> --headless=new --disable-gpu` 才起得来，加上这四个参数后实测 exit 0）。因此契约的常规写法是把几何/交互验收写成运行器执行的检查命令（如 `node scripts/ui-geom-check.mjs`，它自己 build + 起服务 + 驱动本机 Chrome），并在 `notes` 里写明「实现者不要因为跑不了浏览器而报 blocked」；只有当确实需要 implement 自验时，才在契约里给出上面那组沙箱内可用参数。两条配套约束：检查脚本**不得往仓库里写文件**（写进任务 scope 会导致 checks 阶段被判 source drift，已实测三次），报告写 `%TEMP%`；实现者的自我验证默认只覆盖代码、单测与类型检查。
<!-- /pdw-entry -->

- 默认 `standard`：一卡一闭环，交证即停，不自动续下一卡。
- `bounded` 连续自治需显式授权并先定 Mission 信封；PDW 任务的机器真相源是 `.pdw/tasks/<id>/state.json`。`.agent-state/run-state.json` 与 `RUN_STATE.md` 已标 **LEGACY**：只读历史，不是汇报来源（最后写入 2026-10-14 / 10-11）。
- 主会话 = 指挥：只留「目标 + 文件指针 + 结果摘要」；长期目标挂 goal。**goal 自动续跑只属于协调者会话**，PDW 角色会话不创建 goal、不嵌套 agent。
- 每张任务卡一个隔离执行器：PDW 的 `implement` 角色（Codex）。DSH / CC 只能担任协调者或宿主子代理辅助模式，不得汇报成 CLI 自动接力已通过。
- 大改动另派对抗性复核（PDW 的 `review` 角色，全新上下文，只对照验收与当前产物）。跨模型复核更独立，但运行器不支持按任务改路由，需人工改 config 并留 diff。
- 记忆全在文件里：本文件（规则）+ docs/（决策）+ tasks/（进度）。对话会忘，文件不会。

### 记录纪律（单一最佳位置，2026-10-12 立）

每个事实只写一处，**不把同一事实写进多处**（依据旧版 PDW 的 `references/memory-policy.md`；1.3.1 包已不含该文档，本条规则本身继续有效）。硬规则：

1. **动手前先建卡**：凡满足「可独立验收 / 需跨会话续接 / 会交接给他人 / 失败需各自回滚」任一条的工作，**先落一张任务卡**（`tasks/NNN-*.md`，含 Goal / Not Doing / Acceptance / Blast Radius / Expected Evidence / Result），再执行。规则是**先建卡、后动手**——补卡不算。
2. **单一最佳位置**：目标与验收 → **任务卡**；代码事实 → **git diff / commit**（不重抄）；长期决策 → **`docs/`**；稳定规则与真实教训 → **本文件**；用户可见的**版本级交付**才进 **`CHANGELOG.md`**；一次性过程记录才进 **`DEV_LOG.md`**。
3. **不重复记账**：同一事实禁止同时写"卡 + 日志 + CHANGELOG + RUN_STATE"四处。
4. **卡完成时收口**：更新卡首行状态 + `tasks/README.md` 路线表一行（+「最近已交付」段）。这是卡自己的索引，不是重复记录。
5. **无则免写**：没有可复用的教训就别往本文件加"教训"；没有过程记录要留就别写日志。
6. **PDW 任务必须先有卡**：卡首行状态行下加 `- PDW task: <id>`（未启动写 `none`）；卡写目标/验收/范围，契约由卡派生并冻结。验收要变就回卡改、再新建任务，不要只改 `.pdw/tasks/<id>/contract.json`。
7. **越界以 artifact 指纹为准**：`new` 之前工作区里已有的未提交改动不算实现者越界，在契约的可选字段 `baseline_dirty` 里列出；复核看 `state.json` 的 artifact 指纹，不拿 `git diff HEAD` 的存量改动当越界证据。
8. **证据落盘**：`checks` 只写 `%TEMP%`；验收后在卡的结果段写摘要 + accepted artifact 哈希，不把生成物复制进仓库（复制会让下次 `status` 显示漂移）。

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
- **`dist` 会落后于 `src`，而真实运行走 `dist`**：`vitest` 直接读 `src`，所以测试全绿不代表 `vessel serve` / `apps/cli` 跑的是同一份代码——它们通过包导出加载 `packages/*/dist`。回滚改动后尤其危险：2026-10-23 复验「完全访问下 Shell 能否执行」时，`dist` 里还留着已回滚的实现，测出了与源码相反的结论。**任何真实进程复验前先 `npx tsc -b tsconfig.json`**，改完源码同理。

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
- **不要把中文提示词用 PowerShell 管道喂给原生 CLI**（`Get-Content -Raw $f | & codex exec ...`）：PowerShell 会按 ANSI 代码页重编码，中文全变 `?`，agent 只收到 ASCII 骨架（2026-10-23 实测 7 次派单全中，事后从 rollout 逐条比对才确认）。派单统一走 `scripts/dispatch-codex.ps1`——它用 cmd 输入重定向传原始字节并先校验 UTF-8。
- **也不要用 `Get-Content` / `Set-Content` 改源码**：同样按 ANSI 代码页往返，会把文件里已有的中文注释变成 `鈥?` 之类乱码，`Set-Content -Encoding UTF8` 还会顺手加 BOM（2026-10-23 改 `shellTool.ts` 时实测，已用 `git show HEAD:<path>` 原始字节还原）。改文件用编辑工具或 Node 的 `readFileSync`/`writeFileSync`；若已污染，用 `git checkout -- <path>` 恢复后重做，不要试图修补乱码。
- **不要把 `vessel doctor --json` 这类依赖 `secretRef` / 用户目录的命令写进 implement 的自验清单**：Codex 的 workspace-write 沙箱取不到 `~/.vessel` 与凭据后端，`providers` 项会误报「凭据不可用」，任务会被判 blocked（2026-10-25 卡 295、296 各中一次）。这类命令只放运行器的 `checks`（宿主进程执行），或在协调者侧手工跑。
- **别用 PowerShell 控制台回显判断 UTF-8 有没有坏**：`git log`、`node` 的 UTF-8 输出在回显时可能变成 `claim �?it`，但那只是终端解码，仓库里的字节可能是完好的。2026-10-24 实测：一条带破折号的 commit message 在控制台显示为乱码，用 `git log --format=%s` + Node 取码点确认后是正常的 U+2014、无 U+FFFD——我当时按乱码误判并写了一条错误规则，随后更正。判据只认字节：`git cat-file -p <sha>`、Node 读文件、或 `git log --format=%s` 交给 Node 处理；不要把控制台样子当证据。

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
- **两份本地副本，读的人不同**：`.agents\skills\personal-dev-workflow\`（9 文件，与源逐字节一致）供 `pdw.ps1`、`update.mjs` 与 Codex 使用；`C:\work\.agents_four_skills\personal-dev-workflow` 是 OpenCode 角色会话实际读的那份（`opencode.json` 的 `skills` 指向该目录），同时兼作离线兜底。
- **每次更新后必须同步两份**：`update.mjs` 只写项目副本；跑完把 9 个文件复制到镜像目录并逐文件核 sha256（含 `references/`、`scripts/`、`agents/`、`assets/` 四层）。两份不一致视为更新未完成，以项目副本为准。
- **改 `.pdw\config.json` 前必须先经用户确认**：模型、思考档位（`reasoning_effort` / `model#variant`）、上限与 `prompt_guidance` 的任何改动，先给出 diff 与预期效果、等用户明确确认后再落盘；确认前不动文件。改前把原文件备份到 `.pdw\skill-upgrade-<YYYYMMDD>\config.json.bak-<用途>-<YYYYMMDD>`。
- **首选一条命令自更新**：`node .agents\skills\personal-dev-workflow\scripts\update.mjs --project <项目根>`（`--dry-run` 只看差异）。它自带备份、原子替换与 `doctor` 复核，幂等、不动 `.pdw\config.json`、不删除文件、不 commit/push；无差异只回「已是最新（<版本>）」。
- 手工兜底（脚本不可用或需人工判断时）：
  1. 取远端到临时目录：`git clone --depth 1 --branch main https://github.com/satan9394/personal-dev-workflow <临时目录>`；网络不可用时退回本地镜像，并在报告中写明用了兜底。
  2. 用远端 `skills/personal-dev-workflow/` 的 9 个文件与本地副本逐字节比对（sha256；缺文件也算差异）；**版本串相同不代表内容相同**，重切过的包按散列判新旧。
  3. 无差异 → 只回一句「已是最新（<版本>）」，不改任何文件。
  4. 有差异 → 备份本地副本到 `.pdw\skill-upgrade-<YYYYMMDD>\` → 用远端 9 文件整份替换（保留 `agents/ assets/ references/ scripts/` 四层）→ **不要动 `.pdw\config.json`** → 跑 `node .agents\skills\personal-dev-workflow\scripts\pdw.mjs doctor --project <项目根>` → 报告散列与 doctor 结果。
- 不要直接改本地镜像；镜像是 GitHub 的下游副本。
<!-- /pdw-skill-sync -->
