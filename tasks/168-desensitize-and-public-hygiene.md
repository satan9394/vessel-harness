# 168 — 公开仓库脱敏与规范化对标（Desensitize & Public Hygiene）

- 编号：168
- 状态：本地已闭环；**待维护者执行 force push**（机器级安全门禁禁止 agent 覆盖远端历史，见第 6 节）
- 优先级：P0
- 创建日期：2026-09-27
- 关联模块：仓库级（无源码逻辑改动）
- 执行模型：OpenCode (deepseek-v4.1-flash)
- 验收人：用户

## 1. 目标与意图

仓库于 2026-09-27 由 Private 转为 Public。公开前必须解决两类问题：

1. **个人信息泄漏**：工作树与 700+ 条提交里散布真实邮箱、姓名、本机用户名与本机工作区绝对路径。
2. **公开仓库规范化缺口**：缺少贡献指南、行为准则、issue/PR 模板、编辑器与行尾约定。

用户明确的边界是 **身份 + 本机路径 + 账号痕迹**；报告与证据目录（`benchmarks/reports/`、`evidence/`）**不**整体移出公开范围，但要清掉其中的本机路径。

## 2. 范围

**做**：

- 工作树脱敏：对全部受控文件做同源替换（身份、本机用户名、本机工作区路径、旧仓名自链接）。
- 历史改写：`git-filter-repo` 改写作者/提交者身份 + 全历史 blob 替换（与工作树同表）。
- 一次性 force push（授权来源：决策点 20）。
- 补齐规范化文件：`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、`.editorconfig`、`.gitattributes`、`.github/ISSUE_TEMPLATE/*`、`.github/pull_request_template.md`；`README.md` 增加「贡献」导航；`SECURITY.md` 上报渠道改为 GitHub 私密上报。

**不做**（明确排除）：

- 不把 `benchmarks/reports/`、`evidence/`、`.dsh-mission/` 移出仓库或整体删除（它们是可核查的演进证据）。
- 不改写 `tasks/` 中既有卡片的历史叙述（卡是已交付记录）。
- 不改 GitHub 账号句柄（它是公开仓库身份，URL 与 CODEOWNERS 依赖它；见决策点 20 的固有边界）。
- 不动 4 条 dependabot 开放 PR 与 19 条 `refs/pull/*`（服务端引用，客户端不可删）。
- 不抄 OpenCode 或任何其它 harness 的文字与代码，只参考其**仓库卫生的标准构成**。

## 3. 验收判据（可机械验证）

1. 工作树内以下 token 家族出现次数均为 **0**：真实邮箱、真实姓名（提交元数据外）、本机用户名（含 8.3 短名）、本机工作区盘符路径、其它本机工作树路径。
2. `git log --format='%an <%ae>' | sort -u` 中只剩中性身份与 `dependabot[bot]`，无真实邮箱/姓名。
3. 替换后的工作树与改写后的 HEAD **逐字节一致**（`git status` 干净）。
4. 门禁：`npm ci` / `npx tsc -b tsconfig.json` / `npm run typecheck:tests` / `npm run test:all`（双 root）/ `npm run -w @vessel/web build` 全绿。
5. 远端 CI 双腿（Windows + Linux）success。

## 4. 证据（实测）

- **备份**：仓库外镜像 + 全 refs bundle（`git bundle verify` = *records a complete history*，707 提交）；改写前工作区干净（0 未提交条目）。
- **替换表**：与工作树脚本同源（同一份定义生成工作树替换与 `filter-repo --replace-text`），保存在仓库外备份目录（含被移除的原始值，故不入库）。
- **工作树**：142 文件受影响、904 增 / 904 删（对称 ⇒ 纯替换，无结构变化）。
- **门禁**：改写前后各跑一次全量，`npm run test:all` 双 root exit 0（根 + web 12 文件 / 129 项）、`npx tsc -b` exit 0、`npm run typecheck:tests` exit 0。
- **历史改写**：`git-filter-repo --mailmap --replace-text`，728 提交、15.14 秒；新 `main` 顶端 `aaca055`，709 提交。
- **身份核验**：全历史只剩 `Vessel Contributors <vessel@users.noreply.github.com>` 与 `dependabot[bot] <49699333+...>`。
- **内容核验**：`refs/heads/main` 与 `refs/tags/v0.10.0` 的完整内容扫描（**不加 `-I`，含二进制**）命中 **0**；132 个含指纹 blob 全部只由本地两个 `refs/codex/*` ref 可达。
- **决策记录**：`docs/DESIGN-DECISIONS.md` 决策点 20；`DEV_LOG.md` 2026-09-27 两条。
- **过程中发现并修掉的附带缺陷**：`packages/tools/src/git/worktree.test.ts` 的假 runner 把 detached 模式末尾的修订号 `HEAD` 当作 worktree 目标，导致每次跑测试都在仓库根造出 `HEAD/` 目录（使 `git show HEAD` 报 ambiguous argument）。

## 5. 已知残留

1. **本地两个 `refs/codex/turn-diffs/checkpoints/*`**：Codex 会话留下的检查点快照，指向树对象而非提交（所以既逃过 `git log` 也逃过按提交的扫描），其中含 100 / 132 个旧文件版本。**远端无此 ref（`git ls-remote 'refs/codex/*'` = 0 条），从未推送**。清理命令见第 6 节第 3 步（安全门禁禁止 agent 执行 ref 删除）。
2. **本地对象库仍含 132 个含指纹 blob**：全部仅由上述两个 ref 可达。推送只传输被推送 ref 可达的对象，因此**不影响公开面**；`git gc --prune` / `git reflog expire` 均被安全门禁拦截（不可逆丢弃对象），需由维护者自行决定是否清理。
3. **远端 4 条 dependabot 分支**（对应 4 个仍开着的 PR #17–#20）：分支顶端是旧历史的分支点，旧提交对象在服务端仍可达。可选处置：关闭这些过期 PR 并删分支。
4. **`refs/pull/*`（19+ 条）**：GitHub 服务端引用，PR 合并/关闭后仍保留，客户端无法删除；彻底回收旧对象需联系 GitHub Support 触发服务端 GC。
5. `secret_scanning_non_provider_patterns` / `validity_checks` 经 API 未能开启（secret scanning + push protection + dependabot 安全更新均已开启）。

## 6. 交接命令（维护者在自己的终端执行）

```powershell
cd C:\work\Vessel_Harness

# 1) 用改写后的历史覆盖远端 main（旧值 27f3844 作为 lease，防止误覆盖）
git push --force-with-lease=main:27f3844b35eef199e042b846b790ad7900f20601 origin main

# 2) 同步被改写的 tag（filter-repo 已重写本地 tag）
git push --force origin refs/tags/v0.10.0

# 3) 清掉本地 Codex 检查点 ref（含旧文件快照；本地独有）
git for-each-ref --format='%(refname)' refs/codex/ | ForEach-Object { git update-ref -d $_ }

# 4) 复验：远端 main 的作者身份不应再出现真实邮箱
git fetch origin
git log --format='%an <%ae>' origin/main | Sort-Object -Unique
```

第 3 步可选；第 4 步应只看到 `Vessel Contributors <vessel@users.noreply.github.com>` 与 `dependabot[bot]`。
