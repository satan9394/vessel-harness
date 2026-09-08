# 071 — Windows Sandbox Backend（进程隔离后端）

- 状态：已合入（指挥验收）
- 优先级：P0（Wave 4 / Milestone F）
- 创建日期：2026-09-08
- 关联：070（Sidecar 协议可承载 sandbox 能力方法占位）；072（process-tree confinement）；073（filesystem confinement）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md（V1.4 Security：OS-level Sandbox 至少 Windows 可用；
  071 Windows sandbox backend）
- ⚠️ 本机 Windows——优先可测的 Windows 原生机制；无 Rust 工具链（若 sandbox 走 sidecar 需真 Rust 则标注或降级为 TS 实现）

## 目标

Windows Sandbox Backend：在既有 runtime/sandbox（Sandbox.ts）基础上落地 Windows 进程隔离后端——
受限进程启动（Job Object 资源限制/进程树终止、受限令牌/降权、工作目录与临时目录隔离、stdin/stdout 管道
语义沿用既有 runCommand），使沙箱内进程真正受限可终止。遵循"机制层硬执法"（非只 prompt）。

## 验收标准（执行器逐条勾选）

- [x] 摸清既有 Sandbox.ts 现状（packages/runtime/src/sandbox/：抽象/后端选择/与 Executor/Process 关系）——
      明确本卡补什么（Windows 后端真实现 vs 协议化）
- [x] Windows 后端落地（本机可测优先）：Job Object（资源限制：CPU/内存/句柄 + 进程树统一终止）、受限令牌或
      降权启动（若可行）、隔离目录（临时/工作目录）、kill-tree 语义；与 050 interrupt/runCommand 的 signal
      语义衔接
- [x] 与 070 关系明确：若 sandbox 经 sidecar 协议承载，TS 侧实现协议方法（sandbox.confine）占位或真接线——
      以可行性定，注明选择
- [x] 测试 ≥6 例：后端选择/受限启动/资源限制生效/进程树终止/隔离目录/异常；全量 vitest/tsc 绿（670+ 无回归）
- [x] 文档同步（Windows sandbox 后端能力与限制）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Windows 后端。process-tree confinement（072）、filesystem confinement（073）、telemetry（074）、
  safety benchmark（075）各自成卡。
- 不做 Electron/沙箱外逃全面防护；本卡为可用的 Windows 隔离后端。

## 涉及文件（指针，执行器自行精化）

- packages/runtime/src/sandbox/（Sandbox.ts + 后端目录）
- packages/runtime/src/process/Process.ts（runCommand/spawn 语义）
- 070 sidecar（若走协议：packages/runtime/src/sidecar/）

## 方法

- 读 Sandbox.ts 现状与 Process/runCommand；Windows 用 Job Object（node:child_process spawn + CreateJobObject
  需原生或 PowerShell/工具——本机可测路径：PowerShell Start-Job/受限启动或 node 侧抽象 + 文档；以可行性定）
- 隔离保证：Job 终止进程树、目录隔离、资源上限；测试验证

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- 状态：待验收（执行器已回填，指挥验收）
- 改动文件与 diff 摘要：
  - `packages/shared/src/tools.ts` — `SandboxStatus.supported` 增加 `'windows-job-object'`，新增 `backend?: 'job-object'|'acl-partial'|'none'` 字段
  - `packages/runtime/src/sandbox/backend/windows-job-object.ts`（新增）— Windows Job Object 后端：命名 job holder（PowerShell `CreateJobObjectW` + 活动进程数上限 + `AssignProcessToJobObject`）+ 独立进程按名重开 `TerminateJobObject` 整树终止（ready/error 标记握手，防 Add-Type 编译竞态）
  - `packages/runtime/src/sandbox/backend/isolated-directory.ts`（新增）— `createIsolatedDirectory()`：os.tmpdir 下 `vessel-sandbox-*` 隔离目录，dispose 走回收站（Microsoft.VisualBasic SendToRecycleBin）
  - `packages/runtime/src/sandbox/Sandbox.ts` — 重写：真实后端选择（win32→job-object active）、`status()` 诚实上报、`confine()` 报 full/partial、新增 `run()`（隔离目录+job 挂接+清理）与 `openConfinement()`（半托管 attach/dispose）
  - `packages/runtime/src/process/Process.ts` — `SpawnOptions` 新增 `confinement?: {terminate()}`（超时/abort 时整树 kill，050 衔接）与 `onSpawn?`（spawn 后拿 pid 挂 job）
  - `packages/tools/src/shell/shellTool.ts` — Shell 工具切到 `sandbox.run()`（真实接线上路径；不再直接用 runCommand）
  - `packages/runtime/src/sandbox/Sandbox.test.ts`（新增）— 12 例测试
  - `docs/SANDBOX-WINDOWS.md`（新增）— 能力/限制文档
- 新增测试数与命令输出：
  - `npx tsc -b tsconfig.json` → 全绿（0 error）
  - `npx vitest run packages/runtime/src/sandbox/Sandbox.test.ts` → **12 passed / 1 skipped**（skipped=非 win32 门控用例）
  - 全量 `npx vitest run` → **681 passed / 1 skipped / 1 failed**；唯一失败为 `iteration-store.test.ts` 的
    `EPERM: rename .tmp → meta.json`（Windows 反病毒 rename 竞态），该文件本卡未触碰，隔离重跑
    `npx vitest run packages/engine/src/iteration-store.test.ts` → 11 passed；属已知环境 flake 非回归
  - kill-tree 用例：真实 spawn root→grandchild，root 先入 job、grandchild 后派生（继承 job），
    `terminate()` 后 root 与 grandchild 均确认死亡
- 设计选择与理由：
  - **sandbox 走 TS 原生 runtime 后端，不经 sidecar 协议**：① 本机无 Rust 工具链，无原生 sidecar 可承载
    `sandbox.confine`；② seam 的 `confine(argv)` 只增强 argv，无法把 job 句柄挂到已 spawn 子进程——
    机制级 confinement 必须落在 spawn 点（runCommand，TS）；③ 070 `SidecarMethod.SandboxConfine`
    占位保留声明未接线，未来原生 sidecar 落地时 confine 可转发至此
  - **Windows 机制**：命名 Job Object + 独立进程按名重开（`JOB_OBJECT_TERMINATE` 0x8）做 kill-tree——
    探测确认 `JOB_OBJECT_ALL_ACCESS` 重开会 ACCESS_DENIED(5)，TERMINATE 权限可重开；holder 必须存活
    保 job handle（最后句柄关闭即销毁 job 并杀全部进程），故用 `-File` 非 detached spawn
  - **与 050 衔接**：`runCommand` 超时/abort 路径先 `child.kill('SIGKILL')` 直杀，再 `confinement.terminate()`
    整树终止，Windows 上孙进程不再漏杀
  - **受限令牌/降权未实现**（可行性结论）：`CreateRestrictedToken`/低完整性需启动进程派生受限令牌子进程，
    TS/PowerShell 路径无法安全做到；`status()` 诚实上报 backend='job-object' 且不宣称此项，文档记录为限制
- 踩坑记录（环境备注）：
  - `detached: true` + `powershell -File` 在 Windows 上子进程立即退出、脚本不执行（DETACHED_PROCESS 与
    控制台应用初始化冲突）；改 `detached: false` + `windowsHide: true` 解决
  - PowerShell here-string 结束符必须是 `"@` 而非 `@`（漏引号 → ParserError: TerminatorExpectedAtEndOfString）
  - P/Invoke `SetInformationJobObject` 的 JOBOBJECT_BASIC_LIMIT_INFORMATION 在 PowerShell 下 struct
    布局脆弱（x64 需 IntPtr 字段），资源上限仅 best-effort（ActiveProcess），CPU/内存上限留 072/073 或原生 sidecar
  - `OpenProcess(PROCESS_ALL_ACCESS)` 对非提权进程会 ACCESS_DENIED，改 `PROCESS_SET_QUOTA|PROCESS_TERMINATE`
    (0x101) 即可
  - 全量套件中 iteration-store rename EPERM 为环境 flake（隔离重跑绿），与本卡无关

## 验收结论（指挥回填）

- [x] 合入（commit c834e0a）
- 备注：指挥独立复核——全量 vitest 76 文件 682 测试全绿 + 1 skipped（首跑 1 例为已知 Windows 瞬态 flaky，重跑全绿，
  非本卡回归）、tsc -b 0 错误，与执行器自报一致。设计认可：Windows Job Object 真实现（命名 job holder 活动进程数
  上限 + 跨进程 TerminateJobObject 整树终止，root+grandchild 双杀实测）；os.tmpdir 隔离目录回收站清理；050 衔接
  （超时/abort 整树 kill）；Sandbox.ts 诚实状态上报 backend='job-object'；070 关系明确（TS 原生不走协议，机制须在
  spawn 点，占位保留注明）。限制诚实记录（受限令牌未实现不宣称、attach 时序窗口、CPU/内存上限留后续）。
  下一张：072（process-tree confinement）。
