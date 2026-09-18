# 023 — 修复交互 TUI 阻断 bug（每轮退出）

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：CHANGELOG.md V0.8（TUI 每回合退出修复）。
- 优先级：P0（阻断）
- 创建日期：2026-09
- 关联：goal-a0b7e372

## 问题（用户实测）

`cah` 进交互后每轮输入就退出：/help 能显示但回车后回 PowerShell；/provider、/model 打到 shell 报"不是 cmdlet"；普通文字 "hh" 跑一轮后也退出。根因（指挥初判）：`apps/cli/src/tui/chat.ts` 的 createStdioIO.readLine 用 `for await (const line of rl) { return line }` —— 每次调用都对同一个 readline 接口做 for-await，第二次消费时接口已 EOF/关闭 → 返回 null → 主循环 break 退出。且 Ctrl+C 未处理（默认 SIGINT 直接关 rl）。

## 验收标准

- [ ] createStdioIO 重写：readLine 用 rl.question 包 Promise（或一次性事件订阅 + 队列），支持**连续多轮**调用不 EOF
- [ ] Ctrl+C（SIGINT）→ 优雅退出（返回 null，进程 exit 0，不残留半行提示）
- [ ] 脚本化测试覆盖：scriptedIO 连续喂 ["/help","你好","/quit"] 能跑 3+ 轮不提前退出（现有 chat.test 加强）
- [ ] 真实管道/PTY 验证：多轮输入不退出（可用 node 脚本模拟 stdin 多行）
- [ ] `npx vitest run` 全绿；`npx tsc -b` exit 0
- [ ] 卡置"待验收"

## 涉及文件

- `apps/cli/src/tui/chat.ts`（createStdioIO 重写）
- `apps/cli/src/tui/chat.test.ts`（多轮测试）
- `docs/V08-PROGRESS.md`

## 设计锚点

- readline.createInterface({ input, output, terminal:false }) 可多次 question；或改 terminal:true + SIGINT handler
- 主循环不变（readLine 返回 null 即退出），问题只在 IO 实现
- 保持 ChatSessionIO 接口不变（测试兼容）

## 工作证明（执行器回填）

- [ ] diff / 测试 / tsc

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
