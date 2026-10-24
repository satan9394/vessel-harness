# 卡 276 收尾：完全访问下 Shell 真实可用的证据

日期：2026-10-23。真实模型 `deepseek/deepseek-v4.1-flash`（Command GOTA），
`vessel serve` + `POST /api/sessions`（`permission: danger-full-access`），
`VESSEL_PROVIDER_ROOT` / `VESSEL_USAGE_ROOT` 指向临时目录，`~/.vessel` 未被触碰。

## 1. 未准备的工作区 → DENIED（且给出可操作提示）

工具结果（`tool/result`）里的审计记录：

```json
{"isolationTier":"windows-job-restricted","sandboxed":false,"outcome":"denied",
 "allowedWritePaths":["...\\vessel-ui-shell-ebayL3\\ws"],
 "reason":"Error: restricted sandbox denied: ... sandbox directory requires provisioned Low Integrity and restricted SID ACL: ...\\vessel-ui-shell-ebayL3\\ws"}
```

模型据此判断「Shell 不可用」（这是修复前的行为；修复后同一错误会附带
`run: scripts/provision-sandbox.ps1 -Path "<workspace>"`）。

## 2. 执行过 `scripts/provision-sandbox.ps1` 之后 → enforced

准备输出：

```
workspace : C:\work\AppData\Local\Temp\vessel-e2e-provisioned-31ew72\ws
sandbox SID: S-1-5-21-2569144062-4194578834-2219986372-183 (granted=True)
low label  : True
done - Shell under a full-access session can now use the restricted sandbox here.
```

审计记录：

```json
{"isolationTier":"windows-job-restricted","sandboxed":true,"outcome":"enforced",
 "allowedWritePaths":["C:\\work\\AppData\\Local\\Temp\\vessel-e2e-provisioned-31ew72\\ws"],
 "constraints":{"readOnlyPaths":[],"memoryLimitBytes":536870912,
 "privilegeReduction":"Restricted token, Low Integrity, and Job Object confinement. ...",
 "integrityRid":4096}}
```

工具结果 meta：`{"exitCode":0,"readonly":true,"retryUnsafe":true,"sandbox":{"active":true,"isolationTier":"windows-job-restricted"}}`，
内容 `provisioned-shell-ok`，与真实的 `echo` 输出一致。

## 3. 两个在复验中发现、必须一起修的坑

- **`os.tmpdir()` 作为写根**：预检要求每个写根都已准备，`%TEMP%` 永远不会，于是准备完工作区仍被拒，
  报错路径指向 `%TEMP%`。已移除该写根（沙箱路径只剩工作区）。
- **`dist` 落后于 `src`**：第一次复验测出「能跑」，实际是 `packages/*/dist` 仍留着已回滚的 A 方案
  （`vessel serve` 通过包导出走 dist）。`npx tsc -b` 后重跑才看到真正的 DENIED。已记入 `AGENTS.md`。

## 4. 脚本自身的两个实现细节

- `icacls /remove:g *<sid>` 对本地不存在的 SID 返回 1332，撤销改用 .NET `RemoveAccessRuleSpecific`。
- Low 与 Medium 完整性标签都带 `(NW)`，`icacls` 输出里靠 `Low Mandatory Level` / `Medium Mandatory Level`
  区分，不能只看策略位。

以上两点由 `packages/tools/src/execution/sandbox/provisionScript.test.ts` 固化
（SID 与 `restrictedWriteSid()` 逐字比对、撤销后授权消失且标签不再为 Low）。
