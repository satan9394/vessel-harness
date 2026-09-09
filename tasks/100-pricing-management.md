# 100 — 定价管理（历史回填 recompute + 用户价目覆盖）

- 编号：100（合并 CC-SWITCH-MODULE-STUDY 候选卡 091/092）
- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-08
- 关联：085（source/estimated 语义，已合入）；089/099（usage 分项与 daily 分桶，已合入）；docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

1. **091 定价变更回填**：`vessel usage recompute` —— 按当前价目重算历史用量成本（幂等 + dry-run）。
   改价后历史成本不再"钉死"，且可验证重算结果与直接重跑一致。
2. **092 用户价目覆盖**：`~/.vessel/pricing.override.json`（覆盖 + 删除墓碑）与内置 `configs/pricing.json` 分离；
   提供**值守卫**式迁移（仅当现值 = 旧值才改，避免覆盖用户改动）。

## 验收标准（执行器逐条勾选）

### 091 recompute
- [ ] `vessel usage recompute [--dry-run] [--since/--until]`：按当前价目重算历史条目成本（保留 token 原始值，
      只重算 cost/estimated/pricingSource）；**幂等**（连跑两次结果一致）
- [ ] dry-run 输出差异摘要（受影响条目数/金额变化），不落盘
- [ ] 重算与"用新价目重新记录"结果一致（测试断言）
- [ ] 旧数据兼容：无 pricingSource 的 legacy 条目按当前规则重算并标注

### 092 用户覆盖 + 值守卫
- [ ] `~/.vessel/pricing.override.json`：按 `provider::model`（或既有键格式）覆盖单价；支持删除墓碑
      （显式删除内置条目）；与 `configs/pricing.json` 分离，内置更新不覆盖用户覆盖
- [ ] 加载优先级：override > 内置（> catalog > protocol > default，沿用 085 的 source 语义并新增 `override` 来源）
- [ ] 值守卫式迁移工具（仅当现值 = 旧值才改），避免内置更新冲掉用户手改
- [ ] 测试 ≥8 例：覆盖生效/墓碑删除/优先级/值守卫/内置更新不冲用户/异常

### 共同
- [ ] `npx tsc -b tsconfig.json` exit 0；全量 vitest（root 994+ 无回归）+ web 74
- [ ] 文档同步（PRICING.md：recompute 用法、override 文件格式与优先级、值守卫）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 091+092。P2（093-096）后续卡；不做 UI。
- 不读用户本机应用数据；密钥不落盘；不加新依赖。

## 涉及文件（指针，执行器自行精化）

- `packages/shared/src/pricing.ts`（085：resolvePrice/source——新增 override 来源）
- `apps/cli/src/usage/UsageStore.ts` + `vessel usage` 命令（apps/cli/src/cli.ts）
- `configs/pricing.json`（内置，不改语义）
- `~/.vessel/pricing.override.json`（新，用户态）
- 参考报告 §3（cc-switch 的 DB 覆盖 + model-pricing.json 墓碑 + 值守卫修复 + 历史回填）

## 方法

- 先读 085 的 resolvePrice/source 与 UsageStore 记录结构 → 加 override 加载层 + 值守卫 → recompute 命令 →
  测试（含幂等与 dry-run）

## 工作证明（执行器回填：改了什么/override 格式/优先级链/recompute 幂等证据/测试输出，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
