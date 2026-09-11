# ARCHITECTURE-REPORT — 结构性与开发体验审计（独立审计，自包含）

> 审计角色：ARCHITECTURE_DX_AUDITOR（独立子代理，只读代码库 + docs/PROJECT-BRIEF.md）。
> 审计时间：2026-09（基于 commit 064af63 附近的工作树，VERSION 0.10.0）。
> 方法：源码阅读 + 结构化 grep 取证；未运行测试、未改任何代码。
> 范围：模块边界 / 配置系统 / 扩展能力 / CLI-API-日志-调试 / 数据存储 /
> 技术债与长期维护成本。重点：判断「语言设置 / 主题 / 术语解释」引导体系（task 117 + web 045）是否暴露系统级问题。

---

## 0. 三个最重要的系统级问题（TL;DR）

1. **i18n 架构不存在，只有三套互相不通的 locale 机制**。CLI 的 `settings.json locale`（仅 guide 消费、
   无自动检测）、Web 的 `apps/web/src/i18n.ts`（navigator.language 自动检测 + localStorage，仅 web UI 消费）、
   以及“词库内容永远双语、locale 只调顺序”的 glossary —— 三者互不知晓。用户设了 CLI 语言，Web 概不知情；
   `vessel explain` 永远按默认顺序渲染，走的根本不是 settings。加上 CLI 主体输出（cli.ts 217 处 console.*）
   全是内联中文、无消息目录，“加一种语言”= 全量改造；这是本次“语言设置”需求暴露的最硬系统级缺口（P1）。
2. **apps/web 游离在 `tsc -b` 项目图之外，发布门禁查不到它的类型错误**。根 `build`/`typecheck` 只构建
   tsconfig.json references 里的项目（packages + cli + local-server + runners），web 是独立 Vite 应用；
   release Gate1 `build` 就是 `tsc -b tsconfig.json`（gates.ts:461），Gate7 `ux-smoke` 只探测
   `apps/web/dist` 是否存在（gates.ts:562-573）；web package.json 没有任何 typecheck 脚本。
   即：web 的 TS 类型错误可静默通过 8 道发布门禁（P1）。
3. **~/.vessel 状态根解析被复制了 7 次，且 settings 根耦合 usage 根、迁移清单会腐烂**。
   `VESSEL_{PROVIDER,USAGE,SETTINGS,REVIEWS,ITERATIONS,HANDOFFS,TASKQUEUE}_ROOT` 七个环境变量各自散落定义，
   `defaultXxxRoot()/resolveXxxRoot()` 模式重复实现；`resolveSettingsRoot()` 把 settings 持久化挂到
   usage root 的口径上（settings.ts:24-26）；`migrate.ts` 的 `KNOWN_STATE_ENTRIES` 硬编码清单
   （providers/current/usage/memory/learned/skills）不包含后出现的 settings.json、pricing.override.json、
   reviews/、iterations/、handoffs/、taskqueue/ —— 新增状态文件后「一次性迁移」覆盖面自动失效（P1/P2）。

---

## 1. 现状评估（模块级）

### 1.1 模块边界与依赖零环 —— 总体健康 ✅

| 项 | 结论 |
|---|---|
| 分层 | packages 13 个 + apps/cli + apps/local-server + apps/web + benchmarks/runners。依赖方向从 shared 叶子向上，无环。 |
| 零环 | 抽查全部 tsconfig references：shared（叶子，零依赖）→ core/behavior → context/llm/memory/policy/runtime/skills/telemetry → tools(+runtime,policy) → agents → engine / application → cli / local-server / runners。apps/cli 对 benchmarks/runners 的单向边有显式注释（task 098，防 TS5055 环），runners 不再 import @vessel/cli。**判定：依赖零环成立，且是多年治理结果，符合 DESIGN-DECISIONS 的模块化单体约束。** |
| 薄核 | core 只依赖 shared；policy 不反向依赖 tools；clean-room 注释（不照搬 Claude Code/Codex 实现）普遍存在。 |
| 证据 | `packages/*/tsconfig.json`、`tsconfig.json`（17 个 project references）、`apps/cli/tsconfig.json` 内注释、`packages/application/src/compose.ts` 的 UsageStoreLike 最小契约接口（防 application→cli 反向依赖）。 |

**问题 1（P2，潜在构建顺序脆弱点）**：`apps/cli/src/cli.ts:8` 顶部 `import { createVesselServer } from '@vessel/local-server'`，
但 `apps/cli/tsconfig.json` 的 references **没有声明 apps/local-server**（只列了全部 packages + benchmarks/runners）。
`@vessel/local-server` 的 types 指向 `dist/index.d.ts`（无 paths 映射，走 node_modules 符号链接）。
干净 clone（无 dist）下 `tsc -b` 对 cli 与 local-server 的构建顺序没有图上的依赖约束，可能按
“cli 先编译、而 local-server 的 d.ts 未就绪”的顺序执行 → TS2307。本地之所以一直通过，是因为 dist/ 产物
常驻工作树（gitignored）。**建议**：在 `apps/cli/tsconfig.json` 补上 `{ "path": "../../apps/local-server" }` 声明该边，
与 task 098 为 bench-runners 声明边的做法对齐。

**问题 2（P1，见 TL;DR #2）**：apps/web 不在 `tsc -b` 图中，无类型检查门禁（详见 §1.4 / §4-S2）。

**问题 3（P3，职责边界需文档化）**：`packages/application` 与 `packages/engine` 两个“编排层”并存：
application 承载 compose 组合根、会话/评审/团队投影；engine 承载 LoopEngine、任务队列、迭代、交接。
LoopEngine（engine）与 AgentLoop（core/application compose 里 loop）的职责分界没有单篇权威文档；
新维护者容易放错层（尤其是“迭代/交接”这类横切能力与 application 的 Session 投影有重叠）。建议在
docs/ARCHITECTURE.md 补一段“application vs engine 边界”说明。

**问题 4（P4，噪音）**：工作树残留各包 dist/ 产物（gitignored，不影响交付），但 grep/源码审计会命中
`packages/application/dist/...`、`apps/cli/dist/...` 里的陈旧 .d.ts/.js 与旧注释（如 presets.data.d.ts 里的
“see createProvider TODO”表述），容易误判源码状态。

### 1.2 配置系统 —— 核心抽象优秀，外围存储有耦合

| 项 | 结论 |
|---|---|
| policy 四件套 | `configs/policy.default.yaml` → `compilePolicyYaml`（Packages/policy/src/risk/Compiler.ts）→ PolicyArtifacts（Prompt Guidance + Tool Interceptor + Runtime Deny + Audit）。硬策略边界符合项目定位。✅ |
| behavior 双通道 | `configs/behavior.default.yaml` → `loadBehaviorIR` + `compileBehavior(ir, policy)`（packages/behavior/src/compiler/Compiler.ts）→ `promptSections[]`（prompt 通道）+ `runtime_policy` 引用校验（编译期对缺 policy rule 的引用发 warnings，compose 里 `harness.behaviorWarnings` 打到 CLI）。**行为 IR 与运行时策略的“双通道 + 一致性校验”是本品亮点。** ✅ |
| ProviderStore SSOT | providers.json/current.json 单一事实源；fail-loud 校验；mock 内建永不持久化；task 106 后 CLI 与 TUI 共用 `createDefaultProviderStore` 唯一构造路径。✅ |
| settings | `vessel settings set theme/locale` → `~/.vessel/settings.json`（原子 tmp+rename）。⚠️ 见问题 5/6。 |
| pricing SSOT | 查价/归一全部收敛在 `packages/shared/src/pricing.ts`（“唯一”实现，明文禁第二套）；CLI 的 `apps/cli/src/providers/pricing.ts` 只做读盘 + re-export；protocol/default 兜底标 estimated。✅ |

**问题 5（P2，根语义耦合）**：`SettingsStore` 的根解析
`VESSEL_SETTINGS_ROOT > VESSEL_USAGE_ROOT > ~/.vessel`（settings.ts:24-26），且
`PricingOverrideStore` 也把 `~/.vessel/pricing.override.json` 放在 usage root（cli.ts:163/1028/1235 用
`resolveUsageRoot()`）。即：usage.json 的目录成了 settings.json 与 pricing.override.json 的“顺带容器”。
一旦用户为了测试/迁移设了 `VESSEL_USAGE_ROOT`，设置与价目覆盖会**悄悄**被重定向；“usage root”这个名字
已不再准确。建议引入统一的 `resolveVesselRoot(kind)`，每种状态文件显式声明归属（P1 根治、P2 收敛）。

**问题 6（P2，见 TL;DR #3）**：7 个 `VESSEL_*_ROOT` env + 7 份 `defaultXxxRoot()/resolveXxxRoot()` 重复实现
（ProviderStore / UsageStore / settings / ReviewHandoffStore / engine 的 iteration-store、HandoffStore、
project-task-queue）。每个新状态物都要再抄一遍“path.join(home,'.vessel',<sub>) + env 覆盖 + tmp+rename”。
建议收敛为 `@vessel/shared`（或新 packages/state）里的状态根注册表。

**问题 7（P3，schema 先于消费者）**：`theme` 设置可写、有双语说明，但**没有任何消费者**——TUI 不换肤、
web 无主题概念（grep web/src 无 theme）、local-server 不读 settings.json。settings.ts 的注释也承认
“实际换肤由 UI 层使用（不在本卡范围做 UI 大改）”。settings 体系缺“消费者注册/未消费标记”机制，
容易出现“设置项写了≠生效”的错觉（`vessel settings set theme light` 后界面毫无变化）。

### 1.3 扩展能力（新增 provider/模型/术语/设置项/语言 的成本）

| 新增项 | 成本 | 说明 |
|---|---|---|
| Provider | **低** | `packages/application/src/providers/presets.data.ts` 一行数据（73 个预置，官方/CN/聚合/本地分类），wizard 自动消费；添加自定义端点走 checklist 校验。 |
| 模型/价目 | **低** | 数据驱动：configs/model-catalog.json + pricing.json；`vessel pricing sync` 从 models.dev 增量 upsert；查价命中 shared SSOT。 |
| 术语（guide 词库） | **低** | `apps/cli/src/guide/glossary.ts` 加一个对象（term/name/aliases/zh/en/usage），CLI（explain/list-terms）与 TUI（/explain、? term）**共用同一份词库**（chat.ts dispatchSlash 直接 import glossary），无重复实现。✅ |
| 设置项 | **中** | SETTINGS_DEFS 加条目 + VesselSettings 类型加字段 + SettingsStore.load 补默认 + renderSettingsList 自动渲染。但**消费端不自动同步**：web/local-server/TUI 均不读 settings.json，新增设置项若要生效需逐个消费面手工接线。 |
| **语言（locale）** | **高**（P1） | 见 §2-S1。『zh'|'en'』联合类型在三处重复（GuideLocale / web Lang / VesselSettings.locale）；glossary 每条目要加新语言字段并改 renderExplain 的分支；GUIDE_ZH/GUIDE_EN 是两整份 map；web DICT 要加整套键值；**CLI 主体输出无消息目录**。加第 3 种语言 ≈ 三套系统各改一遍。 |

### 1.4 CLI / API / 日志 / 调试

| 项 | 结论 |
|---|---|
| 错误质量 | **好**：fail-loud + 带可操作提示的中文错误（“未收录术语，试试 vessel list-terms”）、`[vessel <cmd>]` 前缀统一；退出码语义一致（0 成功 / 1 运行时失败 / 2 用法错误）。`describeProviderError` 统一 provider 错误面。✅ |
| 命令一致性 | `vessel provider/pricing/usage/settings` 家族都是“子命令 + 二级参数”，`--help` 顶部 USAGE 手写常青。⚠️ 少量不一致：`--dry-run` 与 `--dryRun` 双别名并存（cli.ts:854、1166 处 `flags.has('dry-run') || flags.has('dryRun')`）；手写 parseArgs（cli.ts:115-141）**不支持 `--flag=value` 语法**。 |
| 调试手段 | 会话日志落 `<workspace>/.harness/sessions/<id>`（✅）；enforcement 遥测打印（✅）；TUI 有 /help。⚠️ 无 `--verbose/--debug` 全局开关、无统一日志通道；CLI 主要靠 console + 测试。对单用户工具可接受（P4）。 |
| 单体倾向 | cli.ts **1516 行、217 处 console.***（全量中文内联）；`main()` 里 16 个分支手写 dispatch。已按领域拆出 providers/guide/review/usage/tui 子目录（✅ 部分模块化），但 usage/pricing 的表格式渲染仍堆在主文件。 |
| 端口 | 5678 与项目 AGENTS.md 端口约定一致；EADDRINUSE 有明确提示（“试 --port 5679”）。✅ |
| TUI 命令面 | `/explain`、`? <term>` 复用词库 ✅；但 **TUI 没有 /settings、/guide**；`/model`、`/permission` 是“会话内生效、不持久”（chat.ts:359-363 明说“持久请用 /provider 重配”）——权限档这种策略相关项只能会话内切，退出即丢。TUI 与 CLI 的命令面不一致（P3）。 |

### 1.5 数据存储（secrets / providers / usage / settings）

| 项 | 结论 |
|---|---|
| secrets | **DPAPI CredentialStore 质量高**（packages/application/src/credential/CredentialStore.ts）：零新依赖（node:crypto + powershell ProtectedData）；Windows DPAPI / 其它平台显式降级 plaintext 并 warn；providers.json 永不落明文（secretRef）；旧明文加载时自动迁移；损坏默认 fail loud、可选 recover（改名留档非删除）；删除铁律贯穿（备份轮转用“改名覆盖”而非删除）。✅ |
| providers/current | SSOT + 校验 + 备份轮转（backups/，task 095）+ renameWithRetry（task 113 收敛）。✅ |
| usage | 本地日分桶 + 模型子分项 + recompute 幂等 + legacy 标注；价格来源显式化（estimated/pricingSource）。✅ |
| settings | 原子写 + 非法值 fail loud；损坏 fail loud。⚠️ 根路径耦合见问题 5；启动与迁移覆盖面见问题 8。 |
| **迁移覆盖面** | **问题 8（P2）**：`apps/cli/src/migrate.ts` 的 `KNOWN_STATE_ENTRIES`（providers/current/usage/memory/learned/skills）是硬编码清单，不含后出现的 settings.json、pricing.override.json、reviews/、iterations/、handoffs/、taskqueue/。这些子目录随版本出现，`vessel migrate`（~/.dsh→~/.vessel）不会搬它们；跨功能演进时“全量迁移”名不副实。建议把“~/.vessel 下有哪些状态物”做成单一注册表（与问题 6 的根注册表合并），migrate 遍历注册表。 |
| 布局 | ~/.vessel 的 7 个区域到处散落定义（跨 packages/application、packages/engine、apps/cli），无“状态目录权威文档/模块”。 |

---

## 2. 系统级问题清单（按优先级）

### S1（P1）i18n 无统一架构：locale 三套并存、CLI 无消息目录、加语言成本高
- 涉及模块：apps/cli/src/guide/*（settings/guide/glossary）、apps/cli/src/tui/chat.ts、apps/web/src/i18n.ts、apps/local-server（完全不参与）。
- 证据：
  - CLI settings：`resolveSettingsRoot()`（settings.ts:24-26）；`locale` 仅被 `cmdGuide` 读取（guideCommands.ts:85 `settingsStoreFor(opts).load().locale`）；`cmdExplain` 根本不读 settings，直接用默认顺序渲染（glossary.ts:177 `renderExplain(entry, locale='zh')`）；TUI `? term`/`/explain` 同样不带 locale（chat.ts:313）。
  - Web：独立 `i18n.ts`（task 045），`inferLang` 用 navigator.language（zh*→zh，否则 en），持久化到 localStorage `vessel.ui.lang`，与 CLI settings.json 零关联。
  - CLI 主体输出：cli.ts 217 处 `console.*` 全中文内联（usage/pricing/provider 输出在任何 locale 下都是中文）；无 `t(key)` 消息目录。
- 实现成本/风险：
  - 修复“一员全局生效”需在 settings.json 与 web 之间建统一来源（例如 web 通过 local-server 读 settings.json，或 CLI 读 web 的 localStorage 约定——推荐前者），成本中。
  - 完整英文化 CLI 需要把 217+ 处文案抽成目录（或显式决策“CLI 仅中文”），成本高。
  - 新增语言（如 ja）：3 处类型 + glossary 逐条 + GUIDE 双 map + web DICT，成本高且分散。
- 依赖：settings 存储（S4）、web 与 local-server 的 API 通道（当前 web 只走 usage SSE）。

### S2（P1）apps/web 无类型检查门禁：游离于 tsc -b 图 + 发布门禁探测退化
- 涉及模块：根工程设置（tsconfig.json/build 脚本）、apps/web、benchmarks/runners 的 release-gates。
- 证据：根 `build`=`tsc -b tsconfig.json`（references 不含 web；web 用 Vite 独立 tsconfig）；Gate1 Build 跑的就是 `tsc -b tsconfig.json`（gates.ts:460-463）；Gate7 ux-smoke 只 `fs.existsSync(apps/web/dist)` 判“产物存在”（gates.ts:562-573，judgeUxSmoke 只看 webDistPresent）；apps/web/package.json 无 typecheck 脚本（dev/build/preview/test）。
- 实现成本：低——恢复成本大概是“根脚本加 `tsc -p apps/web/tsconfig.json --noEmit`，并把 Gate1 或 Gate7 的判据升级为真实 typecheck/vitest（web 有 82 个测试）”。
- 风险：web 改坏类型时发布门禁不拦；web 与共享包的类型契约漂移静默发生。

### S3（P2）~/.vessel 状态根解析 ×7 重复 + settings 根耦合 usage 根（TL;DR #3）
- 证据与对策见 §1.2 问题 5/6 + §1.5 问题 8；建议合并为一个“状态注册表”（kind → 子目录 + env 覆盖 + 迁移清单），一次性解决重复实现、settings 耦合、migrate 腐烂三个问题。

### S4（P2）apps/cli 缺少对 apps/local-server 的项目引用边
- 证据：cli.ts:8 import createVesselServer；apps/cli/tsconfig.json references 无该边；local-server types 指向 dist。
- 风险：干净 clone 的 `tsc -b` 构建顺序脆弱（TS2307 可能）；当前靠常驻 dist 掩盖。
- 成本：一行引用声明 + 回归跑 Gate1。

### S5（P3）TUI 与 CLI 命令面、持久化语义不一致
- TUI 无 /settings、/guide；/model 与 /permission 会话内不持久；explain 不走 locale；这些与“引导体系”的定位冲突——新手在 TUI 里引导链断在“去 CLI 外敲 settings”。
- 建议：TUI 补 /settings（复用 guideCommands 的 cmdSettings 逻辑，它已支持注入输出通道）、/guide；/permission 至少持久化到会话文件。

### S6（P3）设置项“先 schema 后消费者”，theme 无消费端
- 见 §1.2 问题 7。建议在 SETTINGS_DEFS 上加 `consumers` 字段或在文档明示未接线状态，避免用户误以为已生效。

### S7（P3）CLI 单体膨胀与手写参数解析
- cli.ts 1516 行；parseArgs 不支持 `--flag=value`；`--dry-run/--dryRun` 双别名。建议：把 usage/pricing 渲染抽到各自模块；统一为 `--dry-run`（保留 `dryRun` 为兼容别名但收敛成一处常量）。

### S8（P2/P3）原子写 wrapper 在各 Store 重复实现
- rename 已收敛到 shared `renameWithRetry`（task 113/114 “12 sites”），但 tmp 命名、fsync、备份轮转 wrapper 仍在 ProviderStore（writeJsonAtomic + backupBeforeWrite）、SettingsStore.set、PricingOverrideStore、UsageStore、CredentialStore（writeSecretsFile）、engine 的 HandoffStore/iteration-store/taskQueue 各写一份。建议 shared 提供 `writeJsonAtomic(file, data, opts)`（含可选 backups 轮转）供各 Store 复用。

---

## 3. 技术债与重复实现清单

| # | 债务 | 位置 | 影响 | 建议优先级 |
|---|---|---|---|---|
| T1 | 状态根解析/环境变量覆盖 ×7 | ProviderStore / UsageStore / settings / ReviewHandoffStore / iteration-store / HandoffStore / project-task-queue | 新状态物每加一个都要抄一次；env 命名割裂 | P2（随 S3 一并收敛） |
| T2 | “tmp+rename(+备份)” wrapper ×6+ | 各 Store（见 S8） | 原子写语义若有升级（如防锁重试）需多点跟进 | P2/P3 |
| T3 | locale 类型/机制 ×3 | GuideLocale / web Lang / VesselSettings.locale；GUIDE_ZH/EN、web DICT、glossary 双语字段 | 加语言要三处同步改 | P1（并入 S1 决策） |
| T4 | CLI 文案全量内联、无目录 | cli.ts 217 console.*、guide/review/tui 若干 | 英文化/换肤/改文案成本高 | P1（或明示“CLI 仅中文”） |
| T5 | 双别名 `--dry-run`/`--dryRun` | cli.ts:854、1166 等处 | 命令一致性 | P3 |
| T6 | 两套构建系统（tsc -b vs Vite），web 无类型门禁 | 根 tsconfig / apps/web | 类型契约静默漂移 | P1（S2） |
| T7 | dist 产物常驻工作树（gitignored） | 各包 dist/ | grep/审计误命中陈旧产物 | P4 |
| T8 | task 编号注释密度高（“task 0xx”“V0.x”） | 遍布源码头部注释 | 交接友好，但版本演进后注释与代码漂移（dist 里已见旧表述）；无自动校验 | P4 |
| T9 | 每命令 new 一次 Store（如 providerCostMultiplierResolver 每次 createUsageStore 都 new ProviderStore 读盘） | cli.ts:180-188 | 微小重复 I/O，无缓存 | P4 |

未发现：全局单例反模式、循环依赖、死代码大块、静默吞错（除 web saveLang 的 storage 降级是有意为之）。

---

## 4. 长期维护成本分析

- **正向信号（应保持）**：依赖零环经多年治理（098 显式声明边）；pricing/查价 SSOT；ProviderStore/CredentialStore 的安全与原子写纪律；每文件头部“决策注释”（task 来源、选型理由、踩坑记录）让单用户项目可交接；测试隔离机制成熟（VESSEL_PROVIDER_ROOT/USAGE_ROOT 注入，120+ 测试文件 / 1220+ 用例）；8 道发布门禁以“证据 + 三态判定 + 不静默通过”运行。
- **主要负担**：
  1. 文案/语言：中文内联输出使“产品化/多语言”成为大改造；只要维持“CLI 仅中文、web 双语自检测”现状，维护成本可接受，但必须把该决策**显式写进文档**并把 settings.locale 语义收窄为“guide 文案语言”，否则用户心智（全局语言设置）与行为（只影响 guide）长期错位。
  2. 状态文件注册表缺失：新增状态物（settings→pricing.override→reviews→iterations→handoffs→taskqueue 已在 ~/.vessel 生根）没有统一登记，migrate、备份、清理、审计都只能靠人肉记住清单；长期会继续腐烂。
  3. 两个编排层（application/engine）+ 两套构建（tsc -b/Vite）并存：需要文档化边界与补 web 类型门禁，否则新人放错层/漏建 web 是常态。
  4. 测试→代码映射良好（每卡测试隔离），但 1516 行 cli.ts 是命令增长的瓶颈点，应把渲染与解析继续外移。

---

## 5. 关键判断：引导体系需求暴露了什么？

用户提的“语言设置 / 主题 / 术语解释”引导体系（task 116/117 + web 045 语言切换）**本身实现质量不低**
（词库单源复用、设置项带双语说明、fail-loud 校验、退出码干净），但它像一个探针，照出了三个此前被
“单用户 + CLI 为主”掩盖的结构性问题：

1. **“语言设置”是全身设置，但系统只有局部文案**：settings.locale 只作用于 guide（连 explain、TUI、
   usage/provider/pricing 输出都不跟着走）；web 又另起炉灶。用户以为设置了语言，实际只改了 1/4 的文案 ——
   这是**功能语义与实现范围不符**，比“缺 i18n 库”更值得先修（要么全局生效，要么 rename/收窄语义）。
2. **“设置项”缺少“消费者注册”约定**：theme 写了没消费方；“设置”与“生效面”之间没有契约，导致
   新增设置项时消费端接线完全靠自觉（S6/T4 同源）。
3. **“术语解释”词库扩展成本低，但语言扩展成本高**：词条是代码内嵌双语数据（非数据文件/目录结构），
   加术语便宜、加语言昂贵；术语体系与 locale 体系还只耦合了一半（explain 不走 locale）。若引导体系要
   继续长，应在 S1 的 locale 收敛决策里一并决定词库数据的形态（保持内嵌 vs 数据文件）。

**一句话**：这次需求本身不差，但它证明了“CLI 文案无目录、locale 三套、设置无消费契约”三个系统级欠账
已经到达用户可见面，建议按 S1（locale/文案策略）、S2（web 门禁）、S3（~/.vessel 状态注册表）的顺序收敛。

---

## 附录 A：本报告引用的关键代码位置

| 主题 | 位置 |
|---|---|
| 依赖零环 | `tsconfig.json`（17 references）、各 packages/tsconfig.json、apps/cli/tsconfig.json（098 注释） |
| cli→local-server 未声明边 | apps/cli/src/cli.ts:8 + apps/cli/tsconfig.json |
| settings 根耦合 | apps/cli/src/guide/settings.ts:24-26、98 |
| explain 不走 locale | apps/cli/src/guide/guideCommands.ts:42-62；glossary.ts:177；chat.ts:307-316 |
| web 独立 i18n | apps/web/src/i18n.ts:16-217（LANG_STORAGE_KEY=19、inferLang=172、getInitialLang=179） |
| parseArgs / 双别名 | apps/cli/src/cli.ts:115-141、854、1166 |
| 发布门禁 | benchmarks/runners/src/release-gates/gates.ts:43-52（8 门禁）、460-463（build）、560-573（ux-smoke） |
| 迁移清单 | apps/cli/src/migrate.ts:20-27 |
| 原子写 | packages/shared/src/atomicWrite.ts（renameWithRetry）vs ProviderStore.ts:485-529、CredentialStore.ts:88-107 |
| 状态根 ×7 | UsageStore.ts:354-361、settings.ts:24、defaultStore.ts:18-20、ReviewHandoffStore.ts:35、iteration-store.ts:38、HandoffStore.ts:25、project-task-queue.ts:80 |
| 双通道行为编译 | packages/behavior/src/compiler/Compiler.ts:23-55；compose.ts:219-222 |
| presets | packages/application/src/providers/presets.data.ts（73 预置） |