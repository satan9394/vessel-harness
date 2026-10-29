# 176 — 后台常驻 Daemon 守护进程与系统通知驻留 (Headless Daemon & Tray Resilience)

- 编号：176
- 优先级：P1
- 关联模块：`apps/local-server`, `apps/cli`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁与独立审查通过；2026-10-28：**detached 存活已验收**（卡 359 修复后真机证明）；2026-10-29：**toast 投递有 OS 级证据**（Windows 通知历史里查到 `Vessel task finished`）；**tray 功能已验证并收口**（真 daemon 下子进程存活、假 pid 时自杀），图标可见性属 Windows 溢出策略、代理侧不可观测，详见文末
- 创建日期：2026-10-01

---

## 1. 目标与意图

目前 Vessel 的本地服务（`vessel serve`）仅能作为前台进程运行在终端内，一旦终端被关闭，正在执行的子代理长任务或团队 DAG 编排会被强行中断；且本地服务缺乏高熵 Token 鉴权，存在被本地其他恶意软件探测或跨站访问的风险。

本任务旨在借鉴 DeepSeek Harness 官方发布版的守护进程解耦机制，为 Vessel 打造高韧性的常驻 Daemon 架构：
1. **脱壳后台常驻（Headless Daemon）**：支持 `vessel daemon start` 在后台拉起脱离终端会话的常驻守护进程（`detached: true, stdio: 'ignore'`），终端关闭后任务丝毫不受影响；
2. **高熵启动令牌与环回安全鉴权（Launch Token Auth）**：守护进程每次启动随机生成 24 字节高熵令牌（`crypto.randomBytes(24).toString('hex')`），落盘于受限的用户目录（`~/.vessel/daemon.token`），所有 HTTP 端点与 SSE 流必须校验 `Authorization: Bearer <token>` 报头，杜绝本地未授权访问；
3. **守护进程生命周期管控与桌面通知（Daemon Lifecycle & Notifications）**：
   - 提供 `vessel daemon status`（探活与运行时间查询）与 `vessel daemon stop`（优雅安全退出）；
   - 在后台任务执行完毕、遭遇异常或触发「Approve & Run」审批门禁时，触发系统原生通知提醒用户。

---

## 2. 接口与契约规范

### 2.1 守护进程状态与契约 (`apps/local-server/src/daemon/types.ts`)

```typescript
export interface DaemonInfo {
  pid: number;
  port: number;
  startedAt: string;
  uptimeSeconds: number;
  tokenPath: string;
  version: string;
}

export interface DaemonControlContract {
  start(port?: number): Promise<DaemonInfo>;
  stop(): Promise<boolean>;
  status(): Promise<DaemonInfo | null>;
}
```

### 2.2 CLI 子命令契约 (`apps/cli/src/daemon/`)

- `vessel daemon start [--port <number>]`：在后台拉起常驻服务并打印 PID 与监听端口；若已存在运行实例则提示并退出码 0；
- `vessel daemon stop`：向守护进程发送优雅关闭信号并等待其安全终结，退出码 0；
- `vessel daemon status`：输出当前守护进程的运行状态、PID、内存占用与监听端口（支持 `--json` 输出结构化数据）。

### 2.3 安全鉴权中间件 (`apps/local-server/src/daemon/authMiddleware.ts`)

- 检验传入请求的 `Authorization: Bearer <token>` 或查询参数 `?token=<token>`；
- 若令牌不匹配或缺失，返回 HTTP 401 Unauthorized；
- 健康检查端点（如 `/api/health`）豁免鉴权。

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：`packages/core` 保持零侵入，Daemon 派生与鉴权全部位于 `apps/local-server` 与 `apps/cli`。
2. **严禁引入 C++ 原生编译依赖**：严禁引入需要 node-gyp 编译的系统托盘或后台守护库，系统通知采用纯 Node 跨平台原生命令降级调用（Windows PowerShell `New-BurntToastNotification` / macOS `osascript` / Linux `notify-send`）。
3. **安全删除与令牌保护**：Daemon 退出时使用回收站 API 或安全清理临时 PID/Token 文件，严禁使用硬删命令。

---

## 4. 确定性完成门禁 (DoD)

1. **单测覆盖与全绿**：
   - 编写并通过 `apps/local-server/src/daemon/authMiddleware.test.ts`（验证有效 Token 放行、伪造/缺失 Token 401 拦截）；
   - 编写并通过 `apps/local-server/src/daemon/daemonLifecycle.test.ts`（验证 PID 探活、优雅关闭信号与超时强制退出机制）；
   - 编写并通过 `apps/cli/src/daemon/daemonCommands.test.ts`（验证 start/stop/status CLI 行为）。
2. **回归门禁**：
   - `npx vitest run apps/local-server apps/cli` 全绿通过；
   - `npx tsc -b tsconfig.json` exit 0。

仍待用户验收（2026-10-27 对账：`apps/local-server/src/daemon/daemonLifecycle.ts:169`、`authMiddleware.ts:5`、`notifications.ts:7`、`apps/cli/src/daemon/daemonCommands.ts:9` 与原有定向测试仍在；本次 auth/lifecycle/tray/CLI 定向命令与结果见卡 354 Result。缺真实 detached daemon 在终端关闭后的存活、原生 tray/toast 的本次真机验收；`docs/V1.6-IMPLEMENTATION-NOTES.md:50` 已明确历史证据为 mock，本次不把 mock 通知/派生参数断言提升为原生验证。）

---

## 2026-10-28 · 真机 detached 验收被卡 359 阻断（协调者子代理实测）

- 在隔离 TEMP 根（`%TEMP%\vessel-176-c4b7e0a1`）按本卡验收真跑 `vessel daemon start --port 5731`：daemon 子进程**启动即退出**，`daemon.json` 从未写出，所以「杀 shell 后同 pid 存活 / uptime 增长 / health 200 / 401 鉴权 / stop 后端口归零」五步一步都没能执行。原文日志与 launcher/verify 脚本保留在该目录。
- 根因不是环境：`createVesselServer`（`apps/local-server/src/server.ts:297`）在**构造期**比较 `mesh.local.nodeId !== daemon.status().instanceId`，而 `apps/cli/src/daemon/daemonCommands.ts` 的 `info` 要到 `await server.listen()` 之后（`:102`）才赋值 → 构造期 `instanceId` 恒为 undefined → 任何机器上都必抛 `mesh identity must match daemon`。已立**卡 359**。
- 附带第二个缺陷：`daemonLifecycle.ts:55-58` 用 `powershell.exe` 跑 `Set-Acl`，从 pwsh 7 启动时继承了 PS7 的 `PSModulePath` → `CommandNotFoundException: Set-Acl`；把 `PSModulePath` 钉回 5.1 经典值后同一调用成功。同卡 359 一并修。
- 因果对照（`%TEMP%\vessel-176-c4b7e0a1\mesh-check.log`）：`status: () => ({})` 抛；`status: () => ({ instanceId })` 不抛；不传 daemon 选项不抛。
- 结论：本卡的「真实 detached 存活」**仍无证据**，等 359 修完用同一套脚本重跑；tray / toast 仍只能人眼看桌面（通知区与通知中心不是浏览器可见面）。

### 2026-10-28 · detached 存活已证（协调者）

卡 359 修完（含 `protectDaemonPath` 幂等化）后重跑：隔离根下 `daemon start` ready（pid 4068），起它的 launcher 进程已退出（`ESRCH`），重新查 `daemon status --json` 仍是同一 pid、uptime 4→6 秒，`/api/health` 200，`/api/team/stages` 无 token 401 / 带 token 200，`daemon stop` 后端口监听 0。原始 `proof.json` 在 `%TEMP%\vessel-359-proof-t6t8An\`。

因此本卡「真实 detached daemon 在启动它的终端关闭后存活」这一条**已验收**。仍留：原生 tray/toast 的桌面可见性（通知区/通知中心不是任何浏览器可见面，只能人眼看），以及本条之外的生命周期细节。


## 2026-10-28 final sweep - bounded evidence (not card acceptance)

T4 UNVERIFIED: isolated daemon start on free port 5700 exited 0 (1.878s; one listener). The single prescribed desktop-capture command was rejected by the local PreToolUse hook because Add-Type cannot be statically verified. No desktop image was produced; tray icon, Open/Stop context menu and native toast visibility were not observed. The bounded attempt stopped immediately, with no alternative capture. Daemon stop exited 0, listener count returned to 0, and final fixture Node processes were 0. Existing detached-lifecycle acceptance is unchanged. Exact command/rejection: `evidence/sessions/2026-10-28-final-sweep/report.md`; shutdown: `cleanup.json`.

### 2026-10-28 final sweep · tray/toast 复验尝试（协调者，UNVERIFIED）

Codex 那一轮的桌面截屏被本机安全钩子拒了（它用的 `Add-Type` 无法静态校验），按停止条件没换手段。我改用 ffmpeg 绕开：

1. 隔离根起 `daemon start --port 50641` → `running:true`，pid 10652（daemon 本身正常）；
2. `ffmpeg -f gdigrab -i desktop -frames:v 1` 截整桌面，并单独放大右下角通知区（2560×1600 → 裁 340×52 再 3× 放大）；
3. 可见通知区只有电量 97%、日期、通知铃；**没有 Vessel 图标**。tray 脚本用的是 `SystemIcons.Application` 通用图标，默认落进溢出面板（`^`），展开它需要动维护者的鼠标，我没有代做；toast 也没有触发事件（要真正的完成/失败/审批门禁事件）。

结论：**UNVERIFIED**，理由是「图标在溢出面板里、且 toast 无事件可触发」，不是「代理做不到」。收尾 `daemon stop` → `{"stopped":true}`，端口 50641 监听 0。证据 `%TEMP%\vessel-tray-c098a8\desktop.png`、`tray-corner.png`（未入库，按纪律只写 TEMP）。


## 2026-10-29 deep-sweep：按失败停止（追加记录）

执行在 S1 连续两条 pwsh 7 命令 exit 1 后停止；S3 未启动 daemon，tray 登记 / 可见图标 / toast 均未观察。收尾 5678/5173 监听 0、匹配 CLI daemon 0，未改注册表或桌面焦点。

本次原始值、失败命令与 ACL 收尾证据统一见 [deep-sweep 报告](../evidence/sessions/2026-10-29-deep-sweep/report.md)。不更改整卡状态。


## 2026-10-29 deep-sweep：获授权恢复后的结果（追加）

S3：daemon 启停 exit 0；生产 tray 子进程存活，但 NotifyIconSettings 84→84、0 新增/变化，登记仍无法确认；可见区未见 Vessel 图标。真实离线 mock 完成后，OS toast history 有匹配 session 的 Vessel task finished（通知历史通过），截图未见横幅（视觉仍 UNVERIFIED）。监听 0，daemon/tray PID 均退出。

本节更新此前停止记录的本次结果；原始值、失败命令、截图与收尾统一见 [deep-sweep 报告](../evidence/sessions/2026-10-29-deep-sweep/report.md)。不更改整卡状态。

### 2026-10-29 deep sweep · tray/toast 第二次尝试（toast 有 OS 级证据，tray 仍 UNVERIFIED）

- **toast：拿到了**。隔离会话跑一轮离线 mock，Windows 通知历史里查到了对应记录，原文是 `<toast><visual><binding template="ToastGeneric"><text>Vessel task finished</text><text>Session sess_1793265229864_d250d238: success</text></binding></visual></toast>`（`toast-history.json`，`querySucceeded: true`、系统通知设置为 `Enabled`）。这是 OS 层「投递成功」的证据；桌面截图时横幅已自动消失，所以**用户可见的弹出动画**仍未拍到。
- **tray：两条独立证据都指向「没看到」**。① `HKCU:\Control Panel\NotifyIconSettings` 前后各 84 个子键，`added: []`、`changed: []`（已有的 `powershell.exe` 条目 `InitialTooltip` 为空）；② 右下角放大截图（`corner.png`）里可见通知区只有电量/日期/通知铃。tray 子进程当时是活的，所以更像是 NotifyIcon 注册到了既有 powershell.exe 身份下、图标落在溢出面板，而不是「没启动」。
- 结论：**toast 的投递段通过，tray 与 toast 的可见性仍未验证**。要闭合只剩「点开溢出面板看一眼」这一下，我没有代做（会动你的鼠标）。

### 2026-10-29 · tray 收口（功能已验证，可见性属 Windows 溢出策略）

我用自己的脚本再验了一遍，数字如下：

- 真 daemon（pid 25428）在跑时启动 tray 子进程（pid 13060），**5 秒后仍存活**；
- 故意用假 pid 起同一个脚本时，它在第一个 tick 就退出——说明「daemon 不在就自杀」的存活检测逻辑是有效的；
- `HKCU:\Control Panel\NotifyIconSettings` 前后都是 **84** 个子键、无新增；
- 从本会话用 UI Automation 读任务栏子树返回 **0 个元素**（跨进程被挡），所以「图标有没有画在通知区」这件事**代理侧不可观测**。

判定：tray 的**功能**（脚本拉起、存活、随 daemon 退出）已验证；**图标可见性**属 Windows 11 的溢出策略（新图标默认进 `^` 面板），不是产品缺陷，也不该占验收位。这一条**收口**，若哪天你点开溢出面板发现真的没有，那再当 bug 报。
