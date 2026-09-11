# EVALUATION-BRIEF-07 — Round 5b（G-04 P2 补修）+ Round 6（G-05a）独立验收

> 给**独立 Evaluator**（全新上下文，不继承任何 Implementer 推理）。对抗立场：**先假设实现有错**。
> 产出：`docs/product-evolution/EVALUATION-REPORT-07.md`，两节分别给结论（**ACCEPT / REJECT**）+ 最小修复方向。

---

## 第一节：Round 5b —— Round 5 评审两项 P2 的补修（源：`EVALUATION-REPORT-06.md`）

**背景**：Round 5（G-04 usage 数据不再静默丢失）评审判 ACCEPT，但列出两项 P2，其中 P2-2 触碰 BRIEF-05 硬验收项「不得覆盖损坏文件」。

**待验改动**（`apps/cli/src/usage/UsageStore.ts`）：
1. `load()` 的 `readFileSync` catch 现按 `err.code` 分流：`ENOENT` 静默空表；其它 code → `suppressWrite = true` + `console.warn`（含 code 与路径）。
2. 新增 `private suppressWrite = false;`；`save()` 开头（`mkdirSync` 之前）`if (this.suppressWrite) return;`。
3. `quarantineCorrupted`：隔离目标改循环取唯一名 `<file>.corrupted-<ts>[-N]`；**rename 失败分支**置 `suppressWrite = true`（成功分支不置位）。

**必查**：
- ① 三处是否与上述一致（给行号）？`suppressWrite` 置位后**确实**不会再写该文件（`save()` 早退位置正确）？
- ② 隔离**成功**后是否仍允许写新表（否则用"恢复后能继续用"被破坏）？—— 即成功分支**不得**置位。
- ③ 隔离名唯一化是否真的能避免同毫秒二次损坏覆盖前一份（`existsSync` 循环 + `-N`）？
- ④ 是否只动这一个文件、未改备份轮转/`record`/`recompute` 语义？

**指挥侧证据（真实 CLI E2E，勿照抄）**：损坏 `usage.json`（`{oops`）+ `vessel usage` → 警告含隔离目标路径、exit 0、目录仅剩隔离文件且内容 = `{oops`；连跑 3 次 `run` → `backups/` 5 份；`KEEP=0` → 不建 backups 目录。全量 vitest 见下。

---

## 第二节：Round 6 —— G-05a 密钥不进命令行 + secrets 损坏默认可恢复

**需求源**：`docs/product-evolution/IMPLEMENTATION-BRIEF-06.md`

**待验改动**：
- `packages/application/src/credential/CredentialStore.ts`：
  - `dpapiProtect`/`dpapiUnprotect` 的 PowerShell 脚本改为 **`$o = $input | ConvertFrom-Json;`**（不再用 `[Console]::In.ReadToEnd()`），材料经 `execFileSync(..., { input: JSON.stringify({payload, entropy}) })` 走 **stdin**；
  - `readOrCreateEntropy()` 内读文件那行改为 `readSecretsFile(this.secretsFile, { recover: this.recoverCorrupted })`（此前漏转发 → DPAPI 用户在**构造期**即抛，是 RELIABILITY-REPORT R5 的残留）。
- `apps/cli/src/providers/defaultStore.ts`：默认路径 `createCredentialStore({ ..., recoverCorrupted: true })`。
- 新增测试：`packages/application/src/credential/dpapiArgv.test.ts`（4 例）、`apps/cli/src/providers/defaultStore.recovery.test.ts`（4 例）。

**必查**：
- ① **argv 无材料**：`dpapiProtect/dpapiUnprotect` 的 argv（`-Command` 脚本）是否**完全不含**密钥明文/base64/熵材料？材料是否只经 `input`？测试文件是否真做了"无分隔拼接 argv 检查"（而非只查个别参数）？
- ② **真实往返**：`dpapiArgv.test.ts` 的真·round-trip 用例是否真调用真实实现（`vi.doUnmock` + 动态 import），且用**假 key**（不得出现真实 key）？非 Windows 是否正确 skip？
- ③ **构造期路径**：`readSecretsFile` 三处（含 `readOrCreateEntropy`）是否**都**转发 `{ recover: this.recoverCorrupted }`？显式 `recoverCorrupted:false` 是否仍 fail-loud（throw `CredentialError`）？
- ④ **不误伤 ENOENT**：空 root → 不抛、不产生 `*.corrupted-*`、无"损坏/隔离"类告警？
- ⑤ 越界：是否只动声明文件；库层默认值是否仍 fail-loud（恢复由调用方显式开启）。

**指挥侧证据（真实 CLI / 全量，勿照抄）**：
- 损坏 `secrets.json`（`{oops`）+ `VESSEL_PROVIDER_ROOT` 临时 root → `vessel provider list`：stderr 出现「[credential] secrets 文件损坏（invalid JSON …）已隔离备份到 `<tmp>\secrets.json.corrupted-<epochMs>`，凭据被重置为空；请核对后重建。」；命令 **exit 0**、正常列出 provider；隔离文件内容 = `{oops`。
- credential 包：`npx vitest run packages/application/src/credential` → **2 文件 / 36 用例全过**（含真实 DPAPI 往返 —— 修复前该包 5 例红，报 `DPAPI Protect failed`）。
- **过程记录（供你判断修复质量）**：stdin 方案第一版用 `[Console]::In.ReadToEnd()` 导致真实 DPAPI 往返 5 例红；探针实测该形态在本环境 `spawnSync EPERM`、而 `$input` 成功 → 改为 `$input`。
- 全量：见交付时最新的 `tsc -b` / `vitest` 结果（指挥会在提交说明里给出）。

**【额外扫查（P3 即可）】**：`vessel usage` 标题硬编码 `~/.vessel/usage.json`（实际 root 可由 `VESSEL_USAGE_ROOT` 指定）是否属实；`defaultStore.recovery.test.ts` 是否有其它把"测试缺陷"误记为"实现缺陷"的断言。
