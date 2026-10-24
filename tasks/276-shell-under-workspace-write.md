# 任务卡 276: 让 Shell 在 workspace-write 下可用（强制沙箱）

**状态**: 已否决（原方案放开默认权限）；改为「UI 显式开关 + Shell 保持 danger-full-access」，2026-10-23
**创建时间**: 2026-10-23
**执行者**: Codex (`gpt-6.1-sol`, medium)
**协调者**: OpenCode

---

## 1. 背景（实测，不要重新论证）

卡 275 的浏览器验收发现：UI 正常建出来的会话调 Shell 必被拒，理由是
`approval required but approval=never (profile)`。

根因：`Shell` 的 `requiredPermission` 是 `danger-full-access`，而 UI 默认会话是 `workspace-write`；
`packages/policy/src/engine/Engine.ts:100` 对 `workspace-write + danger-full-access` 判需要审批，
`approval=never` 时直接 deny。

同时卡 256 已证明沙箱真的能工作（受限令牌 + Low + Job Object + 写根限制，真实模型会话里审计记录为
`enforced`，见 `evidence/task256/`）。

**用户决策（已确认）**：允许 `workspace-write` 使用 Shell，但**必须**强制走沙箱。

## 2. Goal

1. `Shell` 在 `workspace-write` 下可用（不再需要 `danger-full-access`）。
2. 该权限下执行**必须**经过原生沙箱；沙箱不可用或执行被拒时 fail-closed（返回 DENIED），
   绝不允许回落到无沙箱的 `sandbox.confine` 直通路径。
3. `read-only` 下仍不可用。
4. 不改变 `danger-full-access` 的现有行为。

## 3. Acceptance Criteria

1. `packages/policy/src/engine/Engine.ts` 的 profile 比较：`workspace-write` + Shell → 允许（不再 needsApproval）。
   `read-only` + Shell → 仍拒绝。
2. `packages/tools/src/shell/shellTool.ts`：没有可用的原生沙箱 runner 时，返回
   `DENIED`（不得静默走非沙箱路径）；有 runner 时执行。
3. 新增测试：
   - policy：`workspace-write` 允许 Shell、`read-only` 拒绝 Shell、`danger-full-access` 不变；
   - tools：缺少 native runner 时 Shell 返回 DENIED；
   - 既有 Shell 沙箱用例仍通过。
4. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`npx vitest run packages/policy packages/tools`、
   `npx vitest run apps/local-server`、`npm run test:web`。`test:all` 由协调者跑。
5. 若 UI 里有权限说明文案，同步更新（Shell 在 workspace-write 下可用但强制沙箱）。

## 4. Not Doing

- 不放宽 `read-only`。
- 不引入 approval 交互流（那是另一个选项，本次不做）。
- 不改 `packages/core`；不改沙箱实现本身。
- 不 commit/push。

## 5. Blast Radius

`packages/tools/src/shell/shellTool.ts`、`packages/policy/src/engine/Engine.ts`（仅 profile 比较与相关测试）、
`packages/policy/src/risk/*`（若策略文本需要同步）、`docs/POLICY-SPEC.md`、Web 权限说明文案（若有）。

## 6. Result

**原方案已否决（2026-10-23），原因是有新的安全事实。**

实现完成后跑 `test:all`，安全包 S008（云元数据 SSRF）失败。追查根因不是测试写错，而是：
**原生沙箱不限制网络出口**。在受限令牌 + Low + Job Object 内实测：

```
nslookup example.com → 2606:4700:10::ac42:93f3 / 104.20.23.154 / 172.66.147.243
```

沙箱约束的是文件系统、令牌权限与进程树；联网完全不受限（`curl.exe` 在受限令牌下 DLL 初始化失败属偶然，
换 `nslookup` 就通）。因此「Shell 降到 workspace-write」实际等于**把默认权限从『不能用 Shell』变成『能用 Shell 且能联外网』**，
与当初「反正进沙箱了」的前提不符。S008 的红是它该有的表现。

**采用的替代方案**：Shell 保持 `requiredPermission: 'danger-full-access'`；UI 的新会话权限选择器补齐
`danger-full-access` 档位（此前只有 read-only / workspace-write，导致 UI 里永远调不到 Shell），
并在选中时显示「可执行任意命令；原生沙箱只约束文件与进程，不限制联网」的警告。由用户按会话显式决定。

已落地：`NewSessionForm` / `TaskComposer` 的选项与警告、中英文案、`POLICY-SPEC` 的沙箱边界与 Shell 权限说明、
组件测试（选项存在、警告仅在选择时出现、提交时权限透传）。

被否决的实现已整份 stash 保留（`card276-workspace-write-rejected-network-egress`），未合并。
逐进程网络隔离（AppContainer/WFP）属独立课题，不在 v0.1 范围。

### 后续（同日）：补上「完全访问也跑不了」的缺口

UI 的完全访问档位落地后，用真实模型会话验证（`danger-full-access` + 普通临时工作区）发现 Shell 仍然必拒：

```
[DENIED] restricted sandbox denied: sandbox directory requires provisioned
         Low Integrity and restricted SID ACL: <workspace>
```

原因是卡 256 的沙箱要求工作区**预先**带 Low 标签且其按路径派生的受限 SID 被授予写权限；此前端到端能过，
是因为夹具目录被手工准备过。普通项目目录必然没有，于是「完全访问」变成必然拒绝。

试过并**否决**的两条：

1. **A：让 `danger-full-access` 跳过沙箱**（改 `createShellTool` 按 profile 选择 runner）。
   实现完成后 `test:all` 三个套件红：`B005`、安全包「`no_executed_call` 必须能单独红」、`nativeSandboxIntegration`
   （它断言真实工具循环会产生原生沙箱审计）。因为 Shell 只在 danger 下可用，A 会让沙箱在整个产品里**不可达**，
   卡 256 的整条链变成测试里的死代码。已 stash（`card276-danger-bypass-sandbox-rejected-suite-wide`），未合并。
2. **B：会话内静默给工作区打 ACL**。否决理由：那是改用户目录权限位，不该由一次对话偷偷完成。
   参照 OpenAI Codex 的 Windows 沙箱——ACL 配置在 setup 阶段、需提权；Claude Code 在原生 Windows 上干脆不隔离。

**采用 C：显式、一次、可撤销的准备命令** `scripts/provision-sandbox.ps1`：

- `-Path <项目目录>`：授予该工作区派生 SID 的 Modify、把目录设为 Low 完整性，并回读验证两项事实。
- `-Revoke`：移除授权、标签设回 Medium（`icacls /remove:g *<sid>` 对本地不存在的 SID 报 1332，
  故改用与授权对称的 .NET `RemoveAccessRuleSpecific`；标签判定也改为匹配 `Low Mandatory Level`，
  因为 Low 与 Medium 都带 `(NW)` 策略位，光看标志位区分不开）。
- 实测：SID 与 `restrictedWriteSid()` 逐字一致；准备后 `cmd /c echo` 在沙箱内 exit 0、`integrityRid=4096`；
  撤销后同一命令再次被拒。

准备脚本落地后做真实会话复验，又发现两处必须一起改，否则「已准备」仍然跑不起来：

1. **写根里的 `os.tmpdir()` 是致命项**。预检要求每个写根都已准备，系统临时目录永远不会被准备，
   所以准备完工作区后仍然被拒，报错路径指向 `%TEMP%`。低完整性令牌本来就写不进 Medium 标签的临时目录，
   该写根从未提供真实能力，已移除（沙箱路径的写根现在只有工作区）。
2. **拒绝信息不可操作**。原始错误只是一句路径抱怨，真实模型会话把它读成「Shell 工具不可用」并重试三次。
   现在命中该错误时补一句 `run: scripts/provision-sandbox.ps1 -Path "<workspace>"`。

复验口径（真实模型、`danger-full-access`、普通临时工作区、隔离的 provider/usage 根）：
未准备 → `DENIED` 且提示脚本；准备后 → `sandboxed: true`、`outcome: enforced`、`integrityRid: 4096`、
`allowedWritePaths` 只有工作区，模型贴出的 `echo` 输出与真实一致。

> 教训（已写进 `AGENTS.md`）：一次 `test:all` 之后 `packages/*/dist` 可能落后于 `src`，
> 而 `vessel serve` 通过包导出走 **dist**。第一次复验就是因为 dist 还留着已回滚的 A 方案，
> 测出了「能跑」的假象——`tsc -b` 之后重跑才看到真正的 DENIED。

边界如实记录在 `docs/POLICY-SPEC.md` §2.4：未准备的工作区不静默降级，而是 fail-closed 并报出准备方法。
