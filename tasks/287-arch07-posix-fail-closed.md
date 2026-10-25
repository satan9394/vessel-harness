# T287 — ARCH-07 POSIX 沙箱降级改为默认拒绝（方案 2）

- Status: 已完成（2026-10-25；PDW 任务 + WSL 真进程证据；未提交、未推送）
- PDW task: 20261025083644-85ac5b（`accepted_local`）
- Mode: standard（安全默认行为变更 + 文档/测试）
- Source: 卡 281 用户拍板（方案 2：默认 fail-closed，允许显式放行）
- Risk: medium（改变 POSIX 上 helper 缺失时的默认行为）

## Goal

关闭 ARCH-07 的平台安全承诺缺口：POSIX（Linux/macOS）沙箱 helper 不可用时，默认**拒绝执行**，与 Windows 行为一致；只有显式设置 `VESSEL_ALLOW_UNSANDBOXED=1` 才允许 `passthrough-fallback`，且审计必须如实记录 `sandboxed:false` 与 `native-helper-unavailable`。helper 可用时现有 bwrap/Seatbelt 路径不变。

拒绝时错误信息必须可操作：点名缺失的 helper（Linux `/usr/bin/bwrap`、macOS `/usr/bin/sandbox-exec`），并给出两条出路——安装 helper，或设置 `VESSEL_ALLOW_UNSANDBOXED=1`。

## Not Doing

- 不改 Windows 受限令牌/Job Object 路径。
- 不新增 `danger-full-access` 自动放行（那是卡 281 的方案 3，未采纳）。
- 不新增审批流或交互提示；只做默认拒绝 + 环境变量放行 + 审计。
- 不修改 `packages/runtime`、策略引擎或 UI。
- 不 commit / 不 push / 不删除任何文件。

## Acceptance

- AC1：helper 不可用且未设置环境变量时，`execute` 在**运行目标命令之前**拒绝；错误信息包含 helper 路径与 `VESSEL_ALLOW_UNSANDBOXED=1`；审计事件为 `outcome:'denied'`、`sandboxed:false`、`reason` 含 `native-helper-unavailable`。
- AC2：helper 不可用但设置 `VESSEL_ALLOW_UNSANDBOXED=1` 时，命令照常执行一次，结果 `isolationTier:'passthrough-fallback'`、`sandboxed:false`，审计为 `outcome:'fallback'`、`reason` 含 `native-helper-unavailable`。
- AC3：helper 可用时 Linux/macOS 的探测、挂载参数、`enforced` 审计与现有一致（既有用例保持通过）。
- AC4：Windows 分支行为与现有一致（既有用例保持通过）。
- AC5：`docs/POLICY-SPEC.md`、`docs/SANDBOX-WINDOWS.md`、`docs/ARCHITECTURE.md` 三处「POSIX helper 缺失」的描述改成「默认拒绝 + 显式环境变量放行 + 审计 denied」，不再出现「优雅回退/照常执行」的旧表述。
- AC6：定向 vitest 通过；`tsc -b` 与 `typecheck:tests` 干净。

## Blast Radius

`packages/tools/src/execution/sandbox/platformSandbox.ts`、`platformSandbox.test.ts`、`docs/POLICY-SPEC.md`、`docs/SANDBOX-WINDOWS.md`、`docs/ARCHITECTURE.md`、本卡、`tasks/README.md`。回滚：`git checkout -- <上述文件>`。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、PDW 任务的 check 日志与 review 结论；另附 WSL Ubuntu（本机实测无 `bwrap`）的真实进程证据：默认拒绝、`VESSEL_ALLOW_UNSANDBOXED=1` 放行。macOS 无法本地验证，如实标注未验证。

## Result

已完成，方案 2 生效。

代码只加了 4 行：`platformSandbox.ts` 在 helper 不可用且 `VESSEL_ALLOW_UNSANDBOXED !== '1'` 时，先写审计（`outcome:'denied'`、`sandboxed:false`、`reason` 以 `native-helper-unavailable` 开头），再抛错；错误信息同时给出两条 helper 路径与 `VESSEL_ALLOW_UNSANDBOXED=1`。只有字符串 `'1'` 放行，`''`/`'0'`/`'true'`/`' 1'`/`'1 '`/`'ONE'` 都不算（单测逐个覆盖）。helper 可用时 bwrap/Seatbelt 与 Windows 分支零改动。

PDW 任务 `20261025083644-85ac5b`：`accepted_local`，4 次调用、0 修复、约 14 分 26 秒，artifact `87dc7ee747ad7fd1af8ac931244db949a1222cb35ca3582c90fa5de6fe8a50b5`。四条 check 全 exit 0（定向 vitest、`tsc -b`、`typecheck:tests`、文档一致性）；review 对 AC1–AC6 逐条给 pass 并引用了代码行号与原始日志。

全量门禁（在最后一次编辑之后）：根 305 文件 / 3200 passed + 6 skipped，web 58 文件 / 494 passed；`git diff --check` 干净。

WSL 真进程证据（Ubuntu，实测无 `bwrap`）：默认调用被拒，错误为 `native-helper-unavailable: install or enable /usr/bin/bwrap (Linux) or /usr/bin/sandbox-exec (macOS), or explicitly set VESSEL_ALLOW_UNSANDBOXED=1 ...`；设 `VESSEL_ALLOW_UNSANDBOXED=1` 后同一条命令返回 `stdout:"hi"`、`tier:"passthrough-fallback"`、`sandboxed:false`。

未验证：macOS 的 Seatbelt 降级分支没有本地环境，按卡 281 的规矩不拿 Windows/WSL 结果冒充；该分支由单测的 fake platform 覆盖。

