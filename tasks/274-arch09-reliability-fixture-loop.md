# 任务卡 274: ARCH-09 可靠性 fixture 闭环

**状态**: 已验收（2026-10-26 对账；`npm run bench:reliability` 实跑 exit 0，依据见 [卡 340](340-board-backlog-closeout.md)）
**创建时间**: 2026-10-23
**执行者**: Codex (`gpt-6.1-sol`, medium)
**协调者**: OpenCode

---

## 1. Goal (目标)

把散落在各卡里的可靠性验证，收敛成**一条命令可跑的 10–20 个最小 fixture 闭环**，并产出可复核的清单与证据。

规范（`docs/VESSEL_Architecture_Review_and_Execution_2026-10-20.md` §3 ARCH-09）要求覆盖：
失败后重试成功、崩溃、删除（软删）、真实 adapter 不可用、未知工具调用、事件重放、不同模型能力协商。

## 2. 现状（先核对，不要重造）

- `benchmarks/scenarios/` 已有 25 个场景（B001–B027、S001–S008），`benchmarks/fixtures/` 有对应工作区。
- 已有 `npm run bench` 与 `npm run bench:conformance`。
- 审计判「部分实现」的原因不是数量不够，而是：**没有一份显式覆盖映射、没有统一的证据产物、没有记录 SHA/版本、live 与离线边界不清**。

## 3. Acceptance Criteria (验收标准)

1. 新增一条命令（建议 `npm run bench:reliability`），**离线**跑完选定的 10–20 个 fixture，退出码 0/1 语义明确。
2. 产出机器可读清单（JSON），每个 fixture 至少含：`id`、覆盖类别、`outcome`、证据文件路径、失败原因（若有）。
3. 清单头部记录：`git rev-parse HEAD`、Node 版本、npm 版本、运行时间戳；**历史结果不得冒充当前 HEAD 证据**。
4. 七类覆盖必须齐全；缺任何一类，命令必须以非 0 退出并明确报「缺少类别 X」。不要用「数量够」冒充覆盖。
5. live 场景默认排除；仅当显式传 `--live` 且用户已单独授权时才运行，且清单里要标注 `live`。
6. `docs/BENCHMARK-SPEC.md` 增补一节：这套闭环覆盖什么、不覆盖什么、如何复现、证据在哪。
7. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`npm run test:all` 由协调者跑；你至少跑 `npx tsc -b` 与新增命令本身。

## 4. Not Doing (非目标)

- 不新增产品行为、不改 `packages/core`、不改既有 scenario 的判据。
- 不为了凑「七类齐全」而把弱断言包成新 fixture；没有就如实报缺。
- 不运行 live（真实供应商/真实外部 CLI）。

## 5. Blast Radius (影响面)

`benchmarks/runners/src/`（新增 runner 或复用）、`benchmarks/scenarios/`（仅补缺口）、`package.json`（新增 script）、`docs/BENCHMARK-SPEC.md`、证据目录 `evidence/sessions/`。

## 6. Result

已实现 `npm run bench:reliability`，复用 14 个既有确定性 fixture，覆盖七类；
逐项 JSON、SHA/工具版本/工作树与源 hash、缺类/跳过/失败拒绝、offline-only 边界与规范已落盘。
执行证据、两次一致性比较、定向门禁、限制和回滚指针统一见
[`evidence/sessions/2026-10-23-task274/PROOF.md`](../evidence/sessions/2026-10-23-task274/PROOF.md)。
未改 core / 既有 scenario，未运行 live 或 `test:all`，未 commit/push；最终全量验收由协调者负责。
