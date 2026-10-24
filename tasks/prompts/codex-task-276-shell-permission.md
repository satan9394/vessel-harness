# Codex 执行契约：卡 276 让 Shell 在 workspace-write 下可用（强制沙箱）

仓库 `E:\Code_file\Projects\Vessel_Harness`，分支 `main`，工作树干净。

## 先读

1. `tasks/276-shell-under-workspace-write.md`（范围与验收，唯一权威）
2. `packages/policy/src/engine/Engine.ts`（约 88–117 行的 profile 比较与 approval 判定）
3. `packages/tools/src/shell/shellTool.ts`（`requiredPermission` 与 native 沙箱分支）
4. `packages/application/src/compose.ts:343`（Shell 装配，`nativeAudit` 总是传入）
5. `evidence/task256/RESULT.md`（沙箱已可用的实测证据）

## 背景

UI 默认会话是 `workspace-write`，而 Shell 要求 `danger-full-access`，于是 UI 里永远调不到 Shell
（实测拒绝原因：`approval required but approval=never (profile)`）。
用户已拍板：允许 workspace-write 使用 Shell，但**必须强制走沙箱**。

## 要做

1. `Shell` 的 `requiredPermission` 改为 `workspace-write`；read-only 下仍不可用。
2. **强制沙箱**：`shellTool` 在没有可用 native runner 时必须返回 `DENIED`，
   不允许回落到无沙箱的 `sandbox.confine` 直通路径。有 runner 时照常执行。
3. 测试：
   - policy：workspace-write + Shell → 允许（不再 needsApproval）；read-only + Shell → 拒绝；
     danger-full-access 行为不变。
   - tools：缺 native runner → Shell 返回 DENIED（附错误类别）。
   - 既有 Shell / 沙箱用例保持通过。
4. 同步 UI 里关于权限的说明文案（如果有把 Shell 描述成「需要完整权限」的地方）。
5. `docs/POLICY-SPEC.md` 补一句：Shell 在 workspace-write 下可用，但执行强制经过原生沙箱，
   不可用时 fail-closed。

## 红线

- 不放宽 `read-only`。
- 不绕过沙箱、不新增「没有沙箱也照跑」的降级分支。
- 不改 `packages/core`、不改沙箱实现本身、不引入 approval 交互流。
- 不 commit/push；不跑 `test:all`（协调者跑）。

## 交付

- 改动 + 新增测试名。
- 门禁退出码与计数：`tsc -b`、`typecheck:tests`、`vitest run packages/policy packages/tools`、
  `vitest run apps/local-server`、`test:web`。
- 最终回复说明：为什么这样改能保证「workspace-write 下也一定在沙箱里」，以及被否的替代方案。
