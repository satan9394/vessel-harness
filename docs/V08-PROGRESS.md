# V0.8 执行进度（V08-PROGRESS.md）— TUI 修复 + Vessel 改名/哲学 + 供应商/UI + 品牌

> 接力：tasks 023-025 + 后续品牌/目录收尾。
> 触发：用户实测 TUI 每轮退出 + 要求改名 Vessel 融哲学 + opencode 式分栏 UI + LOGO + cah 残留清理。
> 最后更新：2026-09（**023/024/025 全部合入**；后续品牌、UI 主题、供应商 71 条、命令统一全部完成）。

## 0. 基线

- 285 测试绿；tsc 0。提交链（V0.8 主线）：39635b4（卡）/ 08962c4（023 TUI 修复）/ 49eda1a（024 Vessel）/ 92714a5（025 供应商+UI）/ 523031c（卡验收）→ 9c6170c（浅色主题）/ 08da39f（UI-THEME 约定）/ cb51fc9（vessel scripts + 卡校准）/ 3e91904（VESSEL 运行文档）/ 78cfa6a（LOGO+brand）/ a453650（供应商 71 条）。

## 1. 里程碑

| 卡 | 标题 | 状态 |
|---|---|---|
| 023 | 修复交互 TUI 每轮退出 bug | 已合入（08962c4） |
| 024 | 改名 Vessel + 六条哲学 IR 化 + 三角色 | 已合入（49eda1a） |
| 025 | 供应商可见性 + 补第三方 + 分栏 UI 设计稿 | 已合入（92714a5） |
| — | V0.8 后续：LOGO / UI 主题 / 命令统一 / 目录 71 | 已合入（见 §5-§8） |

## 2. 关键决策

- Vessel 哲学以 behavior IR 条目落地（不自相矛盾地写死 prompt）。
- 改名只动品牌/命令层（bin vessel + cah 别名），内部 @cah/* 保留防爆炸。
- UI 主题：浅色默认 + 系统深色自动适配（prefers-color-scheme），无手动切换。
- 供应商目录按用户要求对照 cc-switch 标准集补足（不再"宁少而准"收窄），长尾中转带 hint 自测提示。

## 3. 023 交付记录（TUI 修复，子代理 59975834，已合入 08962c4）

- 根因：createStdioIO.readLine 对同一 readline 接口 `for await`，中途 return 触发迭代器 return() → Node 内部 rl.close()，第一行读完接口即关，第二轮 EOF → runChat break 退出。
- 修复：新增 `makeLineReader(rl)`（一次性 'line' 监听 + FIFO Promise 队列 + 预到行缓冲，支持同一接口连续任意多轮；close/error → pending 以 null 结束，drain-then-EOF）；createStdioIO 改用它，SIGINT（process + rl）→ 换行清残留 + reader.close() + rl.close() → runChat 优雅返回 0。
- 测试：chat.test.ts 新增 runChat 三连用例（["/help","你好","/quit"] 跑满 3 轮）+ makeLineReader 4 单测（PassThrough 真 readline）。全量 281→285。
- 验证：真实管道 E2E 三行依次收到、help 渲染、EXIT=0（修复前第 1 轮即退）。

## 4. 024 交付记录（改名 Vessel + 六条哲学 IR，子代理 5ab5c7cd，已合入 49eda1a）

- behavior.default.yaml 加 6 条 `vessel.*` IR（channel=prompt_guidance）：replaceable / minimal_complexity / harness_carries / soft_guidance_hard_boundaries / no_self_certification / human_above_loop，render 为"该怎么做"句。
- Builder.ts 固定句 → "你是 Vessel 系统中的一个 Agent（Composable Agent Harness 核心）。"
- bin 加 vessel（cah 别名保留）；cli.ts 帮助/错误/版本 → Vessel CLI；chat 问候语 Vessel。
- docs/VESSEL.md（品牌宣言 + 哲学→IR 映射 + Constitution + 三角色）；agent-cli-analysis.html 品牌同步。
- 验证：IR entries=10（vessel 6）· promptSections=10 · warnings=0。

## 5. 025 交付记录（供应商可见性 + UI 设计稿，子代理 4487e5e7，已合入 92714a5）

- 目录 52→56（bedrock/vertex/baseten/scaleway）；picker 分组 `[官方]/[国产]/[国际]/[聚合]/[本地]` + custom 固定可搜。
- docs/ui-split-layout.html（opencode 式左对话/右 MCP+成本面板，数据源注释标注）+ 截图。

## 6. UI 主题（用户反馈：不要深色、要浅色 + 系统深色适配）

- 两个 HTML（agent-cli-analysis / ui-split-layout）改**浅色默认**：:root 浅色变量 + `@media (prefers-color-scheme: dark)` 覆盖深色；html 标签加 `color-scheme: light dark`。
- 新建 `docs/UI-THEME.md`：主题约定（浅色默认 + 系统深色 + 颜色只走 CSS 变量 + 状态色语义 + 交付前双主题截图）。
- 提交 9c6170c / 08da39f；浅色与深色渲染均截图验证。

## 7. 命令统一 + 卡状态校准 + 运行文档（用户要求）

- 根 package.json scripts 加 `vessel` / `start`（cb51fc9）。
- 卡 014-017、020-025 状态校准为已合入（附真实 commit）——此前全部 25 张卡实际都已完成，状态文本滞后。
- docs/VESSEL.md 加「如何运行」章节（vessel / setup / provider / 斜杠命令 / 测试）。
- docs/PROVIDER-MANAGEMENT.md 全面 vessel 化（cah → vessel 命令）。
- 全局 `npm link ./apps/cli` 刷新后 `vessel --version` → "Vessel CLI v0.1.0"（cah 别名仍可用）。

## 8. LOGO / 品牌（用户要求）

- ASCII LOGO（碗 + 波浪线 + VESSEL + 副标语）→ `apps/cli/src/brand.ts`，在 --version / --help / 交互会话开始显示。
- SVG 品牌标志 → `docs/assets/vessel-logo.svg`（碗形承载绿波；浅色默认、系统深色自动切换），截图验证渲染正常。
- 提交 78cfa6a。

## 9. 供应商目录 56 → 71（用户反馈：对照 cc-switch 标准集，OpenCode 都没有）

- 补 opencode / opencode-go（OpenCode Zen/Go 官方 OpenAI 兼容网关，models.dev 核实端点）。
- 补 kimi-coding（Anthropic 编程端点）/ doubao-seed（火山 Coding Plan）。
- 补 cc-switch 标准集中文生态常见中转一批：aihubmix / cherryin / ppio / subrouter / therouter / soleapi / zetaapi / runapi / pipellm / qiniu / packycode（均带 hint"第三方中转，稳定性自测"）。
- 测试豁免名单更新；全量 285 绿 + tsc 0（a453650）。
- 验证：重建后向导搜 "opencode" 命中 `[国际] OpenCode Zen` 与 `[国际] OpenCode Go`（picker 共 72 项 = 71 供应商 + 自定义）。

## 10. 待办 / 遗留

- 无未完成开发任务（25 张卡全部合入）。
- 可选项：真全屏分栏 TUI（按 ui-split-layout 设计稿实现）；MCP 实时 online/offline 心跳；成本卡落库；`cah` 命令别名是否最终移除（当前保留向后兼容）；内部 @cah/* 包名是否最终迁移（工程量大，当前注明历史遗留）。
