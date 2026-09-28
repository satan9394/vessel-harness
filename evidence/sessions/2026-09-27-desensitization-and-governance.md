# 2026-09-27 · 公开化脱敏与 GitHub 治理（会话记录）

> **性质**：一次工作会话的完整记录——变更、行为、证据、未决项。目标是让**没有上下文的接手者**（或清空上下文后的自己）能直接续做。
> **涉及卡**：`tasks/168-desensitize-and-public-hygiene.md`
> **决策**：`docs/DESIGN-DECISIONS.md` 决策点 19（包管理器锁定 npm）、20（个人信息边界与一次性历史改写）、21（GitHub 治理）
> **纪律**：本文遵守与本次脱敏相同的纪律——**不写本机绝对路径、不写被移除的个人标识**；仓库外资产只用目录名指代。

## 0. 一句话结论

仓库已由 Private 转为 Public；工作树与全部历史完成脱敏（真实身份 / 本机路径 / 账号痕迹）；GitHub 治理定型为「只做提交 → PR 审核 → CI 测试，不发布任何版本」。全部动作已完成并验证，剩余 5 项可选收尾与 2 处本地垃圾待维护者处置（见 §8）。

## 1. 维护者在本会话下达的指令（按时间顺序，保留原意）

1. 进入本仓库（会话工作目录随之迁到本仓）。
2. 把仓库改为**公共仓库**。
3. 确认项目继续用 **npm**（不改 pnpm）；同时问「npm 与 pnpm 的区别、这个项目到底该用哪个」。
4. **全面脱敏**；「全面对标 OpenCode」但**参考不抄**；脱敏边界 = 身份 + 本机路径 + 账号痕迹；**授权改写历史 + force push**。
5. GitHub 上**只做提交，不发布任何版本**，只做**提交审核**，然后**测试**。
6. 「自己调 GitHub 相关 API，自己检测相关情况，自主执行」。
7. 授权 agent 执行 force push（实际被**机器级安全门禁**拦截，两次 push 最终均由维护者本人在自己终端执行）。
8. PR #21 的合并走 **A 方案**（本地用中性身份合并 + 普通推送）。
9. 把本会话全部变动与行为记录到本项目下（= 本文）。

## 2. 交付了什么（最终提交链，main 顶端 `26d931a`）

| 提交 | 内容 | 关键数字 |
|---|---|---|
| `e2b2e0b` | `chore(rename)`：收掉 `Composable_Agent_Harness → Vessel_Harness` 改名尾巴 | 5 文件 |
| `0733cfa` | `docs(decisions)`：决策点 19 锁定 npm（含三条依据） | — |
| `c76e450` | `chore(privacy)`：工作树脱敏 | **142 文件 / 904 增 904 删**（对称 ⇒ 纯替换） |
| `aaca055` | `test(tools)`：修掉 worktree 假 runner 把 detached 模式的修订号 `HEAD` 当目标、每次跑测试都在**仓库根**造出 `HEAD/` 的缺陷 | 1 文件 + 1 断言 |
| `ff752d2` | `docs(tasks)`：卡片 168 记录脱敏结果与交接命令 | — |
| `95ad2c1` | `docs(governance)`：决策点 21（不发布版本）+ README 安装路径/SECURITY 上报渠道/贡献导航 | — |
| `8b51083` | `ci`：`scripts/identity-guard.sh` + CI job（身份回归防线） | 守卫双向实测 |
| `569b926` `bcd9922` | `ci`：push 触发器收窄到 main（顺带消除必需检查重复上报） | 1 行 |
| `604189f` | `ci`：守卫跳过合并提交 + 去掉 GitHub noreply 黑名单 | — |
| `26d931a` | PR #21 合并提交（作者与提交者均为中性身份） | main = 716 提交 |

> 上述 SHA 是**最终**链。中间经过**两次**全历史改写，改写前的 SHA（如 `27f3844`、`5c2762b`）都已不在历史里，只在两次 force push 的远端描述中出现。

## 3. 历史改写与两次 force push

**第一次改写**：`git-filter-repo --force --mailmap <mailmap> --replace-text <replace-text>`（728 提交 / 15.14 秒）→ 新 `main` 顶端 `aaca055`。维护者执行 push #1：`27f3844 → 5c2762b`（main）、`8133cdc → 4db3b6f`（tag）。

**第一次事故**：push #1 之后的第 4 步复核打出真实邮箱 —— 服务端 API 分页全量确认 `5c2762b` 的作者就是被移除的地址。
**根因**：改写历史 ≠ 改写身份配置。本仓 `user.email` 当时仍指向全局 `.gitconfig` 的真实地址，所以**改写之后**新增的两个提交（`723b8e8`、`5c2762b`）从配置取回真实身份；而身份核验跑在那两个提交**之前**。教训一句话：**验证过去的状态不构成对下一个提交的防护**。

**修复**：① 本仓身份改为中性（`git config user.email vessel@users.noreply.github.com`，未动全局）；② 带同一 mailmap **第二次改写**（715 提交 / 3.62 秒）→ 新 `main` 顶端 `95ad2c1`；③ 复验本地全 refs 身份只剩中性身份与 `dependabot[bot]`；④ tag 值未变（`4db3b6f`），无需重推。维护者执行 push #2：`5c2762b → 8b51083`。

**agent 侧被机器级门禁拦截的命令类型**（不是权限判断，口头授权无效）：`git push --force`/`--force-with-lease`（含**分支**的 force push）、`git update-ref -d`、`git gc --prune`、`git reflog expire`、`git restore --staged`，以及 PowerShell 的 `Remove-Item -Recurse -Force`。门禁还会**预先扫描整条命令**：命令里出现被禁模式，整条（含前面的 `git add`/`commit --amend`）都不执行。

**改写后的历史事实**：main 共 **716** 提交；`refs/tags/v0.10.0 → 4db3b6f`（annotated tag，指向 V0.10 里程碑提交，仍在 main 祖先链上）。

## 4. 脱敏范围与替换原则（不含任何原始值）

**被替换的族**：真实个人邮箱与姓名（提交元数据与文本）；Windows 用户名（长名与 **8.3 短名**）；本机工作区盘符路径（两代仓库目录名）；其它本机工作树路径；指向旧仓名的自链接。

**替换后的中性形式**（供识别是否漏网）：中性提交身份 `Vessel Contributors <vessel@users.noreply.github.com>`；仓库根 `C:\work\Vessel_Harness`；用户目录 `C:\Users\USER`（短名形式 `USER~1`）；其它工作树 `D:\workspaces\...`；工具根 `D:\tools\...`。

**为什么绝大多数"路径命中"不用改**：全仓 1140 种 Windows 路径字符串里绝大多数是**测试自造的合成夹具**（`C:\tmp\vessel-root`、`C:\Users\x\...`、`C:\\fake-home\\...`）。真指纹只集中在 6 种前缀族；`apps/`、`packages/` 源码**零指纹**，源码侧唯一被污染的是 1 个测试文件。用这一区分把改动从"上千处"压到 142 文件。

**替换表本体在仓库外**（它含被移除的原始值，放进仓库等于自毁目的），与工作树脚本**同源**生成 `--replace-text`，保证"改写后 HEAD 的内容 = 历史中的内容"可机械核对。

## 5. GitHub 治理（远端现状，全部 API 实测）

- 可见性：PRIVATE → **PUBLIC**。
- **Release `v0.10.0` 已删除**（复验 0 条）；tag `v0.10.0` 保留为**提交标记**。
- npm 快照 `composable-agent-harness@0.10.0`（历史上仅此一版）**冻结不再更新**；README 安装路径改为**源码优先**。
- 规则集 `protect-default-branch`（id **23645929**，active，作用于默认分支）：4 条规则 = `deletion` / `non_fast_forward` / `pull_request`（0 approvals）/ `required_status_checks`，必需检查 3 条 = `build (ubuntu-latest, 22)`、`build (windows-latest, 22)`、`identity-guard`，且 `strict`（分支须与 main 同步）。`bypass_actors` = 维护者（`bypass_mode: always`）。
- 安全开关：secret scanning、push protection、dependabot 安全更新均 **enabled**；**私密漏洞上报已开启**（`SECURITY.md` 改指该渠道）。命名残留：`secret_scanning_non_provider_patterns` 与 `validity_checks` 经 API 开启无效。
- CI 触发（本轮改定）：`push` **只对 main**；PR 走 `pull_request`；**tag 推送不再触发**（起因见 §6 的 `startup_failure`）。

## 6. 验证证据（附录：可复跑命令）

**服务端身份扫描（权威口径）**：
```powershell
gh api "repos/satan9394/vessel-harness/commits?sha=main&per_page=100" --paginate `
  --jq '.[] | "A:\(.commit.author.email)  C:\(.commit.committer.email)"' | Sort-Object -Unique
```
结果（716 提交）：`A:49699333+dependabot[bot]@users.noreply.github.com C:noreply@github.com`、`A:vessel@users.noreply.github.com C:noreply@github.com`、`A:vessel@users.noreply.github.com C:vessel@users.noreply.github.com` —— **gmail 命中 0**。

**推送载荷内容扫描（含二进制）**：对 `refs/heads/main` 与 `refs/tags/v0.10.0` 用 `git grep -l -F -e <各级指纹>`（**不加 `-I`**）→ 命中 **0**。
> 注意口径：本地 `git clone` 会**连整个对象库一起复制**，因此"clone 里还有指纹 blob"不代表推送会送出它们（那些是不可达对象）。推送只送被推送 ref 可达的对象 —— 这是判断"公开面是否干净"的唯一正确口径。

**身份守卫双向实测**：
- 当前仓库：`identity guard: no denylisted commit identities in this history`，exit 0。
- 改写前的镜像：exit 1，报 20 条 offender 并提示 `(680 further offending commits not listed)`。
- 本地跑法：`bash scripts/identity-guard.sh`（Git Bash / WSL / Linux / macOS 均可）。

**CI run 台账**：

| run id | 事件 / ref | 结论 | 备注 |
|---|---|---|---|
| `36331703152` | push / main | success | 首批改动（含改名+决策点 19） |
| `36336073053` | push / **tag v0.10.0** | **startup_failure**（0 秒） | 成因见下；已用"tag 不触发"根除 |
| `36336084271` | push / main（**含真实身份那版**） | success（5m30s） | 说明该窗口 CI 不会报警——正是守卫要补的盲区 |
| `36337686727` | push / main `8b51083` | success | 三条 job 全绿 |
| `36337857358` | pull_request / `bcd9922` | **identity-guard fail** | 首版守卫扫到 PR 合成合并提交（见 §7.7） |
| `36338494711` | pull_request / `604189f` | success | 三条全 green，PR 转为 CLEAN |
| `36377845634` | push / main `26d931a` | success | 合并后 main 三条全绿 |

**tag `startup_failure` 的成因（推断，非 GitHub 给出的结论）**：该 run 的 head 提交是 `cc17fd7`，而 tag 是被强制更新进一个"对象仍在传送中"的改写历史，GitHub 处理事件时在那个 ref 上取不到工作流。`startup_failure` 没有日志可查，故只能给推断；根因之一是"让 tag 触发 CI"这个设计本身，已由 `push: branches: [main]` 消除。

**本地门禁**（每次改动后实测）：`npm ci` exit 0、`npx tsc -b tsconfig.json` exit 0、`npm run typecheck:tests` exit 0、`npm run test:all` 双 root exit 0（根 + web 12 文件 / 129 项）、`npm run -w @vessel/web build` 经 CI 覆盖。

## 7. 本会话犯的错（逐条，含后果与纠正）

1. 把 PowerShell 的 `Select-Object` 写进 Git Bash 串 → `EXIT=127`，白跑一次。低级的引号/宿主语言混淆。
2. 全历史扫描用 `git grep <token> $(730 个 SHA)` 且**丢弃 stderr** → 很可能触发行长度限制而静默失败，据此得出**错误的"0 命中"**结论，掩盖了真实残留。
3. **改写后未改本机 git 身份配置** → 真实身份随新提交回到公开历史并推送（本会话最严重）。
4. 推前**未重跑**身份核验（把一次历史验证当成持续保证）。
5. 用 jq 摘要表达式（含 `//empty`）读规则集 → 渲染出 `"rules": []`，一度误判"规则被清空"。回读**原始响应**才确认真实状态。
6. `git checkout <ref> --` 让 **HEAD 游离** → 提交落在分支之外，`git push` 报 `Everything up-to-date` 被误读为"已推送成功"。
7. 守卫首版：扫了 PR 的**合成合并提交**（`refs/pull/N/merge`，作者=账号提交身份）+ 把 GitHub 自己的 noreply 列入黑名单 → 每个 PR 必然红，把 PR 流程堵死。改为 `--no-merges` 且黑名单只留真实个人地址。
8. 交接命令一度把**本机路径写进卡片**（后来被 `--replace-text` 改写掉）；现卡片只给仓库外脚本名，不写死路径。

## 8. 未决项（等维护者拍板）

1. **`@clack/prompts` 1.8.1 的升级 PR 做不做**。四个待升依赖的判断：`@clack/prompts`（唯一**运行时**依赖，minor，值得拿）；`tsx` 4.23.15（dev 补丁，可有可无）；`@types/node` 22→**26**（**建议不升**：类型跨大版本而 engines ≥20 / CI 跑 22，等于给"类型通过、运行挂掉"开门）；`@vitejs/plugin-react` 5→6（大版本，需配 vite 8 + React 19 再验一次构建，CI 已有 `vite build` 关，不急）。
2. **旧对象彻底回收**：`refs/pull/*`（19+ 条）是 GitHub 服务端引用，客户端删不掉，需给 **GitHub Support** 发工单请求 GC 不可达对象。
3. **仓库外备份目录可清理**（`_vessel-backup-20260927`：镜像 + 全 refs bundle + 替换表 + mailmap + 本次脚本）。它是唯一的"改写前"回退副本；推送与 CI 均已验证，可删。
4. **规则集收权**：把规则集 JSON 的 `bypass_actors` 改成 `[]` 再 PUT，"必须走 PR"对维护者也变成硬墙（两次 force push 已完成，收权时机已到）。
5. **两处本地垃圾**（agent 无权删 ref）：游离提交 `5092ed4`、引用 `refs/remotes/oc/pr21-merge`。清理：`git for-each-ref --format='%(refname)' refs/remotes/oc/ | ForEach-Object { git update-ref -d $_ }`。

> 已自我了结的一项：4 个基于**改写前**历史的 dependabot PR（#17–#20）由 GitHub 在 `2026-09-27T17:12:27Z` **自动关闭**（= 第一次 force push 的那一刻），分支同时消失。**它们本来就不能合**：四个 PR 的 head 与当前 main 的 `merge-base` 全为空（互不相关的历史），合并会把含真实身份的旧提交重新拉回 main。要拿这些更新，应本地改 `package.json` + `npm ci` 重生成锁文件走新 PR，或在 PR 里让 dependabot 重开。

## 9. 已知漂移与观察（未处置）

- `tasks/README.md` 的路线表里 163–167 仍写「已交付（待合入）」，实际已随 `5ccfd7f feat(epic-167)` 在 main 祖先链上；「未闭合 / 下一目标」一节也仍把 167 当活跃。**本次未改**（不在范围内）。
- `.dsh-mission/publish/`（含约 1.2 MB 打包产物 `dist/cli.js`）在"不发布版本"政策下已是死件；按"保留作记录"未删。
- `docs/product-evolution/PRODUCT-STATE.md` 等多处仍有对已改写历史的旧表述（历史文档，未回溯修改）。
- 改写前的旧对象在 GitHub 服务端可能仍可达（`refs/pull/*`）；本地对象库也可能留有不可达残留（门禁禁止 `gc --prune`）。

## 10. 接手入口（读什么、从哪开始）

1. **规则**：`AGENTS.md`（硬性约束 10 条；第 10 条 = GitHub 治理；包管理器锁定见第 14 行）。
2. **决策**：`docs/DESIGN-DECISIONS.md` 决策点 **19 / 20 / 21**。
3. **卡片**：`tasks/168-desensitize-and-public-hygiene.md`（范围 / 验收判据 / 证据 / 残留 / 交接命令）。
4. **过程**：`DEV_LOG.md` 2026-09-27 共 5 条（含两次事故与教训）。
5. **防线**：`scripts/identity-guard.sh`（本地可跑，CI 里是必需检查）。
6. **远端**：仓库 `satan9394/vessel-harness`；规则集 id `23645929`；CI 仅由 main 推送与 PR 触发。
