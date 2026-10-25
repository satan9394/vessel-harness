# T284 — PDW 交接与索引减重（HANDOFF / 卡 224 / tasks:README）

- Status: 已完成（2026-10-24，本会话手工执行；未提交、未推送）
- PDW task: none（文档收口，未走运行器）
- Mode: standard（文档/索引收口）
- Source: human-requested
- Risk: low（只改交接文档与索引，不碰产品源码与配置）

## Goal

把三处会误导接手者的旧口径收掉，并让索引只剩一个入口：

1. `HANDOFF.md` §0 只留现状指针：PDW 模型细节不再抄一遍，改为指向 `AGENTS.md` 角色表；删掉"根据 `.agent-state/run-state.json` 汇报"的过期指令；2026-10-14 的"实现移交 OC + 模型锁定"段落明确标历史；`HANDOFF.md:55` 的"待维护者拍板"改成已定案指针；`HANDOFF.md:184` 的"主力模型锁定 Codex"同样改为指针。
2. `tasks/README.md` 两段"最近交付"（:11 停在 259、:15 停在 277）合并成一段并更新到 283/284；"卡命名"节补 `PDW task` 字段规则。
3. 卡 224 的 1.3.2 续节加历史横幅：`workbuddy`、`planner=agy`、旧 codex 路径、`opencode 2.0.32` 已全部过期，但它仍是 `.pdw/config.json` 的唯一在库来源，不能删，只能标注。
4. 归档孤儿契约 `.pdw/tasks/contracts/codex-invocation-doc.json`（无对应任务、notes 与事实相反）：移到 `contracts/archive/` 并加 `.draft` 后缀，不删除。

## Not Doing

- 不改 `AGENTS.md`（卡 283 已收口）。
- 不改 `.pdw/config.json`（卡 285）。
- 不回答 `HANDOFF.md:14` 的远端/推送口径冲突（需用户另拍板，保持原样）。
- 不碰产品源码、不 commit / push、不删除任何文件。

## Acceptance

- AC1：`HANDOFF.md` 不再出现"根据本段与 `.agent-state/run-state.json` 汇报"；PDW 行只留一句状态 + 指向 AGENTS 角色表；`待维护者拍板` 与"主力模型锁定为 Codex"两处改为已定案指针；2026-10-14 模型段带历史标记。
- AC2：`tasks/README.md` 只有一段"最近交付"，且提到 283/284；"卡命名"节含 `PDW task: <id>` 规则。
- AC3：卡 224 的 1.3.2 续节有历史横幅，声明当前口径以 `.pdw/config.json` + AGENTS 角色表为准。
- AC4：孤儿契约已移到 `contracts/archive/`，原路径不存在，文件未删除。
- AC5：改动只落在上述文件（+ 本卡 + `.pdw` 内归档）。

## Blast Radius

`HANDOFF.md`、`tasks/README.md`、`tasks/224-pdw-1.3.1-local-adoption.md`、`tasks/284-pdw-handover-and-index-slimming.md`、`.pdw/tasks/contracts/codex-invocation-doc.json`（移动）。回滚：`git checkout -- <三个文档>` + 把归档文件移回原路径。

## Expected Evidence

`node` 断言 stdout（过期短语缺席、指针在场、README 段落数、卡 224 横幅、归档路径存在/原路径不存在）、`git diff --stat`、`git status -sb`。

## Result

已完成。`HANDOFF.md`：PDW 行改成一句状态 + 指向 AGENTS 角色表；"根据 run-state.json 汇报"标作废；2026-10-14 分工与模型锁定两条标历史；`HANDOFF.md:55` 的"待维护者拍板"改成"2026-10-24 定案"；文末"主力模型锁定 Codex"改成角色表指针；最后更新改为 2026-10-24。`tasks/README.md`：两段"最近交付"合成一段（停在 283/284），卡命名节补 `PDW task: <id>` 规则。卡 224 的 1.3.2 续节加历史横幅。孤儿契约移到 `.pdw/tasks/contracts/archive/codex-invocation-doc.draft.json` 并留 README（原路径已不存在，文件未删除）。

验证：`node C:\work\AppData\Local\Temp\opencode\check-pdw-handoff.mjs` → `{"total":17,"failed":[]}`，exit 0。改动范围当时只有 AGENTS/HANDOFF/224/README 与两张新卡（卡 285 随后追加 `docs/DESIGN-DECISIONS.md` 与第三张卡）。

未验证：同样没跑机器门禁——本次只改 Markdown。`HANDOFF.md:14` 的远端/推送口径冲突按 Not Doing 保持原样，等用户另行拍板。

