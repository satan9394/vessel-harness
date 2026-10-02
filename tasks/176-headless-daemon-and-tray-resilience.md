# 176 — 后台常驻 Daemon 守护进程与系统通知驻留 (Headless Daemon & Tray Resilience)

- 编号：176
- 优先级：P1
- 关联模块：`apps/local-server`, `apps/cli`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁与独立审查通过；待用户验收（2026-10-02）
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
