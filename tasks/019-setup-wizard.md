# 019 — `cah setup` 交互向导（按 PROVIDER-UX-RESEARCH 规格实现）

- 状态：已合入（2026-09-05，指挥按调研规格实现并验收）
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：目标 goal-0a841d9d；依赖 014-018 + 调研报告 docs/ideas/PROVIDER-UX-RESEARCH.md

## 目标

把 `cah setup` 从骨架完善为交付级交互向导：进入 → 搜索选供应商 → 输 API key → 拉取模型列表 → 搜索+空格勾选模型 → 底部提交 → 写入 SSOT + 设为默认。交互规格以 docs/ideas/PROVIDER-UX-RESEARCH.md 调研结论为准。

## 验收标准

- [x] 向导分步完整可走通：选供应商（autocomplete 搜索）→ key（password 掩码）→ 拉模型（spinner）→ 勾选（autocompleteMultiselect 搜索+空格）→ 汇总 confirm 提交
- [x] 错误与重试引导：key 401/403 → 重试 ≤3 次；404/405/网络失败 → 转手动填模型 id 出口（不静默保存）
- [x] 供应商预设库在 picker 可搜索；"自定义端点"路径手动输 base-url（sanitizeId 派生 id）
- [x] mock 预设：提示内置无需配置
- [x] 提交写入 ProviderStore（存在则 confirm 覆盖）；问是否设为当前默认；终屏汇总（key 尾号/模型数/作用域 ~/.dsh）
- [x] 非 TTY/CI 环境：清晰 fallback 提示不崩（实测 exit 2 + 引导文字）
- [x] 脚本化冒烟：SetupIO 注入假实现走完整流（8 用例：全流程/mock/取消/幂等 key/手动降级/自定义/写前取消/maskKey）
- [x] `npx vitest run` 全绿不回归（258）；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `apps/cli/src/providers/setup.ts`（升级：autocomplete 系 + 幂等 key + 错误阶梯 + 汇总屏 + fetchModels 注入）
- `apps/cli/src/providers/setup.test.ts`（新建：8 脚本化用例）
- `apps/cli/src/cli.ts`（cah setup 已接线，非 TTY fallback）
- `docs/V06-PROGRESS.md`

## 依赖

- 依赖任务卡：014-018、调研报告 PROVIDER-UX-RESEARCH.md（子代理 6f2ac0d4 产出）
- 阻塞于：调研报告产出

## 设计锚点

- UI 库 @clack/prompts 1.7.0：autocomplete/autocompleteMultiselect/groupMultiselect/password/spinner 全确认可用
- SetupIO 接口注入（脚本化冒烟）；WizardDeps.fetchModels 注入（测试免真实网络）
- 参考：opencode /connect+/models（幂等跳步反例）、cc-switch Fetch Models + 错误四类降级、Claude /model 作用域明示
- 显式优先 + mock 内置语义沿用 ProviderStore 约定

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：setup.ts 升级 + setup.test.ts 8 用例；全量 258 用例全绿、tsc exit 0；非 TTY fallback 实测 + clack TTY 渲染探针通过

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收，commit dc8ba68）
- 备注：执行记录——调研子代理 6f2ac0d4 成功产出 13 章规格报告；实现子代理 baae4cf5 约 8 分钟零产出被中断，指挥按规格直接实现（延续教训 1/7：本环境子代理"读多锚点再实现"不可靠，指挥实现最稳）。规格五处升级（搜索化/幂等/降级/汇总/缓存）全落地。
