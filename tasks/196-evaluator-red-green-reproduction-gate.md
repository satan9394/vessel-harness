# 196 — 评估器 Red→Green 缺陷复现前置硬门禁 (Evaluator Red→Green Reproduction Gate)

- 编号：196
- 优先级：P1
- 关联模块：`packages/policy`, `packages/runtime`, `packages/shared`, `packages/tools`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：实现完成，定向验证通过（Epic 199 全量门禁待执行）
- 创建日期：2026-10-08

---

## 1. 目标与意图

在自动化软件开发与 Bug 修复场景中，Agent 极易产生“伪完成（Hallucinated Fix）”偏差：
1. **Generator 自证完成**：Agent 在修改源码后，仅凭模型自说自话宣告“修复已完成”，未提供任何针对当前 Bug 的精确回归证据；
2. **缺乏失败基线（No Red Baseline）**：Agent 编写的测试往往直接测试修改后的状态，如果测试逻辑存在漏洞（如永远 assert true），即使代码根本未修复也会通过；
3. **隐蔽性功能倒退**：修复单一 Bug 却破坏了其他模块，而缺乏统一严格的生命周期管控。

本任务旨在建立 **Vessel 原生 Red→Green 缺陷复现硬门禁（Evaluator Red→Green Gate）**：
- **强制双阶段检验**：
  - **阶段 1 (Red Check)**：在实施业务代码修复前，Agent 必须提交独立的复现用例。门禁在当前基线分支执行该用例，**必须且仅允许因目标 Bug 失败（Exit Code != 0 / Assertion Error）**，留存 Red 证据报告；
  - **阶段 2 (Green Check)**：在业务代码修复后重新执行该用例，**必须转为成功通过（Exit Code == 0）**；
  - **阶段 3 (Regression Check)**：全量既有测试必须保持 100% 通过；
- **薄核（Thin Core）集成**：作为 Policy Engine 与 Evaluator Agent 的可插拔检验器运行，不在核心 AgentLoop 塞入硬编码。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 门禁定义与阶段状态 (`packages/policy/src/gates/redGreenGate.ts`)

```typescript
export interface RedGreenGateConfig {
  reproductionCommand: string; // e.g. "npx vitest run tests/repro/issue-123.test.ts"
  fullSuiteCommand?: string;   // e.g. "npm run test:all"
  timeoutMs?: number;          // Default: 30000ms
  allowBaselineFailureReasons?: string[]; // 预期的失败关键词或断言特征
}

export type RedGreenPhase = 'uninitialized' | 'red_verified' | 'green_verified' | 'rejected';

export interface RedGreenProof {
  phase: RedGreenPhase;
  redExecution: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    verifiedAt: string;
    failureSummary: string;
  };
  greenExecution?: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    verifiedAt: string;
  };
  regressionPassed?: boolean;
}

export interface IRedGreenGate {
  /** 阶段 1：验证复现用例是否在未修复前确定性失败 */
  verifyRedPhase(config: RedGreenGateConfig): Promise<{ success: boolean; proof: RedGreenProof; error?: string }>;

  /** 阶段 2：验证在代码修复后复现用例是否成功转绿，且全量回归测试无破坏 */
  verifyGreenPhase(proof: RedGreenProof, config: RedGreenGateConfig): Promise<{ success: boolean; proof: RedGreenProof; error?: string }>;
}
```

### 2.2 门禁拦截策略集成

在 Policy Engine 中注册为硬门禁规则：
- 当任务类型标记为 `bugfix` 或触发修障工作流时，若 Agent 调用 `claim_task_complete` 或输出完成信号，Policy Engine 自动校验 `proof.phase === 'green_verified'` 且 `proof.regressionPassed === true`。
- 若无合法 Red 证据证明，直接 Deny 完成请求，打回提示：“[Policy Deny] 缺少有效的 Red 缺陷复现凭据，无法确认 Bug 已被真实定位与闭环”。

---

## 3. 验收标准与测试用例 (DoD)

1. **单元测试 (`packages/policy/tests/redGreenGate.test.ts`)**：
   - 用例 1：测试在 Red 阶段如果用例直接通过（False Positive），门禁必须返回 `rejected` 并给出明确错误说明；
   - 用例 2：测试在 Red 阶段执行确实失败，成功生成包含输出快照与特征提取的 `proof.redExecution`，阶段进入 `red_verified`；
   - 用例 3：测试在 Green 阶段用例依然失败（修不好），门禁拒绝放行；
   - 用例 4：测试用例在 Green 阶段通过，且回归测试通过，凭据状态成功转换为 `green_verified`。
2. **安全与防伪断言**：
   - 凭据数据采用哈希校验（SHA-256），防止外部直接手工篡改 `proof` JSON 对象伪造检验结果；
   - 命令执行使用隔离受控子进程通道，禁止 shell 注入。
3. **构建与门禁通过**：
   - `npm run test:all` 与 `npm run typecheck:tests` 全部通过。

## 4. 交付指针（2026-10-08）

实现与信任边界：`evidence/sessions/2026-10-08-v2.3/card196.md`。
父会话 41 项定向测试及测试类型检查 exit 0；追加来源新鲜度、Red 运行中基线变更与跨工作区凭据拒绝后，14 项门禁/组合测试 exit 0，见 `card196-final-scope-freshness.log`。全量双 Root、构建与 Web 门禁统一在 Epic 199 最后一次源码编辑之后执行。


## 2026-10-27 对账（卡 355）

已被 199 取代（2026-10-27 对账）：仅指“Epic 199 全量门禁待执行”的旧状态，196 实现继续有效。199:58-72 记录 196/197/198 闭环、最终双 Root 2957 passed + 6 skipped、构建/类型/Web exit 0 与历史失败保留；README 已记录 2026-10-09 commit 3e6a56f。现行 redGreenGate.ts:109-157 校验 Red/Green、凭据与完成门禁；本次 redGreenGate.test.ts 纳入 9 文件 / 121 passed、exit 0。未重跑全量，也未重写历史失败记录。
