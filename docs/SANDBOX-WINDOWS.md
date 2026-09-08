# Windows Sandbox Backend（071）能力与限制

> 状态：任务 071 交付（Windows Job Object 后端）
> 关联：`packages/runtime/src/sandbox/`、`packages/runtime/src/process/Process.ts`、路线文档 §13.1–13.3
> 本文档描述 071 落地后的**真实能力**与**诚实限制**——不宣称"看起来启用、实际 passthrough"（§13.3）。

## 一句话

Windows 上 runtime/sandbox 从 v0.1 的纯 seam（partial/passthrough）升级为**机制层硬执法**的
Job Object 进程隔离后端：进程树统一终止 + 活动进程数上限（OS 强制）+ 隔离工作目录，并衔接 050
中断（runCommand `signal`）的整树 kill。

## 能力（delivered）

| 能力 | 机制 | 强度 |
| --- | --- | --- |
| 进程树统一终止（kill-tree） | 命名 Job Object + `TerminateJobObject`（从独立进程按名重开） | OS 强制：root + 在 job 内派生的所有后代一并终止，孙进程也不例外 |
| 活动进程数上限（anti fork-bomb） | `JOB_OBJECT_LIMIT_ACTIVE_PROCESS`（holder 创建时设置） | OS 强制（best-effort：struct 设置失败时静默降级，见限制） |
| 隔离工作目录 | 每次 confine/run 在 `os.tmpdir()` 下新建 `vessel-sandbox-*`，作为 cwd 与 TMP/TEMP | 目录隔离；绝不落主工作区 |
| 050 interrupt 衔接 | `runCommand({ signal, confinement })`：超时/abort 时先 `child.kill` 直杀，再 `confinement.terminate()` 整树终止 | 孙进程在 Windows 上不再漏杀 |
| 诚实状态上报 | `status()`：win32 → `enabled/active=true, backend='job-object', supported='windows-job-object'` | 无 passthrough 伪装 |

## API 形态

```ts
// 1) 全托管：run() 自动完成隔离目录 + job 挂接 + 清理
const r = await sandbox.run('node', ['-e', '...'], { limits: { maxActiveProcesses: 8 }, signal });

// 2) 半托管：自己 spawn，随后 attach + dispose
const session = await sandbox.openConfinement({ maxActiveProcesses: 8 });
const child = spawn(...);
await session.attach(child.pid!);   // 把子进程拉进 Job Object
await session.dispose();            // TerminateJobObject 整树 + 回收隔离目录

// 3) 底层：直接创建/终止
const conf = await createJobObject(pid, { maxActiveProcesses: 4 });
await conf.terminate();
```

`runCommand` 新增 `confinement?: { terminate(): Promise<void> }` 与 `onSpawn?` 两个选项（详见
Process.ts 注释）；shell tool 已切到 `sandbox.run`（真实接线上路径）。

## 与 070 sidecar 的关系（明确选择）

**sandbox 保持 TS 原生 runtime 后端，不经过 sidecar 协议**。理由：

1. 本机无 Rust 工具链，不存在承载 `sandbox.confine` 的原生 sidecar 二进制；
2. seam 的 `confine(argv)` 只做 argv 增强，无法把一个 Job Object 句柄挂到已 spawn 的子进程上——
   机制级 confinement 必须发生在 spawn 点（`runCommand`），而那是 TS；
3. 070 的 `SidecarMethod.SandboxConfine` 占位仍保留声明、未接线；未来原生 sidecar 落地时，
   `confine` 可转发到这里。

## 限制（honest，不隐藏）

1. **受限令牌/降权未实现**：`CreateRestrictedToken`/低完整性令牌需要启动进程以受限令牌派生目标，
   TS/PowerShell 路径无法安全做到（需原生 helper）。`status()` 不宣称此项。
2. **attach 时序窗口**：job 挂接发生在 spawn 之后（holder 需 `Add-Type` 编译 + 赋值，通常 <2s，
   首次更慢）。**挂接之前已派生的孙进程不 retroactively 入 job**——只有挂接后派生的后代被整树终止
   覆盖。`run()` 在 `onSpawn` 立即挂接，常规场景下命令尚未 fork 即已入 job；极端场景（spawn 后
   立即 fork）存在窗口，已记录为已知限制。
3. **资源上限 best-effort**：`JOB_OBJECT_LIMIT_ACTIVE_PROCESS` 通过 P/Invoke struct 设置，若
   `SetInformationJobObject` 失败则静默降级（tree-kill 不受影响）。CPU/内存上限（JOB_TIME /
   WORKINGSET）未做——受限 struct 在 PowerShell 下的 P/Invoke 布局验证不充分，留 072/073 或原生
   sidecar 补齐。
4. **仅 Windows**：非 win32 平台 `status()` 保持 passthrough（bwrap/Seatbelt 后续卡）。
5. **回收站纪律**：隔离目录清理走 `SendToRecycleBin`（`Microsoft.VisualBasic`），holder 临时脚本
   自删；os.tmpdir 下的自建工件按仓库既有约定清理，绝不触碰主工作区路径。

## 验证

- `packages/runtime/src/sandbox/Sandbox.test.ts`：≥6 例（后端选择/受限启动/资源限制接线/进程树终止/
  隔离目录/异常/050 衔接/非 win32 门控）。
- kill-tree 用例真实 spawn root→grandchild，root 先入 job、grandchild 后派生（继承 job），
  `terminate()` 后两者均须死亡。
