# T285 — PDW 配置收口：角色档位、限额与一次真实冒烟

- Status: 已完成（2026-10-24，配置手工改 + 一个真实 PDW 任务；未提交、未推送）
- PDW task: 20261024155859-108eea（`accepted_local`）
- Mode: standard（配置 + 决策记录 + 运行器冒烟）
- Source: human-requested
- Risk: medium（改 `.pdw/config.json` 的档位与限额；真实模型调用会消耗配额）

## Goal

按 2026-10-24 拍板的角色表收口项目配置，并用一次最小真实任务证明路由仍成立：

1. 备份 `.pdw/config.json` 到 `.pdw/skill-upgrade-20261024/config.json.bak-role-routing-20261024`。
2. 只改三处：`scan`、`test-plan` 各加 `reasoning_effort: "high"`；`limits.max_cli_calls` 8→10；`limits.call_timeout_seconds` 1800→2700。`implement`、`review`、`planner` 与 `task_timeout_seconds`、`max_repairs`、`cost` 不动。
3. `doctor` 必须 exit 0、五角色 ready，且 `effective_model` 为：scan/test-plan/planner `#high`、review `#max`、implement `gpt-6.1-sol` medium。
4. 派生一个只改 `docs/DESIGN-DECISIONS.md` 的 PDW 任务（`planner: false`），交付「决策点 22：PDW 角色路由与本机执行体」，走完 scan→test-plan→implement→review 并达到 `accepted_local`。
5. 把任务 ID、artifact 哈希、三条 check 的结果写回本卡；`AGENTS.md` 的「21 决策点」计数改为 22。

## Not Doing

- 不改 `.agents/skills/personal-dev-workflow/` 与镜像（上游所有）。
- 不改产品源码（`apps/`、`packages/`、`benchmarks/`）。
- 不动 `implement` / `review` / `planner` 的模型与档位；不调 `task_timeout_seconds` / `max_repairs` / `cost`。
- 不 commit / push，不删除任何文件。
- 冒烟任务失败时如实记录失败阶段与原始日志，不用手工改 `state.json` 冒充通过。

## Acceptance

- AC1：备份文件存在，内容为改动前配置（`max_cli_calls: 8`、`call_timeout_seconds: 1800`、scan/test-plan 无 `reasoning_effort`）。
- AC2：`.pdw/config.json` 仅上述三处变化，其余字段逐字节语义不变（键序与值）。
- AC3：`pdw.mjs doctor --project .` exit 0；五角色 `ready: true`；`effective_model` 与角色表一致。
- AC4：冒烟任务 `status` 为 `accepted_local`，其 `contract.scope` 只有 `docs/DESIGN-DECISIONS.md`，`review` 对每条 AC 给出 pass + 证据。
- AC5：`docs/DESIGN-DECISIONS.md` 新增「决策点 22」，位置在「决策点 21」之后、「附录」之前；内容覆盖六项拍板（角色表、档位分列、卡↔契约、baseline_dirty、证据落盘、legacy）与限额 10/2700。
- AC6：`AGENTS.md` 目录结构行的「21 决策点」已改为「22 决策点」。

## Blast Radius

`.pdw/config.json`（gitignored）、`.pdw/skill-upgrade-20261024/config.json.bak-role-routing-20261024`、`docs/DESIGN-DECISIONS.md`（经 PDW 任务）、`AGENTS.md`（一行计数）、`tasks/285-*.md`、`.pdw/tasks/<新 id>/`。回滚：用备份覆盖 config + `git checkout -- docs/DESIGN-DECISIONS.md AGENTS.md`。

## Expected Evidence

`doctor` JSON、`pdw plan/status` 输出、新任务目录的 `checks-*/` 日志与 `REPORT.md`、`git diff -- docs/DESIGN-DECISIONS.md AGENTS.md`。

## Result

已完成，四项验收全部有机器证据。

配置：备份在 `.pdw/skill-upgrade-20261024/config.json.bak-role-routing-20261024`（旧值 8 次 / 1800 秒、scan/test-plan 无档位）；新配置只改三处——scan、test-plan 各加 `reasoning_effort: "high"`，`max_cli_calls` 8→10，`call_timeout_seconds` 1800→2700。`doctor` exit 0，五角色 ready，`effective_model` 依次为 `...#high` / `...#high` / `gpt-6.1-sol` / `...#max` / `...#high`。

冒烟任务 `20261024155859-108eea`：`accepted_local`，4 次调用、0 次修复、约 11 分 10 秒，artifact `eaf3251cb4e3819885aca404c398c46ec23dc29e3d658c0273a5ba854f21324f`。四个 attempt 的实际路由与角色表一致（scan/test-plan `#high`、implement `gpt-6.1-sol`/medium、review `#max`）。契约 check `adr22` exit 0（`adr22 ok {p21:42526,p22:43762,sectionBytes:1789,fileBytes:47044}`）；review 对 AC1–AC4 全部判 pass、0 findings，并逐条给出原始日志与行号。`baseline_dirty` 起作用了：复核明确以 artifact 指纹判定，AGENTS/HANDOFF/224/README 的存量改动没有再被当成越界。

交付物：`docs/DESIGN-DECISIONS.md` 新增「决策点 22：PDW 角色路由与本机执行体」（`git diff --numstat` = `23 0`，纯新增，位置在 21 之后、附录之前）；`AGENTS.md` 的「21 决策点」同步为「22 决策点」。

未验证 / 边界：`doctor` 只证明二进制与配置就绪，不证明供应商实际采用了请求档位；本轮只跑一个文档任务，没有覆盖代码类任务与 UI checks 路径。

