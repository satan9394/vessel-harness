# T332 — Codex CLI 四道并行执行计划（E–Q 十三段）

- Status: 待执行（2026-10-26）
- 依据：`tasks/CODEX-PROMPT-ROUND2.md`（十三段的权威执行单）+ `AGENTS.md` 选型表

## 模型与档位（按 AGENTS 选型表，逐条记录依据）

| 道 | 段 | 文件集 | 模型 ID | 档位 | 依据 |
|---|---|---|---|---|---|
| L1 | E → F → J → Q → L → P | UsageStore / server / api / modal / i18n | `gpt-6.1-sol` | `medium` | 多文件协调、预期返工 |
| L2 | G → H → K → M | cli.ts / ProviderStore / 各自测试 | `gpt-6.1-sol` | `medium` | 删除级联与 rename 有取舍 |
| L3 | I（往返保真测试） | 新 `providerRoundTrip.test.ts` | `gpt-6.1-terra` | `low` | scoped fix / 纯测试 |
| L4 | N（API/CLI 一致性） | 新 `profileParity.test.ts` | `gpt-6.1-terra` | `low` | 同上 |
| L5 | D（文档） | 三份 docs | `gpt-6.1-terra` | `medium` | 基于给定材料的简明写作 |

- **Fast 关闭**：`service_tier = "default"`（2026-10-26 确认）。
- **探测**：首次使用 `gpt-6.1-terra` 前跑一次 `codex exec -m gpt-6.1-terra "print OK"`；档位不被接受则用它默认档并记录。
- **升级**：H/J/Q 首轮红 → 同段 `gpt-6.1-sol` + `xhigh` 重跑一次；再红才 `gpt-6-astra`，每次都留失败命令作证据。

## 命令形态

```
codex exec --sandbox workspace-write -C E:\Code_file\Projects\Vessel_Harness \
  -m <model> -c model_reasoning_effort="<effort>" \
  "阅读 tasks/CODEX-PROMPT-ROUND2.md。只做其中 <段列表>，遵守该文件的约束、并发写表与 Done 判据。
   只跑这些段的 Verify 命令；不要跑全量门禁；不要 commit。最后按该文件的报告格式给这几行。"
```

## 并发与冲突

- L1–L4 可同时起（文件集互不重叠）；L5 等 L1/L2 完成后串行。
- 全量门禁（11 批 + `index.test.ts` + web root + 三处 tsc）**只由协调者跑一次**。
- 若出现限流或同一文件被两方改动，立即降到两条道并记原因。

## 收口（由协调者）

1. 收齐四道 → 逐道看报告与 `git diff`；
2. 跑 16 条全量门禁；
3. 红项按升级阶梯定向重跑；
4. 全绿后提交（按卡拆分），同步 `tasks/README.md` 与 `HANDOFF.md`；
5. 交 PDW：`review` 角色（OC/DeepSeek）对已提交 diff 做独立复核，`scan` 只读复核范围；复核不通过则回退提交前状态重做。

## Result

（待执行）
