# 192 — 洋葱式 Mod 中间件核心流水线 (Onion Mod Middleware Pipeline)

- 编号：192
- 优先级：P1
- 关联模块：`packages/policy`, `packages/runtime`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已交证（2026-10-08，定向测试与类型门禁通过；总装见 Epic 195）
- 创建日期：2026-10-08

---

## 1. 目标与意图

在 Claude Code 发布 Mods（2026-10-01）与 DeepSeek Harness (DSH) 实验兼容层之后，插件化扩展进入了“中间件拦截”的新范式。传统的工具扩展仅能被动被模型调用，而 Mod 中间件能够挂载在事件流与工具生命周期上，对输入输出实施观测、改写甚至直接接管。

然而，如果缺乏清晰的分层与确定性洋葱模型，Mod 容易产生不可控的副作用与拦截冲突。

本任务旨在建立 **Vessel 原生洋葱式 Mod 中间件流水线（Onion Mod Middleware Pipeline）**：
1. **三态洋葱式操作契约（Observe / Rewrite / Intercept）**：
   - `observe`（旁路观测）：只读监听内部事件流（`before_tool`, `after_tool`, `turn_start` 等），不可修改载荷，专门用于审计、遥测与外部通知；
   - `rewrite`（上下文与参数改写）：支持对即将发送给模型的提示词增量段进行格式修饰，或对工具入参进行合规校验与标准化规范；
   - `intercept`（执行接管）：前置拦截危险或特定工具调用，直接返回预置或 Mock 结果，绕过真实执行器；
2. **确定性执行流与优先级管道（Execution Pipeline）**：
   - 中间件按明确的优先级权重（`priority: number`）排序组装为洋葱模型；
   - 任何一个中间件抛出异常时执行 Fail-Closed 策略，确保系统不处于未定义状态；
3. **薄核（Thin Core）零侵入**：
   - 整个流水线装配在 `packages/policy` 与 `packages/runtime`，核心 AgentLoop 仅消费既有 Hook 点，保持零侵入。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 洋葱中间件类型定义 (`packages/policy/src/mods/types.ts`)

```typescript
export interface ModExecutionContext {
  sessionId: string;
  turnIndex: number;
  toolName?: string;
  metadata: Record<string, unknown>;
}

export interface ModMiddleware {
  readonly name: string;
  readonly version: string;
  readonly priority: number; // 数值越小越在外层 (Default: 100)

  // 1. 只读观察
  observe?(event: { type: string; payload: unknown; context: ModExecutionContext }): Promise<void>;

  // 2. 载荷改写 (不可中断执行)
  rewriteToolInput?(input: Record<string, unknown>, context: ModExecutionContext): Promise<Record<string, unknown>>;
  rewritePromptFragment?(fragment: string, context: ModExecutionContext): Promise<string>;

  // 3. 执行接管 (返回结果则直接短路真实工具调用)
  interceptToolCall?(input: Record<string, unknown>, context: ModExecutionContext): Promise<{
    handled: boolean;
    result?: unknown;
    reason?: string;
  }>;
}
```

### 2.2 洋葱流水线执行器 (`packages/policy/src/mods/ModPipeline.ts`)

```typescript
export class ModPipeline {
  register(middleware: ModMiddleware): void;
  unregister(name: string): boolean;
  list(): ModMiddleware[];

  dispatchObserve(type: string, payload: unknown, context: ModExecutionContext): Promise<void>;
  dispatchRewriteToolInput(toolName: string, input: Record<string, unknown>, context: ModExecutionContext): Promise<Record<string, unknown>>;
  dispatchIntercept(toolName: string, input: Record<string, unknown>, context: ModExecutionContext): Promise<{ handled: boolean; result?: unknown }>;
}
```

---

## 3. 架构红线与禁做准则

1. **薄核铁律**：`packages/core` 保持 0 改动，中间件管道在 Policy 拦截器与 Runtime 工具分发处装配；
2. **纯本地开发**：严禁执行 `git push`；
3. **安全第一**：拦截与改写必须通过结构化上下文，严禁将未受信环境变量直接赋权给 Mod。

---

## 4. 完成门禁 (DoD)

1. 定向测试全绿：
   - `npx vitest run packages/policy/tests/mods`
   - Runtime 工具生命周期总装与集成验证由 Epic 195 执行（本卡只交付 Policy 流水线与共享接口）。
2. 类型构建通过：
   - `npx tsc -b tsconfig.json` exit 0
   - `npm run typecheck:tests` exit 0

## 5. 工作证明（2026-10-08）

- 共享契约：`packages/shared/src/mods.ts`；Policy 的 `mods/types.ts` 转导出，Runtime 无须新增依赖。
- 流水线：`packages/policy/src/mods/onionPipeline.ts`。优先级小者在外层，同权重按注册顺序；`after_tool` 逆序退栈。Observe 深度只读快照、rewrite 串行传递、intercept 首次 handled 短路。异常与恶意返回值触发持久 Fail-Closed 熔断，移除故障 Mod 不解除熔断。
- 边界：拒绝访问器、循环、非普通对象、原型污染键与工具参数中的 Policy/Sandbox/Credential 授权改写。未签名 Mod 的执行隔离由卡 193 实现；本卡回调明确是主机代理接口，不是第三方源码执行器。
- 提示词：只向 Mod 提供增量 fragment，带 `[Mod: <name>]` 标签追加在现有 scopedPrefix 尾部；稳定前缀不传入 Mod。
- 测试：`onionPipeline.test.ts`、`modIsolation.test.ts`、`modPrompt.test.ts` 共 **3 文件 / 28 passed**；新增测试目录已加入 Vitest 与测试类型检查 include。
- 验证命令与日志：`evidence/sessions/2026-10-08-v2.2/card192-targeted.log`、`card192-build.log`、`card192-test-types.log`，均明确记录 **exit=0**。`packages/core` 变动为 0；无依赖安装、无外部 Agent、无提交/推送/发布。
