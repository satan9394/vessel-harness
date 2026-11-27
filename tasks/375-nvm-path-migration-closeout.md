# 任务卡 375: nvm 路径迁移的收尾与回归守卫

- Status: 已验收（2026-11-02；Codex 交付，协调者独立复跑后签收）
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
4. **执行方先审查协调者代做的两处改动**（用户要求："要不要撤？写进去，让 Codex 审查一遍；没问题就继续做别的，
   有问题就解决"）：`7d92786a`（nvm 路径入库）与 `d88883d3`（`authMiddleware.test.ts` 轮询窗口 1s→15s）各自给
   `KEEP` / `REVERT`。判据与可执行动作写在派单 §1：REVERT 时允许 `git revert --no-edit <sha>`（不 push），
   回退后要复跑 `doctor` 或该测试文件；判 REVERT 但无法安全回退时交回协调者。

## 3. Acceptance

- A1 两份脚本与 `AGENTS.md` 的改动入库，`git status` 干净（协调者做）。
- A2 派单内容自检通过：目标、范围、禁改项、验收命令、失败回交方式都写全，执行方不需要读别的文件。
- A3 守卫脚本落地后（执行方交付时验）：`node scripts/check-tool-paths.mjs` exit 0（**允许文档行显式标记
  `tool-path-guard: allow`**——规则本身要引述旧根，那是合法提及，不是残留）、`--self-test` exit 0、造一个含旧路径的
  临时候选文件能被抓到并 exit 1。
- A5 执行方对 `7d92786a`、`d88883d3` 各给出 `KEEP`/`REVERT` 结论与证据；判 REVERT 时已完成回退且复跑通过。
- A4 本卡不触碰产品代码、CI、`scripts/gate-batched.ps1`。

## 4. Blast Radius

`AGENTS.md`、`scripts/dispatch-codex.ps1`、`scripts/pdw-route.ps1`（以上三处是用户手工改的，协调者只负责入库）、
`tasks/prompts/CODEX-375-nvm-path-guard.md`（新）、`HANDOFF.md`（验收辅助 + 残留说明）、`tasks/README.md`。
执行方侧的 `scripts/check-tool-paths.mjs` 为新增文件。

## 5. Result

**已验收（2026-11-02）。** 执行方（Codex `gpt-6.1-sol`/medium，rollout
`rollout-2026-11-02T02-15-57-01a19bc2…`）交付两步，协调者独立复跑后才签收。

### 5.1 第一步：审查两处代做改动 → 两处 KEEP

执行方逐条给证后判 `KEEP` / `KEEP`。协调者复核一致：

- `7d92786a`（nvm 路径入库）：`.nodejs` 实测是 **Junction → `.shim`**，`node.exe` 报 `v26.13.0`、`codex.exe` 报
  `codex-cli 0.166.0`；旧根 `D:\Technology_application\NVM_Windows` 实测不存在；`pdw.ps1 doctor` exit 0、五角色
  `ready: true`；`pdw-route.ps1 -Kind general -All -DryRun` exit 0。
- `d88883d3`（轮询窗口 1s→15s）：diff 只有超时参数；`authMiddleware.test.ts` 本地 8 passed。执行方补了一条我漏掉的
  判断依据：完成通知走 `TeamRuntime.approve()` 的 `finally` 直接回调，不依赖 SSE，没有「事件顺序导致通知永不发出」
  的路径——所以是慢，不是丢。执行方同时给了更好的后续方向（用回调兑现 Promise 代替轮询），本卡不实现。

### 5.2 第二步：守卫脚本 + 协调者补齐的一处缺口

`scripts/check-tool-paths.mjs`（零依赖，`git ls-files --cached --others` 同时覆盖已跟踪与未跟踪）已落地，
`--root` / `--self-test` 齐备，自测里覆盖了三个模式、排除目录、未跟踪文件与大小写变体。

执行方如实报了 A3 不成立：默认扫描在**既有文档**里命中 4 处，并拒绝自行修改（符合派单）。协调者补齐：

1. 脚本加**行级豁免标记** `tool-path-guard: allow`（文档引述旧路径是合法提及），并在 `--self-test` 里加了一组
   「标记行跳过、未标记行仍报」的断言。
2. 给这 4 行加标记：
   - `AGENTS.md:111`（规则本身引述旧根）
   - `HANDOFF.md:28`（本卡的已接受残留说明）
   - `docs/TEST-REPORT-V07.md:10`（历史测试记录，`D:\tools\NVM_Windows\…`，另一处旧布局）
   - `docs/research/harness-matrix/deepseek-harness.md:436`（调研记录里的 DSH 旧安装位置）

### 5.3 协调者复跑（全部实测）

| 命令 | 结果 |
|---|---|
| `node --check scripts/check-tool-paths.mjs` | exit 0 |
| `node scripts/check-tool-paths.mjs --self-test` | `self-test ok`，exit 0 |
| `node scripts/check-tool-paths.mjs` | `scanned 1882 file(s)`，**0 命中**，exit 0 |
| 造探针 `zz-tool-path-probe.ps1`（写旧根）→ 扫描 | `zz-tool-path-probe.ps1:1: NVM_Windows`，**exit 1**；探针已送回收站，重扫恢复 exit 0（1883 → 1882 文件） |
| `pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind general -All -DryRun` | exit 0 |
| `git diff --check` | exit 0 |

未提交（按 `AGENTS.md` 硬性约束 11，纯脚本/文档改动本地攒着，不单独推）。执行方未 commit/push、未动 GitHub。

