# C5 突变实测：删哪行会红（**只在 `%TEMP%` 副本内**，真实工作树零变异）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：P1（评审 FAIL 的原始病根之一就是"缺突变实测"，纪律 24）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：planned

## 目标
用**变异测试**证明 C4 的两条新用例与既有 ⑯⑰ 是"绊线"而不是橡皮图章：删掉实现里的关键行 ⇒ 指定用例**必须变红**。两段原始输出都要留证。

## 做法（**真实工作树绝不参与变异**）
1. 在 `%TEMP%\composable-mut-<时间戳>\` 建工作树副本：`robocopy` 排除 `node_modules`（以及 `dist`、`.vitest` 等产物），再为需要的 `node_modules`（根；若有 `apps/web/node_modules` 也一并）建 **Junction**（`New-Item -ItemType Junction`），使副本可跑测试而无需重装依赖
2. **变异 1（必做）**：在副本内删除 `packages/telemetry/src/Telemetry.ts` 的 `case 'turn/end':` 分支（记录精确行号与删除内容）
   - 预期变红：既有 ⑯/⑰（纯回放、两侧同数）与 C4 重叠用例中依赖 `case 'turn/end'` 的断言（如 `replay.turns === 2`）
3. **变异 2（可选，预算允许再做 1 轮）**：在副本内去掉 `liveTurnIds` 去重（或等价的身份去重逻辑）
   - 预期变红：实时侧 `turns` 计数翻倍类断言（⑰ 的防重复计数 / C4 的 `live.turns === 2`）
4. 每次变异跑：`npx vitest run packages/telemetry --reporter=verbose`（**在副本内**），保留**完整原始输出**（不得先过滤再丢文件名）
5. 基线（绿）直接**复用 C4 的那次运行结果**（同一次编辑状态），不要为"基线"多跑一次真实树测试

## 限制条件 / 禁止事项
- **真实工作树零变异**：不得在 `C:\work\Vessel_Harness` 内改任何源码；变异只在副本内
- 真实树收尾必须证明未被污染：`packages/telemetry/src/Telemetry.ts` 的 SHA256 与开工前一致（C4 报告值 `c4f18bda…` 需与之一致或说明差异来源）
- 不得跑 `tsc -b` / `test:all`；本卡 vitest 运行 **≤2 次**（都在副本内）
- 不得 install / 改 lockfile / 对真实仓库做任何 git 状态变更 / 删除真实树文件
- 副本清理一律进回收站（不得用永久删除手段）
- 命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）

## 验收标准（客观门禁）
- [ ] 副本路径与创建方式（含 Junction 说明）
- [ ] **变异 1**：被删代码的行号与内容；变异跑输出中**变红的用例名与失败断言**（贴原文）
- [ ] 若做变异 2：同上
- [ ] 真实树未被污染：`Telemetry.ts` SHA256 前后对照（并附 `git status --short` 仍 9 项）
- [ ] 明确结论：C4 两条用例 + ⑯⑰ 是否**已用突变证明是绊线**（是/否 + 证据指针）
- [ ] 副本清理情况（回收站）

## 依赖
- 依赖任务卡：C4

## 预期证据（执行器回填）
- [ ] 副本创建命令与路径
- [ ] 两轮变异的删除内容 + 原始失败输出（红）
- [ ] 真实树哈希前后对照与 `git status --short`
- [ ] 绊线结论
- [ ] 偏差 / 未完成项

## 验收结论（Evaluator / 指挥会话回填）
- **PASS**（含一处**如实上报的缺口**，已立 C5b 补）
- 指挥侧独立复验：真实树 `Telemetry.ts` = `A6A0F935D978C261…`（与开工一致）、`git status` 仍 **9 项**、HEAD `ba173d4`；**真实 `node_modules/.vite/vitest/results.json` 两轮变异后 mtime（02:11:27）与哈希（`EB51AB72…`）未变** ⇒ 无写穿；TEMP 内 `composable-mut-*` 残留 **0**；证据三件套齐全（`C5-mutation-record.md` 7012 B + 两份日志）
- **已证的绊线**：变异 1（删 `Telemetry.ts:435-445` 的 `case 'turn/end':`）→ **3 failed / 24 passed**：⑯ `:746`、⑰ `:798`、C4② `:325`；变异 2（删 `:442` 的 `liveTurnIds` 去重行）→ **2 failed / 25 passed**：⑰ `:790`、C4② `:319`
- **诚实缺口**：**C4①（异常路径用例）不可判别** —— 该场景本就无 `turn/end` 记录，删分支对它天然无感；其真正绊线在 `AgentLoop.ts:462-463` / `:208-212` / `llm/retry` 落盘侧 → 已立 **C5b** 在副本内变异 `AgentLoop.ts` 补齐
- 方法论收获（已记）：整目录 Junction 会让 vitest 把 `node_modules/.vite/vitest/results.json` **写穿真实树**；必须**逐条 Junction** + 跳过 `.vite`。副本与排练目录均进回收站，回收后复查真实 `node_modules` 完好
- 偏差：副本排除 `.git`（telemetry 测试无 git 调用）；指挥侧已更正卡面过期哈希（`c4f18bda…` → 开工实测值）
- 执行器：子代理 a069a3a6