# 165 — 外部异构子代理运行时与 Worktree 隔离 (Outbound Heterogeneous Subagent Runtime)

- 编号：165
- 状态：已完成（2026-09-24）
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`packages/agents`, `packages/tools`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

使 Vessel 具备调度外部成熟 Agent（Claude Code、Codex、DSH、OpenCode）作为全功能子 Agent 的工程能力。
将外部 CLI 封装为与内置 Subagent 一致的通用运行时（`ExternalAgentRuntime`）。
为每个外部子 Agent 在 `os.tmpdir()` 下分配独立的 Git Worktree 物理隔离工作区，
配备针对 `index.lock` 残留的强制破锁与租约回收机制，使外部子 Agent 可以尽情使用读写、编译、重构能力而绝不污染主工作区。

## 2. 权威开源参考与本地免下直读路径

- **DeepSeek Harness (DSH)**：`benchmarks/runners/src/adapters/dsh.ts` 中对外部进程的适配。
- **Claude Code 与 Codex 适配器**：`benchmarks/runners/src/adapters/claude.ts`、`codex.ts`。
- **Git Worktree 既有实现**：`packages/tools/src/git/worktree.ts`。

## 3. 接口与数据契约

在 `packages/agents/src/external/` 定义外部子代理契约：

```typescript
export interface ExternalAgentConfig {
  id: string; // 如 "claude-code", "codex", "opencode"
  command: string;
  argsTemplate: string[]; // 如 ["-p", "--output-format", "json"]
  env?: Record<string, string>;
  /** 是否需要分配独立的 Git Worktree 隔离工作区 */
  isolateWorkspace?: boolean;
}

export interface ExternalSubagentDelegateOptions {
  agentConfig: ExternalAgentConfig;
  prompt: string;
  parentWorkspaceRoot: string;
  timeoutMs?: number;
  policyProfile?: 'read-only' | 'workspace-write';
}

/** 调度外部子 Agent 执行，自动接管 Worktree 创建、进程沙箱、审批代理与结果提取 */
export function executeExternalSubagent(opts: ExternalSubagentDelegateOptions): Promise<SubagentResultContract>;
```

在 `packages/tools/src/builtin/Subagent.ts` 中增加外部子代理的路由支持，使父 Agent 在推理时可以直接通过 Tool Call 委派任务给外部专用 Agent。

## 4. 确定性完成门禁 (DoD)

- [x] **单元测试**：新建 `packages/agents/src/external/externalSubagent.test.ts`：
  - 测试通过 Mock CLI 模拟外部子 Agent（返回结构化变更），验证自动创建 Worktree、在隔离区执行、并正确提取 Unified Diff 返回给父级。
  - 测试 Worktree 异常破锁：模拟前序任务被强杀遗留 `.git/index.lock`，后续任务在确认无活跃进程后成功安全破锁并重用工作区。
  - 测试将子 Agent 产生的输出行无缝转换为父级 EventBus 的标准事件。
  - 测试在发生严重异常时，Worktree 被安全回收，不产生磁盘永久垃圾。
- [x] **构建检查**：
  - `npx tsc -b tsconfig.json` exit 0。
  - `npm run typecheck:tests` exit 0。
- [x] **全量回归**：
  - `npm run test:all` 双 root 全部通过。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **绝对隔离**：外部子 Agent 的所有非只读文件修改，默认必须且只能在临时 Worktree 中进行，严禁直接在宿主未提交的分支上并发写入。
- **薄核红线**：外部运行时的管理仅属于 `packages/agents` 与 `packages/runtime`，核心 AgentLoop 保持薄核。
- **删除纪律**：临时 Worktree 的清理严格遵守 `os.tmpdir()` 的例外标准，其余一律走回收站。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- Git Worktree 路径限制：Git 在 Windows 下对过长路径较敏感，临时 Worktree 目录名称应尽量精简（如 `os.tmpdir()/vessel_wt_<hash>`）。
- 锁文件清理安全：在删除 `index.lock` 之前，必须通过 PID 探测或进程枚举，100% 确认持有该锁的进程已经终止，杜绝在并发执行时误删活跃锁。
