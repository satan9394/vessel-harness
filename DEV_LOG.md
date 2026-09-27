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

