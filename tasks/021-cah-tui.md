# 021 — `cah` 启动直接进交互 TUI（对标 opencode 一条命令）

- 状态：待执行
- 优先级：P0
- 创建日期：2026-09（夜，用户睡前反馈）
- 关联卡片：目标 goal-c055c16c；依赖 020（目录）；022（权限联动）

## 目标

`cah`（无子命令）直接进入交互式 chat TUI——像 `opencode` 一样一条命令进对话界面，供应商配置/自定义端点/模型切换全部是 TUI 内的斜杠命令，而不是要先跑 setup。用户原话："启动时为什么不能直接用 CAH 来启动？交互现场应该直接融入到那个里面去。"

## 验收标准

- [ ] `cah` 无子命令 → 进入 TUI（chat 输入 + 输出区 + 状态栏：当前模型/供应商/权限）
- [ ] 斜杠命令在 TUI 内：`/provider`（进供应商配置向导，可搜选/自定义）、`/models`（当前供应商模型）、`/setup`（完整引导）、`/permission`（切三档权限）、`/help`、`/quit`、`/model <id>`（切模型，Enter=持久 s=仅会话——抄 Claude）
- [ ] 对话跑真实任务：输入自然语言 → 走 harness loop（复用 composeHarness + 当前默认供应商）
- [ ] 全局 `cah` 命令可用（npm bin 入口 + 说明 `npm link` 或 bin 配置）
- [ ] 非 TTY 下 `cah` 无参数 → 清晰提示（进交互需 TTY，或给 --prompt 一次性）
- [ ] TUI 启动器/斜杠分发逻辑用注入 IO 脚本化测试（不依赖真 TTY）
- [ ] 全量绿 + tsc exit 0
- [ ] 文档更新（docs/ 交互用法）
- [ ] 卡状态置"待验收"

## 涉及文件

- `apps/cli/src/tui/`（新：chat TUI 启动器 + 斜杠分发；用 @clack/prompts 还是 raw TTY 由调研定——opencode 用 React ink，我们选轻量方案）
- `apps/cli/src/cli.ts`（cah 无参 → tui）
- package.json bin（cah 全局命令）

## 依赖

- 调研：opencode TUI 架构（命令循环/消息模型/斜杠）、权限模式（022 共用）
- 阻塞于：调研返回

## 设计锚点

- opencode `opencode` 一条命令进 chat 的体验是标杆
- 供应商配置向导（setup.ts）改成 TUI 内可调（复用 runSetupWizard + SetupIO）
- 轻量 TUI：不引 React/ink（重），优先 raw TTY + @clack 组合或极简循环（调研定）
- 对话复用 composeHarness（V0.1-V0.5 全机制可用）

## 工作证明（执行器回填）

- [ ] diff / 测试 / tsc

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回
- 备注：
