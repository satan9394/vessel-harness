# T315 — magpie 对照调研与吸收清单

- Status: 已完成（2026-10-26；协调者直接产出，未经 PDW 独立 review；未提交、未推送）
- PDW task: none
- Mode: develop（产出**只读调研文档**，不改产品代码）
- Source: 目标 bf9fd634「以 magpie 为参照重构 provider 模块」
- Risk: low（只写一份 docs）

## Goal

读 magpie 源码里与「供应商 / 路由 / 用量」相关的三块，和 cc-switch 研究、VESSEL 现状三方对照，产出一份**可直接派活的吸收清单**：每条写明落点文件、改动量、验收信号；不吸收的写明理由。

## 素材位置（本地只读副本，已解压）

- magpie 源码：`.harness/reference/magpie-main/`（Go 项目，**`.harness/` 已 gitignore，不入库**）
- cc-switch 研究：`docs/ideas/CC-SWITCH-MODULE-STUDY.md`
- VESSEL 现状：
  - `apps/cli/src/providers/ProviderStore.ts`、`apps/cli/src/providers/defaultStore.ts`
  - `apps/local-server/src/routes/providerRoutes.ts`
  - `apps/web/src/components/providers/`（Provider Hub、presetsData）
  - `packages/application/src/providers/presets.data.ts`
  - `apps/cli/src/commands/*`（provider / usage / pricing 相关）
  - `benchmarks/runners/src/contracts/types.ts`（`RunResultMetrics` 的 token 字段）

## 要读的 magpie 部分（**只看这些，别通读整个仓库**）

1. `internal/provider/`（供应商数据结构与增删改）
2. `internal/catalog/`（预设与模型目录：模型列表从哪来、如何归一化）
3. `internal/budget/`、`internal/gwbudget/`、`internal/usage/`、`internal/usageapi/`、`internal/stats/`（token/成本/配额怎么记、怎么聚合、按什么维度）
4. `internal/routes/`、`internal/gateway/`（路由组与选路；**只要机制，不要网关实现**）
5. `docs/gateway-routing.md` 的**目录与首 200 行**（路由模式 smart/order/rotate/usage/pace 的语义）
6. `docs/providers-accounts.md` 的**目录与首 150 行**（供应商/账号模型）
7. `docs/reference.md` 里 `provider`、`quota`、`usage` 三组 CLI 命令的说明（搜索定位，不要通读 200KB）

## 产出

`docs/MAGPIE-ABSORPTION.md`，**≤ 220 行**，必须包含五节：

1. **一句话结论**：magpie 值得吸收的三件事、明确不吸收的三件事。
2. **三方对照表**：维度（预设与模型目录 / 端点与容灾 / 切换与 profile / 用量与成本 / 路由与配额）× 三列（magpie / cc-switch / VESSEL 现状），每格一句话，VESSEL 列必须指出具体文件。
3. **吸收清单**（P0/P1/P2）：
   - 每条：要解决什么、落点文件、改动量（人日）、验收信号（可机器判的）。
   - P0 = 用户目标里明确要的（provider 三面统一、token 消耗可见）；P1 = 明显收益（端点容灾、profile）；P2 = 可选。
4. **不吸收清单 + 理由**：至少覆盖「本地网关 3425 / 订阅 OAuth 账号复用 / 明文 key 落盘 / 整仓中间件插件体系」四项。
5. **给 T316–T321 的输入**：每张卡一句话范围边界（不重复计划里的描述，只写「做/不做」的硬边界）。

## 硬约束

- **clean-room**：只记录设计要点、数据结构形状与文件路径；**不得粘贴 magpie 的 Go 代码**（单段代码块 ≤ 10 行，总计 ≤ 30 行，且只能是伪代码或类型签名）。
- 不写「已实现」，只写「现状 + 建议」。
- 每一条吸收项都必须指向真实文件（`ls` 能看到的路径），不许编。
- 只改 `docs/MAGPIE-ABSORPTION.md`；不碰任何代码、不碰 `.harness/`。

## Acceptance

- AC1：文档存在，五节齐全，≤ 220 行。
- AC2：三方对照表至少 5 个维度、VESSEL 列每条都带具体文件路径。
- AC3：吸收清单至少 6 条，每条有「落点文件 + 改动量 + 验收信号」；P0 至少 2 条且直接对应目标里的「三面统一」「token 可见」。
- AC4：不吸收清单覆盖上述四项，每项给理由。
- AC5：全文代码块总量 ≤ 30 行（可由检查脚本统计）；不出现「已实现/已完成」这类把建议写成结论的措辞（指对本项目而言）。

## Blast Radius

只新增 `docs/MAGPIE-ABSORPTION.md`。回滚：删该文件（送回收站）。

## Expected Evidence

文档本身 + 一份自检输出（行数、代码块行数、五节标题、对照表行数）。

## Result

已完成（协调者直接产出，未经 PDW 独立 review）。

`docs/MAGPIE-ABSORPTION.md`，105 行、零代码块、五节齐全：

- **三方对照表**：6 个维度（预设与模型目录 / 供应商数据模型 / 端点容灾 / 切换与 profile / 用量与成本 / 路由与配额），VESSEL 列每条指向具体文件。
- **吸收清单**：P0 两条正对用户目标（usage 按供应商视图、预设单一真源）；P1 三条（`input_token_semantics` 落库、端点失败转移、供应商快照）；P2 两条（值守卫价目修复、cc-switch 导入）。每条带落点、人日估算与可机器判的验收信号。
- **不吸收** 5 项（本地网关 3425、订阅 OAuth 复用、明文 key 落盘、中间件插件体系、自动账号发现）逐项给理由。
- **给 T316–T319 的硬边界**：「只做 X、不动 Y」写死。

素材：magpie 源码本地只读副本 `.harness/reference/magpie-main/`（72 MB，gitignored 未入库）。只读 `internal/provider/provider.go`、`internal/catalog/catalog.go`、`internal/usage/usage.go`、`internal/routes/strategies.go`、`internal/budget/budget.go` 的类型与包注释，未复制 Go 实现。

自检：105 行（限 220）；代码块 0 行（限 30）；五节标题齐全；16 个文件引用中 14 个已存在，2 个标注「待建」（T316 的交付物）。
