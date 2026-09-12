# EVALUATION-REPORT-23 — 独立对抗复评（第三轮：R-1 续行/alias、1C 测试真实性、1B/2B/2C 诚实化、依赖声明）

立场：先假设修复是表面的、测试是假的。方式：**静态审查，未复跑任何命令**（只读代码与测试）。指挥侧 1501 passed / 探针结果本轮未复核，仅作对照。

## A. R-1（`packages/policy/src/risk/Compiler.ts`）— 判定 **REJECT**（修复到位但引入 1 条新 fail-open，且 alias 走私仍有 1 条漏网）

**A1 续行规范化正确性：POSIX 侧正确，Windows 侧错误。**
- 奇数/偶数反斜杠语义与真实 sh 一致：`\\`+LF 保留字面反斜杠且 LF 仍是分隔符（`normalizeLineContinuations:174-187`），测试 ①c `'echo a\\\\\ngit status'` 正锁这条 ✓。奇数 run 输出 `run-1` 个反斜杠再交给 tokenizer 二次解释，`\\\`⇒ 一个 `\`，正确 ✓；幂等成立（偶数分支保留原样，重跑不变）✓。
- `^` 只在**后随换行**时吞：`echo a^b`、`git log -1 ^main`、行中 `^` 均原样保留 ✓（`:188-195`）。无续行符的真换行仍按 `\n/\r` 切段 ✓（`:552` → `splitShellSegments:229`）。
- 引号内一律拼接：单引号内也拼是**保守方向**（只会更易 deny），JSDoc 已如实声明 ✓。
- **新缺陷（P1，修复前反而更安全）**：规范化对 `\`+换行**一律**按 POSIX 续行处理，但 Windows 的 Shell 走 cmd.exe（`packages/tools/src/shell/shellTool.ts:44/70` → `Process.ts:58-62` `shell:true`），cmd 里 `\` **不是**续行、`^` 才是。构造（静态推演）：`git status \` + 换行 + `git push --force origin main` → 合并成 `git status git push --force origin main` → 段首 `git`、子命令 `status`≠`push`（`:337`）→ **allow**；真实 cmd 执行两条命令，第二条就是 force push。同类：`cd D:\` + 换行 + `git push --force origin main` → 合并后 `git` 被并进上一 token（`D:git`，`shellBasename` 不等于 `git`）→ `mentionsGitPush` 不成立 → allow。修复前 `splitShellSegments` 按 `\n` 切段，这两种都 deny。JSDoc 宣称"语义向真实 shell 对齐"在 Windows 上不成立。附带（无害）：`^^`+换行在 cmd 是"字面 `^` + 真换行"，实现当续行（反向偏差，不构成漏洞）。

**A2 alias 判据（`definesGitAlias:127-137`，判定插在 `:333-334` 跳过值之前）：命中的与不命中的逐条结论**
- 命中 ✓：`git -c alias.p='!git "pu"sh --force' p`（键判据不受值内引号/拼接影响）、`git -c alias.p='push --force' p`、`git -c "alias.p=push --force" p`、`git -calias.p=push p`（`:131-132`）、`git --config=alias.p=push p`、`git --config-env=alias.p=EVIL p`、`git --config alias.p=…`（空格式，`:133`）、`git -c alias.P=push p`（`/i`，`:136`）、`git -C repo -c alias.p=… p`。
- **不命中（漏网）**：① **两条命令的 alias 走私** —— `git config alias.p 'push --force' && git p`（或 `--global`）→ 段1 子命令是 `config`（`:337` 早退）、段2 是 `git p`，均无 force 形状 ⇒ **allow**，而真实 git 会写配置后按别名执行 force push（同一 shell 行内即生效）。**这是 R-1② 同类、可直接执行、且不在 JSDoc 边界清单内**。② 变量间接：`CFG='alias.p=push --force' git -c "$CFG" p` ⇒ allow（值不是 `alias.` 开头；且段首是赋值 ⇒ 无签名兜底）。③ `git -c $CFG p` 同类。
- **不命中但正确（负对照成立）**：`git -c core.pager=cat status`、`git -c user.email=a@b push origin main`、`git -c http.proxy= push origin main`、`git --config=core.pager=cat status`、`git commit -c alias.p commit`（子命令位，`:337` 前已早退）均 allow ✓。

**A3 过度拦截代价：可接受，但存在更精确判据。** `git -c alias.st=status st` 被 deny 属实（测试 `:454` 把它**锁成预期**）。更精确且不损失覆盖的判据：保留"`alias.` 键"这一外层语法事实，但只在 ①别名值以 `!` 开头（任意 shell）或 ②值里出现 force 形状（`--force*`/`-f` 簇/`+refspec`）时 deny —— `!git "pu"sh --force` 由 ① 兜住，`alias.st=status` 不再误拦。**注意：该改法不修 A2① 的两命令形**，两者需分别处理。

**A4 测试真实性：通过，无永真断言。** 新增恰为 7 个 `it`（`:390/403/418/434/443/457/469`）、断言数 5+7+8+1+8+7+9 = **45**，与声称一致 ✓。独立核算"修复前必红"= ①a5 + ①b7 + ②命中8 + 端到端 deny5 = **25** ✓（逐条按修复前语义（无规范化、无 alias 判据）推演均会 false）。负对照两侧齐全（①c 8 条 false、②负对照 7 条 false、端到端 allow 分支）✓；断言全部是 `toBe(true/false)` 与带 cmd 的 `toEqual`，**零**永真断言 ✓。缺口：A1 的 Windows 形与 A2① 的两命令形**均无用例锁定**，回退不会红。

**A5 JSDoc 分界：大体如实，但两处"没做的说成做了的"。** "余下边界"清单（变量/别名/`sh -c "$CMD"`/stdin/ANSI-C 引号/整条被引号粘成单词）与实现一致 ✓，①d 用例也如实把"整条引号粘成一个词"判 allow 而非凑绿 ✓。但：①`detectForcePush` 头部（`:520-526`）宣称续行"语义向真实 shell 对齐"，未声明 Windows/cmd 是反例；②`definesGitAlias` 注释（`:110-126`）只承认"定义任何别名都 deny"这一代价，未承认"跨命令 `git config` + `git p`"这条 fail-open。

## B. 1C 测试真实性（`apps/cli/src/mockVisibility.test.ts`）— 判定 **ACCEPT**

断言确实打在真实路径上：`main(...)`（`./cli.js`）与真实 `runChat`（`:314/339/362/369/385/412/436/455/485`）；`finalReplyLine`/`tuiReplyLine` 取不到即 `expect(...).toBeGreaterThanOrEqual(0)`/`toBeDefined()` 失败，**不回落空串**（`:183-186/191-193`）；幂等用 `split` 计数（`:365/372/496`）。判别力成立：用例 2/3(路径B)/5 依赖 `renderFinalReply`/`renderTurnReply`——回显文案（`cli.ts:613`）与 TUI 回显（`chat.ts:431`）**自身不带标记**，删除出口后 `startsWith`（`:350/429`）与 `markCount==1`（`:372`）必红 ✓。真 provider 负对照：loopback 127.0.0.1（`:261`）+ 临时 provider 根 + **摘除** `VESSEL_BASE_URL/API_KEY/MODEL`（`:120-122`，与 `providerFactory` 的 flags 优先级对应）→ 零真实网络 ✓；断言为 `reply.trim()).toBe('CLI-VIS-REAL-MARKER')` + `not.toContain`（`:397-399`、`:467-470`），加前缀必红 ✓。AC2 空回复按现状锁 `(无文本回复)` 并注明已知边界（`:494-496`）✓。用例 1 自认"单独不具判别力、只锁 stderr 通道"（`:18-19`）——**如实标注，非弱断言残留**。5 个状态根 + `VESSEL_MCP_ROOT` 全隔离 ✓（AGENTS §8）。

## C. 诚实化改动

- **1B：判定 ACCEPT（修订不构成掩盖）。** `guide.ts` 中文用 `Vessel`、英文用 `Vessel`（无 `Xiaoxiaomi`），`guide.test.ts:187/192` 反向锁定 ✓；昵称唯一用户可见解释在 `glossary.ts:39-44`（`vessel explain 小蜜|小小蜜`、`list-terms` 可达）。"术语库里解释昵称"与"首触面自称单名"是两件事，不冲突 ⇒ 自洽。残余（非缺陷）：AC 原本许可的"README 一处解释"未做，昵称可发现性完全依赖术语库；`docs/` 内仍有历史 `小小蜜`（`V1.0-CHECKPOINT.md:192`、`product-audit/UX-REPORT.md:4`）——非首触面。
- **2B：判定 ACCEPT。** `keyStorageNote`（`setup.ts:58-66`）判据来自 `store.credentialStore?.backend`，而 `cmdSetup` 的 store = `defaultProviderStore()`（`cli.ts:1303`）→ `createCredentialStore()`（`defaultStore.ts:37-46`）→ `probeBackends/selectBackend`（`CredentialStore.ts:530/614/640`）——**是真实生效后端，不是猜的** ✓；取值 `'windows-dpapi' | 'plaintext'` 与实现一致 ✓；`PROJECT-BRIEF.md:43-46` 与向导文案同口径 ✓。前瞻提示（非现存缺陷）：分支 2 是"backend ≠ windows-dpapi 就说明文"，若将来注册 `macos-keychain`/`linux-libsecret` 实现（`REGISTERED_BACKENDS:582` 目前只有前者），该分支会变成假陈述。
- **2C：判定 ACCEPT。** README 命令表（`:61-79`）逐项对照 `dispatch`（`cli.ts:1970-2078`）全部存在：run/setup/provider/models/usage/pricing/migrate/sessions list/resume/review/explain|term/list-terms/guide/settings/policy status/bench-report/serve/web + 无参 TUI；**无 `chat`**，且 `README:61` 声称"`vessel chat` 报未知命令"与 `cli.ts:2041-2043`（`first !== undefined` ⇒ `未知命令` exit 2）逐字一致 ✓，不是新错误命令。5 个新入口均在 dispatch 命中（`:1976/1977/1979/1981-1989/1990/1993/2001`）；`review handoff|import|list` 经 `reviewCommands.ts:149` 证实存在 ✓。唯一瑕疵：README 未列 `provider export|import|endpoint`（`cli.ts:883-891`）——**遗漏**，非错误。

## D. 依赖声明 — 判定 **PARTIAL（缺口清单基本准确，少列 1 项）**

- 已落地且属实：`@clack/prompts ^1.7.0` → `apps/cli`（装的是 1.7.0 ✓）、`js-yaml ^4.1.0` → `policy` + `behavior`（装的是 4.3.2 ✓）、`apps/cli` 补 `files:["dist"]` + `engines.node>=20` ✓。
- **缺口清单核对**：`apps/cli` 实际 import `@vessel/{application, core, llm, local-server, policy, shared}`，只声明了 application + local-server ⇒ **未声明 4 个（指挥清单写 3 个，漏了 `@vessel/core`）**；`packages/*` 中无 `dependencies` 字段的是 **11 个**（agents/context/core/engine/llm/memory/runtime/shared/skills/telemetry/tools，含 `@vessel/engine` 这个未列入架构清单的包）；`@vessel/bench-runners` 确为 `private:true` 且被运行期 `await import`（`cli.ts:755`、`:1850`）✓。
- **"只声明第三方"装 tarball 是否直接失败**：分两层。① **不会当场失败但很脆**：npm 平铺布局下 `@vessel/application` 已声明 shared/core/policy/llm/tools/… ⇒ 它们被顺带装上，CLI 的裸 import 靠 hoisting 侥幸命中；换成 pnpm/严格 node_modules 或上游调整依赖即 `ERR_MODULE_NOT_FOUND`。② **会直接失败**：`@vessel/bench-runners` 是 `private:true`（不可发布）却在 `cli.ts:755/1850` 被**动态 import 且无 try/catch 兜底** ⇒ 装 tarball 后 `vessel run --bench` 与 `vessel bench-report` 必 `MODULE_NOT_FOUND` 崩溃。

## 总判：**REJECT**（片 A），B/C/D 分别 ACCEPT / ACCEPT / PARTIAL

未闭合清单（按严重度）：
1. **P1（新引入，Windows 实机可执行）**：`\`+换行被无条件当续行，cmd 下会把第二条 `git push --force` 合并进上一条命令的**参数位/子命令位** ⇒ allow。最小修复：按平台分支——Windows 只处理 `^`+换行，POSIX 只处理 `\`+换行（或在 `\` 分支额外要求"下一条命令段首不得为 `git`"）。锁测试：`git status \`+换行+`git push --force origin main`（Windows）**与** `git status \`+换行+`git push --force origin main`（POSIX 下真实语义为单条 git status，须断言 allow）两侧分别锁定。
2. **P1（漏网，未承认）**：跨命令 alias 走私 `git config alias.p 'push --force' && git p`（含 `--global`）与变量间接 `-c "$CFG"` 仍 allow。最小修复：把 `alias.` 判定从"仅本段 `-c` 值"扩到"段内出现 `git config … alias.<k>=…` 写配置"⇒ deny；`$VAR` 形式按已承认的变量间接边界如实写入 JSDoc（不假装覆盖）。
3. **P2（诚实性）**：`detectForcePush` 头部与 `definesGitAlias` 的 JSDoc 补上上述两处未覆盖形（"对齐真实 shell"限定为 POSIX cmd 例外；alias 边界补跨命令形）。
4. **P3（可选精度）**：alias 判据改"`!` 前缀 ∨ 值含 force 形状"，可免去 `-c alias.st=status st` 误拦（该断言目前把代价锁死，需同步改）。
5. **P3（依赖）**：补 `apps/cli` 的 `@vessel/shared|core|llm|policy` 声明；`@vessel/bench-runners` 的 private/运行期依赖矛盾需单列（要么发布、要么把两个命令改成静态依赖 + 明确报错）。

声明：本轮为静态审查，**未复跑任何命令**（含探针、vitest、tsc）；A1 的 Windows 结论基于 `shellTool.ts`+`Process.ts` 的 `shell:true` 与 cmd 语义推演，建议指挥在 Windows 实机用 `git status \`+CRLF+`git push --force origin main` 探针复核一次。
