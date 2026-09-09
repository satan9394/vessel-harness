# 101 — P2：models.dev 价目同步 + provider 成本倍率

- 编号：101（合并 CC-SWITCH-MODULE-STUDY 候选卡 093/094）
- 状态：待执行
- 优先级：P2
- 创建日期：2026-09-09
- 关联：085（resolvePrice/source 语义）；100（override/优先级链）；docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

1. **093 models.dev 同步**：`vessel pricing sync` —— 从 models.dev 拉取模型元数据/价目，生成或更新
   `configs/model-catalog.json`（或用户态 catalog），带选择/排除、超时、**离线回退**（拉取失败保留旧表并提示）；
   同步**不得覆盖用户覆盖**（`~/.vessel/pricing.override.json` 优先级最高，100 已建）。
2. **094 provider 成本倍率**：`ProviderConfig` 增 `costMultiplier?`，在计费时**只乘总额**（不改变分项单价），
   用于中转/代理加价场景。

## 验收标准（执行器逐条勾选）

### 093 sync
- [ ] `vessel pricing sync [--dry-run] [--provider <p>] [--exclude <glob>]`：拉 models.dev（含超时/重试上限 1 次），
      生成/更新 catalog；**离线/失败时保留旧表 + 明确提示**（不静默清空）
- [ ] 同步不覆盖用户 override（优先级链 override > 内置 > catalog 保持 100 的语义）；dry-run 只打印差异
- [ ] 幂等：相同远端数据二次同步无变更（或幂等写）；原子写
- [ ] 测试 ≥6 例：解析映射/离线回退/dry-run/幂等/不覆盖 override/异常

### 094 costMultiplier
- [ ] `ProviderConfig.costMultiplier?: number`（默认 1）；`vessel provider add/set` 可设；持久化到 providers.json
- [ ] 计费只乘**总额**（分项单价不变；`vessel usage` 分项与总额关系可解释）；倍率 <0 或非数字 fail loud
- [ ] 测试 ≥4 例：倍率生效只作用总额/默认 1/非法值 fail loud/与 override·catalog 共存

### 共同
- [ ] `npx tsc -b tsconfig.json` exit 0；全量 vitest（root 1039+ 无回归）+ web 74
- [ ] 文档同步（PRICING.md：sync 用法与离线语义、倍率语义）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 093+094。095（导入导出）/096（多端点）后续卡；不做 UI。
- 不读用户本机应用数据；密钥不落盘；不加新依赖（HTTP 用既有 fetch）。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/providers/pricing.ts` / `packages/shared/src/pricing.ts`（085/100 的价源与优先级链）
- `apps/cli/src/providers/modelCatalog.ts`、`configs/model-catalog.json`
- `apps/cli/src/providers/ProviderStore.ts`（ProviderConfig 增字段）+ `apps/cli/src/cli.ts`（命令）
- `apps/cli/src/usage/UsageStore.ts`（倍率只乘总额）
- 参考报告 §3（cc-switch 的三通道更新：seed / 值守卫修复 / models.dev 同步）

## 方法

- 先读 085/100 的价源链 → 加 sync 命令（离线回退 + 不覆盖 override）→ 加 costMultiplier（只乘总额）→ 测试

## 工作证明（执行器回填：改了什么/sync 离线语义/倍率计算点/测试输出/diff，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
