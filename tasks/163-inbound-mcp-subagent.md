# 163 — Vessel 自身转换为子 Agent：MCP 子代理服务器模式 (Inbound Subagent as MCP Server)

- 编号：163
- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`apps/cli`, `packages/application`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

使 Vessel 具备“被任何外部 Agent（如 Claude Code、Cursor、Codex、DSH 等）作为子 Agent 调度”的标准化能力。
在 CLI 增加 `vessel serve --mode mcp-agent` 入口，将 Vessel 核心循环、Policy 防御与 Session 管理包装为符合 Model Context Protocol (MCP) 的标准服务器。
外部 Agent 无需做任何定制适配，只需在其 `mcp.json` 中配置 Vessel 命令，即可像调用普通工具一样把复杂代码重构与验证任务派发给 Vessel。

## 2. 权威开源参考与本地免下直读路径

- **Model Context Protocol 规范**：`https://github.com/modelcontextprotocol/servers`
- **Claude Code Plugins & MCP** (本地免下直读：`E:\DeepSeek_Harness\workspace\2026_08_25\stars-scan\repos\anthropics__claude-code\`)
- **Vessel 内部 MCP 基础设施**：参考既有实现的 `packages/tools/src/mcp/` 与 `apps/cli/src/mcp/`。
- **读取纪律**：严禁在工作区全量克隆大仓库，优先使用本地已有缓存或官方标准 Schema。

## 3. 接口与数据契约

在 `packages/application/src/mcp-agent/`（或 `apps/cli/src/mcp/`）定义对外暴露的标准 MCP 工具：

```typescript
export interface RunVesselTaskArgs {
  /** 任务指令描述 */
  task: string;
  /** 目标工作区路径，缺省为当前进程工作区 */
  workspaceRoot?: string;
  /** 权限模式：只读、工作区修改、或全权限，默认受限为 workspace-write */
  policyProfile?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** 最大执行步数限制，防失控，默认 20 */
  maxSteps?: number;
  /** 是否需要返回详细的 Unified Diff */
  includeDiff?: boolean;
}

export interface VesselTaskResultContract {
  success: boolean;
  finalText: string;
  steps: number;
  changedFiles: string[];
  diffSummary?: string;
  totalTokens: number;
  sessionId: string;
}
```

向外部宿主暴露的 MCP 工具清单：
1. `run_vessel_task`：启动一个受限的独立 Vessel Agent 循环执行任务，执行完毕后返回冷冻的 `VesselTaskResultContract`。
2. `query_vessel_task_status`：非阻塞查询后台任务的当前步骤、运行状态与最新思考摘要。
3. `cancel_vessel_task`：强制中止指定 `sessionId` 的执行。

## 4. 确定性完成门禁 (DoD)

- [ ] **单元与端到端测试**：
  - 新建 `packages/application/src/mcp-agent/vesselMcpServer.test.ts`：
    - 测试通过标准 MCP stdio 协议发送 `tools/list`，正确返回包含 `run_vessel_task` 的工具描述。
    - 测试发送 `tools/call` 触发 `run_vessel_task`（使用内置 mock provider），成功完成多步执行并返回 `VesselTaskResultContract`。
    - 测试只读 profile 拒绝非只读工具（Policy 硬拦截生效）。
    - 测试信息隐藏原则：验证返回的工具结果不携带未紧凑化的几十万字中间历史，防宿主上下文爆炸。
- [ ] **构建检查**：
  - `npx tsc -b tsconfig.json` exit 0。
  - `npm run typecheck:tests` exit 0。
- [ ] **全量回归**：
  - `npm run test:all` 双 root 全部绿灯通过。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **坚守信息隐藏（Information Hiding）**：MCP 返回体绝不直接倾倒原始 Session 日志，必须通过结果契约进行紧凑汇聚。
- **薄核红线**：服务化包装不得在 `packages/core` 中引入额外的网络或 RPC 逻辑，核心依然保持薄循环。
- **回收站删除纪律**：测试中创建的临时目录必须符合清理例外，仓库内零永久删除。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- stdio 通信干净性：MCP 走 stdin/stdout 传输 JSON-RPC 消息。CLI 启动时必须将所有的非协议日志（如 `[vessel] ...`、`[policy] ...`）重定向输出到 `stderr`，绝对不能打印到 `stdout`，否则会导致外部 MCP 宿主解析 JSON 报错而断开连接。
