# 180 — 原生级操作系统沙箱与低完整性安全隔离 (Native OS Sandboxing & Low Integrity Boundary)

- 编号：180
- 优先级：P1
- 关联模块：`packages/tools`, `packages/runtime`, `packages/policy`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁通过；待验收
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
