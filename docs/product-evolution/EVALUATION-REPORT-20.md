# EVALUATION-REPORT-20 — 安全复评（Round 15 收尾 + 安全加固）

立场：对抗（先假设修复表面可绕过）。方法：**静态审查，未复跑命令**（本会话零命令执行）。
证据均为仓库当前源码行号；指挥侧运行证据（tsc 0 / 134 文件 1460 passed / policy 61 / runners 216）仅作参照，不代替判据。

## A. 四处修复本身

1. **profile/approval first-wins** — 通过（含一处未闭合）。`PolicyLoader.ts:239-241` 遍历中「首个声明者胜出」，低层无法抬升。**但语义仍是「高层优先」而非「取最严」**：system `danger-full-access`/`approval:never` 时，project 想收紧为 `read-only`/`ask` **被忽略**（低层不能收紧）。`docs/POLICY-SPEC.md:473`（profile/approval 取高层默认）与之自洽，故非回归；但与「低层只能加限制、不能放宽」是**两个方向**的规则。
2. **git/network/audit 单调趋严** — 通过。`strictestAction` 序 `allow0<ask1<deny2`（`PolicyLoader.ts:137`），`lower` 更严才取 `lower`，同严保留高层（:148）；`unionLists` 并集、`audit.details` 未登记值按 `MAX_SAFE_INTEGER`（:167，低层给未登记串**不能**降级，方向正确）；`inheritUnknownKeys` 高层覆盖低层（:196-198）。`git:force-push` 编译点 `Compiler.ts:240-253` 与 deny 优先（`Engine.ts:43-52`）共同保证 project 加 allow 规则也压不过 system deny。
3. **Shell 通配** — 通过（副作用见 C-3）。`Compiler.ts:39-45`：含 `*` 走转义 + 锚定正则，`.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')` 覆盖全部正则元字符，再 `\\*`→`.*`；无 `*` 保留 `startsWith`。锚定正确（`compilerMatcher.test.ts:80` `sudo git push --force` 为 false、:99 `.` 逐字转义）。
4. **文档诚实化** — 部分通过（有 1 处反向污染）。`POLICY-SPEC.md:454-459` 明示仅 system+project、trust 门「只存在于注释」、session 层无实现；`cli.ts:475-528` 三态可区分（`PolicyLoader.ts:101-118`）。**但 `cli.ts:509` 仍打印「靠后的层覆盖标量 / 拼接数组」——正是修复前那套（可被 project 覆盖 profile/git 的）心智模型**，与 `PolicyLoader.ts:239-249` 的新语义直接矛盾。

## B. 必查项判定

1. **其他「可放宽」键：有，3 处未闭合（见 C-1/C-4/C-5）。** 逐字段：`version` **后者覆盖**（`PolicyLoader.ts:238`，低层可降级版本号，当前 `Compiler.ts:119` 只校验存在、不比较取值 ⇒ 现在**不可利用**，属潜伏）；`profile`/`approval` first-wins（不可放宽，但不可收紧）；`guidance` 并集（低层可注入任意文本，属**注入面**而非权限面，见 C-3 备注）；`filesystem.protected/deny_read/allow`、`shell.deny/allow/scoped_rules`、`tools.deny/rules` 全部并集；`git/network/audit` 已知键单调、未知键高层先声明者胜出（:191-200，低层只能补空位，无法改写高层已给值 ⇒ 不可放宽）；**`filesystem.confinement` 完全没有合并分支**（见 C-1）。**结论：并集对 deny 类是趋严，对 `shell.allow`/`filesystem.allow` 这类 allow 类是趋宽**，`PolicyLoader.ts:223-225` 的「低层只能加限制、不能放宽」对它们不成立。
2. **单调性可绕过点：** `ACTION_STRICTNESS` 方向正确（deny=2 最大）；`AUDIT_DETAIL_RANK` 未登记值按最详尽处理，方向正确、不可被低层未登记串规避（:166-168）。**唯一绕过面不在序表，而在并集键**（C-1）。
3. **glob 副作用：** 锚定与转义正确（`compilerMatcher.test.ts:78-101`）；**过度匹配存在但方向不同**——`Shell(git status*)` 会命中 `git statusX` 乃至 `git status; rm -rf /`（deny 类误伤=趋严，安全；allow 类 scoped 规则会趋宽）。**ReDoS：无指数回溯**（括号/量词全被转义，只有 `.*` 串联 ⇒ 最坏多项式，`*` 个数为指数、命令串为底数，策略作者自伤 + 命令侧可控，等级低）。`Write/Read(path=...)` 早已走 `globMatch`（`Compiler.ts:63-75`）；无 `*` 的 `startsWith` 是**过度匹配陷阱**而非死规则（`compilerMatcher.test.ts:108` 刻意锁住），非同类缺陷。
4. **测试判别力：通过。** 两文件无 `it.skipIf`/无 `if` 守卫/无 `expect(true)` 型永真断言（全文实读）。`mergeScopes.test.ts:15-19` 自述「修复前必红 10 条」与旧浅覆盖/对象展开行为一致（①③⑥⑦⑧⑩⑪⑫⑰⑱ 确为红；⑬⑭⑮⑯⑲ 为回归锁，符合声明）；19 例中 **0 例覆盖 `confinement`、`shell.allow`/`filesystem.allow` 放宽、`version`**——恰是 C-1/C-2/C-4 的盲区。
5. **端到端一致性：不同源（残留确认为真）。** `inspectPolicyLayers` 只 `parsePolicyYaml`（`PolicyLoader.ts:112`），不跑 `compilePolicy`；`effectiveOrder` 只按 `declarationCount>0`（`cli.ts:478`）⇒ 未知顶层键 / 未知 `shell.deny` 类别（`Compiler.ts:116,203`）的层显示为「存在·1 条 · 生效层序 system > project」，而 `run` 立即 fail-loud。安全影响为 **fail-closed（不会静默放行）**，属诚实性缺陷。另有一处未列残留：`policy status` **完全不展示 session 覆盖**，`--permission danger-full-access` 下显示的文件 profile 与实际执法 profile 不同。
6. **回归面：不受影响。** S006 判据为 `denial_seen pattern "force"`（`benchmarks/scenarios/S006.yaml:10`），两个可能 ruleRef（`shell-force-push` / `git:force-push`）都含 "force"；runner 是**重写 system 策略文件**设 danger-full-access（`runner.ts:270-278`），不引入 project 层，故 first-wins 不影响它。**唯一变化**：规则顺序（`Compiler.ts:218` 先于 :240）+ 首个 deny 命中（`Engine.ts:43-52`）⇒ S006 归因从 `git:force-push` 变为 `shell-force-push`（无 golden 固定 id，216/216 印证）。`sessionOverrides` 在 merge **之后**写入（`PolicyLoader.ts:38-39`），`--permission danger-full-access` 仍有效（测试⑲）。

## C. 未闭合清单（按严重度）

- **C-1 [高] `filesystem.confinement` 在合并中被静默丢弃 ⇒ 硬执法特性在生产路径永不生效。** `mergeScopes` 重建 `out.filesystem` 只带 `protected/deny_read/allow`（`PolicyLoader.ts:243-249`），`confinement` 从不写入；`compilePolicy` 读 `declaration.filesystem?.confinement`（`Compiler.ts:137,169,278`）⇒ 恒 false。生产入口 `compose.ts:173-191` 走的就是这条路，而 `policy.test.ts:105-167` 的 6 个 confinement 用例全部直调 `compilePolicyYaml`（:121,133,138,145,154,163）**绕过合并**，故 61/61 全绿仍掩盖此洞。最小修复：合并时 `confinement: Boolean(高层?.confinement || 低层.confinement)`（或 any-true），并补一条走 `loadPolicyArtifacts` 的端到端用例。
- **C-2 [高] allow 类列表并集 = 低层可放宽执行。** project 层可并集追加 `shell.allow`（`PolicyLoader.ts:252-254` → `Compiler.ts:280` → `Engine.ts:83-85,126-129`）。实测推演（静态）：system `workspace-write` + `approval: never` 下 Shell 的 `requiredPermission='danger-full-access'`（`shellTool.ts:46`）本会触发 deny，但 project 写 `shell.allow: ["bash"]` 后 `bash -c "rm -rf /tmp/x"` 被降级为 `req='read'` ⇒ **allow**（`shell-deny` 正则要求命令以 `rm`/`mkfs`/`fdisk` 开头，`Compiler.ts:15-22`，包一层即绕过）。同理 `filesystem.allow` 一旦 C-1 修好即成为外部目录授权通道。且 project 层**无 trust 门**（`cli.ts:196-198` 仅 `existsSync`；`POLICY-SPEC.md:457` 自认），克隆仓库即可携带。最小修复：allow 类列表改**交集/不得由低层扩张**（或先落 trust 门再谈并集），并补用例断言「低层追加 allow 不改变既有拒绝」。
- **C-3 [中] force-push 仍有可用绕过形。** `Compiler.ts:250` `/^git\s+push\s+(-f|--force)\b/` 与 `^git push --force.*$` 都要求 `--force/-f` **紧跟 `push`**：`git push origin main --force`、`git -C r push --force`、`sh -c "git push --force"`、`sudo git push --force`（后者被 `compilerMatcher.test.ts:80` **当作正确行为锁死**）**均不命中任何规则**。默认策略下 profile 门（workspace-write+approval never 拒绝全部 Shell）兜住了，但 S006/`--permission danger-full-access` 这类放宽会话里 deny 规则是**唯一防线** ⇒ 可被模型一句 `git push origin main --force` 绕过。最小修复：命令归一化（剥离 `sudo/env/-C/sh -c` 包装）+ 位置无关判定（`/^git\s+push\b[^|;&]*\s(-f|--force)([=\s]|$)/`），并对 refspec 尾置形补测。
- **C-4 [中] `policy status` 文案仍宣称「靠后的层覆盖标量」**（`cli.ts:509`）——与本批 1/2 号修复的语义相反，是唯一向用户展示层事实的通道。最小修复：一行改为「高层优先 / 低层只能收紧」。
- **C-5 [低-潜伏] `version` 后者覆盖**（`PolicyLoader.ts:238`）；当前 `Compiler.ts:119` 只校验非空，取值未被任何分支消费 ⇒ 不可利用；一旦将来按版本切换语义即成为降级通道。最小修复：与 profile 同改 first-wins。
- **C-6 [低] 诚实性余项**：`policy status` 不跑编译校验（B-5，已列为已知残留，建议在 status 内复用 `compilePolicy` 做只读校验）；不展示 session `--permission` 覆盖（B-5 末）。

## D. 总判

**REJECT**（有条件）。四处修复的**核心断言成立**：提权（profile/approval）、放宽 force-push（git/network/audit）、死规则（`Shell(...*)`）三条经静态复核后判定 **ACCEPT**；文档诚实化 **ACCEPT-PARTIAL**（`cli.ts:509` 反向污染）。但「低层只能加限制、不能放宽」这一被写进 JSDoc 与 spec 的**总括命题为假**（C-2），且合并层静默丢 `confinement` 使一项硬执法特性失效（C-1）——两者都因测试**只测 `compilePolicyYaml`、不测 `loadPolicyArtifacts` 全链**而全绿。

闭合顺序建议：C-1 → C-2 → C-3 → C-4 → C-5/C-6。C-1、C-2 修好并各补一条**走 `loadPolicyArtifacts` 的端到端判别用例**后，可复评转 ACCEPT。

（静态审查，未复跑命令；无代码改动。）
