# 任务卡 369: 项目健康——依赖漏洞清零 + GitHub 仓库状态审查

- Status: 已完成（2026-10-30，协调者执行并自验）：依赖漏洞 4 → 0（vite 8.3.5 / vitest 5.0.5 / source-map-js 1.2.2，仅 lockfile 变），`npm ci` 0、web build 0、全量 17/17（根 3,726 / 8 skipped、web 61 / 543）；GitHub 侧描述改 Node ≥26、CI matrix 改 `[22,26]`（耦合 ruleset）、AGENTS 的 GitHub 段按实测重写。清单见 `evidence/sessions/2026-10-30-project-health/github-health.md`
- PDW task: none
- 来源：卡 368 收口时 `npm ci` 报 4 个漏洞（2 moderate / 2 high，npm 12 审计口径）；同时 GitHub 仓库自 2026-10-24 起没有再推送，描述里还写着 `Node >=20`。

## 1. 现状（2026-10-30 实测）

**依赖漏洞（`npm audit`，全部落在 dev 依赖链上）**：

| 包 | 严重度 | 受影响范围 | 说明 |
|---|---|---|---|
| `vitest` | moderate | 5.0.0-beta.1 – 5.0.2 | 经 `@vitest/mocker`：未认证的 manual mock 注册可致代码注入；Windows 反斜杠穿越绕过 redirect allowlist |
| `@vitest/mocker` | moderate | 同上 | 同上 |
| `vite` | high | 8.3.0 – 8.3.2 | 多条：`launch-editor` 的 `%` 转义缺失、编辑器 CLI 参数误判（部分编辑器可致任意命令执行）、Windows 存在性检查绕过（high）、跨源脚本执行、`server.fs.allow` 越界读、`?vite-wasm-instance` 泄漏前 4 字节 |
| `source-map-js` | high | 1.0.0 – 1.2.1 | 索引式 source-map 段偏移导致事件循环 DoS |

四个都 `fixAvailable: true`，属补丁级。**注意**：`vite` 与 `vitest` 同时是构建与测试工具链，升级后必须重跑全量门禁；`source-map-js` 是 `vite` 的传递依赖，靠 lockfile 抬版本。

**GitHub（`satan9394/vessel-harness`）**：PUBLIC、默认分支 `main`、issues 开启、未归档、`pushedAt` 2026-10-24T15:32:34Z（本地 `main` 之后又累积了若干提交，按仓库约定**不推送**）。描述文本仍写 `(TypeScript, Node >=20)`。

## 2. Goal

1. **依赖**：把 4 个漏洞清零（`npm audit` 0/0/0/0），且**只做补丁级升级**——不动大版本、不改产品代码；升级后用 `npm ci` 验 lockfile、跑全量门禁。
2. **GitHub**：给出一份可核对的健康清单（Actions 权限、分支保护/规则集、Dependabot/CodeQL/secret-scanning 告警、开放 issue/PR、远端分支与 tag、本地与远端差距），并**修掉能修且有明确收益的**（描述里过期的版本声明、遗留远端分支等）；不能修的写清原因。
3. 全程遵守仓库约定：**不推送、不发布、不删仓库/主分支、不 force push、不启用 Actions**（除非用户另行授权）。

## 3. Acceptance

- A1 `npm audit --json` 在修复后 4 类计数全 0；`npm ls vite vitest source-map-js` 显示新版本；`package.json` 里只有补丁级 semver 变化（或说明为何必须动 minor）。
- A2 `npm ci` exit 0（lockfile 与 package.json 一致），`npm install-scripts ls` 无未审项（esbuild 仍被批准）。
- A3 全量门禁 17/17 exit 0（Node 26），根/web 测试数不低于 3,726 + 8 / 543；若因工具链升级导致数量变化，逐个说明。
- A4 GitHub 健康清单落盘（`evidence/sessions/2026-10-30-project-health/github-health.md`），每条含命令与原始输出摘要；修过的项写「改前 → 改后」。
- A5 明确列出「看到了但没动」的项与原因（例如：Actions 停用是既定策略、本地领先远端是因不推送约定）。

## 4. Blast Radius

`package.json` / `package-lock.json`（补丁升级）、GitHub 仓库元数据（描述/主题）、远端陈旧分支（仅在明确安全时），以及本卡与证据目录。**禁止**改 `apps/**`、`packages/**` 源码与测试；禁止推送 `main`、禁止启用 Actions、禁止动 branch protection 的必需检查项。

## 5. Result

已完成（2026-10-30，协调者执行并自验）。

**依赖（A1–A3）**

- `npm audit fix`（**未用 `--force`，`package.json` 未动**）：`vite 8.3.0 → 8.3.5`、`vitest 5.0.1 → 5.0.5`、`source-map-js → 1.2.2`（传递依赖），`package-lock.json` +162/−168。
- 修复后 `npm audit --json` → `{info:0, low:0, moderate:0, high:0, critical:0, total:0}`；`npm ls vite vitest source-map-js @vitest/mocker` 显示 8.3.5 / 5.0.5 / 1.2.2 / 5.0.5。
- `npm ci` **exit 0**（115 包 / 23s）——lockfile 与 manifest 一致；`npm install-scripts ls` 无未审项（esbuild 仍被批准）。
- `npm run -w @vessel/web build` **exit 0**（vite 升级后仍能构建）。
- 全量门禁 **17/17 exit 0**：根 **335 文件 / 3,726 passed + 8 skipped**、web **61 / 543**、三处 tsc exit 0、conformance 25/25 $0，日志 `%TEMP%/vessel-gate-f192ec09`。**测试数与升级前完全一致**，没有用例被跳过或改写。

**GitHub（A4–A5）**：完整清单见 `evidence/sessions/2026-10-30-project-health/github-health.md`。摘要：

- 安全面：CodeQL `configured`、开放告警 **0**；Dependabot 漏洞告警 **0**；secret scanning 开放告警 **0**。
- 治理面：ruleset `protect-default-branch` active，必需检查仍是 `build (ubuntu-latest, 22)`、`build (windows-latest, 22)`、`identity-guard`，strict=true。
- 开发面：开放 issue **0**；开放 PR **6**（4 绿 2 红——react 19.3.1 红在 `Test (vitest)`，@types/node 26.6.5 红在 `Typecheck web`）；tag 仅 `v0.10.0`；无 Release。
- **本地领先远端 169 个提交**（远端停在 `b147ae4` / 2026-10-11）。

**修掉的**

1. 4 个依赖漏洞清零（见上）。
2. 仓库描述 `Node >=20` → **`Node >=26`**。
3. `.github/workflows/ci.yml` matrix 26 → **`[22, 26]`**：ruleset 的必需 context 写着 22，只留 26 会让那两个检查永不出现；yaml 里已加注释说明顺序（先让 26 的 check 在远端绿 → 改 ruleset → 再删 22）。
4. `AGENTS.md` 的「远端 GitHub 状态」段按实测重写：旧文说「Actions 已整体停用 / CodeQL 未配置」，实测都是反的（`enabled=true`、`configured`，且 main 上仍有 Dependabot 定时运行，最近 `2026-10-30T10:13:54Z` success）；同时把「恢复命令」标注成「现在已经是启用状态，别再重复恢复」。

**没动的（附原因）**

- **推送**：169 个提交未推，符合既有约定；恢复推送会同时触发 CI（22+26 两腿）、CodeQL 重扫与 Dependabot 重评，属策略变更，需要明确授权。
- **6 条 Dependabot PR**：不推送就合不了；vite / vitest 两条的目标版本已被本地升级超越（本地 8.3.5 / 5.0.5），两条红的基于 169 提交前的 main，结论未必适用于现在。
- **ruleset 的必需 context**：必须与 matrix 成对改且顺序不能反，留作推送时的动作。
