# Task 252: EffectJournal Torn-Tail Fault Recovery & Session Lease Rollback Hardening (Fixes F5)

状态：待验收（F5 修复与定向验证通过；Windows 进程树门禁未通过）
负责人：Codex (`gpt-6.1-sol`, medium reasoning effort)
规划 / 架构监督：Antigravity
前序依赖：[任务卡 249](249-adversarial-audit.md) 对抗审计揭露的 F5 漏洞；前序 [任务卡 251](251-compaction-keepid-and-ime-hardening.md) 已交付

## 1. 目标 (Goal)
攻坚修复 Task 249 独立对抗审查报告揭示的 F5（Medium 级）缺陷：
1. **EffectJournal 破损尾部容错与自愈恢复**：
   - 解决 `packages/runtime/src/executor/EffectJournal.ts` 中直接遍历解析每行 JSON 导致半截未完成写入（torn tail）抛出 `SyntaxError` 崩溃的问题；
   - 增加对尾部未写完残卷的识别与容错隔离，安全保留之前已 fsynced 的有效记录，保证崩溃重启后的可恢复性；
   - 补充针对断电截断残卷的单测用例。
2. **应用组合根 Session 租约回滚加固**：
   - 解决 `packages/application/src/compose.ts` 中 `Session.open()` 获取单写者租约锁后，若后续组件装配（如 EffectJournal 构造、Mod 加载等）抛错导致租约未被释放的悬空锁缺陷；
   - 在 `Session.open()` 后的装配流程增加保护拦截，失败时确保执行 `await session.close().catch(() => {})` 进行租约回滚释放，允许后续同进程再次打开；
   - 编写针对装配失败后租约完整释放、可重新打开会话的自动化测试。

## 2. 禁做事项 (Not Doing)
- 严禁修改 `packages/core`（薄核纪律：严格 0 修改）；
- 严禁永久删除任何文件（所有删除走回收站，除临时测试自建目录外）；
- 不引入外部新依赖，不篡改无关业务模块。

## 3. 验收标准 (Acceptance Criteria)
1. **F5 验证**：
   - `packages/runtime/src/executor/EffectJournal.test.ts` 新增对文件末尾存在半截 JSON 字符（torn tail）的恢复测试，验证不仅不抛 `SyntaxError`，而且能成功加载此前的有效 intent/outcome；
   - 验证在装配出现异常时，`compose()` 正确回滚并关闭底层 session，释放 `.lease` 锁，随后的同一进程再次调用 `compose()` 或 `Session.open()` 不会撞锁。
2. **门禁指标**：
   - `git diff HEAD --stat -- packages/core` 必须为 0；
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npx vitest run packages/runtime` 全部通过；
   - `npm run test:web` 418 项测试全部通过；
   - 运行 Task 249 产出的反例探测脚本关于 F5 的部分能够成功通过。

## 4. 影响面 (Blast Radius)
- `packages/runtime/src/executor/EffectJournal.ts`
- `packages/runtime/src/executor/EffectJournal.test.ts`
- `packages/application/src/compose.ts`
- `packages/application/src/session/` 或相应应用级装配测试

## 5. 预期证据 (Expected Evidence)
- `evidence/sessions/2026-10-20-codex-task-252.log`
- `evidence/sessions/2026-10-20-codex-task-252-proof.md`

## 6. Result

Implemented torn-tail byte-boundary repair with fsync and durable-prefix/replay protection, plus lease rollback for every post-Session.open assembly failure. Added recovery and synchronous/asynchronous composition regression tests, and a `--verify-252` mode to the original adversarial probe script. Independent read-only review found no blocking defect.

Authoritative gate results, logs, failure details, and scope qualifications: [Task 252 proof](../evidence/sessions/2026-10-20-codex-task-252-proof.md). Runtime acceptance remains incomplete because two unchanged Windows process-tree tests fail, including on an isolated retry. No core changes against HEAD; origin/main includes pre-existing core history. No commit/push.
