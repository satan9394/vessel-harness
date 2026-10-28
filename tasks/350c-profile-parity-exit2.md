# 任务卡 350c: `profileParity` 的 exit 2 可达路径（把「没说明」变成「有用例」）

- Status: 已验收（2026-10-27 验收：Codex 实现 + 独立复核 PASS；协调者复跑 parity 5/5、local-server 26 文件 / 313 passed、两处 tsc exit 0，全量门禁 17 步全绿）
- PDW task: 待回填（跑完再补）
- 前置证据：卡 350 的「复核结论」——`delete` 幂等恒返回 0，exit 2 只能来自 `profileCommands` 的 catch

## 1. Goal

卡 350 记录的偶发是 `expected 2 to be 0`。已经确认 `profileCommands` 的 `delete` 分支幂等（`deleted=false` 也 `return 0`），所以「CLI 读错 provider 根」**不会**产生 exit 2；exit 2 只能来自它的外层 `catch`，最典型是 profiles 文件损坏（`ProviderStore.ts` 抛 `provider_profiles_corrupted`）。本卡用一条用例把这个可达路径钉住，让下次同类红灯能直接对号入座。

## 2. 要做的事

1. 在 `apps/local-server/src/routes/profileParity.test.ts` 新增一条用例：把本用例临时根下的 `provider-profiles.json` 写成非法 JSON（或非 v1 结构），再跑 `main(['provider','profile','delete','work','--json'])`。
2. 断言 CLI 返回 **2**，且错误输出含映射后的文案「provider-profiles.json 损坏」（中英以 `profileCommands.ts` 的 `ERRORS` 为准）；用 `stderr` 与 JSON 输出两处之一取证，不放过任何一处静默。
3. 同一用例里对同一根发一次 `DELETE /api/providers/profiles/work`（直接 `fetch`，不要复用会强断言 200/201 的既有 `http()` 助手），断言返回 `provider_profiles_corrupted`——证明 CLI 与 HTTP 对同一故障给出同一结论。
4. 用例注释写明：`delete` 幂等 ⇒ 读错根不会产生 exit 2；因此本用例是「exit 2 可达路径」的证据，不是复现原始偶发。

## 3. Not Doing

- 不改产品代码（`profileCommands.ts` 的 `ERRORS` 映射已经覆盖该错误码）；若确证必须改，报 blocker 而不是自行扩范围。
- 不改弱卡 350 已加的两条守卫（`expectCliStoreRoot` / `profilesOnDisk`）与四条逐字比对断言。
- 不加 sleep、不加测试级重试、不为「让它过」而放宽既有断言。

## 4. Acceptance

1. 新用例在受损文件下断言 exit 2 + 映射文案；在文件正常时不受影响（既有 4 条仍绿）。
2. HTTP 侧同故障返回 `provider_profiles_corrupted`。
3. 两条判据都在同一条用例内，且注释解释了「为什么 exit 2 不可能是读错根」。
4. `vitest run apps/local-server/src/routes/profileParity.test.ts`、`vitest run apps/local-server`、`tsc -b`、`tsc -p tsconfig.test.json --noEmit` 全绿，计数写进报告。
5. 只改这一个测试文件。

## 5. Blast Radius

`apps/local-server/src/routes/profileParity.test.ts`（+ 一条用例）。无产品行为变化。

## 6. Expected Evidence

新用例的前后输出、两份 vitest 计数、两处 tsc 的 exit、`git diff --stat`。

## 7. Result

- 实现路由：`gpt-6.1-terra` / `medium`，Fast 关闭；依据交接单 §1：单测试文件、判据明确。
- 新增同一临时根下的非法 JSON 用例：CLI exit 2，stderr 的 JSON 信封及其解析后的错误均含映射文案；HTTP 原始 DELETE（带 Origin）返回 `provider_profiles_corrupted`。注释说明幂等删除与原偶发的证据边界。保留既有守卫和逐字比较。
- `node node_modules/vitest/vitest.mjs run apps/local-server/src/routes/profileParity.test.ts`：exit 0，1 文件、5 测试通过；`node node_modules/vitest/vitest.mjs run apps/local-server`：exit 0，26 文件、313 测试通过。
- 协调者在最终测试编辑后执行 `node node_modules/typescript/bin/tsc -b tsconfig.json` 和 `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit`：均 exit 0，零诊断。
- 原始日志：`C:/work/AppData/Local/Temp/vessel-wave2-x0Tnhs/` 下的 `t5b-profileParity.log`、`t5b-local-server.log`、`tsc-build.log`、`tsc-tests.log`。测试文件 Git blob：`a32fa8b8578b8a053a1006779ab93fd2fd637289`。
- `git diff --stat -- apps/local-server/src/routes/profileParity.test.ts`：1 file changed, 85 insertions(+), 5 deletions(-)；该统计包含任务开始前已存在的未提交改动。任务卡为未跟踪文件，不在该统计中。
- 未运行全量门禁、提交或推送；未改产品代码。一次只读探索命令 `rg -n -C 4 'provider_profiles_corrupted|console.error|JSON.stringify' apps/cli/src/providers/profileCommands.ts apps/local-server/src/routes/provider*` 因 Windows 路径通配符失败（os error 123），随后直接读取目标文件。
- 策略拒绝的命令：无。协调者曾收到模型调用失败（非命令拒绝）：`Agent errored: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 5:50 AM.`
- 独立复核：`gpt-6.1-terra` / `low`，逐条 AC PASS。协调者另行复跑 parity 5/5、local-server 313/313，均 exit 0；最终两项 tsc 再次 exit 0、零诊断，并将测试文件 SHA-256 写入 `tsc-build-final.log` / `tsc-tests-final.log` 以绑定最终产物。复跑日志为同目录 `verify-t5b-profileParity.log`、`verify-t5b-local-server.log`。

#### 协调者验收（2026-10-27，独立复跑）

- 我自己的数字：`profileParity` exit 0、1 文件 / **5 passed**；`local-server` exit 0、26 文件 / **313 passed**（比卡 350 时 +1，正是本卡新增用例）；`tsc -b`、`tsc -p tsconfig.test.json` exit 0；全量门禁 17 步全绿。
- 新增用例的判据我读过：损坏的 `provider-profiles.json` 下 CLI 断言 **exit 2 + 映射文案**，同一根直接用 `fetch` 断言 `provider_profiles_corrupted`；注释里写清了「`delete` 幂等 ⇒ 读错根不会产生 exit 2」。这正是卡 350 复核（`20261027093657-9b91ec`）要求补的那条，缺口闭合。
- 边界：未复现原始偶发，本卡证明的是「exit 2 的唯一可达路径」与「读错根会红」，不是「偶发已消除」。卡 350 仍按「已加固、根因未定位」记账。
