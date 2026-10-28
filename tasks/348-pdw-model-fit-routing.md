# T348 · PDW 角色路由按模型能力适配（仅 Vessel）

- Status: 已完成（2026-10-26）
- PDW task: none（项目级配置改动，未走运行器）
- Mode: standard（配置 + 文档）
- Source: human-requested
- Risk: low（只改 `.pdw/config.json` 的档位与一条 guidance；不动模型与限额）

## Goal

按「读多交给 DeepSeek、写留给 Codex、子 Agent 只做只读」的判据，把 Vessel 的角色配置调到能反映真实成本与失败代价：

1. `planner` 的 `reasoning_effort` 由 `high` 提到 `max`（默认关闭，只有契约 `planner: true` 才启用；规划是低频且最吃思考的一步）。
2. `implement` 的 `prompt_guidance` 补一条：scope 超过 6 个文件或需要铺开读大范围代码时，可 spawn `pdw_explorer`（Luna high，只读）并行摸底；不得让它改文件，也不得把它的结论当成验收。
3. 其余角色（scan / test-plan / implement / review）的模型与档位不变：DeepSeek `high` / `high` / `max`，Codex `gpt-6.1-sol` `medium`。

## Not Doing

- 不改 `backend` / `model` / `limits`。
- 不给 repair 单独配模型（当前 `pdw.mjs` 里 repair 直接复用 implement 配置，属机制限制，改它必须走上游）→ 记为已知限制。
- 不改另外三个项目的配置。
- 不 commit / push。

## Acceptance

- AC1：改前备份存在（`.pdw/config.bak-20261026-model-fit.json`）。
- AC2：`git diff` 只在 `.pdw/config.json`（该文件被 gitignore，故以备份 vs 现值的字段对比为准）。
- AC3：`doctor` exit 0，五角色 ready，planner 的 `effective_model` 带 `#max`。
- AC4：implement 的 `prompt_guidance` 含 "pdw_explorer" 与"只读"两个关键词。

## Blast Radius

`Vessel_Harness/.pdw/config.json`（gitignore 内）。回滚：用备份覆盖。

## Expected Evidence

备份文件、字段对比输出、`doctor` 的 JSON。

## Result

已完成。备份 `.pdw/config.bak-20261026-model-fit.json`；与备份逐字段对比，只有两处变化：

- `planner.reasoning_effort`: `high` → `max`
- `implement.prompt_guidance`：追加子 Agent 规则（scope >6 文件或需铺开读时可 spawn `pdw_explorer`，只读、不得改文件、结论不算验收）

`limits` 与其余角色逐字段未变。`doctor` exit 0，五角色 ready，`effective_model` 为：scan `#high`、test-plan `#high`、implement `gpt-6.1-sol`、review `#max`、planner `#max`。

已知限制：`repair` 复用 `implement` 配置（`pdw.mjs` 里固定映射），所以"小修小补降档"当前做不到，要改必须走上游。

**后续（同日，方案 A）**：implement `prompt_guidance` 里那句「scope >6 文件时 spawn `pdw_explorer`」已删除（PDW 车道不派子代理）；planner `max` 保留。
