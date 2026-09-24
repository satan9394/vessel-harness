# 166 — 跨 Agent 全量功能保全与双盲评测套件 (Subagent Capability Conformance Suite)

- 编号：166
- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`benchmarks/runners`, `benchmarks/scenarios`
- 执行模型：Codex (GPT-6 Luna - Max Thinking)
- 验收人：用户

## 1. 目标与意图

建立工业级自动化评测套件，用严谨的机械指标回答核心疑问：
“外部成熟 Agent 或 Vessel 自身作为子 Agent 运行，到底能保留多大比例的全量功能？”
建立离线确定性的双盲评测通道，通过环回自测（Vessel 调 Vessel）与 Mock 仿真（模拟外部 Claude Code / Codex），
对子 Agent 的提问交互、多步代码重构、工具拦截熔断、Token 计量透视、以及 Worktree 干净回收进行确定性验证。

## 2. 权威开源参考与本地免下直读路径

- **Cross-Harness Conformance Suite**：`benchmarks/runners/src/conformance/run-conformance.ts`。
- **离线安全基准 S001–S008**：`benchmarks/runners/src/safety.test.ts`。
- **禁做清单铁律**：严守 AGENTS.md 禁做准则，**离线评测绝不自动启动本机真实安装的外部 Agent**，所有自动化 CI/门禁必须基于可控 Mock 桩与 Loopback 进行。

## 3. 评测指标与契约规范

在 `benchmarks/runners/src/conformance/subagent/` 建立三维保全度指标（Capability Preservation Metrics）：

```typescript
export interface SubagentConformanceMetrics {
  /** 任务执行成功率 */
  successRate: number;
  /** 交互保全度：子 Agent 发起的确认提示被成功处理的比例 (0-1) */
  interactionPreservation: number;
  /** 可观察性透视率：内部思考流与工具事件被父级无损捕获的比例 (0-1) */
  observabilityPassThrough: number;
  /** 工作区卫生：任务收尾时临时 Worktree 与锁文件的残留数，必须恒为 0 */
  residueCount: number;
  /** 总体能力保全评分，目标必须 >= 90% */
  overallPreservationScore: number;
}
```

评测套件必须包含 3 类标准测试场景：
1. **Scenario-SA01（代码重构与验证）**：子 Agent 在独立 Worktree 中修改文件、运行测试并返回 Diff，父级成功合并。
2. **Scenario-SA02（交互确认与安全拦截）**：子 Agent 触发高危命令，父级虚拟代理自动审批合法项、阻断非法项。
3. **Scenario-SA03（超时强杀与内核进程树清理）**：子 Agent 运行死循环与孙子后台进程，父级超时触发 Job Object 瞬间清理，残留进程数恒为 0。

## 4. 确定性完成门禁 (DoD)

- [ ] **自动化评测测试**：新建 `benchmarks/runners/src/conformance/subagentConformance.test.ts`：
  - 跑通全部 3 类标准场景，总体保全评分 `overallPreservationScore >= 90`。
  - 工作区残留检查：`residueCount === 0`。
  - 离线确定性：完全走 Mock 仿真与内部环回，绝不依赖真实外网与外部进程。
- [ ] **构建检查**：
  - `npx tsc -b tsconfig.json` exit 0。
  - `npm run typecheck:tests` exit 0。
- [ ] **全量回归**：
  - `npm run test:all` 双 root 全部通过。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **禁做铁律**：不得在未获用户显式同意的情况下，通过自动化测试去调起真实机器上的 `claude` / `codex` / `dsh` / `opencode` 进程（遵守任务 153 纪律）。
- **零脏数据**：评测套件在任何失败情况下，必须在 `afterEach` 或 `finally` 中将测试 Worktree 完全解脱，严禁污染本地开发环境。

## 6. 架构提示与避坑点 (GAN 对抗审计沉淀)

- 进程存活性断言：在 SA03 场景断言孙进程被杀死时，建议使用原生操作系统 API（如 PowerShell `Get-Process -Id <pid>`）探测，在进程确实不存在时验证退出码为非 0 或捕获 NoSuchProcess 异常。
