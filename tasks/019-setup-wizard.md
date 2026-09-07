# 019 — `cah setup` 交互向导（按 PROVIDER-UX-RESEARCH 规格实现）

- 状态：待执行
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：目标 goal-0a841d9d；依赖 014-018（ProviderStore SSOT 已就绪）+ 调研报告 docs/ideas/PROVIDER-UX-RESEARCH.md（派实现子代理前先读）

## 目标

把 `cah setup` 从骨架完善为交付级交互向导：进入 → 搜索选供应商 → 输 API key → 拉取模型列表 → 搜索+空格勾选模型 → 底部提交 → 写入 SSOT + 设为默认。交互规格**以 docs/ideas/PROVIDER-UX-RESEARCH.md 调研结论为准**（参考 Claude Code / Codex / cc-switch / opencode 的模型配置交互），不得凭空发挥。

## 验收标准

- [ ] 向导分步完整可走通：选供应商（搜索）→ key（掩码）→ 拉模型 → 勾选（搜索+空格）→ 提交确认
- [ ] 错误与重试引导：key 无效 / 拉模型失败 → 清晰提示 + 可选重试/跳过（不卡死）
- [ ] 供应商预设库（presets.ts 已有）在 picker 里可搜索；"自定义端点"路径可手动输 base-url
- [ ] mock 预设：提示内置无需配置
- [ ] 提交写入 ProviderStore（存在则确认覆盖）；问是否设为当前默认
- [ ] 非 TTY / CI 环境：清晰 fallback（不崩）
- [ ] 脚本化冒烟：用模拟 IO 喂输入走完整交互流，断言产物 ProviderConfig 正确（不依赖真 TTY）
- [ ] `npx vitest run` 全绿不回归；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `apps/cli/src/providers/setup.ts`（现有骨架 → 按规格完善）
- `apps/cli/src/providers/setup.test.ts`（新建：脚本化冒烟）
- `apps/cli/src/cli.ts`（cah setup 已接线，微调）
- `docs/V06-PROGRESS.md`

## 依赖

- 依赖任务卡：014-018（SSOT/命令已合入）、调研报告 PROVIDER-UX-RESEARCH.md
- 阻塞于：调研报告产出（子代理 6f2ac0d4 进行中）

## 设计锚点

- UI 库已装 @clack/prompts 1.7.0（search/select/password/multiselect/spinner 全可用）
- SetupIO 接口已定义（可注入模拟实现做脚本冒烟）
- 参考项目（调研报告应覆盖）：Claude Code /model、cc-switch Provider 向导（Fetch Models 按钮）、Codex config、opencode 模型选择
- 显式优先 + mock 内置语义沿用 ProviderStore 约定

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
