# T286 — PDW 供应商迁移到 v2 `providers` 并做真实路由冒烟

- Status: 已完成（2026-10-25，配置手工迁移 + 一个真实 PDW 任务；未提交、未推送）
- PDW task: 20261025074418-69269b（`accepted_local`；首轮 20261025074139-e33519 被 scan 判 blocked，check 列数写死 5 与两列表头冲突，已将 `PDW row column count changed` 改为「与表头分片数比对」后重建）
- Mode: standard（全局配置迁移 + 项目配置对齐 + 一次真实冒烟）
- Source: human-requested
- Risk: medium（改 `~/.config/opencode/opencode.json` 的顶层结构；真实模型调用消耗配额）

## Goal

`~/.config/opencode/opencode.json` 里的 `provider`（单数，v1 形态）在 OpenCode 2.1.4 上**已被完全忽略**——2026-10-25 实测：把整份配置缩减成只含 `provider.commandcode` 的最小文件，`opencode models` 一条命令都不出。这解释了 2026-10-24 深夜那次会话的猝死：会话本身一直在用内存里的旧配置跑，一旦有人写入该文件触发重载，`commandcode` 整块被丢弃，随后 `SessionRunnerModel.resolve` 抛 `provider.no-route: Model unavailable`。

因此本轮不是"补 variants"，而是**把整份配置迁到 v2 的 `providers`（复数）形态**，并顺带完成上一轮没能执行的冒烟：

1. 备份 `~/.config/opencode/opencode.json`，把 `provider.commandcode` 迁进 `providers.commandcode`，字段按 v2 语义改写（`npm`→`package`、`options.apiKey/baseURL`→`settings.apiKey/baseURL`）。档位 `low/high/max` 写进模型的 `variants`。
2. `supportsPromptCacheKey` 保持 `true`（旧配置是 `options.setCacheKey: true`，迁移不得回退成 workbuddy 的 `false`）。
3. 模型键必须保留上游全名 `deepseek/deepseek-v4.1-flash`：v2 下键名会被当作上游模型名发出，缩写 `deepseek-v4.1-flash` 会被上游拒为 `Model "deepseek-v4.1-flash" is not supported on this endpoint`。
4. `.pdw/config.json` 的四个 OC 角色 `commandgota/...` → `commandcode/...`，档位一个字不动。备份到 `.pdw/skill-upgrade-20261025/config.json.bak-commandcode-20261025`。
5. 派生一个只改 `HANDOFF.md` 的 PDW 冒烟任务（`planner: false`），修掉 §0 快照里那句已经指空的指针。

## Not Doing

- 不改 `.agents/skills/personal-dev-workflow/` 与镜像（上游所有）。
- 不改产品源码（`apps/`、`packages/`、`benchmarks/`）。
- 不动 `implement` 的模型与档位，不动 `limits`、`cost`。
- 不补 `off` 档位：DeepSeek 官方关闭思考的值是 `none`，`off` 没有依据。
- 不 commit / push，不删除任何文件。
- 冒烟失败时如实记录失败阶段与原始日志，不手工改 `state.json` 冒充通过。

## Acceptance

- AC1：全局配置顶层只剩 `providers`（复数），`provider`（单数）已移除；`opencode models` 能列出 `commandcode/deepseek/deepseek-v4.1-flash`。
- AC2：`commandcode` 的 `variants` 恰为 `low/high/max`，`compatibility.supportsPromptCacheKey` 为 `true`，`limit` 保持 `context 1000000 / output 384000`。
- AC3：无档位与 `#low` / `#high` / `#max` 四次真实调用全部 exit 0。
- AC4：`pdw.mjs doctor` exit 0，五角色 `ready: true`，`effective_model` 依次为 `commandcode/deepseek/deepseek-v4.1-flash#high` ×2、`gpt-6.1-sol`、`...#max`、`...#high`。
- AC5：`.pdw/config.json` 仅四个 OC 角色的 provider 段变化，档位与 `limits` 逐字节语义不变。
- AC6：冒烟任务 `status` 为 `accepted_local`，`contract.scope` 只有 `HANDOFF.md`，四个 attempt 的实际路由与角色表一致，review 对每条 AC 给出 pass + 证据。

## Blast Radius

`~/.config/opencode/opencode.json`（仓外，带备份）、`.pdw/config.json`（gitignored）、`.pdw/skill-upgrade-20261025/config.json.bak-commandcode-20261025`、`HANDOFF.md`（经 PDW 任务）、`tasks/286-*.md`、`tasks/README.md`（一行）、`.pdw/tasks/<新 id>/`。

回滚：全局配置用 `opencode.json.bak-variants-20261025` 覆盖（注意那份仍是失效的单数形态，回滚后 `commandcode` 会重新不可路由，故只在需要取证时用）；项目配置用备份覆盖；`HANDOFF.md` 用 `git checkout -- HANDOFF.md`。

## Expected Evidence

`opencode models` 输出、四次 `opencode run` 的 exit code、`doctor` JSON、`git diff -- .pdw/config.json` 的语义对照、冒烟任务的 `checks-*/` 与 `REPORT.md`、`git diff -- HANDOFF.md`。

## Result

已完成，配置侧三条验收有实测证据，冒烟任务走完全程。

**根因**：`provider`（单数）在 OpenCode 2.1.4 上已被完全忽略，不是"deprecated 但仍可用"。取证方式是把整份配置缩成只含 `provider.commandcode` 的最小文件（1306 B），`opencode models` 输出 0 条 commandcode 模型；换回复数 `providers` 形态后同一命令立刻列出 70 个。2026-10-24 深夜那次会话能一直跑到 00:27，靠的是后台服务内存里的旧配置，一旦写入该文件触发重载就整块丢失，随后 `SessionRunnerModel.resolve` 抛 `provider.no-route`。所以上一轮"给单数块补 variants"是无效操作，且是写入行为本身引爆了会话。

**迁移过程踩到三个坑，都已修**：

1. `modelID` 字段在 v2 里不是"本地键别名"，本地键名本身会被当作上游模型名发出。写成键 `deepseek-v4.1-flash` 时上游直接拒：`Model "deepseek-v4.1-flash" is not supported on this endpoint`。键必须是上游全名 `deepseek/deepseek-v4.1-flash`。
2. 克隆 workbuddy 块做模板时把它的 `compatibility.supportsPromptCacheKey: false` 一并带了过来，而旧 commandcode 是 `options.setCacheKey: true`。已改回 `true`。
3. `limit` 一度被 workbuddy 的 `input: 800000` 污染，已恢复为 `context 1000000 / output 384000`；`capabilities.reasoning` 必须写成对象 `{supported: true, effort: [...]}`，写成布尔会被静默丢弃。

**验收**：`opencode models` 列出 `commandcode/deepseek/deepseek-v4.1-flash`；无档位与 `#low` / `#high` / `#max` 四次真实调用各 exit 0，回复均为 `OK`；`doctor` exit 0，五角色 ready，`effective_model` 依次 `...#high` / `...#high` / `gpt-6.1-sol` / `...#max` / `...#high`；`.pdw/config.json` 只改四个 OC 角色的 provider 段，档位与 `limits` 未动（备份 `.pdw/skill-upgrade-20261025/config.json.bak-commandcode-20261025`）。

**冒烟任务 `20261025074418-69269b`**：`accepted_local`，4 次调用、0 次修复、约 10 分 46 秒，artifact `2bd26ef5688664013c6f1a38d545f28ee1e07bf976d57cfd54a70748836fa888`。四个 attempt 实际路由（`[1/10] scan → commandcode/...#high` 等）与角色表逐条吻合——这是本轮真正要证明的东西。check `handoff-pointer` exit 0（`handoff ok { cells: 4, bytes: 20953, row: 235 }`）；review 逐条 AC 判 pass，并用 baseline 逆向重建第 16 行后 sha256 精确命中 `254ce1…` 证明其余字节未动。

**未做 / 边界**：`HANDOFF.md:55` 与 `:184` 当时仍把 `AGENTS.md`「执行角色与模型路由」当成模型事实源，与刚修的第 16 行自相矛盾（review 判 medium，属 scope 外）；同日后续已改成「角色看 AGENTS、模型与档位看 doctor」，见文末追加。`doctor` 的 `effective_model` 对 Codex 角色只返回模型名，档位在并列的 `reasoning_effort` 字段，按字面只读 `effective_model` 会漏掉 implement 的 medium（AGENTS 与 HANDOFF 已补说明）。另外 `off` 档位没有补——DeepSeek 官方关闭思考的值是 `none`，`off` 无依据。

**2026-10-25 追加（协调者核对）**：

1. 全局配置里删掉单数 `provider.commandcode` 后约 18 秒又被写回。查 cc-switch 日志确认：它的 OpenCode 集成在切换供应商时执行 `[SWITCH] opencode 写入 commandcode（累加式应用）`，写的是 v1 单数块；同时把带 `capabilities` 的 v2 块判为 `Invalid native OpenCode provider ... leaving its source untouched`，所以复数块保留。结论：单数块是 cc-switch 的产物，删不掉也不影响 OpenCode 2.1.4（它忽略该块）；实际生效的是 `providers.commandcode`。已把这个事实写进 `AGENTS.md`「PDW 本机适配」。
2. 复核方式：每次用 cc-switch 切换供应商后跑一次 `pwsh pdw.ps1 doctor`；若 `opencode models` 里 `commandcode` 消失，说明复数块被整体覆盖，按本卡「三个坑」重建。注意 `capabilities` 必须保持对象形态，cc-switch 的校验器认不出它，但也不会改它。
3. 截至 2026-10-25 08:16Z 实测：`doctor` 五角色 ready，`effective_model` 仍为 `...#high` / `...#high` / `gpt-6.1-sol` / `...#max` / `...#high`；`opencode models` 仍列出 `commandcode/deepseek/deepseek-v4.1-flash`。
