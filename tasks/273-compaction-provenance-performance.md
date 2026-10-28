# 任务卡 273: Compaction provenance 的性能回归修复

**状态**: 已验收（2026-10-26 对账；实现已提交 6df04ab 而卡面漏回填，证据见 [卡 340](340-board-backlog-closeout.md)）
**创建时间**: 2026-10-23
**执行者**: Codex (`gpt-6.1-sol`, medium + fast)
**协调者**: OpenCode

---

## 1. Goal (目标)

`benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts` 在默认 30s 钩子内重新跑通，
且**不削弱** ARCH-08 的 provenance 契约。

## 2. 已定位的事实（不要再重复二分）

- 全量测试在该 benchmark 上失败：`beforeAll` 30s 超时。
- 二分（每一步都用 stash 保工作树）：
  - 全部改动 stash 掉 → 12.93s 通过
  - 只 stash `packages/` → 11.08s 通过
  - 只 stash `packages/context/src/compaction/Compaction.ts` → 10.67s 通过
- 插桩后：新增的哈希/深拷贝每轮仅 3–18ms；真正成本是 `provenance` 进入消息 metadata 后，
  后续压缩把历史摘要连 metadata 一起重新序列化 → 摘要 4KB→56KB、待压缩 region 73→1068 条，超线性放大。
- 试过但**无效**：把 provenance 从 summary 文本里删掉（仍超时）；把 `sourceRefs` 改成区间（仍超时）。
- 试过且**不可用**：把 provenance 从 metadata 删掉 → 3.81s，但报 `Compaction evidence hash mismatch`。

## 3. 关键约束（违反即不通过）

1. `metadata.provenance` 必须保留，且既能被重算验证，也能被篡改检测。
2. 校验链条在 `packages/shared/src/projection.ts:75`：`provenance.sourceHash` 必须等于
   `canonicalArgumentsHash(该 seq 区间内、排除 compaction/start|end 的事件)`。
   若你修改哈希输入，**两侧必须同步改**，并保留「篡改 provenance 仍会被拒」的负向测试。
3. 不允许提高 benchmark 的 hook 预算、不允许改场景断言、不允许跳过该文件。
4. 不允许改 `packages/core`；若必须改，停下报告。

## 4. Acceptance Criteria (验收标准)

1. `npx vitest run benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts` 默认配置通过，
   耗时回落到 15s 以内的量级（基线 10.7–12.9s）。
2. `npx vitest run packages/context/src/compaction` 全绿（现有 70 项，含 `recovery-golden.test.ts`）。
3. 新增/保留一条负向测试：篡改 `provenance`（或 sourceHash 覆盖范围的记录）时仍然抛出
   `Compaction evidence hash mismatch` 或等价错误。
4. 门禁：`tsc -b`、`typecheck:tests`、`@vessel/web typecheck`、`npx vitest run apps/local-server`、`test:web`、web build；
   `npm run test:all` 由协调者跑。
5. `git diff --stat -- packages/core` 为空。

## 5. Blast Radius (影响面)

`packages/context/src/compaction/Compaction.ts`、`packages/shared/src/projection.ts`、对应测试与 benchmark 场景（仅限不改断言的辅助改动）。

## 6. Result

待执行。
