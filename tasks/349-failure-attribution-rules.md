# T349 · 失败归因固化：运行期不动仓库 + 契约先自检

- Status: 已完成（2026-10-26）
- PDW task: none（规则文档，未走运行器）
- Mode: standard
- Source: human-requested
- Risk: low（只改 AGENTS.md 两条规则）

## Goal

把 2026-10-26 归因统计里占比最大的两类失败变成可执行约束，避免下次再靠"升档"硬顶：

1. **Source drift（6 次 / 129 次派发，最大单一失败源）**：任务 `running` 期间不要编辑仓库里被 scope 覆盖的文件；`pdw.mjs` 每个阶段都比对产物指纹，改了就以 `Source drift detected` 失败。要改先 `cancel` 或等结束。
2. **契约自相矛盾（5 次 blocked 里至少 3 次）**：AC 之间、AC 与 `notes` 不得互斥；模型如实报 `blocked` 是契约问题，不是模型能力问题，先改卡再新建任务。

## Not Doing

- 不改 `pdw.mjs`（加"运行中锁仓库"属机制，需走上游）。
- 不删除历史任务证据。

## Acceptance

- AC1：`AGENTS.md` 的「PDW 本机适配」段含"任务运行期间不要编辑仓库"与"契约先自检再冻结"两条，均可 grep。
- AC2：两条都给出实测数字（6 次漂移 / 5 次 blocked 中 3 次）而不是形容词。
- AC3：改动只在 `AGENTS.md`。

## Blast Radius

`Vessel_Harness/AGENTS.md`（两条 bullet）。回滚：`git checkout -- AGENTS.md`。

## Expected Evidence

grep 命中行号。

## Result

已完成。在 `AGENTS.md`「PDW 本机适配」末尾加了两条 bullet，都带 2026-10-26 的实测数字：漂移 6 次（129 次派发里的最大单一失败源）、blocked 5 次里至少 3 次是契约矛盾。两条都写明"先 cancel / 先改卡，不要靠升档硬顶"。

未做：运行期锁仓库需要改 `pdw.mjs`（机制），未在本卡处理。
