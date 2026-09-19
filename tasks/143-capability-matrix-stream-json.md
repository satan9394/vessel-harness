# 143 — CAPABILITY-MATRIX：`stream-json` 缺口登记 + 陈旧 `vessel mcp` 口径收口

- 编号：143
- 状态：已合入（2026-09-18）
- 优先级：P2（诚实化：能力矩阵与事实一致）
- 创建日期：2026-09-18
- 关联：`docs/product-audit/CAPABILITY-MATRIX.md`、`docs/V1.6-STABLE-CHECKLIST.md` §未闭合清单第 9 条、`tasks/127`（`vessel mcp`）、`tasks/140`（文档残余扫描 #2）
- 执行器：指挥侧

## 1. 目标

按 `V1.6-STABLE-CHECKLIST` 第 9 条，把 `run --output-format stream-json` 在能力矩阵里
**登记为"仍缺 / 可选增强（无消费方不做）"**；顺带修正同文件里与之相邻、且已被实测推翻的
陈旧口径——`vessel mcp` 早已交付（task 127），矩阵多处仍写"缺 CLI 出口"。

## 2. 改动（纯文档）

| 位置 | 陈旧处 | 改为 |
|---|---|---|
| §13 Headless（`:134`） | "仍缺 stream-json"（无处置口径） | 补"**已登记为可选增强（无消费方不做）**" + 指向 §6-3 / checklist |
| §14 MCP 结论（`:141`） | "管道已通、缺 CLI 出口" | "**CLI/TUI 出口已交付**（task 127/129）" |
| §4.2 常见能力（`:189`） | "MCP（库级有 / CLI 缺 `vessel mcp` 子命令）" | "MCP（**库级 + CLI/TUI 出口均已交付**，task 127/129）" |
| §4.4 缺口 #3（`:207`） | "`run --json` 已补，仍缺 stream-json" | "`--json` **已交付**；stream-json **登记为可选增强、无消费方不做**" |
| §6-2（`:245`–`249`） | 标题 ◐ 现状 / "CLI 无配置命令" / "建议值得做" | 标题 **已交付**；现状改为 127/129 已交付；建议改为已交付 |
| §6-3（`:251`–`255`） | 标题 ◐ 现状 / "通用 run 无结构化契约" | 标题 `--json` 已交付 / stream-json 可选增强；现状/建议同步 |
| §8 结论摘要（`:313`） | "仍缺 `vessel mcp` 子命令与 stream-json" | "**均已交付**（127 / Round 130）；stream-json 可选增强" |

## 3. 验收与实测

- 门禁（纯文档仍跑）：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` exit 0
  （根 **178 文件 / 2236 passed + 6 skipped**；web **11 文件 / 120 passed**）、
  web `vite build` exit 0、CLI 冒烟 exit 0。
- 核验：全文件 `grep` 后 "缺 `vessel mcp` 子命令" **零命中**；`stream-json` 三处
  （§13 / §4.4 / §6-3）口径一致 = **可选增强、无消费方不做**。
- 判别性证据：纯文档，测试数字与基线逐字一致 ⇒ 无回归。

## 4. 边界

- 只改 `docs/product-audit/CAPABILITY-MATRIX.md`；不动代码、不动断言。
- 不改该文件里其它已核实的历史判断（如 §6-1 发行渠道仍缺、§6-4 快照回滚仍待做）。
