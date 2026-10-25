# T300 — 补齐三处遗留测试

- Status: 已完成（2026-10-25；Codex 手动执行 + 授权修复 doctor 凭据判断；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 三张卡各留了一个「只有代码、没有专门测试」的口子，本卡一次性补上。**不改产品逻辑**（发现逻辑错再回报）。

## 0. 先读这些（只读）

1. `benchmarks/runners/src/runner.ts` 约 970–1060 行 — `success`、`turnEndedAbnormally`、`.run-complete.json` 的写入条件。
2. `benchmarks/runners/src/types.ts` — `ScenarioReport.turnKind` / `turnEndedAbnormally`。
3. `benchmarks/runners/src/runner.test.ts` — 现有「assert 失败但写 summary」的用例（卡 294 的 AC5 用它做负对照），以及 `OFFLINE_SCRIPTS` 的用法。
4. `apps/cli/src/commands/doctorCommand.ts` 的 provider 检查 + `apps/cli/src/providers/ProviderStore.ts` 的 `ProviderConfig`（含 `secretRef`）。
5. `packages/shared/src/toolPins.ts` 的 `probeToolVersion` / `parseToolVersion`。

## 1. 测试 A：turn 异常但断言全过 → 不写 `.run-complete.json`

- 构造一个 run：`asserts` 全部 pass，但 loop turn 以 `kind !== 'success'` 收尾（看 `runner.ts` 里 `turnKind` 的来源，用可注入的 provider / 离线脚本让该轮异常终止）。
- 断言：`report.success === true`、`report.turnEndedAbnormally === true`、`summary.json` 存在，但 `.run-complete.json` **不存在**。
- 若发现构造不出「asserts 全过 + turn 异常」的场景（现成 fixture 都不支持），**不要伪造**：在回报里说明，并把该用例降级为对 `writeRunCompletionMarker`（若可抽出）或对条件表达式的直接单测——但优先真跑。

## 2. 测试 B：`secretRef` 凭据不被判「不可用」

- `VesselDoctorEngine` 注入 `providers: () => [{ id, protocol: 'openai-compatible', baseUrl: 'https://example.invalid/v1', secretRef: 'some-ref' }]`（**没有 `apiKey` 字段**）。
- 断言 `providers` 项是 `pass` 或 `warn`，**不是 `fail`**；并断言 message 不包含凭证值。
- 这条锁的是卡 295 那次 blocked 的根因之一：doctor 对 `secretRef` 条目的口径。

## 3. 测试 C：`probeToolVersion` 的解析边界

- `'codex-cli 0.164.0'` → `'0.164.0'`；`'opencode 2.1.4'` → `'2.1.4'`。
- 多行输出（版本号在第二行）→ 仍能取到。
- 完全无版本号 → `null`（不是抛错）。
- 版本号在 stderr（stdout 为空）→ `null`（当前实现只读 stdout；如要改行为，先回报）。

## 4. 不许做

- 不改产品代码（除非测试 C 暴露实现 bug，那就停下回报）。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`；不跑 `--live`。
- 测试自建的临时目录用 `os.tmpdir()`，允许测试自己清理。

## 5. 允许修改

```
benchmarks/runners/src/runner.test.ts        (追加用例)
apps/cli/src/commands/doctorCommand.test.ts  (追加用例)
packages/shared/src/toolPins.test.ts         (追加用例)
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/runner.test.ts apps/cli/src/commands/doctorCommand.test.ts packages/shared/src/toolPins.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 7. 回报

```
A：<构造方式 + 断言 + 是否真跑成>
B：<注入的 provider 形状 + 断言结果>
C：<四条解析用例结果 + 是否发现实现 bug>
新增用例总数：<n>
检查：<三条命令退出码>
未做到：<如实写>
```

## Result

已完成，并**按用户授权顺带修了一处产品逻辑**。

- **A（turn 异常不写标记）**：用现成的 B025 场景真实触发 interrupt，断言 `report.success === true`、`turnEndedAbnormally === true`、`summary.json` 存在而 `.run-complete.json` 缺席。
- **B（`secretRef` 口径）**：补齐回归测试后**先失败**——`apps/cli/src/commands/doctorCommand.ts:92` 只认 `apiKey`，而同文件 `localWithoutAuth` 对 `secretRef` 直接返回 `false`，于是「只有 secretRef、没有 apiKey」的供应商被判 `fail`。经授权改该处：新增 `hasCredential = Boolean(apiKey?.trim()) || Boolean(secretRef)`，其余分支与 `allPassed` 定义未动。修复后该用例转 pass。
- **C（`probeToolVersion` 边界）**：多行输出、无版本号、版本在 stderr 等四种情况，全按预期（版本在 stderr 时返回 `null`，不改实现）。

验收：三文件 / 69 passed；`tsc -b`、`typecheck:tests` exit 0。

这处修复解释了卡 295 与 296 两次在 Codex 沙箱里报 blocked 的机制：沙箱内 `createDefaultProviderStore().load()` 解析不到 `secretRef` 对应的密钥，旧判定就把它当成「凭据不可用」。
