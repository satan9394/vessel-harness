# 会话交接 — 2026-10-23 → 10-24（协调者：OpenCode）

> 给下一个会话用。只写状态、证据位置和没做完的事；过程与角色聊天看 `.pdw/tasks/<id>/` 与各任务卡。

## 位置

- 分支 `main`，远端 `origin/feat/v2.8-taste-ui` 与本地同一 commit，工作树干净。HEAD 以 `git rev-parse --short HEAD` 为准（本文件不钉哈希）。
- 最后一次代码编辑之后的全量门禁：根 **305 文件 / 3198 通过 + 6 跳过**，web **58 文件 / 494 通过**；`tsc -b`、`typecheck:tests`、web typecheck、web build 均 exit 0。

## 这一段交付了什么

| 卡 | 内容 | 关键证据 |
|---|---|---|
| 276 | 「完全访问」下 Shell 真能跑：`scripts/provision-sandbox.ps1` 显式给工作区打 Low 标签 + 授予派生 SID；沙箱写根不再包含 `%TEMP%` | 真实模型会话 `outcome: enforced` / `integrityRid=4096`；`evidence/sessions/2026-10-23-provision-sandbox-result.md` |
| 277 | 两个 UI P2：B-F1 删除确认的 Escape/焦点还原；C-F1 KEY HINTS 与 Goals 不重叠 | B-F1 用户浏览器复验通过；C-F1 由 `scripts/ui-geom-check.mjs` 在 5 视口断言，PDW 任务 `20261024095132-1bac7e` = `accepted_local` |
| 278 | 一次工具失败不再锁死会话：`EffectJournal` 区分「执行是否跑完」与「是否成功」 | 真实模型会话：DENIED 之后 Write 仍成功；`evidence/sessions/2026-10-23-card278-effect-classification.md` |
| 279 | `vessel effects list\|resolve`：未知副作用的 CLI 出路，写同形 `audit/effect_reconciled` | 构建后的真实 CLI 进程 list→resolve→list |
| 280 | ARCH-09 用当前证据收口：14 fixture / 7 类别的 7 个源文件逐个复核、conformance 25/25、全量门禁 | `evidence/sessions/2026-10-23-card280-*.log` |
| 282 | 会话被未知副作用挡住时，工具结果直接给出带会话 id 的解除命令 | `packages/application/src/effectBlockMessage.test.ts` |

另：`HANDOFF.md` 顶部快照按实测重写（旧内容保留为历史）；`AGENTS.md` 增加三条实测规则（见下）。

## 下一步要用户拍板的

1. **卡 281（唯一硬阻塞）**：POSIX 上没有 `bwrap`/`sandbox-exec` 时，A 保持现状（照常执行、审计标注 `sandboxed:false`，只补文档）／B 默认拒绝（与 Windows 一致）／C 仅 `danger-full-access` 放行。协调者倾向 A，理由与代价写在卡里。
2. 卡 277 的人眼确认（可选）：提示词 `tasks/prompts/card277-browser-recheck.md`，判据是两矩形不相交 + 8 行草稿复测。
3. ARCH-04 的跨 harness live 证据：需要逐次授权调用本机其他 CLI。
4. UI-10 的 150%/200% 缩放与原生输入法：只能真机。

## 这一轮踩出来的四条（都已写进 AGENTS.md）

- **`dist` 会落后于 `src`**：`vitest` 读 src、真实进程走 dist，回滚后直接复验会得到与源码相反的结论。真实复验前先 `npx tsc -b`。
- **UI 类契约的浏览器验收放 `checks`（运行器执行）**：implement 角色在 Codex 沙箱里默认起不了浏览器；若确需自验，Chrome 需要 `--no-sandbox --user-data-dir=<工作区内> --headless=new --disable-gpu`（0.164.0 实测可跑）。
- **检查脚本不得往仓库里写文件**：写进任务 scope 会让 PDW 在 checks 之后判 `Source drift`（连中三次）。报告写 `%TEMP%`。
- **不要用 PowerShell 控制台回显判断 UTF-8 是否损坏**：一次 commit message 在控制台显示成 `claim �?it`，字节实际是正常 U+2014；判据只认 `git cat-file` / Node 读到的字节。

## PDW 现状

`.pdw/config.json` 1.3.3-local：`scan`/`test-plan`/`review`/`planner` = OC `deepseek-v4.1-flash`（review `#max`、planner `#high`），`implement` = **Codex `gpt-6.1-sol` / medium**（`codex-cli 0.164.0`）。

今天试过把 implement 换到 OC（`#high`）：`doctor` 就绪但**没有跑过真实任务**，按用户决定已回滚；备份在 `.pdw/skill-upgrade-20261024/config.json.bak-implement-to-oc-20261024`，要再试直接覆盖回去即可。`.pdw/` 不入库。

Codex 的调用形态（若要手工派单或换接入方式）：`codex exec --skip-git-repo-check --json --color never --sandbox <workspace-write|read-only> [-m <model>] [--config model_reasoning_effort="..."] --output-schema <schema> --output-last-message <final> -`，prompt 走 stdin；多轮用 `exec resume <uuid|--last>`，常驻后端是 experimental 的 `app-server`。项目内手工派单仍用 `scripts/dispatch-codex.ps1`（UTF-8 安全）。
