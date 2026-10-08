# 190 — 工作区状态指纹与无进展死循环熔断器 (Workspace Fingerprint & No-Progress Convergence Breaker)

- 编号：190
- 优先级：P1
- 关联模块：`packages/engine`, `packages/tools`, `packages/application`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已验收（2026-10-08，按人类批准的本机精确语义性能指标）
- 创建日期：2026-10-07

---

## 1. 目标与意图

在长任务自治或多 Agent 协作开发中，Agent 最致命的失控模式之一是**“原地打转无进展死循环”（Infinite Stagnant Loop）**：
- 模型多次执行相同命令并产生相同报错（如 `ENOENT` / `EACCES` / 编译语法错误），但模型拒绝调整策略，反复重试；
- 模型声称在“不断优化调试”，但工作区物理文件、代码与 Git 状态无任何实质变化，徒耗大量 Token。

本任务旨在建立**确定性的物理状态收敛感知与无进展熔断体系**：
1. **轻量快速工作区状态指纹（Workspace Fingerprint）**：
   - 每次读取实时内容与 mtime、新增/删除文件集合及精确 Git 补丁字节，保留 staged、untracked、忽略规则与目录 confinement；性能按 2026-10-08 人类批准的本机有界规模指标验收，替代原 <25ms；
2. **多维收敛判定与死循环熔断器（`NoProgressBreaker`）**：
   - 连续 $N$ 轮（默认 3 轮）工具执行后，若工作区状态指纹保持完全一致（0 物理产出）；
   - 或连续 $K$ 次发生相同类型的工具执行失败（相同 `errorCode` / `errorClass`）；
   - 自动判定为“收敛停滞”，主动触发熔断中断当前 Loop，记录 `audit/stagnation_break` 事件；
3. **输出清晰的停滞诊断与人工干预建议**：
   - 熔断退出时提供结构化报告：包含停滞轮次、重复错误类型与最后有效物理变更点，杜绝盲目消耗配额。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 工作区状态指纹 (`packages/tools/src/filesystem/workspaceFingerprint.ts`)

```typescript
export interface WorkspaceStateFingerprint {
  timestamp: number;
  trackedFilesHash: string;
  uncommittedDiffBytes: number;
  fileCount: number;
}

export class WorkspaceFingerprinter {
  static compute(workspaceRoot: string): Promise<WorkspaceStateFingerprint>;
}
```

### 2.2 无进展熔断器 (`packages/engine/src/breaker/NoProgressBreaker.ts`)

```typescript
export interface BreakerConfig {
  maxStagnantSteps?: number; // 默认 3
  maxConsecutiveErrors?: number; // 默认 3
}

export interface StepObservation {
  stepIndex: number;
  toolName: string;
  isError: boolean;
  errorCode?: string;
  fingerprint: WorkspaceStateFingerprint;
}

export interface ConvergenceCheckResult {
  shouldBreak: boolean;
  stagnantStepCount: number;
  consecutiveErrorCount: number;
  reason?: string;
}

export class NoProgressBreaker {
  constructor(config?: BreakerConfig);
  recordStep(observation: StepObservation): ConvergenceCheckResult;
  reset(): void;
}
```

---

## 3. 架构红线与禁做准则

1. **薄核铁律**：`packages/core` 保持 0 侵入，熔断器作为外层 `packages/engine` 的执行保护外壳；
2. **只读计算性能**：指纹计算仅做必要的状态读取，严禁全量深扫大型 `node_modules` 目录，必须自动应用忽略规则（`.git`, `node_modules`, `dist`）；
3. **无硬删除**：除在 `os.tmpdir()` 创建的测试自建临时目录外，严禁硬删任何文件。

---

## 4. 完成门禁 (DoD)

1. 定向测试全绿：
   - `npx vitest run packages/tools/src/filesystem/workspaceFingerprint.test.ts`
   - `npx vitest run packages/engine/src/breaker/NoProgressBreaker.test.ts`
2. 类型与全量回归通过：
   - `npx tsc -b tsconfig.json` exit 0
   - `npm run typecheck:tests` exit 0
3. 本机精确语义性能（2026-10-08 人类显式批准）：
   - 50 文件 fixture：warm ≤50ms（验收脚本按全部 10 次 warm 样本的最大值判定）；
   - 当前全仓 ≤2000 文件规模：cold ≤1500ms、warm p95 ≤1000ms；
   - `npx tsx scripts/bench-workspace-fingerprint.ts .` exit 0；整次 compute 调用计时，包含文件遍历、实时读取、哈希与 Git；cold 为首次调用，之后 10 次为 warm，p95 使用 nearest-rank；
   - 不并行运行测试或构建，不缓存跨调用结果，不删减精确语义。原 <25ms 失败记录保留为已被替代的历史门禁。

## 阶段交证（2026-10-07）

- shared 类型契约、tools 实现、engine 导出门面；父与隔离运行时默认启用，不改 core。停滞事件持久化后中断，不自动续跑。
- Git 文件集合遵循忽略规则与 tracked 例外；补丁按二进制字节统计，未跟踪/非 Git 文件按原始内容统计；覆盖同 mtime 改写、未提交仓库、嵌套工作区与符号链接边界。
- 专项/生产集成 **11 passed**，构建与测试类型检查 exit 0；见 `evidence/sessions/2026-10-07-v2.1/phase190*.log`。
- **严格 <25ms 未达标**：50 文件 cold 约 52ms、warm 中位约 38.6ms；本仓约 1673 源文件 cold 约 1095ms、warm 中位约 1285ms、最大约 1526ms。不能以专项正确性全绿替代性能验收；未用跨调用陈旧缓存掩盖问题，未获授权放宽指标。

## 追加修复交证

- 新鲜内容按 32 文件并发读取，保持确定性哈希顺序；修复 tracked 父目录 junction 导致 Git diff 读取工作区外文件的问题。6 项正确性测试通过，最终同步准备函数整理由 renewed 全量回归覆盖。
- 本仓约 1709 文件 cold 773.05ms、warm 中位 638.24ms、最大 804.86ms；50 文件 cold 48.79ms、warm 中位 32.52ms。严格 <25ms 仍失败，未修改标准。
- 预算已获追加授权。当前待决定的是性能契约或原生方案研究范围；详见 `evidence/sessions/2026-10-07-v2.1/fingerprint-design-decision.md`。机械门禁继续独立执行，未提交代码。

## 人类恢复原目标后的研究

直接 Git 二进制仍至少约 32ms 启动；<=64 文件同步读取候选通过 10 项正确性测试，但整次调用仍超过 25ms且无稳定小工作区收益，已完全撤回实验分支。恢复源码后的专项验证记录在 `resumed-restored-fingerprint-correctness.log`；尚无新的全量终态验收声明。严格目标不变，详见 `resumed-strict-performance-audit.md`。

## 最终验收（2026-10-08）

人类显式批准的新 DoD 已生效，历史 <25ms 阻断关闭。交付文件收齐后的最终串行 benchmark：50 文件 fixture warm 最大 **42.5767ms ≤50ms**；全仓 **1739 文件 ≤2000**，cold **905.8525ms ≤1500ms**，warm p95 **673.4129ms ≤1000ms**；exit 0。实时内容、mtime、精确 Git 字节与安全边界语义保持。

最终构建、测试类型、Web 安全构建、双 Root 回归与身份守卫全部 exit 0；双 Root 合计 **2811 passed / 6 skipped**。证明与原始日志：`evidence/sessions/2026-10-07-v2.1/final-delivery-proof.md`、`accepted-final-fingerprint-benchmark.log`、`accepted-*.log`。不提交、不推送、不发布；历史删除纪律偏差继续披露。
