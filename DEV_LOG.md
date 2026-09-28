# Dev Log

Append-only development log for **Vessel_Harness**.

Created 2026-09-24 as part of the personal-dev-workflow v1.0.0 layout unification.

## How to use

Log only what genuinely needs to survive the session — do not write a daily entry for
every small card. Per `memory-policy.md`, a fact belongs in exactly one place:

| Fact | Where |
|---|---|
| Task semantics & acceptance | `tasks/` card |
| Code facts | git diff / commit |
| Long-term decisions | ADR / `docs/` |
| Stable rules & recurring lessons | `AGENTS.md`, `memory/` |
| User-visible shipped changes | `CHANGELOG.md` |
| Throwaway process notes | **this file** |

When there is nothing worth recording, not writing is the correct behavior.

---

## 2026-09-25 · V1.3 双向子 Agent 网关体系全量交付与私有化闭环

- **Agent**: @agy (Gemini 3.8 Flash High)
- **事件**:
  - 接收 Codex 首席架构师关于 Epic 167（V1.3）的交付汇报；
  - 依据 personal-dev-workflow 规范执行独立对抗验收：全量门禁实测通过（`tsc -b` 0 报错、`typecheck:tests` 0 报错、定向测试 4 文件 24 项全过、`npm run test:all` 双 root 2,431 项全绿，Web 打包 1.68s）；
  - 完成本地打包提交 `68bc8e3` 并同步至 GitHub 远端；
  - 响应用户诉求，通过 `gh repo edit` 将仓库 `satan9394/composable-agent-harness` 切换为私有仓库（Private），消除公开暴露风险；
  - GitHub Actions 远程 CI/CD 全链路跨平台自动化验证通过：Ubuntu (Linux) 1m 20s 全绿、Windows 4m 26s 全绿、CodeQL 0 告警；
  - 状态机 `.agent-state/run-state.json` 与 `RUN_STATE.md` 顺利闭环归档为 completed。
- **状态**: 工作区干净，本地与远程 `origin/main` 保持完全对齐。

---

## 2026-09-27 · 仓库转公开 + 包管理器归属清算（npm 锁定）

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**:
  - 依用户指示把 `satan9394/vessel-harness` 由 Private 改为 Public（`gh repo edit --visibility public`）。这与 2026-09-25 那条"转私有以消除公开暴露风险"相反，属用户重新拍板；转公开前先做了一次全历史凭据扫描（705 提交，按 API key / 私钥 / JWT / AWS 格式匹配，唯一命中是测试里写的 JWT 头字面量 `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`，非真实令牌）。遗留提示：早期提交作者邮箱为真实 Gmail，公开后不可撤回。
  - 发现 9/26 的一次 pnpm 实验把本地 `node_modules` 换成了 pnpm 形态（`.pnpm/` + `.modules.yaml` + junction 链接），并遗留未跟踪的 `pnpm-lock.yaml` / `pnpm-workspace.yaml`。已用 `npm ci` 恢复 npm 平铺树（122 包、exit 0，同时顺带验证锁文件与 `package.json` 一致），两份残留进回收站。
  - 根目录未被跟踪的 `HEAD/`（内容仅一行 `gitdir: fake`）一并清理：仓库根存在名为 `HEAD` 的目录会让 `git rev-list HEAD` 报 "ambiguous argument"。
  - 决策点 19 落盘（`docs/DESIGN-DECISIONS.md`）：包管理器锁定 npm，不迁移 pnpm；`AGENTS.md` 技术栈一节留指针。
  - 已知漂移：`tasks/167-epic-universal-subagent-mesh.md` 里给子代理的人格 prompt 仍写 "Node 20+ / pnpm / vitest"。按"任务卡是已交付记录、不改正文"的惯例保留原文，由决策点 19 覆盖。
  - 顺带收掉改名尾巴（`chore(rename)` 提交）：`DEV_LOG.md` 标题、`docs/VESSEL.md` 的 `cd` 路径、`.dsh-mission/publish/` 的三条仓库链接、`run-release-gates.note.test.ts` 的绝对路径断言。
- **状态**: `npm ci` exit 0；`npx tsc -b tsconfig.json` exit 0；`npm run typecheck:tests` exit 0；定向测试 `run-release-gates.note.test.ts` 20/20 通过。本批无源码逻辑改动，故未跑 `test:all` 全量。

---

## 2026-09-27（续）· 全仓脱敏 + 公开仓库规范化对标

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**:
  - 用户拍板三件事：按 OpenCode 的公开仓库卫生标准校准本仓（只参考其**标准构成**，不抄文字与代码）；授权改写历史 + force push；脱敏边界取「身份 + 本机路径 + 账号痕迹」，报告与证据目录不整体移出。
  - 脱敏前先做只读盘点，并区分"真泄漏"与"合成夹具"：全仓 1140 种 Windows 路径字符串里绝大多数是测试自造的假路径（`C:\tmp\vessel-root` 一类），真指纹只集中在 6 种前缀族；`apps/`、`packages/` 源码**零指纹**，源码侧唯一被污染的只有一个测试文件。
  - 工作树脱敏已应用：**142 文件 / 904 增 904 删**（对称，纯字符串替换无结构变化）。替换表与工作树脚本同源，保存在**仓库外**备份目录（它含被移除的原始值，放进仓库等于自毁目的），仓库内只记录策略与范围。
  - 备份先行：仓库外镜像 + 全 refs bundle（`git bundle verify` = *records a complete history*，707 提交）。
  - 规范化文件落盘：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`.editorconfig`、`.gitattributes`、issue 模板 ×2 + `config.yml`、PR 模板；`README.md` 增「贡献」导航；`SECURITY.md` 上报渠道改为 GitHub 私密漏洞上报（该通道已通过 API 开启）。
  - 决策点 20 落盘（个人信息边界与一次性历史改写），并把"禁止 force push"的**唯一书面例外**写进 `AGENTS.md` 硬性约束 6；任务卡 `tasks/168` 记录范围、验收判据与已知残留。
- **状态**: 分两笔提交（脱敏 / 规范化），随后执行历史改写与 force push。
- **已知残留**: `refs/pull/*` 服务端引用在 PR 合并后仍可能保留旧对象，客户端无法删除，彻底回收需联系 GitHub Support；`secret_scanning_non_provider_patterns` 与 `validity_checks` 经 API 未能开启（secret scanning + push protection + dependabot 安全更新均已开启）。

---

## 2026-09-27（续 2）· 历史改写已在本执行完毕，force push 交回维护者

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**:
  - 历史改写已在活仓库执行完毕：`git-filter-repo --mailmap --replace-text`，728 提交 / 15.14 秒，新 `main` 顶端 `aaca055`（709 提交）。全历史身份只剩中性身份与 `dependabot[bot]`。
  - 交付侧核验用"推送载荷"口径：`refs/heads/main` 与 `refs/tags/v0.10.0` 的完整内容扫描（**不加 `-I`，含二进制**）命中 **0**。
  - 排查过程中纠正了我自己上一轮的一个错误结论：先前"全历史逐提交扫描"把 stderr 丢弃，730 个 SHA 作参数很可能触发命令行长度限制而静默失败，那个"0 命中"不可信；改用逐 ref + 逐对象口径后，才发现残留来自两个 `refs/codex/turn-diffs/checkpoints/*`（Codex 检查点快照，指向树对象而非提交，因此既逃过 `git log` 也逃过按提交的扫描，含 100 / 132 个旧文件版本）。它们**远端 0 条、从未推送**，不影响公开面。
  - 附带修掉一个真实缺陷：`packages/tools/src/git/worktree.test.ts` 的假 runner 取 `args[args.length-1]` 作 worktree 目标，而 detached 模式末尾是修订号 `HEAD`，于是每次跑测试都在仓库根造出 `HEAD/` 目录——这正是 9/27 早先那个"根目录 HEAD 垃圾"被清掉后又复现的原因。已改为取绝对路径参数并在缺席时大声失败。
  - 门禁：改写前后各跑一次全量 `npm run test:all`（双 root）+ `npx tsc -b` + `npm run typecheck:tests`，全绿。
- **状态**: **force push 未执行**——机器级安全门禁拦截 `git push --force`（策略：不允许覆盖远端历史），`git update-ref -d`、`git gc --prune`、`git reflog expire`、`git restore --staged` 同样被拦。授权本身没有问题（决策点 20 已记录用户授权），是执行主体受限：**这类命令只能由维护者在自己终端执行**。交接命令写在 `tasks/168` §6。
- **已知残留**: 远端 4 条 dependabot 分支（对应仍开着的 PR #17–#20）、`refs/pull/*`（需 GitHub Support 触发服务端 GC）、本地两个 `refs/codex/*`（本地独有）。

---

## 2026-09-27（续 3）· GitHub 治理定型：只做提交与审核，不发布版本

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**:
  - 用户定策：本仓在 GitHub 上只做**提交 → PR 审核 → CI 测试**，不发布任何版本。
  - 先用 gh API 核出两处与政策冲突的既成事实：GitHub 上存在 Release `v0.10.0`（Latest，2026-09-14 发布）；npm 上确有 `composable-agent-harness@0.10.0`（仅此一版，2026-09-14）。
  - 处置：**删除 GitHub Release**（复验剩余 0），tag `v0.10.0` 保留为提交标记；npm 快照冻结不再更新，README 不再把它列为推荐安装路径。
  - 规则集 `protect-default-branch` 增补 `required_status_checks`（`build (ubuntu-latest, 22)` / `build (windows-latest, 22)`）与 `strict_required_status_checks_policy`，保留 `pull_request` / `non_fast_forward` / `deletion` 三条与维护者 bypass。
  - 文档同步：`AGENTS.md` 硬性约束新增第 10 条；`README.md` 改为源码优先并修掉"每个 tag 对应一个 release"的失效表述；`CONTRIBUTING.md` 写明必需检查与不发布政策；决策点 21 落盘。
- **状态**: 远端治理已生效（API 实测：4 条规则齐全、release 0 条）；文档改动待随下次推送生效。远端 `main` 仍是改写前的 `27f3844`——force push 仍需维护者本人执行（见 `tasks/168` §6 或 `FINISH-PUSH.ps1`）。
- **教训**: 校验规则集时我用 jq 摘要表达式把结果渲染成了 `"rules": []`，一度误判"规则被清空"。回读原始响应才确认真实状态——**改完安全配置必须回读原始 API 响应，不能相信自己写的摘要表达式**（且别在同一个表达式里堆 `//empty` 回退）。

---

## 2026-09-27（续 4）· 脱敏泄漏事故：改写后新增的提交把真实身份带回并已推送

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**:
  - 维护者执行 `FINISH-PUSH.ps1`：main 与 tag 均强制更新成功（`27f3844...5c2762b`、`8133cdc...4db3b6f`），`refs/codex/*` 已删。脚本第 4 步却打出 `satan9394 <yichenzhang439@gmail.com>`。
  - 我先怀疑是本地跟踪引用过期，于是用服务端 API 直接查（`/commits?sha=main` 分页取全量）：**711 条提交里确实存在 `yichenzhang439@gmail.com`**，且顶端 `5c2762b` 的作者就是它。不是引用问题，是真泄漏。
  - **根因**：改写历史 ≠ 改写身份配置。`git config --show-origin user.email` 指向全局 `.gitconfig` 的真实地址，所以改写**之后**做的两个提交（`723b8e8`、`5c2762b`）从配置里取回了真实身份。而我的身份核验跑在改写后、那两个提交之前，推之前没重跑——**验证过去的状态不构成对下一个提交的防护**。
  - **修复**：① `git config user.email/name` 改为中性（仅本仓）；② 带 mailmap 重跑 `git-filter-repo`（715 提交，新 `main` = `95ad2c1`）；③ 复验本地全 refs 身份只剩中性身份与 `dependabot[bot]`，`main`/`tag` 内容扫描 0 命中，tag 值未变（无需重推）；④ 需要第二次 force push。
  - **防复发**：新增 `scripts/identity-guard.sh`——把被移除的身份以 **SHA-256** 形式写死（守卫不重新发布这些地址，报错只回显哈希前缀，并限制最多列 20 条 offender）；接入 CI 新 job `identity-guard`（`fetch-depth: 0`）并加入规则集的必需检查。**双向实测**：当前仓库 exit 0；对改写前的镜像 exit 1 并提示 `(680 further offending commits not listed)`。
- **状态**: 待维护者执行第二次 force push（lease = `5c2762b…`，脚本已更新）；远端 `main` 目前仍是含真实身份的那一版。
- **待办**: ① 第二次 force push 后，用服务端 API 复验作者身份；② 如在意，关闭 4 个过期 dependabot PR 并删分支；③ 彻底回收旧对象需 GitHub Support。


---

## 2026-09-27（续 5）· 会话收尾：记录落盘 + 治理首次走通

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**: 维护者完成第二次 force push（`5c2762b → 8b51083`），main 经 PR #21 合并到 **`26d931a`**（716 提交）；服务端复核身份只剩中性身份与 `dependabot[bot]`（gmail 0 命中）；main CI 三条全绿。**首次完整走通**"分支 → PR → 三条必需检查 → 合并"，合并按 A 方案在本地用中性身份完成，GitHub 正确标记 MERGED、远端分支自动删除。4 个基于改写前历史的 dependabot PR（#17–#20）由 GitHub 在第一次 push 那刻自动关闭——四个 head 与当前 main 的 merge-base 全为空，合了会把含真实身份的旧提交拉回 main。
- **记录落盘**: 本会话完整记录 `evidence/sessions/2026-09-27-desensitization-and-governance.md`（§6 可复跑命令 / §7 八个自省错 / §8 五项未决 / §10 接手入口）；`evidence/README.md` 增 `sessions/` 说明；`tasks/README.md` 路线表增 168 一行；`tasks/168` 状态改「已合入」。
- **状态**: 主线闭环；未决 5 项见会话记录 §8（`@clack/prompts` 升级 PR、GitHub Support 工单、仓库外备份目录清理、规则集收权、两处本地垃圾）。
- **给接手者**: 先读会话记录 §9/§10，再读 `tasks/168`；`bash scripts/identity-guard.sh` 可本地复跑。
- **教训补充**: 合并提交的作者身份取决于**谁在哪执行合并**——本地用中性身份合并保住了 main 作者名一致性；GitHub 网页端合并会以账号提交身份署名（但用 noreply 地址，不会带回真实邮箱）。