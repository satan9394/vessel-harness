# T347 · Codex 项目级子 Agent 落地与验证

- Status: 已完成（2026-10-26）
- PDW task: none（项目级 Codex 配置，未走运行器）
- Mode: standard（配置 + 一次最小验证）
- Source: human-requested
- Risk: low（只新增 Vessel 内的 `.codex/` 文件与 .gitignore 一条；不动全局配置、不改产品代码）

## Goal

在 Vessel 里建立**只对本项目生效**的 Codex 子 Agent 配置，并把"子 Agent 真的按指定模型跑"这件事验出来。

1. `Vessel_Harness/.codex/config.toml`：`[features] multi_agent = true`；`[agents] default_subagent_model = "gpt-6-luna"`、`default_subagent_reasoning_effort = "high"`、`max_concurrent_threads_per_session = 4`。
2. `.codex/agents/pdw-explorer.toml`：`name = "pdw_explorer"`，Luna + high，只读探索，禁止改文件。
3. `.codex/agents/pdw-ui-verifier.toml`：`name = "pdw_ui_verifier"`，Terra + medium，浏览器/视觉证据，禁止改业务代码。
4. `.gitignore` 加 `.codex/`（与 `.pdw/` 同口径：本机模型路由不进仓库）。

## Not Doing

- 不改 `~/.codex/config.toml`（全局默认仍是 Terra/medium，与本任务无关）。
- 不把 review 换到 Codex；不改 `.pdw/config.json`（卡 348）。
- 不默认让每个任务都开子 Agent；只在契约显式要求时用。
- 不 commit / push，不永久删除任何文件。

## Acceptance

- AC1：三个文件存在，`codex` 能正常加载（`codex exec` 不报 config 解析错误）。
- AC2：一次最小任务里成功 spawn `pdw_explorer`，且会话记录显示它用的是 `gpt-6-luna`/`high`，不是父会话的 `gpt-6.1-sol`。
- AC3：子 Agent 没有修改任何文件（工作树在测试前后一致）。
- AC4：`.codex/` 已被 git 忽略（`git check-ignore` 命中）。
- AC5：若 AC2 不成立（版本回归），如实记录，配置保留但标注"未验证生效"。

## Blast Radius

`Vessel_Harness/.codex/`（新增）、`Vessel_Harness/.gitignore`（一条）。回滚：删除 `.codex/`（回收站）并撤回 .gitignore 一行。

## Expected Evidence

`git check-ignore` 输出、`codex exec` 的 stdout/rollout 路径、rollout 里 `subagent:thread_spawn` 与模型字段、`git status --short` 前后对比。

## Result

已完成（2026-10-26）。三个文件已建，`.codex/` 已进 `.gitignore`（`git check-ignore` 命中 `.gitignore:62`）。

最小验证：以 `codex exec --sandbox read-only -m gpt-6.1-sol --config model_reasoning_effort="low"` 跑了一次，要求"只 spawn 一个 pdw_explorer，让它报顶层目录和 tasks/ 下文件数"。结果：

- 父会话末行自报 `agent=pdw_explorer model=gpt-6-luna`；
- 新增两条 rollout（父 01a17b95-6ae5…、子 01a17b95-bfad…），子会话 `forked_from_id` 指向父会话，两者都命中 `pdw_explorer` 与 `"model":"gpt-6-luna"`；
- 工作树条目数测试前后都是 43，子 Agent 没有改文件。

附带一条同日实测：`codex exec` 暴露的工具清单里有 `collaboration.spawn_agent/wait_agent` 与 `mcp__cua_repl.js`（computer use），**没有独立的 browser 工具命名空间**。所以 UI 验收仍以 PDW 的 `checks` 为硬门禁，`pdw_ui_verifier` 只用于有人在场的探查，不进无人值守契约。

未验证：CUA 在非交互 `codex exec` 里能否真正驱动浏览器（需要桌面会话与首次授权，未在本卡试）。

**后续（同日，方案 A）**：PDW 不再引用这两个 agent。`AGENTS.md` 与 `.pdw/config.json` 里的「spawn pdw_explorer」已删除；`.codex/` 三个文件保留（已 gitignore），只在 Codex 应用或手动 `codex exec` 时可用。
