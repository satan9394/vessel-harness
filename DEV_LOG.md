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
---

## 2026-09-27（续 6）· 残留暴露审计 + 三项依赖升级

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**:
  - 逐项实测残留暴露面（详见 `evidence/sessions/2026-09-27-residual-exposure-audit.md`）：**GitHub 上 9 个 PR 页仍展示被移除的真实邮箱**（#12–#16 自己的 PR；#17–#20 dependabot PR 把改写前历史整段列为"本 PR 的提交"），另有 **22 条 `refs/pull/*`** 让旧对象仍可达——三样都**不由仓库控制**，改文件改不到，只能关 PR（已关）+ 给 GitHub Support 发工单（草稿见该文档 §A-1）。**npm 侧同样残留**：`composable-agent-harness@0.10.0` 的 registry 元数据里 `_npmUser`/`maintainers` 仍是真实邮箱、`repository`/`homepage` 仍指旧仓名，且早已过 unpublish 的 72 小时窗口。
  - **main CI 一次失败已定性**：run `36385562028` 的 Windows 腿报 `Worker exited unexpectedly with exit code 3221225794`（= 0xC0000142 `STATUS_DLL_INIT_FAILED`），**EPERM 命中 0** ⇒ 2 核 runner 上 worker 起不来的基建抖动，非代码回归（同提交 ubuntu 腿与 identity-guard 全绿；PR 上同一内容三条检查亦全绿）。已 `gh run rerun --failed`。**约定**：若再出现第二次就立卡收掉，可选缓解为给 CI 设 `maxWorkers`（本次不改：一次抖动不足以改测试执行语义，且既有口径就是"抖动→重跑"）。
  - **依赖升级三项**：`@clack/prompts` 1.7.0 → **1.8.1**（唯一运行时依赖，minor，`engines >=20.12` 兼容）、`tsx` 4.23.13 → **4.23.15**（patch），两项同时**抬起 `package.json` 的版本下限**（只改锁文件的话，别人 `npm install` 仍会解析回被替掉的旧版）；`@vitejs/plugin-react` 5.2.0 → **6.1.1** 独立成一个提交便于回退——实测其三个可疑 peer 全为 **optional**，升级**移除 45 个包、锁文件 −618 行**，`vite build` 1.18s exit 0、web 类型检查 exit 0、web 套件 **12 文件/129 项全绿**（JSX 换了变换实现，故以套件为准）。
  - **明确不升**：`@types/node` 26（类型跨到 Node 26 而 `engines >=20` / CI 跑 22，等于给"类型通过、运行挂掉"开门；要升得连 `engines` 与 CI 一并谈）。
  - **规则集 bypass 重新判断后决定保留**：维护者账号提交身份是 `xuanchen`，若收权则只能走网页/API 合并 ⇒ 每条合并提交都以账号身份署名、作者名与 `Vessel Contributors` 混排，且失去应急直推通道；边际安全收益小于该代价。要收权的两条命令写在审计文档 §F。
- **状态**: 分支 `chore/residual-exposure-audit` 走 PR（4 个提交）。未决清单更新为 6 项，见审计文档 §G。
---

## 2026-09-28（续 7）· 项目交接文档落盘 + 文档陈旧记账清算

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**:
  - 维护者要求"交接项目"：把日志与未完成项整理成**独立交接文档**，规则文件里只放**引用**。已落盘 `HANDOFF.md`（现状一分钟 / 治理与门禁 / 最近日志索引 / 未完成清单分三段：需维护者做 5 项、Agent 可推进 4 项、清不掉的 3 类已知边界 / 验证命令 / 严格纪律 / 阅读顺序），并在 `AGENTS.md`「目录结构」与 `README.md`「贡献」各加指针，`evidence/README.md` 顶部指向它。
  - 交接文档刻意写清两件容易被下一位忽略的事：**本机安全门禁会拦哪些命令**（force push / 删 ref / 清对象，且整条命令预扫描），以及**换机器后须先确认 git 身份已设为中性**——历史上正是改写后新提交从本机配置取回真实身份，才把它带回公开历史（决策点 20 事故）。
  - 文档清算（PR #24 / #25，均已合并）：`docs/V1.3-PROGRESS.md` 4 处 `file:///C:/work/...` 死链改为仓库相对链接、"改动尚未提交"改为"已交付合入（`5ccfd7f`）"；`tasks/README.md` 中 163–167 的「已交付（待合入）」改为「已合入（2026-09-25）」、V1.3 改记为已收官；两处**清单性质**的发布待办（`tasks/README.md`「发布准备」、`docs/V1.6-STABLE-CHECKLIST.md`「发布准备已就绪」）按决策点 21 加日期追注标为**作废**。历史快照（`V1.0-CHECKPOINT` / `V1.1-ROADMAP` / `tasks/152`）**刻意不改**——它们记的是当时的门禁状态。
  - 一次核实纠正了我自己先前的怀疑：`evidence/README.md` 关于 `.dsh-mission/backup/` 不进版本库的说法**是准确的**（`.gitignore` 第 25 行 `.dsh-mission/*` + 第 30 行 `!.dsh-mission/publish/` ⇒ backup 跟踪 0、publish 跟踪 8）。结论与过程记入审计文档 §H/§I。
- **状态**: main = `cd9d7bf`（728 提交）；三条必需检查全绿；工作区干净。**文档清理线到此为止**（边际收益已低，重复劳动），后续方向交给维护者：产品能力（README 三条已知边界）或需其署名的对外动作（Support 工单 / npm 工单 / 规则集收权）。
---

## 2026-09-28（续 8）· 交接收尾：冷启动路径 + 两处会误导读者的记录

- **Agent**: @opencode (deepseek-v4.1-flash)
- **事件**:
  - 交接文档已合入：PR #26 → `e0c5758`（main **730** 提交）。`HANDOFF.md` 在仓库根，`AGENTS.md` / `README.md` / `evidence/README.md` 各留指针（内容只存在于一个文件，避免两处各写一份后各自腐烂）。
  - **为新会话加"冷启动三步"**（`HANDOFF.md` §6）：`git log --oneline -3` 认准最新提交 → `git status -sb` 应为干净（有未提交改动先问维护者）→ `npm ci` 自证依赖一致；并提示本仓不发布版本、不要顺手引入其它包管理器锁文件。
  - **修两处会误导新会话的记录**：① `AGENTS.md` 标题仍写"Composable Agent Harness"（旧名）——改为 "Vessel"，并加一行说明"旧名属历史、可见于早期文档与 commit，不必改"；② 根目录 `RUN_STATE.md` 的 `## Status` 停在 2026-09-25 的 `Mission: completed / Revision 7`、DoD 勾选框全空，与当前状态脱节——**按约定未改正文**（该文件首行写明"机器真相源是 `.agent-state/run-state.json`，不要在此改计数器"，且它被 `.gitignore` 排除、不在版本库里），改由 `HANDOFF.md` §3.1 提示"接手时若看到它，先看 HANDOFF"。
- **状态**: main = `e0c5758`；三条必需检查在 PR 上全绿；工作区干净。**交接线完成**，下一步由维护者白天从 `HANDOFF.md` 决定方向（§3.1 需其署名 / §3.2 Agent 可推进）。