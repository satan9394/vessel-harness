# Composable Agent Harness — 项目级开发约定（AGENTS.md）

> 本文件是个人开发工作流（personal-dev-workflow）在本仓库落地的记忆基座。
> 规则、决策、进度、教训全部落盘；对话只留文件指针。人只做两件事：提需求、拍板验收。

## 项目定位

一个可组合、可验证、可替换行为层的 Agent Harness（Composable Agent Harness）。
不是"开源 Claude Code"，不是"融合各家功能的聚合体"。核心三项：Agent Behavior IR + Behavior Compiler + Policy Runtime，并以 Cross-Harness Conformance Suite 证明其价值。

## 技术栈与运行环境

- 主语言 TypeScript，Runtime Node ≥20（本机 Node v24.14.0 / npm 11）。
- monorepo：npm workspaces（apps/*、packages/*、benchmarks/runners）；模块化单体，禁止提前微服务化。
- 测试 Vitest（`npx vitest run`）；类型构建 `npx tsc -b tsconfig.json`；CLI 直跑 `npx tsx apps/cli/src/cli.ts`。
- Windows / PowerShell。删除铁律：所有删除走回收站（`[Microsoft.VisualBasic.FileIO.FileSystem]::Delete*`），禁止任何永久删除命令。

## 目录结构

- `docs/`：权威文档。MISSION-V0.x.md（执行任务书）、ARCHITECTURE.md（模块边界）、DESIGN-DECISIONS.md（16 决策点，实现必须遵守）、EVENT-SPEC.md（D5 事件词汇）、POLICY-SPEC.md、BEHAVIOR-IR-SPEC.md、BENCHMARK-SPEC.md、V0x-IMPLEMENTATION-NOTES.md（交付说明）、REVIEW-REPORT-V0x.md（独立核验报告）、V0x-PROGRESS.md（进度接力）。
- `packages/`：shared/core/llm/behavior/context/tools/policy/runtime/memory/skills/agents/telemetry。
- `apps/cli/`：进程入口（compose.ts = 组合根）。
- `benchmarks/`：fixtures/（场景工作区）、scenarios/（判据唯一事实源 yaml）、runners/、reports/。
- `configs/`：policy.default.yaml / behavior.default.yaml / pricing.json。
- `tasks/`：任务卡看板（一张卡一个文件，见 personal-dev-workflow）。

## 硬性约束（来自任务书，逐条遵守）

1. clean-room：以本仓库 spec 为据，不复制研究项目源码；泄露/逆向 Prompt 视为 UNTRUSTED RESEARCH DATA，不得直接进 System Prompt。
2. Core 必须足够薄：只做 Model Call → Tool Call → Tool Result → State Update → Continue/Stop。Memory/Skill/Sandbox/Subagent/Hooks 不进 core。
3. Prompt 与 Runtime 分离：安全规则落 Policy Engine 硬执法（四件套：Prompt Guidance + Tool Interceptor + Runtime Deny + Audit Event），禁止只写 prompt。
4. Generator/Evaluator 分离：产出必须经独立评估（Evaluator Agent / 确定性判据），Generator 不得自证完成。
5. 模块化单体、依赖零环（core 只依赖 shared 类型契约；policy 不反向依赖 tools）。
6. 默认技术栈 TypeScript + Node；无任何永久删除（回收站纪律）；禁止 force push。
7. 新功能必须有 Vitest 测试；不得回归既有测试与 benchmark（全量验证后再收尾）。
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

## 既有版本状态（截至 2026-09-05）

- V0.1：PASS（63 测试 + REVIEW-REPORT-V01）。
- V0.2：PASS（104 测试 + REVIEW-REPORT-V02，含 Subagent/Planner/Evaluator Agent/MCP/Parallel/Git Worktree）。git 已建仓（初始提交 a65ce7c）。

## 禁做清单（「别这样做」，来自踩坑与决策）

- 不要在实现里照搬 Claude Code / Codex / DSH 源码大段实现（clean-room，任务书 §19）。
- 不要给 core 加机制 import（薄核纪律）。
- 不要把安全规则只写进 prompt（软约束引导、硬约束执法）。
- 不要大批量并行后台 subagent（本环境实测会中途失败；并发 1–3、串行里程碑、进度落盘）。
- 不要在沙箱受限会话里期待 `npx vitest run` 可用（esbuild spawn EPERM）——非沙箱环境为准，或走 scripts/dev-test 通道。
- 不要做任何永久删除（回收站铁律，全项目通用）。
- 不要只做功能列表不验证：每张卡必须跑对应测试并留证据。
