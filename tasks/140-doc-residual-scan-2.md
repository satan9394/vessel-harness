# 140 — 外部文档残余扫描 #2：把未覆盖的 living docs 与事实对齐

- 编号：140
- 状态：已合入（2026-09-18）
- 优先级：P2（诚实化：文档与代码不一致）
- 创建日期：2026-09-18
- 关联：`tasks/123`（文档对账 #1，覆盖 README/AGENTS/V1.0/V1.1/SECURITY/CAPABILITY-MATRIX/ARCHITECTURE/POLICY-SPEC/EVENT-SPEC）
- 执行器：指挥侧（只读扫描由子代理完成）

## 1. 扫描范围

上一轮（卡 123 的 §1.2）已扫 README / AGENTS / V1.0 / V1.1 / SECURITY / PROJECT-BRIEF / WORKSPACE-LIFECYCLE / PROVIDER-MANAGEMENT / CAPABILITY-MATRIX / ARCHITECTURE / POLICY-SPEC / EVENT-SPEC / adapter docs。本轮补扫**其余 living docs**（排除 `product-evolution/**`、`product-audit/**`、`*-ADAPTER.md`、`ideas/**`、`research/**`、`MISSION-V0.*`、`V0x-*`、`REVIEW-REPORT-*`）。

## 2. 修正（纯文档 + 一处代码注释）

| 文件 | 陈旧处 | 改为 |
|---|---|---|
| `docs/PROVIDER-INTEGRATION.md` | 协议表只有 openai-compatible/anthropic/mock | 补 **opencode-go** 行（`OpencodeGoProvider`，真实模型 lane 默认 provider，task 102） |
| `docs/PROVIDER-INTEGRATION.md` | `npx vitest run  # 全量 211` | `npm run test:all`（两个 root） |
| `docs/VESSEL.md` | 斜杠命令列表缺 `/cost` `/mcp` `/diff` | 补齐 |
| `docs/VESSEL.md` | `npx vitest run # 全量测试（当前 285 绿）` | `npm run test:all` + 当前数字 |
| `docs/VESSEL.md` | `vessel --version` → `v0.1.0` | `v0.10.0` |
| `docs/VESSEL.md` | "三角色……不实现成代码 preset" | 已落为代码 preset（`packages/agents/src/presets/`） |
| `docs/SAFETY-BENCHMARK.md` | 表头/表项/`offline.ts` 段称 **S008 未接线、gate 5 实跑 7 个** | 更正为 **8 个均有执行路径并已实证**（Round 41 接线；该文件自己的后文早已如此写，前后矛盾） |
| `docs/TASK-QUEUE-ITERATION-STORE.md` | 状态机与字段表缺 `paused`（066） | 补 `paused` |
| `docs/REAL-MODEL-LANE.md` | 场景集 **21**、`runnable=false` **8**（B016-B023）、"streaming/interrupt/steering/resume 尚无资产" | **25**、**12**（B016-B027）、V1.1-D 已补 B024-B027 |
| `benchmarks/runners/src/lane/real-model-lane.ts`（注释） | 文件头 "B001-B023 + S001-S008, 21 entries" | "B001-B005 + B016-B027 + S001-S008, 25 entries"（与同文件 `:72` 的 25 一致） |

## 3. 验收与实测

- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **178 文件 / 2236 passed + 6 skipped** + web **11/120**。
- 核验：`PROVIDER-INTEGRATION` 协议表含 opencode-go；`VESSEL.md` 版本行为 `v0.10.0`、斜杠列表含 `/mcp` `/diff`；`SAFETY-BENCHMARK` 表头为"8 个均有执行路径"；`REAL-MODEL-LANE` 为 25/12；`real-model-lane.ts` 头注与 `:72` 同为 25。
- 扫描子代理另报 3 条"历史记录/措辞张力"（`REAL-*-ADAPTER.md` 的 066/064 前置语、`BEHAVIOR-DEFAULTS.md:97` 的当时 web 82、`REAL-MODEL-LANE.md:9` 的固定模型常量）——**均属当时记录或另一套常量，不算矛盾**，未改。

## 4. 边界

- 不追改 `product-evolution/**` 的历史 Round 段（已在 `PRODUCT-STATE` 顶部标"历史层"）。
- 不追改 `EVALUATION-REPORT-*`（已标"不追改"）。
