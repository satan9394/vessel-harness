# 任务卡 245 [ARCH-04]: 区分 BenchmarkAdapter 与 InteractiveRuntimeAdapter

> 状态：已完成 (DONE)  
> 归属：Phase 3 执行可靠性、外部生态对齐与高信噪比体验（ARCH-04 / P1）  
> 对应规划：`docs/plans/VESSEL_Architecture_Review_and_Execution_2026-10-20.md` §3 ARCH-04 与 `docs/HARNESS-ADAPTER-CONTRACT.md`  

## 1. 目标 (Goal)
- 明确区分 Benchmark 离线基准适配器与交互式持续运行时适配器，杜绝将静态评估接口冒充为实时交互协议：
  1. **语义解耦与显式别名**：
     - 将原跑 fixture 的 `HarnessAdapter` 显式明确为 `BenchmarkHarnessAdapter`（专职 `run(fixture)` 离线 L3 度量）；
     - 保留 `HarnessAdapter` 别名完全兼容既有测试和 runner；
  2. **定义交互式适配器契约 (InteractiveRuntimeAdapter)**：
     - 在 `@vessel/shared` 中建立规范化的 `InteractiveRuntimeAdapter` 接口，定义：
       - `id`, `version`；
       - `probe(): Promise<RuntimeProbeResult>`（探针探测安装版本、能力支持等级 `supported` / `unsupported` / `unknown`、探针时间戳与降级原因）；
       - `startRun(input: SafeRunInput): Promise<{ runId: string }>`；
       - 可选能力方法：`subscribeEvents`、`steerRun`、`cancelRun`、`resumeRun`、`getArtifacts`；
     - 严禁假冒全量支持，所有外部 runtime 必须依据真实证据显式声明支持等级。

## 2. 非目标 (Not Doing)
- 不粗暴删除或修改既有离线 Benchmark 测试套件与 runner 的入参格式；
- 不修改 `packages/core`（修改行数恒为 0）。

## 3. 验收标准 (Acceptance Criteria)
1. 类型与契约：
   - `@vessel/shared` 导出 `InteractiveRuntimeAdapter`, `RuntimeCapabilities`, `SafeRunInput`, `RuntimeProbeResult`；
   - `benchmarks/runners/src/contracts/types.ts` 导出 `BenchmarkHarnessAdapter` 并与 `HarnessAdapter` 保持兼容；
2. 自动化测试门禁：
   - `benchmarks/runners/src/contracts/contracts.test.ts` 新增契约隔离与探针能力验证，17 项测试全绿；
   - `npx tsc -b` 与 `npm run typecheck:tests` 通过；
   - `packages/core` 0 改动。

## 4. 影响范围 (Blast Radius)
- `packages/shared/src/runtimeAdapter.ts`：定义交互式运行时适配器契约与能力矩阵；
- `packages/shared/src/index.ts`：导出 `runtimeAdapter.ts`；
- `benchmarks/runners/src/contracts/types.ts`：导出 `BenchmarkHarnessAdapter` 别名；
- `benchmarks/runners/src/contracts/contracts.test.ts`：扩充契约测试用例。

## 5. 预期证据 (Expected Evidence)
- 定向测试与类型检查通过日志：
  - `benchmarks/runners/src/contracts/contracts.test.ts` 17 passed；
  - `npx tsc -b` exit 0；
  - `npm run typecheck:tests` exit 0；
- `packages/core` 修改行数：0。
