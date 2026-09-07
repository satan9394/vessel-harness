# V0.7 执行进度（V07-PROGRESS.md）— cah 交互 TUI + 50+ 供应商 + 三档权限

> 接力文档：personal-dev-workflow 拆卡（tasks/ 看板 020-022）。
> 触发：用户睡前反馈（供应商太少 / 应一条 cah 进交互 / 三档权限对齐）。**已完成**。
> 调研：docs/ideas/PROVIDER-TUI-RESEARCH.md（40KB，供应商全表 + opencode TUI 架构 + 权限矩阵）。
> 最后更新：2026-09（**V0.7 三卡全部合入**，276 测试绿）。

## 0. 基线

- 全量 276 测试绿；tsc exit 0。
- 提交链：03ebc8d（调研）/ 4e8f719（权限）/ a14a468（52 供应商）/ dc99a50（cah TUI）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| 供应商目录 50+ | tasks/020-provider-catalog-50.md | 已合入 a14a468（52 条数据化目录，四类覆盖） |
| cah 交互 TUI | tasks/021-cah-tui.md | 已合入 dc99a50（cah 无参进 TUI + 斜杠 /provider /models /permission /help /quit） |
| 三档权限 | tasks/022-permission-modes.md | 已合入 4e8f719（--permission + PolicyLoader sessionOverrides profile bug 修复 + 3 测试） |

## 2. 决策/教训

- 权限三档复用既有 policy profile（命名本就是 read-only/workspace-write/danger-full-access）；**修复 PolicyLoader bug**：sessionOverrides.profile 声明了但从未应用。
- 供应商目录数据化：52 条（宁少而准，长尾分销站不收，custom base-url 兜底）；MiniMax 端点修正 minimaxi.com。
- TUI 按调研方案：readline 主循环 + 斜杠复用现有函数 + 会话级 harness；不引 React/ink。
- 用户核心诉求已落地：`cah` 一条命令进交互（opencode 式），供应商配置融入界面。
- 教训：实现子代理多轮零产出 → 指挥直接实现（延续教训 1/7）；chat.test REPO_ROOT 层级陷阱（tui/ 深一级需 4 级 ../）。
