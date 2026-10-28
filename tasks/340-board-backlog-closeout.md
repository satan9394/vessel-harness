# 任务卡 340: 看板积压收口（248–279「待验收」对账）

- Status: 已完成（2026-10-26；17 步门禁全绿，见 §8）
- PDW task: none（协调者只读复核 + 文档收口；不派实现角色，不改产品代码）

## 1. Goal

`tasks/README.md` 与卡面有 20 余处长期停在「待验收 / 待协调者验收」，其中多张的交付在后续批次里已被实际使用和再验证，但状态没有回填；也有卡片（273）已经提交却仍写「执行中」。本卡把 248–279 区间的未收口项逐张在当前 HEAD 上复核，能收口的落「已验收」，不能收口的写清阻塞与替代路径，让看板重新成为可信的进度源。

## 2. Not Doing

- 不改产品代码、不改测试、不改配置（本轮 `git diff` 只允许出现 `tasks/*.md` 与 `HANDOFF.md`）。
- 不重跑每张卡当初的定向门禁；复核依据统一为「当前 HEAD 的全量门禁实跑 + 卡内证据文件在位 + 关键回归用例仍在树中」。
- 不把卡片自述当唯一依据：门禁数字只认本轮实跑。
- 不执行卡 260 / 275（需真实浏览器 / Codex IAB，属新的验证工作，不在收口范围）。
- 不为收口而放宽任何验收口径；复核不过的卡保持原状态并写明缺什么。

## 3. Acceptance

1. 被收口的卡，状态行改为「已验收（2026-10-26 对账；原状态…，依据见卡 340）」，历史正文不动。
2. `tasks/README.md` 表与 `HANDOFF.md` §0 与卡面一致；260 / 275 明确写阻塞原因与替代路径。
3. 复核依据可重跑：命令、数字、grep 结论都写在本卡，不依赖会话记忆。
4. 产品源码零改动（`git diff --stat -- packages apps benchmarks scripts configs` 只应出现文档）。

## 4. 复核方法（可重跑）

1. 全量门禁：`pwsh -NoProfile -File scripts/gate-batched.ps1`（日志落 `%TEMP%`，17 步：12 段根测试 + web root + 三处 tsc + 离线 conformance）。
2. 证据在位：本卡 §5 表里每张卡引用的 evidence 路径逐个 `Test-Path`。
3. 回归用例仍在树中：对每张卡抽查一条判别性用例名，确认 2026-10-26 的 HEAD 里仍存在（不是靠历史日志）。
4. 双份重建类结论（如 273 的性能）只认本轮门禁里该文件的实际耗时，不引用旧日志里的数字当现状。

## 5. 逐卡复核矩阵

结论口径：**收口** = 交付仍在当前 HEAD 成立且证据可查；**收口（带边界）** = 交付成立，但卡片自述的环境性限制仍然存在；**保持** = 验收条件当前不可满足。

| 卡 | 交付主张 | 当前 HEAD 复核依据 | 结论 |
|---|---|---|---|
| 248 | Taste 工作台审美升级 + 服务端回收回执 | 证据 `evidence/sessions/2026-10-20-codex-taste-elevation-248.md`（8.8 KB）在位；本轮门禁全绿，卡片自述的「两项 Windows 运行时失败」现不再出现 | 收口 |
| 249 | 236–248 独立对抗审计（F1–F8） | 证据 + 探针脚本 `…-probes.mjs`（8.5 KB）在位；F1/F2/F3 → 250，F4/F7 → 251，F5 → 252，F8 → 271 均已有落地卡；**F6 仍未处置**（见 §7） | 收口（带残留） |
| 250 | 会话完成态真实性 + 存储凭据目标绑定 | 证据 `2026-10-20-codex-task-250-proof.md` 在位；`/api/sessions/:id/messages` 与 Activity 八态投影用例在树 | 收口 |
| 251 | keepID 守恒接入生产 Compaction + IME 回车 | `packages/context/src/compaction/Compaction.test.ts` 的 `conserves summary and tail keepIDs…`、`assertCompactionConservation.test.ts` 负向用例、`ConversationView.interaction.test.tsx` 的 IME 用例均在树且本轮全绿 | 收口 |
| 252 | EffectJournal torn tail 自愈 + 装配失败租约回滚 | `EffectJournal.test.ts` 的 `repairs a torn tail while preserving durable intents…`、`composeActivation.test.ts` 的 `releases the session lease after synchronous and asynchronous assembly failures` 均在树且全绿 | 收口（带边界：卡片记录的 Windows 进程树环境抖动属环境性，见 §6） |
| 253 | 六场景内置浏览器实测（审计交付） | 证据 `2026-10-21-codex-browser-verification-report.md`（15 KB）+ 截图目录在位；其结论已由 254 与 261–272 两波修复承接 | 收口（审计交付） |
| 254 | BV-01 刷新保史 / BV-02 pending 误标 / BV-03/04 Activity | 证据 `2026-10-21-codex-task-254-proof.md` 在位；BV-01 由 263、272 真机复验补证，BV-02 由 258 八态投影，BV-03/04 由 `ActivityQueue` 与双语用例覆盖 | 收口 |
| 258 | 消除虚假完成信号（八态投影） | 卡片已含协调者独立复核段；`activityRoutes.test.ts` 的 `does not falsely mark empty or unknown sessions as completed`、`projects the eight-state contract` 在树且全绿 | 收口 |
| 259 | 删除跨阶段一致性（index-first + 补偿） | 卡片已含协调者独立复核段；`SessionRegistry` 补偿与 Web 逐项失败用例在树；真实删除另由第一波真机补证 | 收口 |
| 261–267 | 浏览器实测 7 项缺陷修复（删除回收、多行、终止提示、Activity 取消、首屏焦点、Mock 预设、英文残留） | 证据 `evidence/sessions/2026-10-23-fix-wave-report.md`（50 KB）+ 各条 `*-gates.json` 在位；判别性用例（`before native recycling`、`preserves pasted newlines…`、`restores %s termination…`、`distinguishes failure, cancellation and interruption…`、`focuses only an unclaimed input…`、`selects the built-in Mock preset…`、`localizes every English name…`）均在树且全绿 | 收口 |
| 268–272 | 第二波 5 项（工作区草稿、生效 Policy 只读、工具细节与 Stop、SSE 断线恢复、运行结果证据） | 同一份 fix-wave 报告；`isolates workspace drafts…`、`reads the bound policy and source hashes…`、`folds tool parameters by default…`、`replays a disconnected session cursor…`、`preserves cold %s run evidence…` 均在树且全绿 | 收口 |
| 273 | Compaction provenance 性能回归 | **已提交** `6df04ab`（2026-10-23）且带完整证据（`2026-10-23-task273-report.md`、gates、test-all 日志）；卡面停在「执行中」是漏回填 | 收口 |
| 274 | ARCH-09 一条命令跑完的可靠性 fixture 闭环 | `npm run bench:reliability` 本轮实跑 exit 0（见 §8）；证据 `evidence/sessions/2026-10-23-task274/PROOF.md` 在位 | 收口 |
| 278 / 279 | 工具失败不再锁死会话 / `vessel effects list\|resolve` | 卡面写「全量门禁由协调者跑」，本轮门禁已覆盖；定向探针由卡片留存 | 收口 |

## 6. 未收口（保持原状态）

| 卡 | 为什么保持 | 替代路径 |
|---|---|---|
| 260 | 需 Codex 应用内置浏览器（IAB）跑 UI-10 矩阵与端到端；本机 IAB 曾返回 `Browser is not available: iab` | 几何/布局部分已有 `scripts/ui-geom-check.mjs` 先例（本机 Chrome + `--no-sandbox --user-data-dir=<临时> --headless=new --disable-gpu`）；缩放与原生输入法仍只能真机 |
| 275 | 同上，且要求 150%/200% 真实缩放与完整 E2E 签收 | 同上；缩小视口冒充缩放属明令禁止 |

252 的「Windows 进程树门禁未通过」是环境抖动（`taskkill` 访问被拒 / pre-spawned grandchild 枚举），本轮 12 段门禁中 `runtime+memory` 段 exit 0（205 通过 + 1 条件跳过），不再复现；不据此宣称根因已消除。

**本卡范围外的同类陈旧项（下一批候选，未动）**：`tasks/README.md` 的「路线层」表里 170–181 与 183 仍写「本地全门禁通过；待验收」（2026-10-03 V1.5/V1.6 一批，其中 182/183 在另一行已标「已合入」），卡面首行同样停在「待验收」。这批与本卡同一性质（漏回填），但涉及 13 张卡与更早的证据，需要单独一轮核对，不要顺手标「已验收」。

## 7. 残留（已拍板，2026-10-26）

**F6（249 审计）生产侧永久删除边界**：`packages/core/src/session/Session.ts:113,278` 仍用 `fs.rmSync` 删 `.lease`；`packages/engine/src/workspace.ts:42-46` 仍用永久删除清理运行时工作区。属 core 保护范围，且 lease 是内部状态文件而非用户数据。

处置已定：**决策点 24（`docs/DESIGN-DECISIONS.md`）+ `docs/DELETION-AND-RETENTION.md`**。口径是三分：

1. 用户可感知的数据（会话目录、产物）→ 应用内暂存区，默认 7 天后由 `vessel trash purge` 永久删除（可 restore）；
2. 纯运行时临时文件（`.lease`、engine 临时工作区、sandbox 隔离目录）→ 允许直接删除，但必须证明「本进程创建、不含用户内容、可重建」，engine 的 dispose 要补所有权守卫；
3. 零散显式删除 → 仍走系统回收站；**永不读写系统回收站本体**。

实现拆在卡 [343](343-unify-recycle-primitive.md) → [344](344-f6-runtime-delete-ownership.md) → [345](345-app-trash-and-retention.md) → [346](346-deletion-retention-closeout.md)，本轮只落规则与设计，未写代码。

## 8. Result

已完成（2026-10-26）。25 张卡落「已验收」，`tasks/README.md` 与 `HANDOFF.md` §0 同步；产品源码零改动。

### 门禁（本轮实跑，最后一次文档编辑之前执行）

`pwsh -NoProfile -File scripts/gate-batched.ps1` → **17 步全 exit 0**（日志 `%TEMP%\vessel-gate-718b8fdf`）：

| 段 | exit | 结果 |
|---|---|---|
| shared+core | 0 | 30 文件 / 266 |
| llm | 0 | 20 / 336 |
| behavior+context | 0 | 18 / 164 |
| tools+policy | 0 | 31 / 324 通过 + 3 跳过 |
| runtime+memory | 0 | 24 / 205 通过 + 1 跳过 |
| skills+agents | 0 | 23 / 194 |
| telemetry+engine | 0 | 22 / 221 |
| application | 0 | 34 / 275 通过 + 2 跳过 |
| cli | 0 | 64 / 772 |
| local-server | 0 | 26 / 298 |
| benchmarks | 0 | 35 / 527 |
| root-index | 0 | 2 / 14 |
| web-root | 0 | 58 文件 / 519 |
| tsc-build / tsc-tests / tsc-web | 0 / 0 / 0 | — |
| conformance（离线） | 0 | 25 runs / 25 passed / cost $0 |

合计根 **329 文件 / 3602（3596 通过 + 6 跳过）**，Web **58 / 519**。6 个跳过全部是 `it.skipIf` 的环境守卫（npX/tsx E2E、junction 可建性、Windows-only 分支等），不是被隐藏的失败。

### 另两项针对卡面的实跑

- 卡 274：`npm run bench:reliability` → **14/14 passed，exit 0**，清单落在 `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/manifest.json`（工具自身设计的产物目录，保留）。
- 卡 273：`npx vitest run benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts` → **5 passed，Duration 9.80s（墙钟 10.38s），exit 0**；在 30s 钩子内，落在 15s 量级，与卡片要求一致。

### 证据与用例在位核对

- 23 个 evidence 路径（248/249/250/251/252/253/254/258/259 各卡 proof、`2026-10-23-fix-wave-report.md`、各批次 `*-gates.json`、`2026-10-23-task274/PROOF.md`）逐个 `Test-Path` 全部存在，无空文件。
- 判别性用例在当前 HEAD 仍存在（`grep` 命中）：`conserves summary and tail keepIDs…`、`rejects lost keepID anchor…`、`repairs a torn tail while preserving durable intents…`、`releases the session lease after synchronous and asynchronous assembly failures`、`restores %s termination on its message…`、`does not falsely mark empty or unknown sessions as completed`、`distinguishes failure, cancellation and interruption from %s`、`replays a disconnected session cursor…`、`preserves cold %s run evidence…`、`isolates workspace drafts…`、`reads the bound policy and source hashes…`、`folds tool parameters by default…`、`before native recycling`、`preserves pasted newlines…`、`focuses only an unclaimed input…`、`selects the built-in Mock preset…`、`localizes every English name…`、`projects the eight-state contract…`。

### 改动面

- `tasks/` 下 25 张卡的状态行（正文未动）+ `tasks/README.md` 表 + `HANDOFF.md` §0 三行 + 本卡。
- `evidence/sessions/task274-reliability-*/`（`bench:reliability` 自动产物）。
- 产品源码、测试、配置、依赖零改动。

### 未做（沿用 §6 / §7）

卡 260、275 仍未执行（需真实浏览器）；F6 未处置，等用户拍板。本轮不宣称 UI 缩放/无障碍/原生输入法已验收。
