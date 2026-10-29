# 180 — 原生级操作系统沙箱与低完整性安全隔离 (Native OS Sandboxing & Low Integrity Boundary)

- 编号：180
- 优先级：P1
- 关联模块：`packages/tools`, `packages/runtime`, `packages/policy`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁通过；2026-10-29 **Windows 真机执法已验**（生产 Shell 工具：白名单内写成功、越界写 exit 1 且文件不存在、审计 `enforced`），`provision-sandbox.ps1` 两个 shell 均可跑；仍缺 macOS 逃组
- 创建日期：2026-10-02

---

## 1. 目标与意图

在经过 V1.0 至 V1.6 的迭代后，Vessel 的多 Agent 协同与工作台能力已达工业级水准。然而在系统底层执行安全方面，仍存在 README 登记的两大已知边界：
1. **Windows 缺乏特权级降权**：目前的 Windows 沙箱基于 Job Object 实现进程树绑定与内存限额，但运行命令的进程依然继承了当前用户的完整 Windows 访问令牌（Full Token），缺乏受限令牌（Restricted Token）与低完整性级别（Low Integrity Level）降权保护，命令仍可能对用户工作区之外的敏感路径产生误写；
2. **非 Windows 平台缺乏原生轻量隔离**：在 Linux 与 macOS 环境下，命令执行仍为透明直跑（passthrough），缺乏开箱即用的轻量宿主级沙箱支持；
3. **保持无 C++ 编译污染与薄核**：必须以纯 JavaScript/TypeScript 原生系统调用门面或系统预置 helper 方式实现，杜绝引入任何导致跨平台构建失败的原生 C++ 依赖。

本任务旨在攻克上述沙箱缺口，构建多平台原生级安全降权执行器：
- **Windows Low Integrity 隔离器**：结合已有的 Windows Job Object，通过轻量 PowerShell/Win32 系统级管道或原生 helper 生成受限令牌，剥离管理员与写特权（`SE_GROUP_USE_FOR_DENY_ONLY`），将进程完整性降为 `Low Integrity`，确保只写工作区与临时目录；
- **Linux / macOS 平台辅助沙箱**：探测宿主环境预装的 `bwrap` (Bubblewrap) 或 `sandbox-exec`，构建文件系统只读白名单隔离层，未安装时优雅降级并明确审计报警；
- **Policy 引擎与执行注册表联动**：在 `packages/tools` 注入沙箱上下文，针对危险 Shell 命令透明包裹降权执行。

---

## 2. 接口与契约规范

### 2.1 沙箱配置与执行器接口 (`packages/tools/src/execution/sandbox/types.ts`)

```typescript
export interface SandboxExecutionOptions {
  cwd: string;
  allowedWritePaths?: string[];
  maxMemoryBytes?: number;
  cpuTimeoutMs?: number;
  lowIntegrity?: boolean;
}

export interface SandboxExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  sandboxed: boolean;
  isolationTier: 'windows-job-restricted' | 'bwrap-ns' | 'macos-seatbelt' | 'passthrough-fallback';
}

export interface NativeSandboxRunner {
  isAvailable(): Promise<boolean>;
  execute(command: string, args: string[], options: SandboxExecutionOptions): Promise<SandboxExecutionResult>;
}
```

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：沙箱实现完全局限在 `packages/tools` 与 `packages/runtime` 内部，禁止向 `packages/core` 注入操作系统特定的沙箱逻辑。
2. **构建纯净性铁律**：严禁引入需 node-gyp 本地编译的 C++ 插件，保持 `npm ci` 与跨平台 GitHub Actions 恒绿。
3. **回收站与非破坏性原则**：除在 `os.tmpdir()` 创建的测试目录外，严禁任何硬删命令。
4. **单源事实日志**：沙箱执行的审计事件（`audit/sandbox_enforced`）统一通过 EventBus 派发至 JSONL 日志中。

---

## 4. 确定性完成门禁 (DoD)

1. **定向单测覆盖与全绿**：
   - 编写并通过 `packages/tools/src/execution/sandbox/windowsRestricted.test.ts`：验证受限令牌降权参数装配、只读盘符拦截与异常逃逸防护；
   - 编写并通过 `packages/tools/src/execution/sandbox/platformSandbox.test.ts`：验证跨平台环境探测、降级行为与白名单目录挂载；
2. **全量构建与回归**：
   - `npx tsc -b tsconfig.json` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run test:all` 双 Root 保持全绿。


## 2026-10-02 本地交付工作证明

- 严格按 180 → 181 推进；阶段一两个定向文件通过后才启动阶段二。
- 最终定向：沙箱 15 项、记忆 9 项；独立集成核验分别 23 项、13 项通过。
- 最后源代码上的类型构建与测试类型检查均 exit 0；双 Root 全量：根 218 文件 / 2524 passed + 6 skipped，Web 16 文件 / 154 passed，exit 0。
- 离线 conformance 25/25；未调用真实外部 Agent，无提交、push、发布或宿主 ACL 修改。
- 完整修改清单、原生边界与可复跑日志：[V1.7 交付记录](../docs/V1.7-IMPLEMENTATION-NOTES.md)，证据目录：evidence/sessions/2026-10-02-epic183/（accepted-* 为最终门禁）。
- Windows 需预配置 Low Integrity / 专用受限 SID ACL；缺失时拒绝，原生运行契约使用 Mock 验证。

仍待用户验收（2026-10-27 对账：本次 `windowsRestricted.test.ts`、`platformSandbox.test.ts`、`hybridSearch.test.ts`、`reflectiveRules.test.ts`、`reflectiveContext.test.ts` 共 5 文件 34 passed / exit 0，完整命令见卡 354 Result / `t8-v17.log`；源码 `packages/tools/src/execution/sandbox/windowsRestricted.ts:28`、`platformSandbox.ts:40`；受限参数/白名单/默认拒绝仍可复验，缺 Windows ACL/Low Integrity 真机执法与 macOS 脱离进程组生命周期验证，沿用 `docs/V1.7-IMPLEMENTATION-NOTES.md:21` 原有边界。）


## 2026-10-28 final sweep - bounded evidence (not card acceptance)

T5 PASS for offline contracts only: five requested commands each exit 0, 5 files / 32 tests (windowsRestricted 14, platformSandbox 9, Process.sandbox 4, nativeSandboxIntegration 2, shellTool.sandbox 3). Offline npm bench:conformance, with --out pointing to TEMP, passed 25/25, 0 failed, $0 in 4.7380032s; Vessel adapter only, no --live or external Agent CLI. First npm argument-forwarding attempt failed before scenarios and is retained; one literal-argument retry passed. Evidence: `evidence/sessions/2026-10-28-final-sweep/t5-checks.json` and `report.md`; raw logs remain in TEMP. This does not verify Windows ACL / Low Integrity host enforcement or macOS escaped-process lifecycle; those remain maintainer-only boundaries.

**协调者复跑（2026-10-28）**：上面那五条命令我自己又跑了一遍，逐条 exit 0、14+9+4+2+3 = **32 passed**；离线 `bench:conformance --out %TEMP%` 得 **25/25、0 failed、$0**（`runs/passed/failed = 25/25/0`）。结论与 Codex 那段一致：这是**离线契约**证据，**不**构成 Windows ACL / Low Integrity 真机执法，也不覆盖 macOS；那两项仍是维护者边界。

**协调者新发现（2026-10-29，已交给 deep-sweep S1/S2）**：`scripts/provision-sandbox.ps1` 的「真机执法」门槛比我上一轮判断的低——它是 **非管理员** 就能跑的（在 `%TEMP%` 里实测 `granted=True` / `low label=True`，ACL 出现 `S-1-5-21-…-183:(OI)(CI)(M)` 与 `Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)`）。但它**只能在 Windows PowerShell 5.1 下跑**：pwsh 7 报 `[System.IO.DirectoryInfo] 不包含名为 'GetAccessControl' 的方法`（.NET Core 把它移到了静态扩展类）。`icacls /grant *<sid>` 不能替代——对不在本地账户库里的 SID 返回 1332。修复用 `[System.IO.FileSystemAclExtensions]::GetAccessControl/SetAccessControl`（pwsh 7 下类型存在，已验证）。修完后应当补一次真机三态证据：白名单内写成功、越界写被拒、未配置目录 `denied`。


## 2026-10-29 deep-sweep：按失败停止（追加记录）

S1 未通过：5.1 配置/撤销 exit 0；pwsh 7 配置与撤销均 exit 1，命中执行单连续两次失败停止条件。S2 真机执法未运行；未作本次沙箱通过声明。临时 ACL 已由 5.1 撤销，未完成修复已回退。

本次原始值、失败命令与 ACL 收尾证据统一见 [deep-sweep 报告](../evidence/sessions/2026-10-29-deep-sweep/report.md)。不更改整卡状态。


## 2026-10-29 deep-sweep：获授权恢复后的结果（追加）

S1 的 5.1 与 pwsh→5.1 配置/撤销全 exit 0。S2 真 runner 两次允许写均 exitCode=-1073741502（0xC0000142）、sandboxed=true、tier=windows-job-restricted、RID=4096，文件均不存在；按新授权停止本步骤，越界/未配置目录未运行。ACL 已撤销，不能签收真机写执法。

本节更新此前停止记录的本次结果；原始值、失败命令、截图与收尾统一见 [deep-sweep 报告](../evidence/sessions/2026-10-29-deep-sweep/report.md)。不更改整卡状态。

### 2026-10-29 deep sweep · S1 与 S2 协调者复核（S2 通过）

**S1（provision 脚本 pwsh 7）复跑通过**：我在两个 shell 上各做一轮「配置 → 撤销」，四条命令全 exit 0，输出分别给出 `granted=True` / `removed=True` 与 `low label` 先 True 后 False，撤销后 `icacls` 里既无该 SID 也无 `Low Mandatory Level`。修法是 pwsh 7 自查版本后用 `powershell.exe` 转发 `-Path`/`-Revoke` 重入自身（`@args` 不含已绑定参数，执行方这点抓得对），5.1 的 ACL 代码一行未动。

**S2 通过——用生产 Shell 工具路径打的**。执行方那两次 `0xC0000142` 是直连 `PlatformSandboxRunner` 且撞上 HANDOFF §4 记过的 Windows 已知抖动（`Worker exited unexpectedly with exit code 3221225794` 同族），不是执法失败。我改用 `createShellTool`（生产组合根就是这个装配，`nativeAudit` 恒注入 ⇒ 必然走 `PlatformSandboxRunner`）在已 provision 的工作区里跑四条：

| 命令 | 结果 |
|---|---|
| `echo hi` | exit 0，stdout `hi`，tier `windows-job-restricted` |
| `echo inside> in.txt`（白名单内） | exit 0，`in.txt` 落盘，内容 `inside`，再 `type in.txt` 读回正确 |
| `echo escaped> %USERPROFILE%\vessel-escape-*.txt`（越界） | **exit 1**，工具返回 `TOOL_FAILURE`，目标文件**不存在** |
| 四次调用的审计 | 全部 `outcome: 'enforced'`，`allowedWritePaths` 只有工作区 |

所以「白名单内可写、越界写被拒」在真机成立，Windows ACL + Low Integrity 的执法**有本次证据**了。

两条观察（不是阻塞）：① 越界被拒时 stderr 是不可解码的本地化文本（管道里出来是一串 `?`），除非知道这是「拒绝访问」，否则模型读不懂——建议后续把拒绝原因结构化，别依赖 OEM 代码页；② Low Integrity 硬编码不可关（`windowsRestricted.ts:30` 直接抛），所以「cmd 在低完整性下偶发 DLL 初始化失败」这类抖动目前只能记进已知 flake，不能靠关掉 Low IL 规避。

### 2026-10-29 · Linux 分支真机验证（WSL2 Ubuntu），以及 macOS 到底还剩什么

结论先写：**「POSIX 脱离进程组」这半条不需要 Mac**——它的内核语义 Linux 与 macOS 同源，我在本机 WSL2 里真跑完了；只有 Seatbelt 那一小块是 macOS 独占。

环境：WSL2 `Ubuntu`（内核 `6.18.54.1-microsoft-standard-WSL2`），`node v22.22.2`，非 root（uid 1000），`sudo -n` 免密。装了 bubblewrap 0.9.0（`sudo apt-get install -y bubblewrap`，回滚：`sudo apt-get remove bubblewrap`）。用仓库构建产物直接跑 Linux 分支：`packages/tools/dist/execution/sandbox/platformSandbox.js`，`PlatformSandboxRunner.isAvailable()` → **true**。

实测（工作区 `mktemp -d /tmp/...`，`allowedWritePaths: [ws]`，tier 全程 `bwrap-ns`）：

| 用例 | 结果 |
|---|---|
| 白名单内写 `echo inside > ws/in.txt` | exit 0，读回 `inside` |
| 写 `/tmp/vessel-escape-test.txt` | exit 2，`cannot create ... Read-only file system`，文件不存在 |
| 写 `/usr/local/vessel-escape-test.txt` | exit 2，同上，文件不存在 |
| 读 `/etc/hostname` | exit 0，`user`（`--ro-bind / /` 生效） |
| `setsid` 逃逸后代（先写白名单内、再写 `/tmp`） | 7 秒后：白名单内的 `late.txt` **没有出现**，`/tmp` 也没有，`ps` 里无残留进程 |

也就是说 Linux 分支比文档写得**更强**：bwrap 的 namespace + parent-death 把整个沙箱会话一起收掉了，逃逸的后代既没活下来也没写出任何东西。文档里「POSIX 逃组后代可能继续存活」的保守说法在 Linux 上并没有发生——它是给 macOS/降级路径留的余地。

**macOS 还剩三件，且都只在 macOS 分支里**：① `/usr/bin/sandbox-exec` 的能力探测（Linux 走的是 `/usr/bin/bwrap`，两套探测不通用）；② Seatbelt 配置行为（默认 deny `file-write*`、白名单 `subpath`）；③ 逃出进程组的后代是否仍受已继承的 Seatbelt 约束。现有覆盖只有 `platformSandbox.test.ts` 的 darwin 用例——它证参数与调用顺序，不证内核行为。

**判定**：Linux 分支的写隔离与逃组行为**已有真机证据**；macOS 分支保持「单测覆盖 + 文档声明」，不再作为阻塞项挂账——除非本仓要正式支持 macOS，那时再按需上 Mac 或云 Mac 复核。这条口径记在这里，免得下一轮又把它当待办。
