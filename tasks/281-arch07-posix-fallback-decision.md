# 任务卡 281: ARCH-07 POSIX 沙箱降级口径待拍板（需用户决定）

**状态**: 阻塞 — 需要用户对安全口径拍板，协调者不自行决定
**创建时间**: 2026-10-23
**执行者**: 待定
**协调者**: OpenCode

---

## 1. 事实（已核实）

`packages/tools/src/execution/sandbox/platformSandbox.ts` 在 POSIX 上：

- helper 可用（Linux `bwrap` / macOS `sandbox-exec`）→ 真实隔离，`isolationTier` 为 `bwrap-ns` / `seatbelt`。
- helper 不可用 → **照常执行命令**，`sandboxed: false`、`isolationTier: 'passthrough-fallback'`，
  审计里如实写 `sandboxed:false`。

Windows 侧不是这样：受限令牌沙箱拿不到先决条件时，`Shell` 直接返回 `DENIED`（卡 276 之后附带准备工作区的命令）。

评审矩阵因此把 ARCH-07 记为「部分实现」，缺的正是「POSIX helper 缺失时是否允许静默直通」。

## 2. 为什么我不自己决定

这条改动会直接改变**默认行为**：把 POSIX 的 passthrough 改成 fail-closed，等于让没装 `bwrap` 的
Linux 用户执行任何命令都被拒；保持现状则等于承认「不同平台的安全承诺不一致」。属于安全口径取舍，
按项目约定必须由用户拍板。

## 3. 三个可选口径

1. **保持现状 + 把差异写进文档与 UI**（我倾向于此）：不改默认行为，但把「POSIX 无 helper 时不隔离」
   写进 `POLICY-SPEC`，并让会话里能看见 `sandboxed:false`（当前审计已有，UI 是否展示需另验）。
   代价：安全承诺仍是分平台的，必须说清楚。
2. **默认 fail-closed，允许显式放行**（如 `VESSEL_ALLOW_UNSANDBOXED=1` 或会话级开关）：
   与 Windows 一致，代价是 Linux/macOS 用户没装 helper 时第一次执行会失败，需要看提示去装/放行。
3. **仅当 `danger-full-access` 时允许 passthrough**（其余 fail-closed）：与卡 276 的结论同构，
   代价是要重新定义 POSIX 的 profile 语义。

## 4. Acceptance（选定口径后）

- 选定口径写进 `POLICY-SPEC`（含为什么），并在 `platformSandbox` 的单测里固化对应分支。
- 不允许出现「文档说不隔离、代码却隔离」或反向的不一致。
- 若选 2/3，需给出可操作提示文案，并有真实进程证据（Windows 上只能靠 fake platform 单测，
  Linux 侧需用户环境或 CI 腿，**不得用 Windows 结果冒充**）。

## 5. 需要用户回答的一句话

「POSIX 没有沙箱 helper 时，你希望默认拒绝执行（安全优先），还是照常执行但明确标注未隔离（可用优先）？」
