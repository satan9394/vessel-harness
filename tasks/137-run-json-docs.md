# 137 — `run --json` 文档补齐（核实后）

- 编号：137
- 状态：已合入（2026-09-18；实现早已存在，本卡只补文档）
- 优先级：P4（文档缺口，无行为改动）
- 创建日期：2026-09-18
- 关联：`tasks/124`（Round 124「仍开放」①提到"`run --json` 文档缺 durationMs 与拦截审计"）
- 执行器：指挥侧

## 1. 核实结论

**实现早已完整**：`apps/cli/src/cli.ts` 的 `run --json` 出口 `emitJson({ kind, finalText, steps, toolCalls, durationMs, turnId, sessionLog, enforcement })`（`enforcement = enforcementTelemetryDoc(harness)`）。Round 124 记的"文档缺"是**README 命令表未写字段**，不是实现缺失。

## 2. 改动（纯文档）

`README.md` 命令表 `vessel run` 行补一句：

> `--json` 时 stdout 只出一段 JSON（`kind`/`finalText`/`steps`/`toolCalls`/`durationMs`/`turnId`/`sessionLog`/`enforcement`）

## 3. 验收与实测

- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 + web 全绿。
- 核验：README 命令表 `run` 行含上述字段串，且与 `cli.ts` 的实际 emit 键**逐字对应**（8 个键）。
