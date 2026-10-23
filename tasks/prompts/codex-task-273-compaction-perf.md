# Codex 执行契约：卡 273 Compaction provenance 性能回归

仓库 `E:\Code_file\Projects\Vessel_Harness`。分支 `main`，工作树已有未提交改动（属于前一轮规范补齐，**保留，不要回滚**）。

## 先读

1. `tasks/273-compaction-provenance-performance.md` —— 唯一权威范围与验收。
2. `packages/context/src/compaction/Compaction.ts`（约 112–160 行，provenance 的构造与注入）
3. `packages/shared/src/projection.ts:75`（哈希校验的另一侧）
4. `packages/context/src/compaction/recovery-golden.test.ts`（契约断言）

## 问题

`benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts` 的 `beforeAll` 有 30s 钩子，
现在必超时。已二分确认是 `Compaction.ts` 引入的：写入 `provenance` 后，后续每次压缩都把历史摘要
连同其 metadata 重新序列化，region 从 73 条涨到 1068 条、摘要 4KB 涨到 56KB，超线性。

已验证无效或不可用的尝试（不要重做）：
- 删掉 summary 文本里的 provenance 行 → 仍超时
- `sourceRefs` 改成区间 → 仍超时
- 删掉 `metadata.provenance` → 3.8s 但报 `Compaction evidence hash mismatch`

## 期望方向

让「历史摘要」不再把 `metadata.provenance` 计入下一轮压缩的输入（summary 文本、`sourceHash` 计算、
以及 `projection.ts` 的校验范围），同时保证：
- 消息上的 provenance 仍存在、仍可被独立重算；
- 篡改 provenance 或篡改覆盖范围内的记录，仍然被拒绝。

如果两侧都要改（Compaction + projection），就同步改，并补一条负向测试证明篡改仍会失败。
如果发现更小且不破坏契约的做法，可以用，但必须在最终回复里说明理由与被否方案。

## 硬约束

- 不改 `packages/core`；不改 benchmark 的 hook 预算；不改场景断言；不跳过该文件。
- 不 commit、不 push、不跑 `npm run test:all`。
- 不引入新依赖。

## 必须交付

1. 修复 + 负向测试（篡改必失败）。
2. 计时证据：修复前后该 benchmark 的耗时（默认配置下）。
3. 门禁逐条退出码：`tsc -b`、`typecheck:tests`、`@vessel/web typecheck`、
   `npx vitest run apps/local-server`、`npm run test:web`、`npm run -w @vessel/web build`。
4. `git diff --stat -- packages/core` 输出（必须为空）。

## 完成判据

卡 273 五条验收全部成立。做不到就说明卡在哪，不要宣布完成。
