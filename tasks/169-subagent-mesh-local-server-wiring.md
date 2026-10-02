# 169 — Subagent 网关在 Local Server 与事件流的接入与状态透视

- 编号：169
- 优先级：P1
- 关联模块：`apps/local-server`, `packages/application`, `packages/agents`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已合入
- 创建日期：2026-10-01

## 1. 目标与意图

在 V1.3（Epic 167）中，Vessel 交付了入站 MCP 子代理服务器（163）、虚拟人类代理（164）、出站异构子代理运行时（165）与保全度评测套件（166）。
但上述能力目前仅挂载在 CLI 子命令（`vessel serve --mode mcp-agent`）与单测中，本地服务层（`apps/local-server`）尚未提供统一的观测与管理通道。

本任务旨在为 `apps/local-server` 引入 `SubagentSeam`：
1. 建立外部子代理运行实例的注册与查询门面，提供 `GET /api/subagents`（列表与摘要）与 `POST /api/subagents/:id/cancel`（中断指定子代理）。
2. 在 SSE 事件通道（`/api/events`）中集成子代理生命周期事件（`subagent:start`、`subagent:step`、`subagent:end`），使前端能够感知外部子代理的实时进展与 Worktree 隔离状态。
3. 遵循信息隐藏原则：仅透出紧凑的 `VesselTaskResultContract` 与基础状态元数据，杜绝原始长文本打翻宿主上下文。

## 2. 接口与契约规范

### 2.1 数据契约 (TypeScript)

在 `apps/local-server/src/subagentSeam.ts` 中定义并导出：

```ts
export interface SubagentSummary {
  id: string;
  name: string;
  provider: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  worktreePath?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  lastError?: string;
}

export interface SubagentSeamOptions {
  /** 允许注入 mock 或已有外部子代理运行时注册表 */
  getActiveRuns?: () => Promise<SubagentSummary[]>;
  cancelRun?: (id: string) => Promise<boolean>;
}
```

### 2.2 HTTP 端点契约

在 `apps/local-server/src/server.ts` 中挂载：
- `GET /api/subagents`：返回当前系统记录的外部子代理运行态列表 `{ ok: true, subagents: SubagentSummary[] }`。
- `POST /api/subagents/:id/cancel`：尝试取消指定子代理进程树，返回 `{ ok: true, cancelled: boolean }`。
- 404 / 400 遵循既有 `sendJson` 错误响应格式。

## 3. 架构红线与禁做准则 (严格遵守)

1. 薄核（Thin Core）铁律：绝对禁止修改 `packages/core/` 源码。
2. 严禁调起真机 Agent：严格遵守 `AGENTS.md` 禁做准则与任务 153 纪律，单测中绝对严禁拉起本机真实安装的 `codex`/`claude`/`dsh`/`opencode` 进程，必须全部基于内存假对象与 Mock 桩。
3. 回收站与删除铁律：非测试自建且位于 `os.tmpdir()` 之下的临时目录，一律走回收站，严禁任何硬删命令。
4. 协议与输出纯净：非 JSON-RPC / SSE 协议日志严禁倾倒至 stdout，确保服务协议流纯净。

## 4. 确定性完成门禁 (DoD)

本次交付范围按 Epic 169 用户目标扩展至四阶段：服务接线 → Web 工作台 → Windows worker 防抖 → 双 Surface 集成。各阶段用对应定向测试核验，再依次执行编译、测试类型检查、Web 构建与双 root 全量回归。仅使用 mock 子进程，不修改 core，不自动提交或推送。

1. 定向测试全绿：
   - 编写并跑通 `apps/local-server/src/subagent-seam.test.ts`（覆盖列表查询、取消成功、不存在 ID 容错）。
   - `npx vitest run --root apps/web src/components/SubagentPanel.test.tsx`。
   - `npx vitest run benchmarks/runners/src/conformance/runnerWorkerGuard.test.ts`。
   - `npx vitest run benchmarks/runners/src/conformance/subagentEndToEnd.test.ts`。
2. 静态编译全绿：
   - `npx tsc -b tsconfig.json` exit 0。
   - `npm run typecheck:tests` exit 0。
3. 全量测试无回归：
   - `npm run test:all` 双 root（根 2302+ 项 + Web 129 项）全部绿灯。
4. Web 生产构建：`npm run -w @vessel/web build` exit 0。

## 5. 实施记录（2026-10-01）

- 服务：紧凑字段白名单、内存摘要注册表、受限日志/详情回放、HTTP 查询与取消、全局及 session SSE；`/api/events` 与 `/api/subagents/events` 提供相同全局流。
- 外部运行时：取消 ID 对应独立 AbortController，信号进入已有进程树清理机制；透出真实退出码与隔离 worktree 元数据。原生内部 delegate 由其既有 owner 管理，不伪装为可取消的外部实例。
- Web：Sidebar 列表、详情抽屉、四维 token、阶段日志、结束耗时、取消与错误反馈；重连快照剔除失效实例，保留请求期间的新 SSE 更新。
- Windows CI：单 worker 显式防护、CI retry=1、4096 MiB Node heap；192 个内存进程树覆盖取消、延迟 Job 附着与附着失败。
- 双 Surface：真实 HTTP turn → SessionController → Subagent tool → 独立 Git Worktree → 生产 Web SSE 解析器。模拟子进程覆盖完成、拒绝、取消；完成后的交付物 diff 被父模型接收；以实测事件、交互和残留计算保全度。
- 独立审查发现并修复：原生 delegate 的取消 owner 不匹配、异步 SSE 初始列表期间断线泄漏、重连后过期实例累积；新增针对性回归用例。
- 红线：core 源码和 npm 依赖/锁文件未改；新增测试只注入内存子进程与 mock Job，不调用真实安装的 Agent；仅清理测试自己创建的系统临时树。

## 6. 最终验证与交付

以下门禁均在最后一次源码修改之后执行，exit 0：

| 命令 | 结果 |
| --- | --- |
| `npx vitest run apps/local-server/src/subagent-seam.test.ts` | 8 passed |
| `npx vitest run --root apps/web src/components/SubagentPanel.test.tsx` | 10 passed |
| `npx vitest run benchmarks/runners/src/conformance/runnerWorkerGuard.test.ts` | 4 passed |
| `npx vitest run benchmarks/runners/src/conformance/subagentEndToEnd.test.ts` | 1 passed；实测保全度 ≥90%，residueCount=0 |
| `npx tsc -b tsconfig.json` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `npm run -w @vessel/web build` | exit 0 |
| `npm run test:all` | root 189 文件，2315 passed / 6 skipped；Web 14 文件，141 passed；exit 0 |

附加验证：Web typecheck、原有 outbound runtime 8 项测试、`npm ci --dry-run --ignore-scripts`、`git diff --check` 均通过。独立审查复核三项修复后无剩余阻塞。

一次较早的全量运行在源码仍被修改时读取了旧模块快照，导致两个新回归用例失败；该结果已由上述最终、源码稳定后的完整双 root 运行替代，不用于交付证明。

「已合入」按用户指定作为本任务卡的本地验收标记。当前仅完成工作树交付，未 git commit / push / PR / 远程合并；这些动作遵循项目确认边界，须另获授权。
