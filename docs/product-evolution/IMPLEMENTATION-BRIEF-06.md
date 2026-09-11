# IMPLEMENTATION-BRIEF-06 — 密钥不进命令行 + secrets 损坏默认可恢复（G-05a，P1）

> Round 6 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-05 / `docs/product-audit/RELIABILITY-REPORT.md` R3、R5。
> 本切片只做"凭据处理的这两处弱点"（同一模块，低成本高确定性）；**错误体回显脱敏**（R4）留作下一轮，避免一轮多主题。

## 目标

1. **API key 不再出现在进程命令行上**：DPAPI 的 Protect/Unprotect 目前把密钥的 base64 **拼进 `powershell.exe -Command "<script>"`**，本机同级进程（WMI/任务管理器/AV）可读到 → 改为**经 stdin 传入**（命令行只剩固定脚本，无密钥材料）。
2. **`secrets.json` 损坏不再让整个 CLI 变砖**：默认启用"隔离留档 + 警告 + 空结构继续"（与 Round 5 的 usage 同款；`recoverCorrupted` 机制**已存在**，只是默认未开）。

## 用户场景

1. 用户 `vessel provider set --api-key sk-…` → 现状：密钥 base64 出现在 powershell 命令行里（约数十毫秒窗口，本机任意同级进程可抓）。期望：命令行只有固定脚本，密钥仅走 stdin。
2. 用户机器上 `secrets.json` 被改坏 → 现状：`CredentialStore` 默认 `recover=false` 直接 throw，`vessel run/chat/provider/models` **几乎全灭**，报错只给路径、无恢复指引。期望：损坏文件被**改名隔离**（内容保留）+ 一句警告 + 以空结构继续（用户重录 key 即恢复）。

## 当前问题（证据）

- `packages/application/src/credential/CredentialStore.ts:339-354`（`dpapiProtect`）与 `:356-372`（`dpapiUnprotect`）：把 `plainB64` / `cipherB64` / `entropyB64` 用模板串拼进 `script`，再 `execFileSync('powershell.exe', [..., '-Command', script], { stdio: 'pipe' })` → **命令行为进程可见数据**。
- 同文件 `:118-147` `readSecretsFile(file, { recover })`：`recover` 为真才 `quarantineCorrupted`（`:135`/`:145`），否则 throw（`:137`/`:146`）；`recoverCorrupted` 的调用方默认未开启（可靠性报告 R5：`defaultStore.ts` 未传）。
- 参考：`quarantineCorrupted`（`:152-171`）已实现（改名 `<file>.corrupted-<epochMs>` + `console.warn`，不删除）。

## 理想行为

1. **DPAPI 走 stdin**：
   - 命令行参数**只含固定脚本**（`-NoProfile -NonInteractive -Command "$in=[Console]::In.ReadToEnd(); …"`），脚本内不再插值任何密钥/熵材料；
   - 密钥与熵经 **stdin** 传入（建议 JSON：`{"payload":"<b64>","entropy":"<b64>"}`，脚本 `ConvertFrom-Json` 解析）；
   - `dpapiProtect` / `dpapiUnprotect` 的**输入输出契约不变**（入参/出参仍是 base64 字符串），调用方零改动；
   - 失败语义不变：PowerShell 出错 → throw（调用方显式降级，不静默吞错）。
2. **secrets 损坏默认可恢复**：默认路径（`defaultStore` 创建的 store）开启 `recoverCorrupted: true`；损坏时隔离改名 + `console.warn`（复用既有 `quarantineCorrupted`）+ 空结构继续。
   - 若显式传入 `recoverCorrupted: false`，保持 fail-loud（现有测试可能依赖该行为，**不要**改显式语义）。

## 涉及模块

`packages/application/src/credential/CredentialStore.ts`（主）、`apps/cli/src/providers/defaultStore.ts`（传 `recoverCorrupted: true`）、相应测试文件（新增/追加）。

## 不能破坏什么

- `CredentialStore` 的**公开契约**：`get/set/delete/list`、`WindowsDpapiCredentialStore` 的构造与 `CredentialBackend` 接口、错误类型 `CredentialError`。
- 现有测试全绿（当前基线 **118 文件 / 1263 passed + 1 skipped**；`tsc -b` 0）。特别注意：既有测试若断言"损坏 → 抛 CredentialError"，须区分**显式 recover=false** 与默认路径；默认路径的行为变更要同步更新/新增测试，**不得**直接删既有断言。
- 测试隔离：不碰真实 `~/.vessel`；凭据后端用**内存假后端**注入（仓库既有做法）。
- 本轮**不引入新依赖**；不改 `secrets.json` 结构。

## 验收标准

1. **不泄入 argv（关键，可测）**：对 `dpapiProtect`/`dpapiUnprotect` 的 spawn 做 spy（`vi.mock('node:child_process')` 或注入 seam）——
   - 断言 `args` 拼接后**不包含**密钥 base64/明文/熵材料；
   - 断言密钥材料出现在 **`input`/stdin**（选项里的 `input` 字段）而非 `args`。
2. **功能不回归（真实往返）**：在 Windows + DPAPI 可用时，`protect('sk-test-not-a-real-key-123')` → `unprotect` 得到**同一明文**（用非真实假 key，禁止用真 key）。
3. **损坏默认可恢复**：临时 `VESSEL_*/secrets.json` 写非法 JSON → 默认 store 的 `get/list` **不抛**、返回空、且产生 `<file>.corrupted-*`（内容保留）+ `console.warn` 含路径。
4. **显式 fail-loud 保持**：`recoverCorrupted: false` 时损坏仍 **throw** `CredentialError`（既有语义）。
5. `tsc -b` 0；全量 vitest 绿（新增用例计入）。

## 错误场景

- PowerShell 不可用/DPAPI 不可用 → 行为不变（工厂探测决定后端；`WindowsDpapiCredentialStore` 出错仍 throw）。
- stdin 传参在 Windows 下须可靠：若 `execFileSync` 的 `input` 与 `-Command` + `[Console]::In.ReadToEnd()` 组合在实测中不可用，**改判**为"临时文件 + 写后立即回收站删除"方案并**在实现说明中记录实测结论**（不得只凭推测）。

## 测试要求

- 写入型微任务（单文件/单点，执行器不跑命令）；指挥复跑 `tsc -b` + 全量 vitest + **判别性 E2E**：
  - argv 检查（spy 断言密钥不在 args）；
  - 真实 DPAPI 往返（假 key）；
  - 损坏 secrets ⇒ 默认恢复（隔离文件 + 警告 + 不抛）。
- 之后交独立静态 Evaluator 复核（Round 6 验收）。
