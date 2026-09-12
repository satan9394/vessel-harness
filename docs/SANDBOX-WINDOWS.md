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
| 诚实状态上报 | `statusSnapshot()`：`win32` 只决定 `supported='windows-job-object'`；`enabled/active=true, backend='job-object'` **仅当本轮 job 真的附加成功**。未生效时如实给 `active=false, backend='none'` + 机器可读 `degraded`（`job-object-not-attempted` / `job-object-attach-failed` / `job-object-target-exited` / `job-object-unavailable`）与 `fallbackReason`；`vessel run` 末尾的执法遥测会打印这行状态，降级不再只留在运行时内存里 | 无 passthrough 伪装；生效/未生效都可见 |

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
2. **attach 时序窗口**：job 挂接发生在 spawn 之后（holder 需 `Add-Type` 编译 + 赋值；真机实测 **1–10 s**，
   并发下更慢——`tasks/078:59` 有一次 10759 ms 的实跑）。因此：
   - **短命令常常在附加完成前就退出**。这种"目标已不在"（`OpenProcess` 报 87 = pid 不存在，**不是**权限问题：
     权限是 5）按 **`target-exited`** 处理——独立 reason、**不 warn**、不算附加失败，因为已经没有进程需要约束；
     但状态仍如实显示 `active=false, degraded='job-object-target-exited'`（不谎报生效，也不误报"沙箱坏了"）。
   - 等待预算 `createJobObject(timeoutMs)` 默认 **30 s**（≈ 实测最坏编译耗时的 3 倍；旧的 10 s 在实测散布内，
     并发下会白白降级一个本可附加的命令）。
   - **挂接之前已派生的孙进程不 retroactively 入 job**——只有挂接后派生的后代被整树终止覆盖；`run()` 在
     `onSpawn` 立即挂接，常规场景下命令尚未 fork 即已入 job；极端场景（spawn 后立即 fork）由 072 的
     `closeTimingWindow` 枚举补齐（仍有最小残窗，见 072 限制 4）。
   - **真失败仍照旧**：errno 5（`ERROR_ACCESS_DENIED`，缺 `PROCESS_SET_QUOTA`/`PROCESS_TERMINATE` 权限）、
     holder 报错、超时一律 `job-object-attach-failed` + warn + `active=false`，绝不被 `target-exited` 吞掉。
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
- **`target-exited` 与降级去重（本卡新增）**：
  - `Sandbox.test.ts` —「target already exited ≠ attach failed」5 例：短命令给独立 reason 且 **0 条 warn**；
    `openConfinement()` 同款且不误杀；`target-exited` **不掩盖**后续真失败；未识别的
    `attached:false` 大声降级；同一会话重复真失败**只 warn 一次**且状态保留最新 detail。
  - `backend/windows-job-object.test.ts` — 纯函数 `parseAttachMarker`（marker→outcome，含"半写/未知 ⇒ 继续等"）
    ＋ 真机一例（`it.skipIf(!onWindows)`）：**已退出 pid** 应 `resolve {attached:false, reason:'target-exited'}`
    而不是抛 attach 失败（该例先断言前提"该 pid 真的不存在"，前提不成立就红，不静默跳过）。
  - `apps/cli/src/cli.test.ts` — `vessel run` 尾部真的打印沙箱状态行（`状态: backend=… active=… degraded=…`）：
    `reportStatus()` 生产可达的负对照（删除 cli.ts 里那一行调用即红）。

## 073 — Filesystem Confinement（在 071/072 之上新增文件面）

相关：`packages/tools/src/filesystem/guards.ts`、`packages/tools/src/filesystem/fsTools.ts`、
`packages/policy/src/risk/Compiler.ts`、`packages/application/src/compose.ts`。

### 能力（delivered）

| 能力 | 机制 | 强度 |
| --- | --- | --- |
| 允许集合（allow-set） | 允许集合 = 工作区根 ∪ 显式 `filesystem.allow`（绝对或 workspace-relative 目录，Mode 区分 read/write）。`filesystem.confinement: true` 启用 | 机制层：`canonicalize`（识标 + 词法）先跑，`assertConfined` 按 Mode 校验允许集合 |
| 越界读写拒绝 | `canonicalize` 拒绝 `..`/绝对路径逃逸（除非命中显式绝对 allow）；`assertConfined` 拒绝不覆盖 Mode 匹配 allow 的越界访问 | 工具层硬执法（`DENIED` + `meta.guard`） |
| 逃逸路径 / 符号链接出界 | `canonicalize` 保留 workspace-escape 拒绝；symlink 出界永远拒绝（即使目标在 allow 目录，也比 allow 更严——allow 指向真实路径而非重定向链接） | 词法 + realpath 双关，best-effort on Windows |
| 执行前校验 seam（policy 层） | 编译器在有 `confinement:true` 时铸 `fs-confinement` deny 规则：对文件工具做词法预检（`..` 逃逸、未被绝对 allow 覆盖的绝对路径 → 提前 deny） | Executor `decide` 前置拒绝 → AgentLoop 落 `audit/denial`（072 风格可查）；canonical 权威判断仍在工具层守卫 |
| fail-closed 可选 | 越界一律 deny（不静默放行）；`assertConfined` 命中即抛、工具层映射 `DENIED` | 无条件拒绝 |

### API / 接线

```yaml
# .harness/policy.yaml
filesystem:
  protected: [".git", ".git/**", ".env"]
  deny_read: ["**/.aws/credentials"]
  allow:
    - { path: "C:/shared-assets", mode: "read" }   # 显式授权外部读目录
    - { path: "cache/out", mode: "write" }          # workspace-relative 写目录
  confinement: true                                 # 启用 allow-set 强制
```

`createFsTools` / `createSearchTools` 现把 `canonicalize(root, p, fsPolicy)` 与 `assertConfined(...)`
作为 Read/Write/Edit/Grep 的第一步守卫；越界返回 `errorClass:'DENIED'` + `meta.guard`。
`Configs/policy.default.yaml` 未默认开启 confinement（保持既有默认工作区边界），由显式声明开启。

### 限制（honest）

1. **confinement 不削弱既有守卫**：`protected`（写保护）、`deny_read`（凭据）继续在 `assertConfined`
   前后独立执行，语义叠加（质更严的一方生效），不互相豁免。
2. **显式外部目录的 symlink 仍被拒**：允许集合走词法目录名；内部指向外部的 symlink/junction 违反
   "符号链接出界" 拒绝规则，即使目标文本上在 allow 目录内。这是故意的保守选择。
3. **policy 层 fs-confinement 是词法预检**：无工作区根，只拒绝明确的 `..` 逃逸与未被绝对 allow 覆盖的
   绝对路径；workspace-relative 路径交给工具守卫做 canonical 权威判断，避免词法层误伤正常工作区操作。
   因此"执行前拒绝"覆盖逃逸类与显式越界类，其余由工具层兜底。
4. **Windows symlink/junction 语义**：`realpathSync.native` 在 junction 上可解析到目标目录，故目录
   junction 出界可被检测；测试在无权限建立 symlink 的主机上会跳过（诚实降级）。
5. **`allow` 原为死字段**：073 前的 `FsPolicyConfig.allow` 仅声明未强制；本次接通。`confinement:false`
   时行为与 073 前完全一致（`allow` 仍无效果），不回退既有安全。
