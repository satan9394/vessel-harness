# 113 — 原子写统一 EPERM 有界重试（消除全量并发 flaky）

- 编号：113
- 状态：待执行
- 优先级：P1（防 flaky：112 之前全量多次出现偶发 1-2 failed，含 rename EPERM）
- 创建日期：2026-09-10
- 关联：101（f276724：UsageStore 原子写 EPERM 有界重试 3 次 5/15ms）；089/100/104（同类原子写）；
      docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md"已知 rename EPERM 观察项"
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（指挥盘点确认）

仓库全部 rename 原子写点中，**4 处无 EPERM/EBUSY 有界重试**（Windows 杀软/索引器瞬时锁文件，全量并发下
偶发失败 → vitest `1-2 failed`）：
- `packages/application/src/project/ProjectRegistry.ts`（EPERM mentions=0）
- `packages/application/src/review/ReviewHandoffStore.ts`（=0）
- `packages/application/src/session/SessionRegistry.ts`（=0）
- `packages/core/src/session/Session.ts`（=0）

已治理的对照（101：UsageStore 3 次 5/15ms；ProviderStore/pricingOverride/CredentialStore 各有提及）。

## 验收标准（执行器逐条勾选）

- [ ] 统一实现（避免每处复制）：在既有有界重试处提取共享 helper（如 `writeFileAtomic` / `renameWithRetry`，
      放 packages/application/src/fs/ 或 shared 无依赖处——选型记录；**不加新依赖**），参数：次数 3、退避 5/15ms
      （与 101 一致），仅 EPERM/EBUSY/EACCES 重试，其它错误立即抛
- [ ] 4 处无重试点改走共享 helper（ProjectRegistry/ReviewHandoffStore/SessionRegistry/Session）；
      行为不变（tmp+rename 原子语义保持）
- [ ] 已治理的 5 处（UsageStore/ProviderStore/pricingOverride/CredentialStore/pricingSync）若已有本地实现，
      可选迁移到共享 helper（避免三份实现漂移——若迁移，锁行为/失败语义不变）；不迁移则记录理由
- [ ] 测试 ≥4 例：EPERM 先失败后成功（mock rename 前 2 次抛 EPERM 第 3 次成功）/ EBUSY / 非锁错误立即抛 /
      helper 单测；现有相关测试不回归
- [ ] `npx tsc -b tsconfig.json` exit 0；全量 vitest（1175+ 无回归）+ web 82；**连续 2 次全量 0 failed**（本卡目标：
      证明 rename EPERM flaky 消除）
- [ ] 文档同步（若涉文件写入约定）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做原子写统一重试。不改其它逻辑/格式/语义；不加新依赖；不重构无关代码。
- 若共享 helper 涉及包边界：放 packages/application（已被 apps/cli 与其它包依赖）或 packages/shared（只放纯函数），
  选型记录；**薄核**：core 包若依赖 application 会造成环——注意 Session.ts 在 packages/core，helper 需放 core 可
  依赖处（如 packages/shared 或 core 内部 util）——**选型时先查依赖图**，避免引入环。

## 涉及文件（指针，执行器自行精化，先 grep 依赖关系）

- `packages/core/src/session/Session.ts`、`packages/application/src/{project/ProjectRegistry,review/ReviewHandoffStore,
  session/SessionRegistry}.ts`（无重试点）
- 已治理点（可对照）：`apps/cli/src/usage/UsageStore.ts`(530)、`apps/cli/src/providers/{ProviderStore,pricingSync}.ts`、
  `apps/cli/src/usage/pricingOverride.ts`、`packages/application/src/credential/CredentialStore.ts`
- 共享 helper 候选位（先查依赖环）：`packages/shared/src/`（纯 fs 函数，core/application 均可依赖）或
  `packages/application/src/fs/`（若 core 不能依赖 application 则选 shared）

## 方法

- 先 grep 依赖图（Session.ts 能否依赖 shared/application）→ 选 helper 位置 → 提取共享实现 → 迁移 4 处无重试点
  （+可选迁移已有实现）→ 测试（mock 注入 rename）→ 连续 2 次全量验证

## 工作证明（执行器回填：helper 选址与理由/依赖环检查/diff/4 处迁移/测试输出/连续 2 次全量 0 failed 证据，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：