# 150 — 修复外部 harness adapter 对齐真实 CLI（本轮：opencode 已 live 验证）

- 编号：150
- 状态：部分合入（opencode 已修并 live 验证；codex/claude/dsh 受环境阻塞，如实登记）
- 优先级：P1（`--live` 基线的前置）
- 创建日期：2026-09-19
- 关联：`tasks/149`（发现与根因）、`tasks/151`（重跑基线 + 探针加严）、`docs/OPENCODE-ADAPTER.md`
- 执行器：指挥侧

## 1. 目标

把外部 harness adapter 从"本适配器请求的 JSON 契约"改到**真实 CLI 面**，使 `--live` 可跑。

## 2. 本机实测结论（2026-09-19，均带真实调用）

| harness | 真实 headless 调用 | 结果 |
|---|---|---|
| **opencode** | `opencode run --format json <task>` | **可用**（live 跑通，见 §4） |
| claude | `claude -p "<task>"` | **环境阻塞**：配置模型已停用（`API Error: 400 模型已关闭：deepseek-v4.1-flash-expires-on-0910`） |
| codex | `codex exec --skip-git-repo-check "<task>"` | **环境阻塞**：用量上限（`ERROR: You've hit your usage limit …`） |
| dsh | `dsh --profile headless "<task>"` | **不适用**：headless 会启动整套 MCP/OAuth 插件（分钟级启动、输出嘈杂），且**无 JSON 面** |

## 3. 已改（opencode，唯一可验证者）

- **驱动面改准**：`opencode run --format json <task>`（task 为位置参数；cwd = 隔离工作区）。
  旧的 `--workspace/--task/--json` 在真实 CLI 不存在。
- **新增 `parseOpencodeEvents`**：把真实 **JSONL 事件流**（`text`→finalText；`step_finish`→tokens）折合为
  `OpencodeRawRun`；兼容"单个汇总对象"面；坏行**计数不静默丢**。
- **spawn 层**：Windows 改 `shell:false`（`shell:true` 会按空格拆坏多词 task —— `tasks/149` 的根因②）。
- **测试**：`opencode.test.ts` **13 passed**（含新增 JSONL 折合 + 坏行计数 2 例）。
- **文档**：`docs/OPENCODE-ADAPTER.md` 的驱动面/输出面/本机实测改准。

## 4. 验收与实测

- 定向：`npx vitest run benchmarks/runners/src/adapters/opencode.test.ts` ⇒ **13 passed**；`tsc -b` exit 0。
- **live 判别证据**：`npx tsx benchmarks/runners/src/conformance/run-conformance.ts --scenarios B001 --live` ⇒
  `opencode × B001: run (ok) wall=21371ms in=49588 out=92`（改前为 `fail (opencode exited 1: <usage dump>)`）。

## 5. 未闭合（登记，供 `tasks/151`）

- **codex**：flag 已正确，但仍需 (a) 修 `shell:true` 拆词、(b) 解析 `--json` 的 JSONL 事件；**受配额阻塞，本轮无法 live 验证**。
- **claude**：flag 已正确，需修拆词；**受"配置模型已停用"阻塞**。
- **dsh**：需改 `dsh --profile headless <task>` + 纯文本解析（无 JSON ⇒ 指标 approx）；**headless 启动成本过高**，不适合 live lane。
- **探针**：仍只探 `--version` ⇒ 不可用 harness 会以 `fail` 而非 `skip` 出现在基线里（`tasks/151` 处理）。

## 6. 边界

- 只改 opencode adapter + 文档。codex/claude/dsh **不以未验证代码冒充修复**：各自环境可验证时再改。
