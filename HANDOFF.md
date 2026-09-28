# HANDOFF — 项目交接

> **用途**：新会话 / 新 Agent / 换人接手时，**先读本文件**：现状、未完成清单、验证命令、已知约束都在这里。
> 规则本身仍在 [`AGENTS.md`](AGENTS.md)；会约束未来的决策在 [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md)。
> **最后更新**：2026-09-28。维护者：单人。

## 0. 一分钟现状

| 项 | 值 |
|---|---|
| 仓库 | `satan9394/vessel-harness`（**Public**，MIT） |
| 默认分支 | `main` = `cd9d7bf`，共 **728** 提交 |
| tag | `v0.10.0` → `4db3b6f`，**仅作提交标记**（不是发布） |
| GitHub Releases | **0 条**（按决策点 21 不发布版本） |
| npm 快照 | `composable-agent-harness@0.10.0`，**冻结不再更新** |
| 工作区 | 干净，本地与远端一致 |
| CI | `main` 推送与 PR 均全绿；必需检查 3 条 |

## 1. 治理与门禁（改动前必读）

- **本仓只做三件事**：提交 → PR 审核 → CI 测试。**不创建 GitHub Release、不向 npm 发布新版本**（决策点 21）。
- `main` 受规则集 `protect-default-branch`（id **23645929**）保护，必需检查 3 条：
  `build (ubuntu-latest, 22)`、`build (windows-latest, 22)`、`identity-guard`；另开启 strict（分支须与 `main` 同步）。
- **CI 触发**：`push` 只对 `main`；PR 走 `pull_request`；**tag 推送不触发 CI**（tag 只是提交标记）。
- 维护者本人仍在 `bypass_actors`（`bypass_mode: always`）里——**这是刻意保留的**：这样合并可以用"本地中性身份合并 + 普通推送"（main 的作者名保持统一），并保留一条应急直推通道。要改成硬墙的命令见审计文档 §F。
- **合并路径（推荐 A）**：建分支 → 推送 → `gh pr create` → 等三条必需检查绿 → 本地 `git merge --no-ff` → `git push origin main`。GitHub 会正确标记 PR 为 MERGED，且合并提交署名中性身份。
  - 网页端一键合并也可用，但合并提交会以账号提交身份 `xuanchen` 署名（网页端用 noreply 地址，**不会**带回被移除的邮箱）。

### 本机安全门禁会拦掉这些命令（不是权限问题，别再试）

`git push --force` / `--force-with-lease`（**含分支**的 force push）、`git update-ref -d`、`git gc --prune`、`git reflog expire`、`git restore --staged`、PowerShell `Remove-Item -Recurse -Force`。
门禁**预先扫描整条命令**：命令里出现被禁模式，整条（含前面的 `git add` / `commit --amend`）都不执行。
⇒ 需要 force push / 删 ref / 清对象的动作，**只能由维护者在自己终端执行**。

## 2. 最近做了什么（日志索引）

| 时间 | 内容 | 权威记录 |
|---|---|---|
| 2026-09-27 | 仓库转 Public；**全面脱敏**（工作树 142 文件 + **两次**全历史改写）；GitHub 治理定型（决策点 21）；身份守卫上线 | `evidence/sessions/2026-09-27-desensitization-and-governance.md` |
| 2026-09-27 | 残留暴露面逐项实测；三项依赖升级；规则集 bypass 重新判断后保留 | `evidence/sessions/2026-09-27-residual-exposure-audit.md` |
| 2026-09-28 | 文档与代码对齐：4 处死链、163–167 陈旧状态行、2 处作废的发布待办 | `DEV_LOG.md`（续 6/续 7）、上述审计文档 §H/§I |
| 2026-09-27 | 决策点 19（包管理器锁定 npm）、20（个人信息边界与一次性历史改写）、21（不发布版本） | `docs/DESIGN-DECISIONS.md` |
| 2026-09-25 | V1.3 双向子 Agent 网关体系交付合入（卡 163–167） | `CHANGELOG.md` `[Unreleased]`、`tasks/167-*.md` |

**过程日志**逐条在 `DEV_LOG.md`（2026-09-27 有续 1–续 7）。

## 3. 未完成清单

### 3.1 需要维护者本人做（Agent 做不了或不该代做）

| # | 事项 | 为什么要你做 | 状态/材料 |
|---|---|---|---|
| U1 | 发 **GitHub Support 工单**：清理 `refs/pull/*`（22 条）指向的旧对象 | Agent 无法以你名义对外提交 | 英文草稿已写好：审计文档 **§A-1**，可直接粘贴 |
| U2 | 决定 npm 元数据残留是否也开工单 | 同上；且 `_npmUser`/`maintainers` 仍是旧邮箱、已过 unpublish 72 小时窗口 | 审计文档 **§B**；倾向"接受单点残留"（本仓已不发布新版本，不会新增暴露） |
| U3 | 规则集 `bypass_actors` 是否收权 | 会改变你的合并习惯（见 §1 的取舍） | 命令在审计文档 **§F** |
| U4 | 清游离提交 `5092ed4`（可选） | 需要 `git gc --prune`，被门禁拦；内容仅为一次提交信息文本，无个人标识 | — |
| U5 | **真实 `--live` 跨 harness 基线**（若要跑） | 会驱动本机 `dsh` / `opencode` / `codex` / `claude` / `pi`，消耗你的配额 | `tasks/149`/`153`；**必须逐次显式授权**，`npm run bench:conformance -- --live` 永不自动跑 |

### 3.2 Agent 可以推进的（下次自主工作的建议清单）

| # | 事项 | 入口 |
|---|---|---|
| A1 | **产品能力**：README 三条已知边界——① 非 Windows 缺 OS 级沙箱（需原生 helper）② 未交付受限令牌/低完整性降权 ③ `--live` 基线未做 | `README.md` 状态段、`docs/SANDBOX-WINDOWS.md` |
| A2 | 环境补齐项：`release-report` 刷新（需配额确认）、Packaging gate 重跑（需 dist）、字面 3h 墙钟 soak | `tasks/README.md` 未闭合段、`docs/V1.6-STABLE-CHECKLIST.md` |
| A3 | Windows runner worker 启动抖动：**若再出现第二次**就立卡（可选缓解：给 CI 设 `maxWorkers`） | 审计文档 **§C**（已定义触发条件） |
| A4 | 文档诚实化（同类清扫已完成一轮，若有新发现同法处理） | 审计文档 §H/§I 的做法：区分「历史快照」与「面向行动的清单」 |

### 3.3 已知边界（不可能清掉的，别再尝试）

- **GitHub PR 页面**仍有旧身份：#12–#16、#17–#20 共 **9 个 PR** 的提交列表显示被移除的邮箱。PR 不能删除（只能关闭），其提交列表由 PR 自身持有，**不依赖 git 对象**——即使 Support 清了对象，页面大概率仍显示。
- **npm registry 元数据**里的 `_npmUser` / `maintainers` 是发布当时的快照，改文件改不到。
- **服务端旧对象**在 GitHub GC 之前可能仍可按 SHA 取到（客户端无能为力）。

## 4. 验证命令（接手先跑一遍）

```powershell
npm ci                          # 可复现安装；锁文件与 package.json 不一致会直接失败
npx tsc -b tsconfig.json        # 类型 + 编译
npm run typecheck:tests         # 测试文件类型检查（非 composite）
npm run test:all                # 全量 = 根 + apps/web 两个 root
npm run -w @vessel/web build    # web 生产构建（peer 不一致只有构建会暴露）
bash scripts/identity-guard.sh  # 身份守卫（Git Bash / WSL / Linux / macOS 可跑）
gh pr checks                    # 某个 PR 的必需检查
```

预期：以上全部 exit 0；`identity-guard` 打印 `no denylisted commit identities in this history`。

> 已知抖动：Windows runner 上偶发 `Worker exited unexpectedly with exit code 3221225794`（`0xC0000142`）。**与代码无关**——同提交重跑即绿（已有实例，见审计文档 §C）。处置：`gh run rerun <id> --failed`。**再出现第二次就立卡。**

## 5. 严格纪律（越界会被机器拦下或造成不可逆后果）

- **删除**：仓库内一切删除走回收站（`trash` 工具 / `SHFileOperation` + `FOF_ALLOWUNDO`）。唯一书面例外：**测试自己新建、且位于 `os.tmpdir()` 之下**的临时目录。
- **不改写已推送历史**：禁止 force push。唯一书面例外是 2026-09-27 的一次性全历史脱敏（决策点 20），已用完。
- **不自动驱动本机其它 agent**（`dsh`/`opencode`/`codex`/`claude`/`pi`）：需逐次显式同意。
- **提交身份**：本仓 `user.name`/`user.email` 已设为中性（`Vessel Contributors <vessel@users.noreply.github.com>`）。**换机器或换 Agent 后先确认这两项**——历史上正是因为改写后新提交从本机配置取回真实身份，才把它重新带进了公开历史（决策点 20 的事故记录）。
- **暂存文件**：需要先落文件再入库的中间产物放**当天日期目录**并用点号前缀（`.tmp-*`），不要用系统临时目录。

## 6. 从哪里接手（阅读顺序）

### 冷启动三步（新会话先跑，自证环境）

```powershell
git log --oneline -3   # 确认在 main、认准最新提交
git status -sb         # 应为干净（出现未提交改动 → 先问维护者）
npm ci                 # 依赖与锁文件一致；随后可跑 §4 的完整门禁
```

> 若你要替换维护者的角色继续用 CLI 之外的 provider，注意**本仓不发布版本**，也不要顺手引入 pnpm/bun/yarn 锁文件（决策点 19）。

1. 本文件（现状 + 未完成清单）。
2. `AGENTS.md`（规则、硬性约束 10 条、禁做清单）。
3. `docs/DESIGN-DECISIONS.md` 决策点 **19 / 20 / 21**（包管理器、个人信息边界、不发布版本）。
4. `tasks/168-desensitize-and-public-hygiene.md`（脱敏与治理的完整范围与证据）。
5. `evidence/sessions/2026-09-27-desensitization-and-governance.md`（会话记录：§7 八个自省错、§8 未决、§10 接手入口）。
6. `evidence/sessions/2026-09-27-residual-exposure-audit.md`（残留暴露实测、依赖判断、Support 工单草稿）。
7. `DEV_LOG.md`（过程日志）、`CHANGELOG.md`（版本故事）。
