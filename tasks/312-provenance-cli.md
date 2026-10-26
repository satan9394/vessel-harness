# T312 — provenance 清单的生成与检查入口

- Status: 已完成（2026-10-26；PDW 任务 `20261026084254-64cb48` `accepted_local`，第一次尝试因模型输出两版 JSON 加独白失败并已归档；未提交、未推送）
- PDW task: none
- Mode: standard（加 CLI 入口 + 测试，不接 gate）
- Source: 卡 303 的遗留（清单只能手写脚本重生成）+ 评估报告 P2-2
- Risk: low（只加入口，不改既有行为）

## Goal

`configs/benchmark-provenance.json` 现在只能靠一次性脚本重生成。给它一个**可复用、可脚本化**的入口：`--write` 重写清单，`--check` 比对并给出差异摘要。改 fixture 的人不必再手写 `node -e`。

## Not Doing（重要，别越界）

- **不新增第 9 道 release gate**。`run-release-gates.ts:157/461` 与 `gates.ts` 的 8 门注册表是既有决策，评估报告里的「单独成一个 gate 文件」与此冲突，以项目现状为准。
- 不改既有 8 门、不改 `release-gates.test.ts` 的门数断言。
- 不动 `spec-manifest-parity`、不改 `collectProvenance` / `diffProvenance` 的既有语义。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`。

## 设计

1. `benchmarks/runners/src/provenance.ts`：
   - 新增并导出 `export function writeProvenance(repoRoot: string): ProvenanceManifest`（写出 `configs/benchmark-provenance.json`，`version: 1`，`generatedAt` 为当前 ISO，`entries` 为 `collectProvenance(repoRoot)`）。
   - 新增并导出 `export function checkProvenance(repoRoot: string): { ok: boolean; manifest: ProvenanceManifest | null; diff: { missing: string[]; extra: string[]; changed: string[] } }`：清单缺失或损坏 → `ok: false`、`manifest: null`、diff 全空（调用方据此区分「没有清单」与「有差异」）。
   - 增加直接运行入口（`if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))`）：
     - `--write [--project <dir>]` → 写清单并打印 `wrote <n> entries`，exit 0。
     - 默认/`--check` → 打印 `ok: <n> entries match` 或按 `missing` / `extra` / `changed` 分组打印（每组最多 10 条，超出写 `… and N more`），有差异 exit 1；清单缺失打印 `no manifest; run with --write` exit 1。
2. 文档：`docs/BENCHMARK-SPEC.md` 的三轴/完整性清单那节（卡 302/303 新增的段落附近）补 3–5 行，写明两条命令与「清单过期不会被 gate 拦，但 `provenance.test.ts` 的真实仓库自证用例会红」。

## Acceptance

- AC1：`writeProvenance` 与 `checkProvenance` 导出且语义如上；`collectProvenance` / `diffProvenance` 的行为不变。
- AC2：直接运行 `node node_modules/tsx/dist/cli.mjs benchmarks/runners/src/provenance.ts --check` 在仓库根 exit 0，输出包含条目数。
- AC3：`--write` 之后紧接着 `--check` 仍 exit 0（幂等）。
- AC4：测试（扩 `provenance.test.ts`，用临时 repoRoot）：清单缺失 → `ok:false` 且 `manifest:null`；写后 `ok:true`；改一个文件后 `changed` 命中；新增文件后 `extra` 命中；删除后 `missing` 命中。
- AC5：`tsc -b`、`typecheck:tests`、定向 vitest 全部 exit 0。

## Blast Radius

`benchmarks/runners/src/provenance.ts`、`benchmarks/runners/src/provenance.test.ts`、`docs/BENCHMARK-SPEC.md`、`configs/benchmark-provenance.json`（仅在 `--write` 被显式调用时变化；本卡测试用临时目录，不动真清单）。回滚 `git checkout -- <上述文件>`。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、两条 CLI 的真实输出与退出码、PDW review 结论；协调者另跑全量。

## Result

已完成。`provenance.ts` 新增 `writeProvenance(repoRoot)`（写 `configs/benchmark-provenance.json`：`version: 1` + 当前 `generatedAt` + `collectProvenance` 结果）与 `checkProvenance(repoRoot)`（清单缺失/损坏 → `ok: false`、`manifest: null`、diff 三组为空，好让调用方区分「没有清单」与「有差异」），并加直接运行入口：`--write` 打印 `wrote <n> entries` 并 exit 0；`--check`（默认）一致时打印 `ok: <n> entries match` exit 0，有差异按 missing/extra/changed 分组（每组最多 10 条，超出写 `… and N more`）并 exit 1，清单缺失打印 `no manifest; run with --write` exit 1；两者都支持 `--project <dir>`。

真实仓库验证：`node node_modules/tsx/dist/cli.mjs benchmarks/runners/src/provenance.ts --check` → `ok: 111 entries match`、exit 0。

**没有新增 release gate**：`run-release-gates.ts` 与 `gates.ts` 的 8 门注册表是既有决策（`release-gates.test.ts` 三处 `toHaveLength(8)` 保持不动），评估报告「单独成一个 gate」的建议与本项目现状冲突，以现状为准。清单过期仍由 `provenance.test.ts` 的真实仓库自证用例抓到（等价于由 `unit` 门覆盖）。

PDW 任务 `20261026084254-64cb48`：`accepted_local`，4 次调用、0 修复；第一次尝试（`20261026083542-b625ad`）因模型在最终输出里塞了两版 JSON 加一段自我检查独白而解析失败，已归档。验收：定向 **10 passed**；`tsc -b`、`typecheck:tests` exit 0；全量根 **316 文件 / 3372 passed + 6 skipped**、web **58 / 494**。
