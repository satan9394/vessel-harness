# Codex 执行契约：卡 256 Windows 受限沙箱启动链路

仓库 `E:\Code_file\Projects\Vessel_Harness`。分支 `main`。工作树干净。

## 先读

1. `tasks/256-windows-sandbox-launch-console.md` —— 范围内权威。
2. `evidence/task255/native-runtime-and-full-suite.md` —— 已测数据与隔离矩阵（第 3 层）。
3. `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts`（启动器 C# 源码）
4. `packages/tools/src/execution/sandbox/windowsRestricted.ts`（调用与产物校验）

## 当前事实（已复测，不要重新论证）

用 `node --import tsx evidence/task255/native-token-smoke.mts` 跑真实启动器，结果：

- 令牌创建、降完整性、ACL 预检、`CreateProcessAsUser` 全部通过；
- 子进程立即以 `-1073741502`（0xC0000142 STATUS_DLL_INIT_FAILED）退出，`echo` 与写文件都是这个码；
- 隔离矩阵（卡 255 证据里）：受限令牌 + Low 在 `CREATE_NO_WINDOW`/`CREATE_NEW_CONSOLE` 下必崩；
  受限令牌 + Low 用 flags 0（继承父控制台）能启动；普通令牌 + Low 一切正常。

即：不是权限位问题，是受限令牌下**新控制台/窗口站初始化**的问题。

## 目标

让受限令牌 + Low + Job Object + 写根受限 SID 这套隔离真正跑起来：
`cmd.exe /c echo sandbox-ok` 退出 0、子进程实测 Low 完整性、provisioned 写根可写、根外不可写。

## 允许尝试的方向（择一或组合，必须说明取舍）

A. 不请求新控制台：改 `DETACHED_PROCESS`，I/O 全走已有管道；
B. 显式指定 `lpDesktop`（如 `WinSta0\Default`）或调整 STARTUPINFO；
C. 换隔离层（AppContainer，或 Job Object + 非受限 Low 令牌），但**必须**证明写根限制仍然成立。

不允许：关掉 Low、去掉受限 SID、改成无沙箱 passthrough、提高/绕过 ACL 预检、修改系统 ACL。

## Acceptance Criteria

1. `node --import tsx evidence/task255/native-token-smoke.mts` 退出 0，JSON 里 `pass: true`，
   且 `lowIntegrityProven`（或 untrusted）为 true、`write.exitCode` 为 0。
2. 根外写入被拒绝（补一条探针证明，不能只测根内成功）。
3. 失败路径仍 fail-closed：未 provisioned 的写根、拿不到 Low 的令牌、ACL 预检不过，都在启动前拒绝。
4. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`npx vitest run packages/tools/src/execution/sandbox`、
   `npx vitest run packages/runtime/src/sandbox`（若受影响）。
5. 若最终判定该方案在本机不可行，必须给出「试过什么、各自失败码、为什么」并明确写不可行，
   不许只改文档措辞，也不许把 `CREATE_NO_WINDOW` 的崩溃说成已修复。

## 硬约束

- 不改 `packages/core`；不 commit/push；不跑 `test:all`；不动用户数据（夹具只用系统临时目录）。
- 不引入新依赖；不修改回收站实现。
- 生产 C# 源码里的安全语义（受限令牌、Low、Job、写根）不得弱化；
  若必须降级，先停下来说明理由，不要自行决定。

## 交付

- 改动 + 至少一条回归测试（能在 CI 环境下跑的部分）。
- 原生探针修复前后的输出对比（贴 JSON）。
- 五条门禁的退出码与计数。
- 最终回复说明：选了哪条路、被否方案与原因、剩余限制（例如非 cmd 目标是否也验证过）。
