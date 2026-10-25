# T283 — PDW 角色路由与口径收口（AGENTS.md 单一源）

- Status: 已完成（2026-10-24，本会话手工执行；未提交、未推送）
- PDW task: none（文档收口，未走运行器）
- Mode: standard（文档/流程收口，非产品功能）
- Source: human-requested
- Risk: low（只改规则与索引，不碰产品源码、不改 PDW 技能本体）

## Goal

把 PDW 的角色、模型、思考档位与写权限收敛成 `AGENTS.md` 里的一张表，替换掉与之冲突的"项目锁定模型"表述；同时修掉交接文档里会误导执行者的旧口径，并落地六条流程规则：

1. 角色/模型/等级/权限的唯一事实源在 AGENTS.md，协调者模型不锁定。
2. 思考档位按后端分列（GPT 五级 vs DeepSeek `low/high/max/off`），不可互套。
3. 任务卡→PDW 契约单向派生：卡加 `PDW task: <id>` 字段，卡写目标/验收/范围，契约是冻结副本。
4. 越界以 `state.json` 的 artifact 指纹为准；`new` 前已存在的未提交改动用契约的 `baseline_dirty` 字段登记，不算实现者越界。
5. 证据落盘：checks 只写 `%TEMP%`；验收后在卡的结果段写摘要 + accepted artifact 哈希，不复制生成物进仓库。
6. 旧状态 `.agent-state/run-state.json`、`RUN_STATE.md` 标 LEGACY，只读、不作为汇报来源。

并记录本机实测适配事实（OC 2.1.4 / codex-cli 0.164.0 / `#variant` 可用 / `init` 探测不到模型）。

## Not Doing

- 不改 `.agents/skills/personal-dev-workflow/` 任何文件（上游所有，`update.mjs` 会覆盖）。
- 不改 `.pdw/config.json`（卡 285）。
- 不改 `HANDOFF.md`、`tasks/README.md`、卡 224（卡 284）。
- 不碰 `apps/`、`packages/`、`benchmarks/`、`configs/`。
- 不 commit / 不 push / 不删除任何文件。

## Acceptance

- AC1：`AGENTS.md` 含「执行角色与模型路由（PDW）」一节，六行角色表与 `.pdw/config.json` + `doctor` 输出一致（OC flash `#high` ×2、Codex medium、OC `#max`、OC `#high`）。
- AC2：以下表述不再出现——"当前锁定开发模型"、"每张任务卡一个隔离执行器（DSH 子代理默认）"、把五级思考表当通用表、以 `.agent-state/run-state.json` 为真相源。
- AC3：六条流程规则各自可检索（`PDW task:`、`baseline_dirty`、`%TEMP%`、`LEGACY`、档位按后端分列、协调者不锁模型）。
- AC4：本机适配表记录 4 条实测事实与核对日期/方式。
- AC5：本次改动只落在 `AGENTS.md` 与本卡。

## Blast Radius

`AGENTS.md`（角色表 + 工作流条目 + 记录纪律 + 技能同步节）、`tasks/283-pdw-role-routing-single-source.md`。回滚：`git checkout -- AGENTS.md` + 回收站删除本卡。

## Expected Evidence

`node -e` 断言的 stdout（缺席/在场短语、表格行、六条规则关键词）、`git diff -- AGENTS.md`、`git status -sb`。

## Result

已完成。`AGENTS.md` 新增「执行角色与模型路由（PDW）」：六行角色表（协调者不锁模型 / scan `#high` / test-plan `#high` / Codex medium / review `#max` / planner `#high`）、按后端分列的档位说明、模型长处分工与 Codex 提示规约；新增「PDW 本机适配」5 条实测（`opencode v2.1.4` / `codex-cli 0.164.0` / `#variant` 可用 / `init` 的 `config.provider` 缺陷 / 技能正文历史事实）。工作流条目改为「DSH 仅辅助模式」、run-state 标 LEGACY、goal 只属于协调者；记录纪律新增 PDW 卡字段、`baseline_dirty` 指纹口径、`%TEMP%` 证据规则；技能同步节改成"两份副本各归谁读 + 更新后必须同步并核 sha256"。

验证：`node C:\work\AppData\Local\Temp\opencode\check-agents-pdw.mjs` → `{"missing":[],"bannedPresent":[],"bytes":16789}`，exit 0。改动范围 `git status` 只有 `AGENTS.md` 与本卡。

未验证：没有跑机器门禁——本次只改 Markdown，不触及 `tsc -b` / `test:all` 的图。

