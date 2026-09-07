# V0.7 执行进度（V07-PROGRESS.md）— cah 交互 TUI + 50+ 供应商 + 三档权限

> 接力文档：personal-dev-workflow 拆卡（tasks/ 看板 020-022）。
> 触发：用户睡前反馈（供应商太少 / 应一条 cah 进交互 / 三档权限对齐）。
> 目标文档：docs/PROVIDER-CATALOG.md（供应商目录）、docs/ 交互用法。
> 最后更新：2026-09（夜，拆卡完成，调研子代理 0a239131 执行中）。

## 0. 基线

- 全量 258 测试绿；tsc exit 0。
- 现状侦察结论：policy 三档 profile 机制已实现（read-only 禁写 / workspace-write danger 要 approval / approval never fail-closed）；loadPolicyArtifacts 已支持 sessionOverrides{approval,profile}（运行时切换入口就绪）；apps/cli package.json 已有 bin:{cah: dist/cli.js}（npm link 即有全局 cah）；cli 无参现走 run（要改成进 TUI）。

## 1. 里程碑状态

| 里程碑 | 任务卡 | 状态 |
|---|---|---|
| 供应商目录 50+ | tasks/020-provider-catalog-50.md | 待执行（等调研全表） |
| cah 交互 TUI | tasks/021-cah-tui.md | 待执行（等调研架构方案） |
| 三档权限 | tasks/022-permission-modes.md | 待执行（机制已备，做切换+测试） |

## 2. 决策/教训

- 权限三档复用既有 policy profile（不新造）；切换走 sessionOverrides。
- 全局 cah = apps/cli bin（npm link）。
