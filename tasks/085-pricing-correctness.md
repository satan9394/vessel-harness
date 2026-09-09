# 085 — 计价正确性 P0（模型名归一 + 缺价显式化 + 统一计价 + 文案纠偏）

- 编号：085（合并 CC-SWITCH-MODULE-STUDY 候选卡 085/086/087/088，同属计价模块、有依赖链）
- 状态：待执行
- 优先级：P0（修正确性：当前在用默认价制造"假成本"）
- 创建日期：2026-09-08
- 关联：docs/ideas/CC-SWITCH-MODULE-STUDY.md §5 差距清单/§6 P0；tasks/029-usage-store.md、tasks/030-model-catalog.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（来自 cc-switch 三模块对比报告）

1. **085 查价命中率低**：`findCatalogModelByBase` 只做 basename 匹配，缺日期后缀（`-20250514`）、命名空间前缀
   （`openrouter/…`、`anthropic.`）、reasoning effort 后缀（`-high/-low`）、Claude 点号→横线（`claude-3.5-sonnet`
   → `claude-3-5-sonnet`）归一 → 大量真实模型名落不到目录价，退到 default。
2. **086 假成本（最隐蔽）**：`resolvePrice` 对未知模型回落 default 0.5/1.5（per-1M），`UsageProjection` 也硬编码
   同值——**没有任何标记说明这是估算**，用户看到的是"精确数字"。比 cc-switch 的 0 成本更危险。
3. **087 计价双实现**：`UsageProjection` 与 `benchmarks` 侧各有一套价表/默认价逻辑，可能漂移。
4. **088 文案矛盾**：`apps/cli/src/providers/ProviderStore.ts` 头部注释仍写"apiKey 本地明文存储（与 cc-switch
   同款取舍）…不做加密（YAGNI）"，与 034 之后的 DPAPI 实现矛盾（误导后来者）。

## 验收标准（执行器逐条勾选）

### 085 模型名归一
- [ ] 新增 candidates 归一函数（去命名空间前缀/日期后缀/effort 后缀/Claude 点号→横线/大小写），`resolvePrice`
      与 modelCatalog 查价共用（单一实现，勿两处各写）
- [ ] 单测 ≥8 种真实模型名变体（如 `openrouter/anthropic/claude-3.5-sonnet`、`claude-3-5-sonnet-20241022`、
      `gpt-5.1-codex-high`、`mimo-v2.5-pro` 等）命中目录价
- [ ] 命中率提升可量化（列出对比：归一前/后各变体命中情况）

### 086 缺价显式化
- [ ] `resolvePrice` 返回 `{ price, source: 'model'|'catalog'|'protocol'|'default', estimated: boolean }`
      （或等价结构）；`default` 兜底时 `estimated=true` 且 source 标 `default`
- [ ] `UsageEntry`/统计记录增 `estimated`/`pricingSource` 字段（持久化）
- [ ] `vessel usage`（或 usage 展示）明示「含估算条目 N 条 / 价格来源分布」；提供 `--strict` 模式（不用 default 兜底，
      未收录则标 0 或拒绝记录——按卡内选型记录理由）
- [ ] 测试：default 兜底条目被标记；`--strict` 行为断言

### 087 统一计价
- [ ] `UsageProjection` 复用同一份 `resolvePrice` 语义（注入 pricing 表 + catalog 源），删除内部硬编码默认价
- [ ] 两条路径（projection 与 benchmark/usage-store）对同一模型返回相同价（回归测试断言）

### 088 文案纠偏
- [ ] `ProviderStore.ts` 头部注释改为与 DPAPI/secretRef 实现一致（无"YAGNI/明文存储"误导）；扫一遍相关注释

### 共同
- [ ] 全量 vitest（root 900+ 无回归）+ tsc 0 + web 74（若涉）
- [ ] 文档同步（pricing/usage 文档：归一规则、estimated 语义、strict 模式）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做这四项（计价正确性）。P1 的 089 统计时间维度、090 cache_creation 计价、091 定价回填、092 用户覆盖
  各自成卡（后续）。
- 不改 core；不引入新依赖；不重写 UsageProjection 架构（只统一价源）。

## 涉及文件（指针，执行器自行精化）

- 计价：`configs/pricing.json`、`configs/model-catalog.json`、`packages/application/src/projections/UsageProjection.ts`、
  `apps/cli/src/usage/`（usage-store）、`benchmarks/runners/src/adapters/*.ts`（pricing 读取）、resolvePrice 所在处
- 文案：`apps/cli/src/providers/ProviderStore.ts`
- 参考报告：`docs/ideas/CC-SWITCH-MODULE-STUDY.md` §3 计价模块（cc-switch 的 candidates 归一/四项分算/无缺价兜底）

## 方法

- 先读报告 §3 + 现有 resolvePrice/modelCatalog/UsageProjection 实现 → 定归一规则与返回结构
- 归一 + 显式化 + 统一实现（先 085 再 086 再 087，最后 088 文案），每步跑针对性测试
- 全量验证后提交

## 工作证明（执行器回填：改了什么/归一前后命中对比/estimated 语义/测试输出/diff，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
