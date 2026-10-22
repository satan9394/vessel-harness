# 任务卡 256: 打通 Windows 受限沙箱启动链路（受限令牌 + Low 下的子进程初始化）

**状态**: 执行中
**创建时间**: 2026-10-21
**执行者**: 待派（OpenCode / Codex）
**协调者**: OpenCode（原 Antigravity，2026-10-21 起 agy CLI 限额）

---

## 1. Goal (目标)

让 `WindowsRestrictedRunner` 真正能跑起子进程：在「受限令牌 + Low 完整性级别 + Job Object + 写根受限 SID」这套既有隔离下，
`cmd.exe /c echo ok` 能正常退出 0，子进程实际处于 Low 完整性，且对已 provisioned 的写根可写、对根外不可写。

已知卡点（见 [卡 255 的 native 复验](../evidence/task255/native-runtime-and-full-suite.md)第 3 层）：
受限令牌 + Low 在 `CREATE_NO_WINDOW` 与 `CREATE_NEW_CONSOLE` 下必然 `0xC0000142 STATUS_DLL_INIT_FAILED`；
而普通令牌 + Low、以及受限令牌在继承父控制台（flags 0）时都能启动。即问题在控制台/启动标志策略，不在权限位。

## 2. Not Doing (非目标)

- 不放开隔离强度：不得回退成「仅 Job Object、无受限令牌」或「仅 Low、无写根限制」而当作已修复。
- 不修改主机 ACL、不 `Set-Acl` 系统目录、不给受限 SID 授予系统路径。
- 不改 `packages/core`；不动与本卡无关的 Web/服务端行为。
- 不做删除、不发布版本、不打 tag。

## 3. Acceptance Criteria (验收标准)

1. 真实启动器（非 mock）执行 `cmd.exe /c echo ok`：
   - 退出码 0 且 stdout 为 `sandbox-ok`；
   - 子进程完整性级别实测为 Low（`S-1-16-4096`）或 Untrusted；
   - 对 provisioned 写根写入成功（`write-probe.txt`），对根外写入被拒。
2. 失败路径仍 fail-closed：未 provisioned 的写根、取不到 Low 的令牌、`AccessCheck` 不通过，都在启动子进程之前拒绝并产生 `audit/sandbox_enforced` denied 事件。
3. 定向门禁通过：`npx tsc -b`、`npm run typecheck:tests`、`npx vitest run packages/tools/src/execution/sandbox`、`packages/runtime` 相关沙箱用例。
4. 证据含：native 冒烟输出（结构见 `evidence/task255/native-token-smoke.mts`）+ 选定的启动策略与理由（含被否方案）。

## 4. Blast Radius (影响面)

- `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts`（启动标志 / 会话与控制台处理）
- `packages/tools/src/execution/sandbox/windowsRestricted.ts`（若需要调整 launcher 调用方式）
- 对应测试与 `evidence/task256/`

## 5. 待决设计点（实现前必须落定并写进卡）

- 方案 A：改用 `DETACHED_PROCESS` / 不请求控制台，I/O 全走已有管道；
- 方案 B：保留控制台继承，避免 `CREATE_NO_WINDOW`；
- 方案 C：换隔离层（AppContainer 或 Job Object + 非受限 Low 令牌），但必须证明写根限制仍成立。

选定后必须回答：受限令牌下 `cmd.exe` 与 PowerShell 之外的可执行文件是否同样能起（至少再验一个非 cmd 目标）。

## 6. Expected Evidence

- native 冒烟 JSON（stdout / exit code / 完整性标签行 / 写根结果）
- 否定对照：未 provisioned 时仍 denied
- 门禁命令与退出码
- 若最终仍不可行，必须明确写「受限令牌方案在本环境不可用」及证据，不得只改文档措辞

## 7. Result

待执行。
