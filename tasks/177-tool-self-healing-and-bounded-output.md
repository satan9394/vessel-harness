# 177 — 工具级自愈退避与大载荷动态截断管道 (Tool-Level Self-Healing & Bounded Output)

- 编号：177
- 优先级：P1
- 关联模块：`packages/tools`, `packages/runtime`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁与独立审查通过；待用户验收（2026-10-02）
- 创建日期：2026-10-01

---

## 1. 目标与意图

在长时间无人值守的多 Agent 协作执行中，工具执行层（`packages/tools`）面临两类高频威胁：
1. **瞬态系统抖动导致过早退出**：在 Windows 环境下，防病毒软件扫描或前序进程未完全释放时，读写文件极易遭遇 `EBUSY` / `EPERM` / `ETXTBSY`；轻微的网络抖动也会导致 `curl` / `fetch` 瞬态失败。既有逻辑直接将上述错误认定为最终失败，打断长链路任务；
2. **大日志无边界倾倒撑爆内存（Unbounded Tool Output）**：当工具执行 `git diff`、构建脚本或打印超大日志文件时，单次输出可达数十兆。未经截断的字符串直接涌入 Node.js 内存与 LLM 上下文，瞬间诱发 V8 堆内存溢出（OOM）或直接触发模型上下文超限。

本任务旨在借鉴 OpenCode V2 的内存治理规范，构建工具执行层的防卫管道：
- **瞬态故障智能自愈（Tool Self-Healing）**：针对文件锁占用（`EBUSY`、`ETXTBSY`）与网络重试错误，引入带抖动的指数退避重试（默认 2 次重试：50ms、150ms），自愈成功后透明返回；
- **动态输出流控与分块截断（Bounded Tool Output）**：对任何工具返回的标准输出与错误流施加安全边界（默认 64KB）。超过阈值时，自动保留头部与尾部关键信息，中间嵌入结构化提示标记（如 `[Output truncated: showing first 32KB and last 32KB of total 4.2MB]`），彻底阻断内存与上下文膨胀。

---

## 2. 接口与契约规范

### 2.1 大输出动态截断管道 (`packages/tools/src/execution/boundedOutput.ts`)

```typescript
export interface BoundedOutputOptions {
  /** 单次工具输出允许的最大字节数（默认 64 * 1024 = 65,536 字节） */
  maxBytes?: number;
  /** 头部保留比例（默认 0.5，即前 32KB 与后 32KB） */
  headRatio?: number;
}

export interface BoundedOutputResult {
  content: string;
  truncated: boolean;
  originalBytes: number;
  truncatedBytes: number;
}

/**
 * 安全截断大输出字符串，若未超限则直接返回原串；
 * 超限时在首尾间插入结构化占位符并保证 UTF-8 字符边界完整。
 */
export function enforceBoundedOutput(output: string, opts?: BoundedOutputOptions): BoundedOutputResult;
```

### 2.2 瞬态自愈执行器 (`packages/tools/src/execution/selfHealing.ts`)

```typescript
export interface SelfHealingOptions {
  maxRetries?: number; // 默认 2
  initialDelayMs?: number; // 默认 50
  backoffFactor?: number; // 默认 2
  retryableErrors?: (err: unknown) => boolean;
}

export const DEFAULT_RETRYABLE_CODES = new Set(['EBUSY', 'ETXTBSY', 'ECONNRESET', 'ETIMEDOUT']);

/**
 * 封装工具实际执行函数，遇已知瞬态错误自动指数退避重试
 */
export function executeWithSelfHealing<T>(
  fn: () => Promise<T>,
  opts?: SelfHealingOptions,
): Promise<T>;
```

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：截断与重试管道作为 `packages/tools` 内部执行中间件挂载，严禁侵入 `packages/core`。
2. **严禁破坏原始数据完整性**：对于文件写入或代码保存类工具，截断逻辑仅应用于工具返回给 LLM 的输出文本，绝不得截断实际写入磁盘的目标代码文件。
3. **安全删除铁律**：测试中创建的临时文件必须位于 `os.tmpdir()` 下且在 `afterEach` 中干净清理。

---

## 4. 确定性完成门禁 (DoD)

1. **单测覆盖与全绿**：
   - 编写并通过 `packages/tools/src/execution/boundedOutput.test.ts`：
     - 验证未超限内容原样输出；
     - 验证超过 64KB 内容被精确截断并插入包含原体积与截断体积的标记；
     - 验证多字节 Unicode/CJK 字符截断时不会产生乱码裂字。
   - 编写并通过 `packages/tools/src/execution/selfHealing.test.ts`：
     - 验证模拟 EBUSY 在第二次重试成功时正常返回数据；
     - 验证非重试错误（如命令未找到）立即快速失败而不空等；
     - 验证超过重试上限后抛出原始异常。
2. **回归门禁**：
   - `npx vitest run packages/tools` 全部通过；
   - `npx tsc -b tsconfig.json` exit 0。
