# 117 — 交互引导体系（术语中英双语解释 + 设置引导）

- 编号：117
- 状态：待执行
- 优先级：P1（用户明确需求：引导式交互——输入术语给中英文解释；设置项带说明）
- 创建日期：2026-09-10
- 关联：116（提示词工程引导线，独立并行）；CLI（apps/cli/src/cli.ts）+ TUI（tui/chat.ts）；055 预设
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标（用户需求转译）

构建 CLI/TUI 的**引导/解释体系**：
1. **术语中英双语解释**：输入任意术语（内建词库，如「小小蜜/小蜜」「Call（调用）」「Collect（收集/聚合）」
   「主题 theme」「中英文 locale」等）→ 给出**中文解释 + 英文术语 + 一句话用途**。
2. **设置引导**：主题设置、中英文（locale zh/en）等设置项**自带说明**（设置向导/`settings` 命令每项显示
   中英文解释与可选值说明）。
3. **guide 入口**：新手引导命令（分步介绍关键概念、常用命令、如何问"这是什么"）。

## 验收标准（执行器逐条勾选）

- [ ] **术语词库**：内建 `GLOSSARY`（新文件如 apps/cli/src/guide/glossary.ts 或 data）：每条 =
      { term（可含别名，如 小小蜜/小蜜/vessel/小助手）, zh, en, usage（一句话用途）}；覆盖 ≥12 个核心术语
      （Call/Collect/Agent/Harness/Policy/Prompt/Lane/Bench/theme/locale/小蜜 等；含"小小蜜"这位小助手自己的解释）
- [ ] **explain 命令**：`vessel explain <term>`（或 `vessel term <term>`，选型）→ 查词库给出中英文；未收录词
      → 友好提示"未收录，试试：vessel list-terms"；`vessel list-terms` 列出全部
- [ ] **设置引导**：设置项（主题/语言）描述带中英文说明 + 可选值（如 `vessel settings set theme <dark|light>`
      说明、`set locale <zh|en>` 说明）；配置向导/列表显示每项说明
- [ ] **guide 命令**：`vessel guide` → 分步新手引导（①这是什么（小蜜/vessel）②怎么问术语 ③常用命令 ④怎么设置
      主题/语言）——中英文双语可用（locale 影响输出语言）
- [ ] **TUI 内解释**：chat 里输入 `/explain <term>` 或 `? <term>`（选型）触发同一词库（不重复实现）
- [ ] 测试 ≥6 例：词库完整性/explain 命中与未收录/list-terms/settings 说明/guide 输出/locale 切换；
      `tsc -b` exit 0 + 全量 vitest（1198+ 无回归）+ web 82
- [ ] 文档同步（README 或 CLI 帮助：guide/explain/settings 用法）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做引导/解释/设置说明（CLI + TUI 词库共用）。不改 core/策略/定价；不加依赖；不做 UI 大改。
- 词库文案我们自己的表述（不复制他人引导稿；与 116 的 clean-room 一致）。

## 涉及文件（指针，执行器自行精化）

- 新：`apps/cli/src/guide/`（glossary.ts + explain/guide/settings 命令逻辑）或并入 cli.ts（命令组）
- `apps/cli/src/cli.ts`（命令接线：explain/list-terms/guide/settings）+
  `apps/cli/src/tui/chat.ts`（`/explain <term>` 或 `? <term>`）
- 复用：defaultStore.ts（settings 若涉 provider/usage root，保持测试隔离）

## 方法

- 建词库 → explain/list-terms 命令 → settings 说明 → guide 分步 → TUI 入口 → 测试 → 全量验证

## 工作证明（执行器回填：词库条目/命令实现/输出示例/diff/测试输出/全量 vitest/tsc/web，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：