# 任务卡 346: 删除与保留的收口（跨平台、门禁、文档、回滚）

- Status: 已验收（2026-10-27，本地契约 + 文档 + 六条对抗；真机边界明示：Windows 目录符号链接未实测、Linux/macOS 原生回收未实测）
- PDW task: none
- 前置：343 → 344 → 345

## 1. Goal

把 343–345 的产物验成一个可交付的状态：跨平台行为有据可查、文档与代码一致、失败可回滚，并且没有把「永久删除」的口子开到 trash 根之外。

## 2. 要做的事

1. 跨平台矩阵（本机只能真跑 Windows，其余记录为「未实测」并写明判据）：Windows 真跑（回收站 + trash + purge）；Linux 用 `gio` 存在与否两种分支的单测；macOS `osascript` 只做命令形态单测。**不宣称未实测的平台已验证。**
2. 权限与逃逸复核：对 trash 根做一次对抗检查——`..`、目录符号链接、junction 指向外部、手工伪造 `entry.json`、把 `expiresAt` 改成过去但 origin 在 trash 外，逐条确认拒绝且不删任何东西。
3. 文档收口：`docs/DELETION-AND-RETENTION.md` 去掉「实现未开工」标记；`AGENTS.md` 删除铁律的例外二与实现口径对齐（TTL 键名、CLI 名）；`HANDOFF.md` §1/§4 增补 `vessel trash` 与门禁命令；`docs/PROVIDER-MANAGEMENT.md` 之类提到删除的章节交叉引用一次。
4. 回滚说明：把「关掉自动清理」（TTL=0）、「把会话删除退回系统回收站」（单点开关或 revert 345 的删除改道）、「整批回退」三档写进文档。
5. 卡 259 / 261 的验收描述按新口径更新（历史证据保留，不重写正文）。

## 3. Not Doing

- 不新增第 9 道 gate；不把 purge 做成自动后台常驻任务（只在 serve 启动与 daemon tick 触发）。
- 不为跨平台补 CI（Actions 已停）。
- 不改既有 8 道 gate 的判据。

## 4. Acceptance

1. 跨平台矩阵表落盘，实测/未实测分列，未实测项写明「需要什么环境」。
2. 六条对抗用例全部拒绝且事后 `trash list` 与磁盘状态一致（没有误删）。
3. 文档与代码一致：`grep` TTL 键名、CLI 子命令、错误码三者在文档与实现中各只有一种写法。
4. 三档回滚说明可照做（其中「整批回退」给出 `git revert` 的卡号范围）。
5. 门禁：`scripts/gate-batched.ps1` 17 步全 exit 0；记录根与 web 的测试计数。

## 5. Blast Radius

文档（`docs/`、`HANDOFF.md`、`AGENTS.md`、卡 259/261/345）、以及 343–345 的测试补充。产品逻辑若需改动，回到对应卡改，不在本卡顺手改。

## 6. Expected Evidence

跨平台矩阵表、六条对抗用例的实际返回、文档一致性 `grep` 结果、门禁 17 步退出码与计数。

## 7. Result

### W3 实现与定向自验（2026-10-27；最终验收待协调者）

- 模型路由：`gpt-6.1-sol` / `medium`，依据第三波 W3 表（安全边界测试 + 多文档收口）；Fast 关闭。无模型升级、无子代理、无其它 Agent CLI、无 PDW/commit/分支操作。
- **本轮用户明确修订原 §2/§4 的第六条验收**：不再要求“合法伪造 entry.json 必须拒绝”，而要求“即使元数据伪造，purge 也不得删除/修改 trash 根外的内容”。允许给 `trash.ts` 添加最小 restore 目的地护栏，并修改 `trash.test.ts` 夹具；不加入签名、HMAC、token、manifest、数据库或其它来源认证。这一修订优先于卡正文的旧“六条全部拒绝”措辞，正文历史保留。
- 改动八个文件：`trash.ts` 在任何 mkdir/写入前验证 session origin 为 `<workspace>/.harness/sessions/<id>`（绝对路径/根外及无链接父链由既有 `readEntry`/`noLinks` 执行）；`trash.test.ts` 把原 session 夹具迁到合法布局，并按真实源目录修正跨卷备份断言；新增 `trash.escape.test.ts`、`daemonRecycle.posix.test.ts`；`docs/DELETION-AND-RETENTION.md` 修正 TTL/CLI/错误/审计字段、跨平台矩阵及三档回滚；`AGENTS.md` 只改例外二①；`HANDOFF.md` 只改删除约束一行；本卡只填 Result。
- 六条对抗：`..`、目录链接谓词、原生 Windows junction、把新条目 expiresAt 改到 deletedAt 之前、缺 entry.json 均拒绝并比较真实磁盘全树（名称/类型/字节/链接目标）及 list；合法伪造条目真实 purge 仅移除根内条目，根外 origin 目录及全部内容不变。另测不合会话布局的伪造 restore 在创建父目录前拒绝、链接父链拒绝、合法 session 目的地恢复成功。`origin` 在 trash 外本来就是正常恢复契约，不把根外 origin 自身误判为逃逸。
- 首轮 application 自验真实失败：exit **1**，**36 文件：35 passed / 1 failed；303 passed / 1 failed / 2 skipped（306）**，89.11s。唯一失败是 Windows 原生目录符号链接创建 `EPERM`；原始日志 `C:/work/AppData/Local/Temp/vessel-wave3-bAVg76/w3-application.log` 保留。立即停下报告后，协调者明确授权有限夹具修复：POSIX 保留真实目录符号链接；Windows 用类型明确的 `fs.Stats.prototype.isSymbolicLink` 谓词 seam + 真实磁盘快照，保留真实 junction；没有跳过/放宽拒绝与磁盘不变断言，没有改权限、加 sleep 或重试原生命令。Windows 原生目录符号链接仍 **UNVERIFIED**，需有相应权限的环境；环境失败未升级模型。
- 最终代码编辑后的完整定向自验：
  - `node node_modules/vitest/vitest.mjs run packages/application` → exit **0**，**36 文件 / 308 passed + 3 skipped（311）**，80.13s；`w3-application-final.log`。其中新增 POSIX 真实目录符号链接用例在 Windows 平台跳过，其余两个跳过为既有测试。
  - `$env:VESSEL_TRASH_TTL_DAYS='0'; node node_modules/vitest/vitest.mjs run apps/local-server` → exit **0**，**27 文件 / 316 passed**，143.67s；`w3-local-server-final.log`。环境变量仅限该测试子进程，保护普通 cwd 夹具；专用 retention 用例自行覆盖 7/0，真实操作自己的临时数据。两条原生命令回收测试及 345c/358 trash/purge 测试均在此完整包检查中通过，具体名字见文档 §8。
  - Linux gio 存在/不存在、macOS osascript 三条命令单测均包含在 316 passed 中，注入 runner、未调用原生 POSIX 命令；Linux/macOS 原生集成 **未实测**，所需环境见文档矩阵。
  - 协调者在最终产品编辑后串行运行 `node node_modules/typescript/bin/tsc -b tsconfig.json` → exit **0**（`w3-tsc-build.json`）；`node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` → exit **0**（`w3-tsc-tests.json`），均在同一临时证据目录。此两项由协调者执行，本实现者只记录其证据回报。
- 三档回滚：TTL=0 关闭 serve/daemon 自动清理（包括已有过期条目，手工 purge 仍可调用）；单点 session 删除路由回系统回收站（备份 + 精确替换命令，只有文档未执行）；整批卡 343–346 + 357/358 目前均未提交，不能伪称 `git revert` 卡号有效，给出保留脏工作区的隔离 HEAD checkout 方案，以及未来实际 SHA/独立提交/干净树前提下按新到旧 revert 的条件命令。只读校验 tier② 正则匹配当前调用恰好 **1** 处、旧导入不存在；没有实际运行回滚、worktree 或安装命令。
- 历史反例（用户修订前）：schema 合法伪造元数据被 list 接受并被 purge dry-run 选中，拒绝断言 exit **1**；`w3-forgery-counterexample.mjs/.log` 保留，`diskUnchanged:true`、`deletionAttempted:false`。它是被替代的旧判据反例，不是修订后的门禁失败，也不证明根外删除；原 temp 夹具 `vessel-w3-blocker-ZTj4Sy` 保留。
- 被拒命令：最初 probe 的 `finally { fs.rmSync(base, { recursive: true, force: true }); }` 被 PreToolUse hook 拒绝，理由为 Node 永久删除，不产生进程 exit code；尽管 intended target 为本次自建 os.tmpdir 夹具，也没有绕过 hook。**完整原命令与拒绝记录**在 `w3-rejected-command.txt`。替代诊断只做 dry-run，保留夹具。首次 `rg` 诊断里的 `apps/cli/src/commands/trash*` 在 Windows 报路径语法错误，随后改用准确文件路径读取，不影响自验。
- 证据目录统一为 `C:/work/AppData/Local/Temp/vessel-wave3-bAVg76/`；源文件和原测试编辑前字节分别为 `w3-before-trash.ts`、`w3-before-trash.test.ts`，原文档/卡基线由协调者保留。范围差异与冻结哈希另存该目录，不复制生成物进仓库。
- **尚未做**：17 步全量门禁及最终独立只读复核由协调者执行；本实现者不宣称卡 346 最终验收完成，不改卡首状态或 README 路线表。根外安全不是元数据来源认证，也不限制所有合法 session 布局为某个已授权 workspace；没有添加超出用户修订的安全机制。

#### W3 independent host review (2026-10-27)

- `gpt-6.1-terra` / medium, read-only: PASS against the user-revised scope. Reviewed the frozen eight-file diff and raw final test/typecheck evidence. The passing server suite includes the real sibling `workspace/.harness/trash` → `workspace/.harness/sessions/<id>` restore test and verifies original log bytes. Forged purge preserves the outside origin; invalid session restore and linked ancestors fail before mkdir. Source authentication was not added.
- Native Windows junction coverage passed; native Windows directory symlink remains UNVERIFIED after EPERM, and Linux/macOS native integration remains untested. These limits are disclosed in the matrix. The 17-step full gate and final card acceptance remain coordinator work; no status/index change.

#### 协调者验收（2026-10-27）

- 六条对抗我逐条对过代码与测试名：`..` 穿越、`expiresAt` 改到删除前而 origin 在根外、缺 `entry.json`、schema 合法但伪造的元数据（断言 purge 只动根内、根外 origin 字节不变）、伪造 session origin 在 `mkdir` 前被拒、经由链接父目录的伪造 origin 在 `mkdir` 前被拒；另有一条「合法 session 条目仍能还原到 `workspace/.harness/sessions/<id>` 且日志字节一致」。映射完整，不是凑数。
- `restore` 的校验位置正确：先 `readEntry`（结构 + realpath + 根内），再对 `kind === 'session'` 要求父目录名为 `sessions`、祖父为 `.harness`，然后才 `noLinks(origin)`（**逐级向上**检查祖先，不是只看叶子），最后才 `mkdirSync`。这一点是我最担心写成假实现的地方，实测通过。
- 我自己的复跑：`packages/application` **36 / 320 + 3 skipped**、`apps/local-server` **27 / 316**、两处 tsc exit 0；全量门禁 17 步全绿。
- 真机边界按它写的记：**Windows 目录符号链接未实测**（EPERM），junction 实测通过；Linux/macOS 原生回收未实测（只有命令级注入测试）。**不写成「跨平台已验证」。**
- 回滚口径的发现我采纳：343–346 与 357/358 全部未提交，所以「整批回退」不能写成 `git revert <卡号范围>`；文档里已改成「先提交再按范围 revert，未提交时用 `git checkout -- <列出路径>` 丢弃」。这条如果不写清，下一个人照着 revert 会失败。
- 残余边界（记录，不阻塞）：`kind` 非 `session` 的条目仍可恢复到根外任意绝对路径（受 `noLinks` 与「目标已存在则拒绝」约束）。这符合你修订后的口径（purge 根内自限 + restore 先校验），但它不是「来源认证」。要更强保证需另立任务。
