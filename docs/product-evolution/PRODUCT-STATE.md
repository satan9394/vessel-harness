# PRODUCT-STATE — Vessel 产品演进状态（Orchestrator 维护）

> 每轮结束更新。本轮 = Product Evolution Orchestrator 第 1 轮（Phase 1–8）。
> 相关产物：`docs/PROJECT-BRIEF.md`、`docs/product-audit/*`（4 份独立审计）、`docs/product-evolution/PRODUCT-GAP-MAP.md`、`IMPLEMENTATION-BRIEF-01.md`、`IMPLEMENT-BRIEF-01-STATE.md`、`EVALUATION-BRIEF-01.md`、`EVALUATION-REPORT-01.md`（待）。

## 当前成熟度

| 维度 | 评估 |
|---|---|
| 内部工程成熟度 | **高** — 依赖零环、8 道发布门禁、1225+ 测试、存储层原子写与凭据纪律（审计一致确认） |
| 对外可启动成熟度 | **本轮前：低**（新用户无法自行完成第一次成功使用）；**本轮后：显著改善**（首跑示例可用、未知命令不再静默） |
| 差异化护城河 | **稳固** — Behavior IR + Policy 编译四伪物硬执法、Generator/Evaluator 分离 + review 交接单、供应商管理纵深 + 本地价格库（7 竞品均无持久成本库） |
| 主要短板 | i18n 无统一架构（三套 locale 互不相通）；web 游离 `tsc -b` 图外；CLI 顶层无异常兜底；usage.json 损坏静默丢历史；密钥暴露面（DPAPI 命令行传参） |

## 已解决问题（本轮 NOW 切片）

- **G-01（P0）首跑示例失效**：仓库工作区 `run --prompt` 曾 100% 输出 `(mock: no script entry matched)` 且 exit 0（假成功）。根因：ContextBuilder 将 volatile skills index 作为**最后一条 user 消息**追加，MockProvider 只匹配最后一条 user 消息。修复：`ChatMessage.source` 溯源 + Builder 标记 volatile 为 `environment` + MockProvider 只匹配真实 surface 输入 + 确定性兜底文案。
- **G-02（P0）未知命令静默 run**：`vessel foo`、`vessel chat` 曾静默跑一次 mock 任务并 exit 0。修复：main() 未知子命令 → stderr「未知命令 <x>。可用：vessel --help」+ **exit 2**（实测）。
- **G-14（文案）**：TUI 欢迎语补 `/explain`·`? <术语>`·`vessel guide`；`cah *` 经核验为审计**误报**（仅测试临时目录名命中），未做无谓改动。
- 附带：空工作区/无 README 时给友好提示，不再把裸 `TOOL_FAILURE` 当"最终回复"。

验收侧证据（Orchestrator）：`tsc -b` exit 0；`vitest` 113 文件 **1225 passed + 1 skipped**；CLI 冒烟 A–E 全通过；`source` 经查不进入任何真实 provider 请求体（三路均显式挑字段）。**独立 Evaluator 裁定：待回填。**

## 仍存在缺口（按路线图）

- **NEXT（低成本高价值，建议下一轮 NOW）**：G-03 CLI 顶层 `main()` 无 catch（配置损坏即裸栈崩溃、无恢复指引）；G-07 `apps/web` 游离 `tsc -b` 图外（类型错误可静默过 8 道门禁）；G-12 `apps/cli/tsconfig.json` 缺 `local-server` reference（干净 clone 构建顺序脆弱）；G-09 TUI 会话内成本可见性（数据已采集只缺展示，直击 deepseek-flash 成本波动痛点）。
- **LATER**：G-04 usage.json 损坏静默清零 + 无备份轮转（数据丢失类）；G-05 密钥暴露面（DPAPI 经 PowerShell 命令行传密钥 ×  openai-compatible 错误体回显 500 字符 ×  secrets 损坏默认不恢复）；G-10 会话续跑 + 会话级快照回滚；G-11 CLI 面 MCP 配置命令 + 通用 JSON 出口；G-13 TUI/CLI 命令面不一致、`/permission` 不持久、theme 无消费者。
- **NOT_NOW（主动拒绝）**：G-06 全量 i18n 改造（成本≈全量改造、当前用户仅中英）；G-08 `~/.vessel` 状态根 7 处重复的重构（可小步缓行）；G-15 原子写 wrapper 重复（P4）；竞品形态追逐（插件市场 / 消息平台 / 云协作 / 大众榜单 / IDE·桌面表面）——竞品审计已逐条论证不做。

## 新发现问题（本轮过程中）

1. **提交者把 WIP 交证落盘的链条很脆**：连续 3 个 Implementer 在"读文件/跑命令"阶段失败（本环境子代理执行长命令会中断）→ 应对：改用**写入型窄任务**（禁跑命令）+ 由指挥跑验证 + 保命 WIP 提交。
2. **第 4 轮 Implementer 引入语法回归**（模板字符串内嵌反引号 → TS1005，连带两个测试套件 transform 失败）——被验收侧复跑即时捕获，FIX 阶段修复。**教训：写入型执行器虽能完成，但必须强制验收侧复跑 tsc/测试**（否则该回归会静默进主干）。
3. **审计报告存在误报**（G-14 的 `cah *`）——印证"审计结论必须经证据核验"，不可直接当工单执行。

## 当前最高价值下一步

按 NEXT 组选**下一轮 NOW 切片**：优先 **G-03（CLI 顶层异常兜底）**——它是本轮 G-02 的自然延伸（同一处入口），一次改动消除"配置损坏 → 裸栈崩溃、无恢复指引"这一整类用户可见故障；可与 **G-12（tsconfig 补边，极低成本）** 合为一个小切片。

## 纪律

- 并发执行器上限 2；一卡一执行器；删除走回收站；密钥不落盘；测试隔离（`VESSEL_*_ROOT` 注入）。

## 技术债

G-15 原子写 wrapper 各 Store 重复（P4）；architecture 审计的 T1–T9 清单（详见 `docs/product-audit/ARCHITECTURE-REPORT.md`）。

## 风险

- 执行器不稳定（长命令必中断）→ 已确立"写入型执行器 + 指挥验证 + 独立静态 Evaluator"三件套；
- 独立 Evaluator 本轮连败 2 次（需跑命令）→ 降级为静态对抗审查（附指挥原始证据），**独立性靠"新上下文 + 对抗立场"维持，并在报告中如实标注"命令未复跑"**。
