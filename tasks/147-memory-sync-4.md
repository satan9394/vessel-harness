# 147 — 记忆同步 #4：落 145–146，重排外部项 148–151

- 编号：147
- 状态：已合入（2026-09-19）
- 优先级：P1（延续"每 1–3 卡同步一次"节奏）
- 创建日期：2026-09-19
- 关联：`tasks/145`、`tasks/146`、`docs/V1.6-STABLE-CHECKLIST.md`、`docs/product-evolution/PRODUCT-STATE.md`
- 执行器：指挥侧

## 1. 目标

卡 145（B1 真缺口修复）、146（B2–B5 已核实闭合）落地后，同步所有待办落点；
并按实况重排编号（B4/B5 已闭合，原计划的 147/148/149 收拢为 146；外部项顺延 148–151）。

## 2. 改动（纯文档）

| 落点 | 改动 |
|---|---|
| `tasks/README.md` | 路线表补 145–147；"未闭合/下一目标"记录**方向 B 结果**（B1 已修、B2–B5 已核实闭合），外部项重编为 148–151 |
| `AGENTS.md` | 版本状态补「真实模型 lane 接场景 policy + 残留 B2–B5 已核实闭合」，范围到 `tasks/146` |
| `CHANGELOG.md [Unreleased]` | `Fixed` 补 145；`Docs` 补 146/147 |
| `docs/V1.6-STABLE-CHECKLIST.md` | §未闭合清单「可自主」行注明：方向 B 的 B1 已修、B2–B5 已核实闭合 |
| `docs/product-evolution/PRODUCT-STATE.md` | 现状快照"近期闭合"补 145/146；"仍开放"补一句"B2–B5 已核实闭合" |
| `RUN_STATE.md` | Deferred 批次更新到 125–147，仍开放重列外部项（该文件被 `.gitignore` 覆盖，不进提交） |

## 3. 验收与实测

- 门禁（纯文档仍跑）：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` exit 0
  （根 **178 文件 / 2237 passed + 6 skipped**；web **11 / 120**）、web `vite build` exit 0、CLI 冒烟 exit 0。
- 核验：`tasks/README` 路线表含 145–147；`CHANGELOG [Unreleased]` 含 145（Fixed）与 146/147（Docs）；
  `PRODUCT-STATE` 快照"仍开放"含"B2–B5 已核实闭合"。

## 4. 边界

- 纯文档；不动代码、不动断言。
- 历史 Round 段（`PRODUCT-STATE` 第 12 行以下）不追改。
