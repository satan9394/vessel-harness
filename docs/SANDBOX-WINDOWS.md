# Windows Sandbox Backend（071/072）能力与限制

> 状态：任务 071（Job Object 后端）+ 072（process-tree confinement）交付
> 关联：`packages/runtime/src/sandbox/`、`packages/runtime/src/process/Process.ts`、路线文档 §13.1–13.3
> 本文档描述 071/072 落地后的**真实能力**与**诚实限制**——不宣称"看起来启用、实际 passthrough"（§13.3）。

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

## 072 — Process-Tree Confinement（在 071 之上新增）

### 能力（delivered）

| 能力 | 机制 | 强度 |
| --- | --- | --- |
| 进程树跟踪/审计 | `ProcessTreeTracker`（纯状态机，跨平台可单测）：登记 spawn（pid+父 pid+命令）、记录 exit、枚举子树、快照全树、追加式审计日志（spawn/exit/attached/escape-detected/escape-terminated/window-closed） | `run()`/`openConfinement()` 暴露 `processTree` 快照 + `audit` 日志 |
| attach 时序窗口关闭 | 071 的限制：holder 挂接前已派生的孙进程不 retroactively 入 job。072 在 attach 后立即用 CIM（`Win32_Process` ParentProcessId BFS）枚举当前后代，逐个 `AssignProcessToJobObject` 拉进同一 job（`attachDescendants`） | 本机可测：即时派生的孙进程在窗口内被枚举并纳管；可关（`closeTimingWindow:false`） |
| 树外逃逸检测 | 逃逸 = 当前存活后代 pid 不在「已确认纳管集合」（root+已 attach 后代）。`detectEscapes` 纯规则 + CIM 复举实现验证 | 记录 `escape-detected` 审计；`terminateEscaped:true` 时用 `TerminateProcess` 逐个硬终止（pid 级，不动 root/job） |
| 资源上限（071 遗留） | holder 的 `SetInformationJobObject` 现按传入限制组合 flag：`JOB_OBJECT_LIMIT_ACTIVE_PROCESS`(0x8) 活动进程、`JOB_OBJECT_LIMIT_PROCESS_TIME`(0x2) 每进程 CPU 时间（100ns tick）、`JOB_OBJECT_LIMIT_WORKINGSET`(0x1) 工作集 | OS 强制（best-effort，见限制）。**修复 071 笔误**：071 用 `0x4`（实际是 JOB_TIME）却标注 ACTIVE_PROCESS；072 改为正确的 `0x8` |

### 限制（honest）

1. **逃逸检测非实时**：逃逸检测在 `dispose()`/`run()` 结束后 CIM 复举触发——不是每 N ms 轮询实时执行。适合"命令结束后审计"，不适合"毫秒级封堵 fork 炸弹"（后者靠活动进程上限兜底）。
2. **工作集上限是软目标**：`JOB_OBJECT_LIMIT_WORKINGSET` 在许多 Windows 配置下是软目标（内存压力下可超），不是硬性提交上限——按此诚实描述，不宣称硬内存墙。
3. **逃逸只能在"看得到"时检测**：若某进程脱离我们枚举窗口（如已 exit 被 PID 复用、或 breakaway 进别的 job 且不在 root 后代链），检测不到。Windows 无 TS 侧的秒级进程原语遍历，依赖 CIM 快照。
4. **时序窗口有最小残窗**：enumeration 与 attach 之间仍有极小竞态（进程在枚举后、attach 前 fork 的新孙进程）。窗口显著小于 071（由"完全不纳管"降为"覆盖枚举时刻已存在的后代"），但仍非数学零窗口。
5. **CPU/内存上限 best-effort**：struct P/Invoke 布局在 PowerShell 下未做穷尽验证；`SetInformationJobObject` 失败静默降级（tree-kill 不受影响，见 071 限制 3）。
6. **仅 Windows**：CIM/PowerShell 与 Job Object 均仅 win32；非 win32 `status()` 保持 passthrough。

### 新增 API

```ts
// run() 现在返回进程树快照 + 审计（可枚举/可审计）
const r = await sandbox.run('node', ['-e', '...'], {
  limits: {
    maxActiveProcesses: 8,
    maxProcessTimeMs: 5000,          // 每进程 CPU 预算（best-effort）
    maxWorkingSetBytes: 256*1024*1024, // 每进程工作集上限（软目标）
    terminateEscaped: true,          // 逃逸硬终止
    closeTimingWindow: true,         // 默认开：attach 后枚举并纳管已派生后代
  },
});
r.processTree.nodes;   // [{pid,parentPid,command,spawnedAt,alive,...}]
r.audit;               // [{kind:'escape-detected',pid,detail,at}, ...]

// openConfinement() 会话新增 tree()/audit()
const s = await sandbox.openConfinement({ terminateEscaped: true });
await s.attach(child.pid!);
s.tree().nodes; s.audit();
```

## 验证

- `packages/runtime/src/sandbox/Sandbox.test.ts`：≥6 例（后端选择/受限启动/资源限制接线/进程树终止/
  隔离目录/异常/050 衔接/非 win32 门控）。
- kill-tree 用例真实 spawn root→grandchild，root 先入 job、grandchild 后派生（继承 job），
  `terminate()` 后两者均须死亡。
