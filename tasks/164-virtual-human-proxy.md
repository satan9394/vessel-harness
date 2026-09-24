# 164 — 外部 CLI 交互桥接与虚拟人类代理 (Virtual Human Proxy & Interactive Gating)

- 编号：164
- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`packages/runtime`, `packages/agents`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

解决成熟外部 Agent（Claude Code、Codex、DSH、OpenCode）被作为子 Agent 启动时，因缺乏人类 stdin 输入导致的**无头死锁（Hang）或权限强杀退出**问题。
构建轻量级“虚拟人类代理”，双轨制接管子进程输入输出：优先采用结构化非交互参数与预授权映射；
对于终端交互场景，以原生轻量方式拦截 `[y/N]` 审批提示并根据策略自动回写决策；
同时将子进程强制绑定至 Windows Job Object，彻底杜绝外部 Agent 衍生孤儿僵尸进程。

## 2. 权威开源参考与本地免下直读路径

- **Claw-Code 权限执行器**：`https://github.com/ultraworkers/claw-code` 中的 `permission_enforcer.rs`。
- **Claude Code 适配器接入面**：参考 `docs/CLAUDE-CODE-ADAPTER.md` 与 `benchmarks/runners/src/adapters/claude.ts` 中的 `-p` 参数。
- **Windows Job Object 沙箱**：参考 `packages/runtime/src/sandbox/backend/process-tree.ts`。

## 3. 接口与数据契约

在 `packages/runtime/src/proxy/` 定义虚拟交互代理与进程包装器：

```typescript
export interface ExternalCliSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /** 超时毫秒数，超时则通过 Job Object 连同子孙进程全部强杀 */
  timeoutMs?: number;
  /** 自动审批策略规则（例如仅允许修改指定白名单目录） */
  autoApproveRules?: {
    allowPaths?: string[];
    deniedCommands?: string[];
  };
}

export interface CliInteractionEvent {
  kind: 'prompt_detected' | 'stdout_chunk' | 'stderr_chunk' | 'exit';
  data?: string;
  matchedPrompt?: string; // 如 "[y/N]"、"Press Enter to continue"
}

export interface VirtualProxyRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  interceptionsCount: number;
  killedByTimeout: boolean;
}

/** 启动带虚拟人类代理与 Job Object 绑定的受控子进程 */
export function spawnWithVirtualProxy(opts: ExternalCliSpawnOptions): Promise<VirtualProxyRunResult>;
```

## 4. 确定性完成门禁 (DoD)

- [ ] **单元测试**：新建 `packages/runtime/src/proxy/virtualProxy.test.ts`：
  - 测试启动一个会输出 `Are you sure? [y/N]` 并等待 stdin 的 Mock 脚本，虚拟代理在 50ms 内成功识别提示符并自动回写 `y\n`，脚本顺利执行完毕（无死锁）。
  - 测试对于越权操作提示（如尝试修改白名单外的路径），虚拟代理自动回写 `n\n`，阻断危险操作。
  - 测试进程树沙箱：启动一个衍生多个后台 sleep 孙进程的测试脚本，触发超时或中断时，断言操作系统内该孙进程被物理清理，零进程泄漏。
  - **零 C++ 原生编译依赖**：严禁引入 `node-pty` 等破坏干净 `npm ci` 的依赖。
- [ ] **构建检查**：
  - `npx tsc -b tsconfig.json` exit 0。
  - `npm run typecheck:tests` exit 0。
- [ ] **全量回归**：
  - `npm run test:all` 双 root 全部通过。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **clean install 门禁防线**：严禁引入破坏纯 TypeScript / Node 跨平台环境的外部原生二进制依赖。
- **孤儿进程零容忍**：在 Windows 下必须强制附加 Job Object，且设置 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。
- **删除纪律**：测试产生的临时文件与脚本必须在 `os.tmpdir()` 下创建并在结束后清理。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- 避免正则假阳性：外部 Agent 可能会在代码片段中打印 `[y/N]` 或 `?`。提示符检测不仅需要正则匹配，还需要结合“连续 200ms 无新输出产生”作为处于挂起等待状态的双重判据。
