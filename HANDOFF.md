# HANDOFF — 项目交接

> **用途**：新会话 / 新 Agent / 换人接手时，**先读本文件**：现状、未完成清单、验证命令、已知约束都在这里。
> 规则本身仍在 [`AGENTS.md`](AGENTS.md)；会约束未来的决策在 [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md)。
> **最后更新**：2026-10-08。维护者：单人。

## 0. 快速接管协议（当用户直接说「继续未完成的」或「继续」时）

**任何 Agent 在接收到「继续」/「继续未完成的」指令时，直接根据本段与 `.agent-state/run-state.json` 向用户汇报并执行：**

1. **当前交付与阶段状态**：**V2.2 Epic 195（192–195）已于 2026-10-08 完成本地机械验收，未提交；双 Root 2911 passed / 6 skipped，构建、测试类型与 Web 构建 exit 0。证据 `evidence/sessions/2026-10-08-v2.2/PROOF.md`；独立安全评审受内容过滤阻断，不宣称安全审计 PASS。** **V2.0 已收官并独立核验 PASS**；**V2.1 Epic 191（188、189、190）于 2026-10-08 按人类批准的新性能 DoD 完成验收闭环，并已完成中性本地提交（commit `0533ebf9`）**。
2. **已完成与已验证基线**：
   - 188：请求确定性序列化、三段式前缀分层布局与 turn===0 压缩守卫；
   - 189：多供应商真实缓存计费命中率与多维透视遥测；
   - 190：工作区状态指纹与无进展死循环主动熔断器；
   - 191：Epic V2.1 前缀缓存经济学与收敛中枢总卡；
   - 全量终态门禁基线：`tsc -b`、`typecheck:tests` 均 exit 0；Web 生产打包 exit 0；`test:all` 双 Root **2,811 passed + 6 skipped 全绿**；全历史 `identity-guard.sh` 0 命中。
3. **当前路线与目标**：
   - **已完成路线：方向 B（V2.2 沙箱化 Mod 中间件网络与插件生态兼容，Epic 195）**：
     - 子任务顺序：192（洋葱中间件流水线）→ 193（Claude Mods 沙箱与防提权）→ 194（权限清单与 CLI Doctor）→ 195（全量集成与验收）；
   - **已完成本地验收路线：方向 C（V2.3 结构化代码感知与 Red→Green 门禁，Epic 199）**：
     - 子任务顺序：196（Red→Green 缺陷复现硬门禁）→ 197（轻量 AST 符号索引与依赖图谱）→ 198（变更影响面自适应上下文剪枝）→ 199（全量实战验收）；
   - **开发模式与约束**：纯本地开发（严禁 git push，遵循 2026-10-06 规约；薄核零侵入 packages/core；删除必进回收站）；
   - **模型锁定规约**：默认开发模型锁定为 **GPT-6.1 Sol (`gpt-6.1-sol`)**，二级思考（`reasoning.effort: medium`），免多余确认。

| 项 | 当前实况 |
|---|---|
| 仓库 / 分支 | `satan9394/vessel-harness` / `main`（纯本地开发，不推送） |
| 工作区状态 | V2.2 已验证但未提交；V2.3 已按批准的完整语义15/25指标完成本地验收；双Root2957passed/6skipped，全部类型/Web门禁exit0；无提交/推送 |
| 机器状态真源 | `.agent-state/run-state.json`（当前 Mission: Epic 199） |
| 当前任务卡 | 196–199 completed；交证入口 `evidence/sessions/2026-10-08-v2.3/PROOF.md`，原始失败和修复记录保留 |

V2.1 执行偏差：189 执行器三次默认 Vite 构建清空生成 `apps/web/dist`，违反任务删除纪律，已记录，不能声明红线全部遵守。后续 Web 构建必须加 `-- --emptyOutDir false`。为验证锁文件，本轮将旧 `node_modules` 完整移动到 `.tmp/2026-10-07/node_modules-before-epic191-npm-ci` 后执行 `npm ci`（exit 0）；备份保留，不清理。阶段性能实测本仓 1673 文件 warm 中位约 1285ms，见 `phase190-benchmark-final.log`，不得擅自降低验收标准。

V2.2 恢复点：四卡已闭环，所有门禁与 CLI 冒烟完成；packages/core 0 改动，依赖锁不变，未驱动外部 Agent，未提交/推送/发布。只支持无依赖预编译 JS Mod 子集。V2.3 已获新授权；既有未提交改动保留，独立基线哈希见 `evidence/sessions/2026-10-08-v2.3/baseline.json`。

V2.3 最终验收（2026-10-08）：196–199已completed，blocked解除。用户再次批准197完整递归引用/类型驱动刷新指标mean≤15ms、peak≤25ms；scoped12项图+4项工具全绿，独立12次真实更新mean10.767ms/peak21.405ms、精确率100%。最终test:all root258文件/2780passed+6skipped、Web20文件/177passed，合计2957passed/6skipped；tsc构建、测试类型、独立Web测试、带emptyOutDir=false的生产构建全部exit0，均在最后源码/测试编辑后运行。199真实组合Red1→Green0/Regression0、两次完成拒绝、SHA-256证明有效；198剪枝82.56%，静态前缀/任务/最近三轮保护。SQLite修复已通过最终全root，原5ms断言不变；core0、基线缺失0。机器Mission completed、workers0。证据 `evidence/sessions/2026-10-08-v2.3/PROOF.md`、completion-audit.json与accepted15-*.log；先前blocked检查点见PROOF-before15.md，失败日志/依赖备份全保留。纯本地未提交/推送，无外部Agent。下一步等待新任务授权，不自动推进新路线。

V2.1 历史恢复点：PowerShell session **47315 已完成 exit 0**，最后 source 编辑后的五项 accepted 门禁全部通过；根 236 文件 / 2634 passed / 6 skipped，Web 20 文件 / 177 passed。交付文件收齐后的最终性能日志 `accepted-final-fingerprint-benchmark.log` 通过 2026-10-08 人类批准的新指标。所有工作器、测试与门禁进程均结束；旧 failed/frozen/renewed/resumed 记录只作历史，未删改。SQLite <5ms 保持原标准；指纹原 <25ms 被人类明确替代，不再是阻断。

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
| A1 | **产品边界**：Epic 183 已本地实现原生沙箱；Windows ACL 预配置/真机验收、macOS 逃组生命周期、helper 缺失降级仍需按交付记录判断；`--live` 外部基线未做 | `README.md` 状态段、`docs/SANDBOX-WINDOWS.md` |
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
npm run -w @vessel/web build -- --emptyOutDir false # web 生产构建（peer 不一致只有构建会暴露）
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

> **执行模型约定**：当前开发主力模型锁定为 Codex（**GPT-6.1 Sol**，思考深度为二级 `reasoning.effort: medium`，共 5 级：`none`/`low`/`medium`/`high`/`xhigh`）。后续若切换模型维护者会显式说明，未说明前恒以本配置执行，无需重复询问确认。微小任务可切 `low`，攻坚任务可尝试更高等级；依据见 `AGENTS.md` 模型选型规约与 [OpenAI 官方选型指南](https://developers.openai.com/api/docs/guides/model-selection)。
> 若你要替换维护者的角色继续用 CLI 之外的 provider，注意**本仓不发布版本**，也不要顺手引入 pnpm/bun/yarn 锁文件（决策点 19）。

1. 本文件（现状 + 未完成清单）。
2. `AGENTS.md`（规则、硬性约束 10 条、禁做清单）。
3. `docs/DESIGN-DECISIONS.md` 决策点 **19 / 20 / 21**（包管理器、个人信息边界、不发布版本）。
4. `tasks/168-desensitize-and-public-hygiene.md`（脱敏与治理的完整范围与证据）。
5. `evidence/sessions/2026-09-27-desensitization-and-governance.md`（会话记录：§7 八个自省错、§8 未决、§10 接手入口）。
6. `evidence/sessions/2026-09-27-residual-exposure-audit.md`（残留暴露实测、依赖判断、Support 工单草稿）。
7. `DEV_LOG.md`（过程日志）、`CHANGELOG.md`（版本故事）。

- 2026-10-01：Epic 174（V1.5 / 170–173）本地实现及全部门禁通过，未提交。交付入口：docs/V1.5-IMPLEMENTATION-NOTES.md、tasks/174-epic-industrial-resilience-and-teams-mesh.md；根 2398 passed + 6 skipped / Web 141 passed，既有 task 169 改动保留。
- 2026-10-01（续）：Epic 179（V1.6 工业级团队工作台与常驻守护网格）立项启动：
  - 规划文档：`docs/V1.6-ROADMAP.md`，拆解任务卡 175–179；
  - 阶段一（任务 175：Web 交互式 DAG 画布与方案预审）已由 Codex 交付并测试全绿（`TeamDagCanvas.test.tsx` 5/5, `teamStageApi.test.ts` 5/5，`tsc -b` / `typecheck:tests` / `vite build` 均 exit 0）；
  - 因上游模型额度与算力限制，推进在阶段二（任务 176：后台常驻 Daemon 与系统通知）前挂起暂停；
  - 机器状态保存在 `.agent-state/run-state.json`，新会话开启后可通过 `/resume` 或直接执行阶段二无缝接管。

