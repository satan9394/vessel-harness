# 任务卡 255: 根治长输出截断 HTTP 500 导致 Web 卡死与修复 Windows 沙箱 Token 权限

**状态**: 已实现并通过定向门禁；native 复验暴露的沙箱启动缺口转 [卡 256](256-windows-sandbox-launch-console.md)
**创建时间**: 2026-10-21
**执行者**: OpenCode (`opencode run`)
**协调者**: Antigravity

---

## 1. Goal (目标)

1. **消除长输出截断时的 HTTP 500 崩溃与卡顿**:
   - 当模型输出撞上 `max_tokens` / `outputTokens` 限制导致 `finishReason === 'length'` 时，`apps/local-server` 不得将常规的模型输出截断当成服务内部崩溃（HTTP 500）返回给前端，从而避免前端抛出 `ApiError(500)`、中断正常渲染并将输入放回 input 框。
   - 前端与服务端契约保持清晰：截断的输出正常渲染，前端界面友好展示已有生成内容，提示截断状态或允许继续交互，杜绝卡死。
2. **修复 Windows 沙箱 `SetTokenIntegrityLevel` 权限异常**:
   - `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts` 中 `OpenProcessToken` 缺少 `TOKEN_ADJUST_DEFAULT` (0x0020)，导致 `SetTokenInformation` 设置 `TokenIntegrityLevel` (25) 必抛 Access Denied。补充相应权限掩码，并对沙箱调用提供健壮审计与防护。
3. **补充回归单测与集成门禁**:
   - 在 `apps/local-server` / `packages/core` / `packages/tools` / `apps/web` 补充针对 `length` 截断与沙箱的自动化测试用例，确保全量测试绿色。

---

## 2. Not Doing (非目标)

- 不做无关的 UI 重构或组件重写。
- 不修改既有 Core 的状态机无关契约。
- 不向 npm 发布包，不打 git tag。

---

## 3. Acceptance Criteria (验收标准)

1. `POST /api/sessions/:id/turns` 在遇到 `finishReason === 'length'` 时：
   - 不返回 HTTP 500 状态码（返回 200 并在结果中携带 `truncated: true` 或正确标记）；
   - 或者前端优雅处理长文本生成与截断，已有消息正常保留并展示，不会显示红字 500 错误卡死。
2. `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts`：
   - `OpenProcessToken` 句柄具备 `TOKEN_ADJUST_DEFAULT` (0x0020) 权限，允许正确调整 Token Integrity Level；
   - 相应测试通过。
3. 验证命令门禁全部通过：
   - `npx tsc -b` exit 0
   - `npm run typecheck:tests` exit 0
   - `npm run test:web` exit 0
   - local-server 与 tools 相关单测 pass
4. Git 提交并推送到远端 `feat/v2.8-taste-ui`。

---

## 4. Blast Radius (影响面)

- `apps/local-server/src/server.ts`
- `apps/local-server/src/server.test.ts`
- `apps/web/src/components/ConversationView.tsx` / `apps/web/src/api.ts`
- `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts`
- `packages/tools/src/execution/sandbox/windowsRestricted.test.ts`

## Expected Evidence / Execution Contract

- Scope also includes web i18n, conversation interaction tests, and this card/index.
- Preserve unrelated existing changes. No ACL changes, insecure sandbox fallback, deletions, commit or push.
- Plan: HTTP status/body regression; web output/notice/draft regression; native token rights and at-or-below-Low integrity check; ordered type/build/tests and independent review.
- Required checks: npx tsc -b; npm run typecheck:tests; local-server server + turn-status tests; sandbox tests; npm run test:all (both roots); web build with --emptyOutDir false; unchanged core diff.
- Browser interaction evidence required for new truncation notice. Native compile/relabel probe must be distinguished from full provisioned sandbox execution.
- No README/config changes needed: invocation and configuration unchanged; API contract comments updated in source.
- OpenCode CLI startup attempted 2026-10-21; blocked by EPERM opening its user-profile log. Auxiliary implementation/review used without altering CLI permissions or project model configuration.

## Result

Implemented; targeted tests 65/65 and web 424/424 pass. Build/typechecks pass. Independent review has no blockers. Full-suite/native-runtime/browser limits and exact logs: [SUMMARY](../evidence/task255/SUMMARY.md). No commit/push; packages/core unchanged.

## Result（native 复验后更正，2026-10-21）

前一段的「OpenProcessToken 缺 `TOKEN_ADJUST_DEFAULT` 是根因」**结论有误**，按真实启动器实测更正如下，
细节与命令输出见 [native-runtime-and-full-suite](../evidence/task255/native-runtime-and-full-suite.md)：

- 截断部分成立：`finishReason === 'length'` 的 error 回合改判 200 并带 `finishReason`，前端保留已生成内容并给双语提示；这一条由 server/web 单测覆盖。
- 沙箱部分原修复不成立：`CreateRestrictedToken` 返回的句柄无论源句柄开 `0xB` 还是 `0x2B` 都不带 `TOKEN_ADJUST_DEFAULT`，直接降完整性恒 `ERROR_ACCESS_DENIED`。正确做法是先 `DuplicateTokenEx(…, 0x1F01FF, TokenPrimary)` 复制主令牌、在副本上降级，再用副本 `CreateProcessAsUser`。已按实测改。
- 同时发现第二处：`GetNamedSecurityInfo` 只请求 `DACL|LABEL`，缺 owner/group，`AccessCheck` 恒返回 `ERROR_INVALID_SECURITY_DESCR(1338)`，等于所有写根永远被拒。改为 `OWNER|GROUP|DACL|LABEL` 后正常。已按实测改。
- 仍不通，且不是本卡范围：受限令牌 + Low 在 `CREATE_NO_WINDOW`/`CREATE_NEW_CONSOLE` 下必然 `0xC0000142 STATUS_DLL_INIT_FAILED`；对照实验显示普通令牌 + Low 正常、受限令牌在继承父控制台时能启动。属启动标志与控制台策略问题，转 [卡 256](256-windows-sandbox-launch-console.md)。
- 全量门禁：`npx vitest run packages/tools/src/execution/sandbox` 17/17；`tsc -b`、`typecheck:tests`、`test:web` 424/424 通过；`test:all` 的 2 项失败集中在 `packages/runtime` 的 `virtualProxy` 与 `process-tree`，两个文件单独跑 23/23 通过、且本卡 diff 未触碰该包，判为全量并行下的环境性抖动并如实记录，未做掩盖。
