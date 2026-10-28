# 任务卡 350: `profileParity` 偶发失败（`expected 2 to be 0`）

- Status: 已加固、根因未定位（2026-10-27；未验收：隔离守卫已落地并复跑绿，PDW 只读复核判 fail，见 §7）
- PDW task: 待回填（前两次 20261027090716-7825e5 / 20261027091006-4bd893 均在 `new` 之后因编辑仓库判 source drift、模型零调用作废；新 id 在任务跑完后补在此行）
- 实现方式：PDW `implement`（opencode / `commandcode/deepseek/deepseek-v4.1-flash` / high）+ `review`（同模型 `#max`），契约 `.pdw/contracts/350-profile-parity-isolation.json`
- 来源：2026-10-27 全量门禁两次 `local-server` 段偶发；交接单 T5

## 1. Goal

`apps/local-server/src/routes/profileParity.test.ts > delete returns the same ordered fields` 在**整段运行**时偶发 `AssertionError: expected 2 to be +0`（CLI `provider profile` 子命令返回 2＝用法错误），单跑该文件 4/4 通过、整段重跑 298 通过。让这条用例在整段里稳定通过，并补一条能在同类泄漏复现时失败的判别性断言。

## 2. 要做的事

1. 先复现：连跑 `node node_modules/vitest/vitest.mjs run apps/local-server` 3 次，记每次 exit 与失败用例名；复现不出来也要写清尝试次数与命令。
2. 定位：CLI 的 `provider profile` 子命令读的是哪个 provider 根（`apps/cli/src/providers/defaultStore.ts` 的 `providerStateRoot()`、`apps/local-server/src/providers/ProviderStore.ts` 的 `rootDir`），环境变量在什么时机求值，为什么整段运行时拿到别的根或走进用法错误分支。结论要给 `path:line`。
3. 修复优先在测试侧（显式根、环境变量还原、避免模块级单例依序求值）；只有确证产品缺陷才动 `ProviderStore.ts` / `defaultStore.ts`，并附证据。
4. 加判别性守卫：一条断言，同类泄漏复现时必须失败（例如断言 profiles 文件落在本用例临时根内，或断言 CLI 与 HTTP 落在同一个 store 根）。

## 3. Not Doing

- 不改 `apps/local-server/src/server.ts` 的产品行为，不动 `packages/*`、`apps/web`、`package-lock.json`、`.pdw/`。
- 不放宽既有断言（不许把「CLI 输出必须等于 HTTP 输出」改弱）。
- 不为「让测试过」而加 sleep / 重试；偶发要靠隔离根解决，不靠等待。

## 4. Acceptance

1. 复现尝试有记录（命令 + 次数 + 每次结果），并在卡内写清是否复现。
2. 根因有 `path:line` 证据，且解释为什么只在整段运行时出现。
3. 修复后 `vitest run apps/local-server/src/routes/profileParity.test.ts` 与 `vitest run apps/local-server` 均全绿；`tsc -b`、`tsc -p tsconfig.test.json --noEmit` 干净。
4. 新增判别性断言在卡内注明「它为什么能抓住同类泄漏」。
5. 范围外零改动。

## 5. Blast Radius

`apps/local-server/src/routes/profileParity.test.ts`；必要时 `apps/local-server/src/providers/ProviderStore.ts` 或 `apps/cli/src/providers/defaultStore.ts`（须先确证缺陷）。用户可见行为应为零变化。

## 6. Expected Evidence

复现命令与结果、根因的 `path:line`、修复前后同一条用例的对比、两条 vitest 命令的 exit 与计数、两处 tsc 的 exit。

## 7. Result

**结论：隔离加固已落地并通过定向验证；原始偶发（`expected 2 to be 0`）的根因仍未定位，评审因此判 fail。状态按「已加固、根因未定位」记录，不按已验收。**

### 7.1 实现（PDW，DeepSeek）

- 任务 `20261027091222-ef1c4e`：`scan` / `test-plan` 完成，`implement` 跑到一半被宿主重启中断（无 `result.json`）。改动已落盘：`apps/local-server/src/routes/profileParity.test.ts`（+61/−5）。
- 它先按契约连跑整段 3 次，**均绿**（26 文件 / 298 通过），因此走「加固隔离 + 可失败断言」路线，而不是复现后定位。
- 具体加了：`expectCliStoreRoot()`（断言 `providerStateRoot()` 等于本用例临时根）、`profilesOnDisk()`（先 `realpath` 校验文件在临时根内，再断言内容）、CLI 包装器捕获 `stderr` 并把原文带进失败信息、`list` 后断言磁盘上是 `['a','z']`、`delete` 后断言磁盘上不再有 `work`。

### 7.2 协调者复跑（2026-10-27，我自己跑的）

- `tsc -b tsconfig.json` exit 0；`tsc -p tsconfig.test.json --noEmit` exit 0。
- `vitest run apps/local-server/src/routes/profileParity.test.ts` exit 0，1 文件 / **4 passed**。
- `vitest run apps/local-server` exit 0，26 文件 / **298 passed**。
- 无 U+FFFD 污染（逐字节检查过，控制台里的乱码只是终端解码）。

### 7.3 独立复核（PDW audit `20261027093657-9b91ec`，DeepSeek max）

判 **fail**，理由三条，我逐条核对后**全部成立**：

1. 「判别性覆盖部分成立」：`delete` 后断言临时根内条目消失、`list`/`use` 输出比对，确实能抓「读错根」；四条逐字比对断言未被改弱。
2. 「新增守卫覆盖不到卡记录的 exit 2 症状，根因仍未定位」：成立。`profileCommands` 的 `delete` 是**幂等**的（`deleted=false` 也 `return 0`），所以「读错根」不可能产生 exit 2；exit 2 只能来自它外层 `catch`（`profileCommands.ts:56-58`），即 `store.deleteProfile()` 抛错（最典型是 `provider_profiles_corrupted`，见 `ProviderStore.ts:354`）。
3. 「一处注释引用 file:line 失真」：成立。原注释写 `apps/cli/src/providers/defaultStore.ts:36-44`，而该文件只有 2 行、是 re-export；已改为指向 `apps/local-server/src/providers/defaultStore.ts`。

### 7.4 处置

- 已修正那条失真的注释，并把「delete 幂等、exit 2 属 catch 路径」写进注释，免得下一个人再按错方向排查。
- 剩下的判据（用损坏的 `provider-profiles.json` 证明 exit 2 的可达路径，把这条从「未说明」变成「有用例」）交给卡 350c（`tasks/350c-profile-parity-exit2.md`），与 353/345c 同批交 Codex。
- 保留的残余风险：原始偶发若既不是读错根、也不是损坏文件，仍可能复现；届时有 `stderr` 原文与更严的根断言可用。本卡不声称「偶发已消除」。

### 7.5 验收状态

- 已验收的部分：隔离加固与可失败断言（A4）、范围（A6）、定向与类型检查（A5）。
- 未完成的部分：复现与根因（A1、A2）、exit 2 症状的判别用例（转入 350c）。
- 卡状态按「**已加固、根因未定位**」，不标「已验收」。
