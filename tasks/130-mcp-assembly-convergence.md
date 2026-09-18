# 130 — MCP 装配收敛为唯一实现（消除 cli.ts 与 TUI 的两份同款实现）

- 编号：130
- 状态：已合入（2026-09-18）
- 优先级：P2（本仓反复收敛的「两份实现会无声分叉」类；PRODUCT-STATE Round 124 点名「MCP 装配三份副本（一处零覆盖）」）
- 创建日期：2026-09-18
- 关联：`docs/product-evolution/PRODUCT-STATE.md` Round 124「仍开放」②、`tasks/127/129`（MCP 命令）、`apps/cli/src/windowsShim.ts`（同范式先例）
- 执行器：指挥侧

## 1. 缺陷：同款装配逻辑写了两遍，只差错误策略

`cli.ts` 的 `applyMcpConnections` 与 `tui/chat.ts` 的 `loadMcpConnections` 是**两份同款实现**：

```
读 ~/.vessel/mcp.json → 按 windowsShimHint 分区（非白名单 .cmd/.bat 不 spawn，计入 failures）
→ createMcpConnections(spawnable) → 汇总 shimFailures + failures → 打印
```

两者只差：CLI 配置损坏 **fail-loud**（返回 message，调用方 exit 1）；TUI **只告警、按"没配"继续**。
两份都**零测试绑定**该「分流」语义 ⇒ 只改一面会无声分叉（`.cmd`/`.bat` 要么硬 spawn 报含糊
ENOENT/EINVAL，要么拒绝一条本来可用的命令）。这正是本仓已多次收敛的类别（`windowsShimHint`
在 Round 122 收敛过；`turnText` 的 `isModelReplyKind` 同范式）。

## 2. 修复

新增 `apps/cli/src/mcp/assemble.ts` 的 **`assembleMcpConnections(load?)`**（唯一实现，不抛）：

```ts
type McpAssembly = { ok: true; connections; failures } | { ok: false; message }
```

- 配置损坏 ⇒ `{ok:false, message}`（**错误策略交给调用方**：CLI fail-loud、TUI 告警）。
- 非致命失败（win32 shim 不可 spawn + 单 server 建连接失败）⇒ `failures`。
- `load` 可注入（测试用）；缺省 `McpConfigStore().load()`。

调用方改为：
- `cli.ts` `applyMcpConnections`：`!ok` ⇒ 返回 message（exit 1）；否则 `connections` 写入 `opts.mcp`、`failures` 逐条 warn。
- `tui/chat.ts` `loadMcpConnections`：`!ok` ⇒ warn + 返回 `undefined`；否则 warn failures、返回 connections。
- 清理：`cli.ts` 移除不再用的 `createMcpConnections`/`McpConnectionFailure` 导入；`chat.ts` 移除不再用的
  `createMcpConnections`/`windowsShimHint` 导入，并改写上方注释（说明判定与装配各有唯一实现）。

## 3. 验收与实测

- 新增 `apps/cli/src/mcp/assemble.test.ts`（7 例）：
  - 行为 4 例：无 server ⇒ 空；`load` 抛错 ⇒ `ok:false`+message；正常 server ⇒ 建连接；win32 下非白名单 `.cmd` ⇒ 计入 failures（非 win32 按普通命令建连接，平台感知）。
  - **单实现静态守卫 3 例**：`cli.ts`/`chat.ts` 都只调用 `assembleMcpConnections(`；`createMcpConnections(` 与 `windowsShimHint(` 的**调用**只出现在 `assemble.ts`。⇒ 重新内联即红。
- **同步更新两处既有静态守卫**（`cli.test.ts` 本卡①、`chat.test.ts` 本卡C）：原断言"两面都 import `windowsShim.js` 并各自调用"，现改为"调用点唯一 = `mcp/assemble.ts`"（意图不变：唯一实现、无内联副本）。这两个用例在改前**确实先红**，证明守卫有效。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **176 文件 / 2228 passed + 6 skipped** + web **11/120**、CI 两腿绿。

## 4. 边界（未做，如实）

- 未把 `McpConfigStore.load()` 的**校验**逻辑并入：那仍在 `mcp/config.ts`（单一实现），本卡只收敛**装配**。
- `createMcpConnections` 的逐 server try/catch 语义未变（仍在 `packages/application`）。
