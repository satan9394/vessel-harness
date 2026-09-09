# 089 — 统计增强（时间维度 + cache_creation 计价）

- 编号：089（合并 CC-SWITCH-MODULE-STUDY 候选卡 089/090，同属 UsageStore/计价层）
- 状态：待执行
- 优先级：P1（能力补齐：答得出"本月花了多少"、cache 写入不再低估）
- 创建日期：2026-09-08
- 关联：docs/ideas/CC-SWITCH-MODULE-STUDY.md §2 统计模块/§3 计价模块/§6 P1；085（计价正确性，已合入）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（来自 cc-switch 对比报告）

1. **089 统计无时间维度**：`UsageStore` 只有累计总量（inputTokens/outputTokens/cost 累计），**答不出"今天/本月花了
   多少"**、无趋势、无时间窗口查询。cc-switch 有明细表 + 日汇总表（`usage_daily_rollups`，只纳入完整本地日）。
2. **090 缺 cache_creation 计价**：`TokenPrice` 只有 input/output/cacheRead；Anthropic 的 **cache write
   （cache_creation）单价通常比 cache read 贵一个量级**，当前未计价 → 成本被低估。

## 验收标准（执行器逐条勾选）

### 089 时间维度
- [ ] `UsageStore` 增按日分桶（如 `daily: Record<'YYYY-MM-DD', {inputTokens, outputTokens, cacheReadTokens?,
      cacheCreationTokens?, costUsd, calls}>`），与累计总量并存；**本地日**口径（与 cc-switch 一致，只纳入完整本地日）
- [ ] `vessel usage` 支持 `--since <date>` / `--until <date>` / `--by-day`（按日列出）；默认行为保持兼容
- [ ] 原子写语义保持（沿用既有 tmp+rename/DPAPI 无关的持久化方式）；旧 usage 文件迁移（无 daily 字段 → 视为
      legacy 累计，不伪造历史分桶；迁移策略记录）
- [ ] 测试：跨日聚合正确、日边界（本地时区）、窗口过滤、旧文件兼容、原子写

### 090 cache_creation 计价
- [ ] `TokenPrice` 增 `cacheWrite?`（per-1M）；`UsageStore.record` 接收 `cacheCreationTokens?`
- [ ] `configs/pricing.json` 与 `configs/model-catalog.json` 补 `cacheWrite` 字段（Anthropic 系必填；OpenAI 系可缺）；
      缺字段时回退策略明确（如 `cacheRead × 倍率` 或标注 `estimated`——按 085 的 source/estimated 语义）
- [ ] 成本分项计算含 cache write；`vessel usage` 展示分项（input/output/cacheRead/cacheWrite）
- [ ] 测试：带 cache 写入的会话成本不再低估（断言分项）；缺字段回退行为

### 共同
- [ ] `npx tsc -b tsconfig.json` exit 0；全量 vitest（root 957+ 无回归）+ web 74（若涉）
- [ ] 文档同步（usage 统计口径/时间窗口/cache 计价；参考 docs/PRICING.md）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 089+090。091（定价回填 recompute）、092（用户价目覆盖）后续卡；P2 四张更后。
- 不重写 UsageStore 架构（在其上补维度）；不改 core；不引入新依赖；不读用户本机应用数据。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/usage/UsageStore.ts` + `usage-store.test.ts` + `vessel usage` 命令（apps/cli/src/cli.ts）
- `packages/shared/src/pricing.ts`（085 的 TokenPrice/resolvePrice——补 cacheWrite）
- `configs/pricing.json`、`configs/model-catalog.json`
- `packages/application/src/projections/UsageProjection.ts`（若需同步分项）
- 参考报告 §2/§3

## 方法

- 先读 UsageStore 现有结构与 085 的 pricing 实现 → 设计 daily 分桶与 cacheWrite 字段 → 实施 + 迁移 →
  CLI 查询参数 → 测试

## 工作证明（执行器回填：改了什么/daily 结构/迁移策略/cacheWrite 回退/测试输出/diff，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
