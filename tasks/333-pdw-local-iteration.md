# T333 — PDW 项目级迭代（只服务本项目）

- Status: 已完成（2026-10-26）：四项全部落地；`prompt_guidance` 三条已按确认的 diff 写入，备份 `.pdw/config.json.bak-20261026`，doctor 五角色 ready。
- 前置决定（用户 2026-10-26）：本项目可以改技能正文，只求适用于当前项目；执行前需确认。

## 目标

让 `.pdw/` 与本项目真实用法对齐，减少每次重复交代：分批门禁、Codex 旁路并行、模型选型表指针、卡/契约最小字段。

## 改动清单（4 项）

### 1. 新增 `scripts/gate-batched.ps1`（仓库内，替换掉临时目录那份）

- 11 批：`packages/shared packages/core` / `packages/llm` / `packages/behavior packages/context` /
  `packages/tools packages/policy` / `packages/runtime packages/memory` / `packages/skills packages/agents` /
  `packages/telemetry packages/engine` / `packages/application` / `apps/cli` / `apps/local-server` / `benchmarks/runners`
- 再跑：`index.test.ts`、`--root apps/web`、`tsc -b`、`typecheck:tests`、`apps/web` tsc、离线 conformance
- 逐项打印 `exit` 与耗时，最后打印 `FAILED STEPS` 清单；任一红时整体 exit 1
- 不写仓库内产物（日志落 `%TEMP%`）

### 2. 新增 `docs/PDW-LOCAL.md`（本项目操作口径）

- 门禁：一律用 `scripts/gate-batched.ps1`，不跑单进程全量（会挂起）
- 双通道：PDW `implement`（串行单代理）与 Codex 应用/CLI 旁路（可并行）；旁路必须遵守
  「同一文件一个写者」与段间闸门（见 `AGENTS.md` 选型表）
- 选型：派活前查 `AGENTS.md` 的「模型与档位选型表」，并在卡里记「模型 ID + 档位 + 依据」
- Fast：`service_tier` 默认 `default`，开关都记卡
- 卡/契约：`scope` 用正斜杠相对路径；`checks` 优先调 `scripts/gate-batched.ps1` 或单测文件

### 3. 技能正文三处（本项目副本，可被覆盖，需登记）

- `.agents/skills/personal-dev-workflow/SKILL.md`：新增「本项目适配（VESSEL）」小节，指向
  `docs/PDW-LOCAL.md` 与 `AGENTS.md` 选型表；写明门禁分批与旁路并行规则。
- `.agents/skills/personal-dev-workflow/references/runtime.md`：新增「分批门禁与旁路并行」小节；
  写明 `update.mjs` 会逐字节覆盖本地改动，升级前先看 `.pdw/skill-local-changes.md`。
- 新增 `.pdw/skill-local-changes.md`：登记本项目对技能的所有改动，供 `update.mjs` 之后重放。

### 4. `.pdw/config.json` 的 `prompt_guidance`（**需用户确认 diff 后才写**）

- `implement`：增「最终报告必须写：模型 ID、档位、依据（选型表哪一行）、跑过的命令与退出码」
- `review`：增「每条结论必须给 `path:line` 与命令退出码；不得只复述实现者的说法」
- `scan`：增「结论必须带 `path:line`，不推演修法」

## 不做

- 不改 `pdw.mjs` 运行器逻辑（阶段机、锁、证据规则保持原样）
- 不启动任何 PDW `run`；不改角色模型 ID（仍 `commandcode/deepseek/deepseek-v4.1-flash`）
- 不碰产品代码、不 commit 产品代码

## 验收

```powershell
pwsh pdw.ps1 doctor                                   # 五角色仍 ready
node scripts/sync-web-presets.mjs --check             # 生成物未被误改
git diff --stat -- .agents/skills docs scripts .pdw   # 只出现上面列出的文件
```

另需人工核对：`docs/PDW-LOCAL.md` 的六条与本项目现实一致；`gate-batched.ps1` 的 16 步与
`HANDOFF.md` 门禁行一致；`.pdw/skill-local-changes.md` 与技能 diff 一一对应。

## Result

（待用户确认后执行）
