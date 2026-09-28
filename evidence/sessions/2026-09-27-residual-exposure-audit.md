# 2026-09-27 · 残留暴露面审计与依赖升级判断（会话记录 · 续）

> **性质**：接 `2026-09-27-desensitization-and-governance.md`。该次会话把"未决 5 项"交给维护者；本文是对这 5 项（以及期间新冒出的问题）**逐项实测**后的结论与决策。
> **纪律**：与前述脱敏同一纪律——不写真实标识、不写本机绝对路径。
> **一句话结论**：仓库与 CI 这一侧已经干净；**两处不在我们手里、改文件改不到**的暴露仍在（GitHub 的 PR 页、npm 的已发布包元数据）；依赖四项里两项值得升、一项不建议升、一项证据支持但风险需构建验证。

## A. GitHub 上仍可见旧身份的残留（实测）

**事实**：逐 PR 拉 `pulls/N/commits` 检查作者邮箱，22 个 PR 中 **9 个仍在页面上展示被移除的真实邮箱**：

| PR | 状态 | 现象 |
|---|---|---|
| #12–#16 | closed | 你自己的修复 PR，1~4 条提交作者是真实邮箱 |
| #17–#20 | closed | dependabot PR：因它们的分支基于**改写前**历史，PR 页把整段旧历史都列成了"本 PR 的提交" |

另有 **22 条 `refs/pull/*`** 服务端引用（远端 ref 共 26 条 = main + tag + 22 PR ref + …），旧提交对象因此仍可达。

**能做与不能做**：
- **不能**：删除 PR（GitHub 只允许关闭）；删除 `refs/pull/*`（客户端不可删）；改写别人的 PR 记录。
- **已做**：相关 PR 全部处于 closed（#17–#20 由 GitHub 在改写那一刻自动关闭）；分支已删。
- **唯一的杠杆**：给 GitHub Support 发工单，请其清理 `refs/pull/*` 指向的旧对象并移除缓存视图。**结果不保证**，但这是唯一剩下的动作。工单草稿见 §A-1。
- **判断**：即使工单成功，PR 页面上的提交列表（**由 PR 本身持有，不依赖 git 对象**）大概率仍会显示那些提交的作者名/邮箱。所以这条要如实告诉维护者：**"全面脱敏"在 GitHub 侧有硬上限**，能清的是仓库历史，清不掉的是 PR 页面记录。

### A-1 Support 工单草稿（可直接粘贴）

> **Subject**: Request to purge unreachable commits from a force-pushed history (repo: satan9394/vessel-harness)
>
> Hello,
>
> During a history rewrite on 2026-09-27 I replaced the repository history of `satan9394/vessel-harness` (default branch `main`) to remove a personal email address and machine-local paths from commit metadata and file contents. The rewrite itself is complete: `main` and the tag now contain only the sanitised history, verified by a CI guard over the full commit range.
>
> The old commits, however, are still reachable through the pull-request refs (`refs/pull/*`, 22 refs). Could you please:
> 1. remove the objects reachable only from `refs/pull/*` (the pre-rewrite commits), and
> 2. run any server-side cleanup needed so those objects are no longer retrievable by SHA?
>
> If removing pull-request refs is not possible, please tell me what the supported options are — I understand that PR pages themselves may be outside the scope of a rewrite.
>
> Thank you.

## B. npm 已发布包：真实邮箱仍在 registry 元数据里（实测）

**事实**：`composable-agent-harness@0.10.0` 的 registry 元数据中：

| 字段 | 值 |
|---|---|
| `maintainers` | `[{name: "chensatan13", email: <被移除的真实邮箱>}]` |
| `_npmUser` | 同上 |
| `repository.url` | `git+https://github.com/satan9394/composable-agent-harness.git`（旧仓名） |
| `homepage` | 同上（旧仓名） |

**为什么改不动**：npm 的 unpublish 只允许在发布后 **72 小时**内，该版本发布于 2026-09-14，早已超期；deprecate 只加提示、不删元数据；registry 里该版本的 `_npmUser` 是**发布当时的快照**，将来改账号邮箱也不会回溯修改它。

**可选动作（按性价比排序）**：
1. **什么都不做**：本仓已决定"不发布新版本"（决策点 21），所以不会再有新增暴露；这一处是历史单点。
2. 想彻底清：只能是 npm Support 工单（理由：个人信息），**成功率同样不保证**。
3. 降低未来风险：若哪天恢复发布，改用中立账号/中立邮箱发布，并在 `package.json` 里显式写 `author`（当前 `author` 为 `null`，所以暴露的是 `_npmUser` 而非 `author`）。

## C. main CI 一次失败：Windows worker 启动失败（已处置）

**事实**：合并会话记录后 main 的 push run `36385562028` 在 `build (windows-latest, 22)` 的测试步骤以 exit 1 结束，报错为重复的

```
Caused by: Error: Worker exited unexpectedly with exit code 3221225794 during starting state
```

前后可见 `Test Files 56 passed (56)`；**EPERM 命中 0**。

**定性**：`3221225794 = 0xC0000142`（STATUS_DLL_INIT_FAILED）——Node worker 在这台 2 核 Windows runner 上**起不来**，属资源压力型基建抖动；既不是仓库文档里记载的 EPERM 原子改名 flake，也不是代码回归（同一提交的 ubuntu 腿与 identity-guard 全绿；PR #22 的同一份内容三条检查也都绿）。

**已处置**：`gh run rerun <id> --failed` 重跑失败腿。

**留作提案（本次不做）**：根因是根套件在 `isolate` 下会 spawn 上百个 worker（日志自述 186 个）。可选缓解是给 CI 设 `maxWorkers`（如 2~4）。**不做的理由**：① 全量测试耗时与超时余量的账要重算（本仓有显式 120s 超时的大队列用例）；② 一次抖动不足以支撑改测试执行语义；③ 仓库既有处置口径就是"抖动 → 重跑"（`ci.yml` 注释里写明）。**若再出现第二次，就值得立卡收掉。**

## D. 依赖升级逐项判断（含实测证据）

| 依赖 | 现值 | 目标 | 类别 | 证据 | 决策 |
|---|---|---|---|---|---|
| `@clack/prompts` | 1.7.0 | **1.8.1**（latest） | 运行时（全仓唯一） | 仅 minor；`engines.node >=20.12` 与本仓 `>=20` 兼容 | **升**（用 `npm update` 只改锁文件，`package.json` 的 `^1.7.0` 不动） |
| `tsx` | 4.23.13 | **4.23.15**（latest） | dev 工具 | patch；`engines >=18` | **升**（同上，锁文件级） |
| `@vitejs/plugin-react` | 5.2.0 | **6.1.1**（latest） | dev / web 构建 | 必需 peer 只有 `vite ^8.0.0`（本仓 `^8.3.0` ✓）；`oxc-transform-react` / `@rolldown/plugin-babel` / `babel-plugin-react-compiler` **三个都是 optional**，默认路径不变；5.2.0 与 6.0.0 是同一天相隔 11 分钟发布，6.x 是"仅支持 vite 8"的那条线——与本仓一致 | **升**，但**单独一个提交**，靠 CI 的 `vite build` + web 套件验证，失败可独立回退 |
| `@types/node` | 22.20.1 | 26.6.2（现 latest 26.6.3） | dev 类型 | 类型跨到 Node 26，而 `package.json engines >=20`、CI 跑 22 | **不升**。理由：类型比运行时新 = 给"类型通过、运行挂掉"开门；要升得连 `engines` 与 CI 一起谈 |

## E. 决策汇总

**做**：① 重跑失败的 Windows 腿；② `@clack/prompts` + `tsx` 锁文件级升级；③ `@vitejs/plugin-react` 6.1.1（独立提交，构建验证）；④ 本文落盘；⑤ 给维护者工单草稿（§A-1）。

**不做（含理由）**：① `@types/node` 26（见 §D）；② 改 vitest 并发配置（见 §C，留作提案）；③ 关闭/删除 PR 或 `refs/pull/*`（做不到，见 §A）；④ **不移除规则集的 `bypass_actors`**——见 §F。

## F. 关于"规则集收权"的重新判断（本次决定不动）

原提议：把 `protect-default-branch` 的 `bypass_actors` 改成 `[]`，让"必须走 PR"对维护者也成为硬墙。

**改判理由**（实测得出）：
1. 维护者的 GitHub 账号提交身份是 `xuanchen <105955691+satan9394@users.noreply.github.com>`（PR 的合成合并提交即用它署名）。移除 bypass 后只能走网页/API 合并，**每条合并提交都会以该账号身份署名**（网页端用 noreply 地址，不会带回真实邮箱，但显示名会与 `Vessel Contributors` 混排）。
2. 保留 bypass 则仍可走"本地用中性身份合并 + 普通推送"（本会话两次都是这条路），main 的作者名保持统一，且保有一条应急直推通道（例如将来再需要一次性历史处置）。
3. 风险对比：规则集**已经**拦住所有非 bypass 的直推（`non_fast_forward` / `pull_request` / 必需检查三条），维护者是唯一 actor；把 bypass 也去掉带来的边际安全收益，小于作者名混排 + 失去应急通道的代价。

**若维护者仍要硬墙**：一条 API 即可，且可从服务端现取配置，不需要仓库里留任何文件：
```powershell
gh api repos/satan9394/vessel-harness/rulesets/23645929 > ruleset.json
# 把 ruleset.json 里的 bypass_actors 改成 []，然后：
gh api -X PUT repos/satan9394/vessel-harness/rulesets/23645929 --input ruleset.json
```

## G. 更新后的未决清单

1. **GitHub Support 工单**（§A-1 草稿可直发）——决定权在维护者，agent 无法代发。
2. **npm 元数据**：接受单点残留，或另发 npm Support 工单（§B）。
3. **仓库外备份目录**：本次审计后其回退价值已归零，可清（内含被移除的原始值，长期留着反而是本地泄漏面）。
4. **规则集 bypass**：本次决定保留（§F）；要收权用 §F 的两条命令。
5. **两处本地垃圾**：游离提交 `5092ed4`、引用 `refs/remotes/oc/pr21-merge`（agent 无权删 ref）。
6. **新）：Windows runner worker 启动抖动**——已定义"再出现第二次就立卡"的触发条件（§C）。
