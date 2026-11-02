# 任务卡 375: nvm 路径迁移的收尾与回归守卫

- Status: 已交付派单（2026-11-02；迁移已手工完成并入库，只剩守卫脚本由执行方做）
- PDW task: none
- 来源：`AGENTS.md` 2026-11-02 新增的「可执行路径一律指向 nvm 的 `.nodejs` 目录」。这次事故是人发现
  `pwsh pdw.ps1 doctor` 变红才定位的——仓库里没有任何东西会阻止旧路径再次写死。

## 1. 现状（协调者实测，2026-11-02）

| 面 | 实况 |
|---|---|
| `AGENTS.md` | 已加规则（用户手写，协调者代为入库） |
| `scripts/dispatch-codex.ps1` | 已改：`$codex = 'C:\Users\Satanchen\AppData\Local\Author Software\nvm\.nodejs\codex.exe'`（用户手工改） |
| `scripts/pdw-route.ps1` | 已改：`$opencodeExe` / `$codexExe` 同上（用户手工改）；`-Kind general -All -DryRun` 实测 exit 0 |
| `.pdw/config.json`（本地，不入库） | 五个角色全部指向 `.nodejs\codex.exe`，模型 terra/sol；UTF-8 有效（U+FFFD = 0、无 BOM） |
| `pwsh pdw.ps1 doctor` | **exit 0，五角色 `ready: true`**，`codex-cli 0.166.0` |
| 机器级配置 | `~/.config/opencode/opencode.json`、`~/.codex/config.toml`、`~/.gemini/config/GEMINI.md`、`~/.codex/models_cache.json` 均 **0 处**旧路径（`.dsh` 的 450 处全在 session 缓存/日志里，属历史） |
| 仓库活文件残留 | `docs/diagrams/*.finalize.json`（6 个文件 23 处 `NVM_Windows\nodejs\node.exe`）——Archify 生成物的采集元数据 |
| 历史目录 | `evidence/`、`tasks/` 里有大量旧路径，**属历史记录，不git 改** |

## 2. 决定

1. **不手改** `docs/diagrams/*.finalize.json`：它是 Archify 生成物的采集元数据，重跑图会自然刷新；手改等于伪造
   生成记录。在 HANDOFF 记为「已接受的残留」。
2. **不把守卫塞进 `gate-batched.ps1`**：那会把 17/17 的全局口径改掉，且该脚本受多张卡的验收引用。守卫做成
   独立脚本，按需跑（并写进 HANDOFF 的验收辅助）。
3. 守卫脚本 `scripts/check-tool-paths.mjs` 由执行方（Codex）实现，派单
   `tasks/prompts/CODEX-375-nvm-path-guard.md`（自包含，可直接粘贴）。

## 3. Acceptance

- A1 两份脚本与 `AGENTS.md` 的改动入库，`git status` 干净（协调者做）。
- A2 派单内容自检通过：目标、范围、禁改项、验收命令、失败回交方式都写全，执行方不需要读别的文件。
- A3 守卫脚本落地后（执行方交付时验）：`node scripts/check-tool-paths.mjs` exit 0、`--self-test` exit 0、
  造一个含旧路径的临时候选文件能被抓到并 exit 1。
- A4 本卡不触碰产品代码、CI、`scripts/gate-batched.ps1`。

## 4. Blast Radius

`AGENTS.md`、`scripts/dispatch-codex.ps1`、`scripts/pdw-route.ps1`（以上三处是用户手工改的，协调者只负责入库）、
`tasks/prompts/CODEX-375-nvm-path-guard.md`（新）、`HANDOFF.md`（验收辅助 + 残留说明）、`tasks/README.md`。
执行方侧的 `scripts/check-tool-paths.mjs` 为新增文件。

## 5. Result

- 用户手工迁移 + 协调者验证并入库：`AGENTS.md`、`dispatch-codex.ps1`、`pdw-route.ps1`（`doctor` exit 0 / 五角色 ready /
  `-DryRun` exit 0 三项实测）。
- 派单已写：`tasks/prompts/CODEX-375-nvm-path-guard.md`，交给执行方后按 A3 验收。
- `docs/diagrams/*.finalize.json` 按 §2.1 记为已接受残留。
