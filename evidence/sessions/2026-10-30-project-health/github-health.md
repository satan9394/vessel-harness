# GitHub 项目健康清单（satan9394/vessel-harness，2026-10-30 实测）

> 每条都来自实际命令，不是从旧文档抄的。旧文档（HANDOFF「远端 GitHub 状态（2026-10-06）」）里
> 「Actions 已整体停用 / CodeQL 未配置 / 不再触发任何 CI」**与实测不符**，见 §1。

## 1. 仓库与安全姿态

| 项 | 实测 | 命令 |
|---|---|---|
| 可见性 / 归档 | **PUBLIC**，未归档，issues 开启 | `gh repo view` |
| 默认分支 | `main` | 同上 |
| 描述 | 原写 `(TypeScript, Node >=20)` → **已改为 `Node >=26`** | `gh api --method PATCH repos/…` |
| Topics | 9 个（agent / agent-harness / cli / llm / local-first / nodejs / policy-engine / typescript …） | `gh api repos/…/topics` |
| Actions | **enabled = true**（`allowed_actions: selected`，`sha_pinning_required: true`） | `gh api repos/…/actions/permissions` |
| CodeQL | **default setup = configured**（javascript / typescript / python / actions，weekly） | `gh api repos/…/code-scanning/default-setup` |
| CodeQL 开放告警 | **0** | `gh api "…/code-scanning/alerts?state=open"` → `[]` |
| Dependabot 漏洞告警 | **0**（接口 204） | `gh api repos/…/vulnerability-alerts` |
| Secret scanning 开放告警 | **0** | `gh api "…/secret-scanning/alerts?state=open"` → `[]` |
| 最近一次 CI / CodeQL 运行 | Dependabot Updates `2026-10-30T10:13:54Z` success；CodeQL 分析 `2026-10-18T20:07:27Z`（该次 2 条结果，现开放告警 0） | `gh run list`、`gh api …/code-scanning/analyses` |

## 2. 分支保护

规则集 `protect-default-branch`（id **23645929**）`enforcement: active`：

- 禁止删除、禁止 non-fast-forward；
- 必须走 PR；
- **必需状态检查**：`build (ubuntu-latest, 22)`、`build (windows-latest, 22)`、`identity-guard`，且 `strict_required_status_checks_policy = true`（分支必须与 main 同步）。

**这与本地 `ci.yml` 的版本矩阵强耦合**：本地已把 matrix 改成 `[22, 26]`（不是只留 26），原因就是这组 required context 里写着 `22`——只留 26 会让这两个必需检查永远不出现，PR 永久 pending。顺序必须是「先让 26 的 check 在远端跑绿 → 改 ruleset 的 context → 再从 matrix 删掉 22」。

## 3. 开发面

| 项 | 值 |
|---|---|
| 开放 issue | **0** |
| 开放 PR | **6**，全是 Dependabot（见 §4） |
| 远端分支 | `main` + 6 条 `dependabot/*` + `feat/v2.8-taste-ui` |
| Tag | `v0.10.0`（唯一） |
| Release | 无（符合「不发布新版本」的约定） |
| 远端 `main` 落后本地 | **169 个提交**（远端 `b147ae4`，2026-10-11；本地已含全部卡 365–369 的工作） |

## 4. 六条 Dependabot PR（含 CI 结论）

| PR | 目标 | 三条必需检查 | 失败步骤 |
|---|---|---|---|
| 39 | actions/setup-node 7.0.0 → 7.1.0 | 全 success | — |
| 40 | @vitejs/plugin-react 6.1.1 → 6.1.2 | 全 success | — |
| 42 | vite 8.3.3 → 8.3.4 | 全 success | — |
| 45 | vitest 5.0.3 → 5.0.5 | 全 success | — |
| 44 | react 19.3.0 → 19.3.1 | **2 红** | `Test (vitest — root + apps/web)`，两条 os leg 都红 |
| 43 | @types/node 22.20.1 → 26.6.5 | **2 红** | `Typecheck web`，两条 os leg 都红 |

注意：这些 PR 都基于 **169 个提交之前**的 main，红灯未必代表现在也会红。

## 5. 本轮修了什么

1. **本地依赖漏洞 4 → 0**：`vite 8.3.0 → 8.3.5`、`vitest 5.0.1 → 5.0.5`、`source-map-js → 1.2.2`（传递依赖）。**只有 `package-lock.json` 变化，`package.json` 未动**（都在原 semver 区间内），`npm ci` exit 0、`npm audit` 4 类计数全 0、`npm install-scripts ls` 无未审项。
2. **仓库描述**的 `Node >=20` → `Node >=26`。
3. **CI matrix** 由单值 26 调整为 `[22, 26]` 并加注释说明与 ruleset 的耦合（原因见 §2）。
4. **文档纠错**：HANDOFF 的 GitHub 段从「已停用 / 未配置」改为本文件的事实口径。

## 6. 看到但没动（附原因）

- **169 个提交未推**：与「纯本地开发、不推送」的约定一致；推送会同时触发 CI（22+26 两腿）、CodeQL 重扫与 Dependabot 重新评估，属策略变更，需要明确授权。
- **6 条 Dependabot PR**：不推送就合不了；其中 vite / vitest 两条的目标版本已被本地升级覆盖（本地更靠前：8.3.5 与 5.0.5）。关掉它们会在一周后被 Dependabot 重新开出来，除非改 `dependabot.yml` 的策略，所以留着并在此登记。
- **ruleset 的 required context 仍是 22**：必须与 CI matrix 成对改，且顺序不能反（见 §2），留作推送时的动作。
- **两条 CodeQL 结果（2026-10-18）**：当前开放告警 0，说明已处置；不再追旧记录。

## 7. 唯一需要拍板的一件事

**是否恢复推送。** 若不恢复，本文件就是当前能给出的最全结论，仓库处于「本地领先、远端审计信号过期」的已知状态。若恢复，建议顺序：

1. 本地先全量绿（当前 17/17）；
2. 推 `main`，让 CI 跑 22 + 26 两腿；
3. 两腿都绿后，把 ruleset 的 required checks 改成 `build (…, 26)`，再从 `ci.yml` 删掉 22；
4. 关掉 6 条 Dependabot PR（本地已升级到更靠前的版本），或让它们重开后再按需合并。
