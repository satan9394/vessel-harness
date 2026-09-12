/**
 * apps/cli/src/windowsShim.ts —— 「win32 下 `.cmd`/`.bat` 需要 shell」判定的**唯一实现**
 * （BRIEF：*两份实现 + 全仓零测试*；范式照 `turnText.ts`）。
 *
 * 改前的事实（逐条可核）：
 *  - `cli.ts` 里有一份 `windowsShimHint`（`applyMcpConnections` 用它分流 MCP server）；
 *  - `tui/chat.ts` 里**另有一份**（`loadMcpConnections` 用它分流），且注释**自称**
 *    「**必须与 `cli.ts` 的对应实现逐字一致**」，并给出「反向 import 会成环，所以只能内联」
 *    的理由；
 *  - **全仓没有任何测试引用 `windowsShimHint`** ⇒ 两份**都可能分叉且无声**：只改一面会让
 *    另一面对 `.cmd`/`.bat` 脚本要么**硬 spawn**（用户只看到含糊的 ENOENT/EINVAL），
 *    要么**拒绝一条本来可用的命令**。
 *
 * 「反向 import 会成环所以只能内联」这一理由已被证伪：本仓刚落地 `apps/cli/src/turnText.ts`
 * （**零依赖叶子模块**），`cli.ts` 与 `tui/chat.ts` **各自 import 它**，不成环。
 * 本模块照同一范式收敛：判定只有这一份，两个面都 import 它。
 *
 * **零 import**（本文件不依赖任何模块）是刻意的，也是本模块能存在的理由：
 * `tui/chat.ts` 反向 `import '../cli.js'` 会成环（`cli.ts` 已 `import { runChat } from
 * './tui/chat.js'`，ESM 下表现为 TDZ/undefined）。把共用物放进一个**谁都不依赖**的叶子模块，
 * 成环理由就不成立了。
 *
 * 语义**逐字沿用**改前的两份实现（本卡**只收敛、不改行为**）：win32 + `.cmd`/`.bat` 后缀 +
 * 不在包管理器白名单 ⇒ 返回可操作的原因文案；其余返回 `null`（可照常直连 spawn）。
 * 判据与 `resolveSpawnCommand`（packages/tools/src/mcp/McpClient.ts）**逐字对齐**：
 * 白名单命令（自身不带后缀）由那边开 shell，命不中这里。
 */

/**
 * 判定：这条命令在**当前平台**下是否注定 spawn 失败（win32 的 `.cmd`/`.bat` shim）。
 *
 * `platform` 是**可注入参数**（缺省 `process.platform`）：判据因此可以用例驱动，
 * 不必依赖真实平台。
 *
 * 既有语义细节（**不得**顺手改，判别性用例在 `cli.test.ts` / `tui/chat.test.ts` 的本卡块）：
 *  - 后缀判定用**归一化**后的 `cmd`（`trim().toLowerCase()`）；
 *  - 白名单判定用**原始 `command`**（不 trim、不大小写归一）——带后缀的 `npx.cmd`
 *    因此**命不中**白名单（那是刻意的：`resolveSpawnCommand` 同样不会为它开 shell，
 *    直连 spawn 仍会失败，拦住它才是对的）。
 *
 * @returns 直接可读的原因文案；`null` = 该命令可照常直连 spawn。
 */
export function windowsShimHint(command: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'win32') return null;
  const cmd = command.trim().toLowerCase();
  if (!cmd.endsWith('.cmd') && !cmd.endsWith('.bat')) return null;
  // 与 resolveSpawnCommand 同一份白名单：命中者会被开 shell，这里不拦（防御性，当前不可达）。
  if (new Set(['npx', 'npm', 'pnpm', 'yarn', 'uvx']).has(command)) return null;
  return `命令 "${command}" 在 Windows 上需要 shell 才能执行（.cmd/.bat shim）；请改用白名单命令（npx/npm/pnpm/yarn/uvx）或把命令指向 .exe / 绝对路径`;
}
