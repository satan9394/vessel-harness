# 016 — `cah provider` 命令组：list/add/remove/switch/current

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：CHANGELOG.md V0.6（provider 命令组）。
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：依赖 014；目标 goal-575e1e4b

## 目标

`cah provider` 命令组管理供应商配置（对标 `cc-switch provider list/switch/add/...`）：list/add/remove/switch/current。一键切换当前默认供应商。

## 验收标准

- [ ] `cah provider list`：列出所有供应商 + 标记当前默认
- [ ] `cah provider add <name> --protocol <p> [--base-url] [--api-key] [--model]`：新增（交互式缺参提示或用 flags）
- [ ] `cah provider remove <name>`：删除（mock 不可删；确认提示）
- [ ] `cah provider switch <name>` / `cah provider use <name>`：切换当前默认（写 current）
- [ ] `cah provider current`：显示当前
- [ ] 错误路径：未知供应商/重复/缺参 → 明确报错 + 退出码
- [ ] Vitest：命令分发 + 各子命令（可经 ProviderStore rootDir 注入隔离测试）
- [ ] `npx vitest run` 全绿；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件

- apps/cli：provider 命令组（在现有 parseArgs/cmdRun 结构上扩展子命令解析）
- 测试 + `docs/V06-PROGRESS.md`

## 依赖

- 依赖任务卡：014
- 阻塞于：014 合入

## 设计锚点

- 命令风格对齐现有 CLI（flag 解析 + cmdXxx 结构 + 帮助文案）
- mock 内置不可删；switch 到不存在的 id fail loud
- 交互式 vs flags：本项目 CLI 是 flags 风格（--provider 等），add 用 flags 传参，缺省给默认值

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
