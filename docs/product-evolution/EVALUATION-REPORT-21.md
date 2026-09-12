# EVALUATION-REPORT-21 — 安全复评（第二轮，C-1→C-5 闭合核验）

立场：对抗（默认怀疑指挥侧"已修复"）。方法：**静态审查，未复跑命令**（本会话零命令执行；`tsc 0 / 1479 passed / policy 79 / runners 216` 仅作参照，不作判据）。证据均为仓库当前源码行号。
本轮全部改动集中在 `packages/policy/src/risk/{PolicyLoader,Compiler}.ts` 与两个测试文件；无代码改动。

## A. 五条修复逐条判定

1. **C-1 `filesystem.confinement` any-true — 通过。** `anyTrue` 三态正确：任一层 `true` 即 `true`；两层都未声明 → `undefined`，且展开分支确保**不写 `false`**（`PolicyLoader.ts:204-208,313,321`）；编译器只在 `=== true` 生成规则（`Compiler.ts:402-403`），`fsConfig.confinement` 同口径（`:513`），生产入口 `compose.ts:173-191` 到 `tools/guards` 的链路因此真正可达。判别用例 `mergeScopes.test.ts:240-268`（含"低层不得关高层"）＋ `:361-408` 端到端确认。
2. **C-2 allow 类高层优先 + 规则按 action 分流 — 通过。** `firstDeclared`（`PolicyLoader.ts:194-197`）用于 `shell.allow`/`filesystem.allow`（`:319,328`），低层只在高层**完全未声明**时补空档；`mergeRuleLists`（`:224-232`）对非最高层 `fromLower.filter(isTighteningRule)`，`allow` 与未登记 action 一律丢弃、`deny`/`ask` 保留（`:216-218,230,329,336`）。空档问题：**默认生产配置显式声明了这两个键**——`configs/policy.default.yaml:21`（`filesystem.allow: []`）与 `:28-34`（`shell.allow` 六条），`[]` 亦为已声明（`higher !== undefined`）⇒ 克隆仓库补空档在默认路径**不可达**。端到端 `:410-457` 实证 `bash -c "rm -rf /tmp/x"` 仍 deny、系统 allowlist 仍生效。
3. **C-3 force-push 专用谓词 — 通过（原始四形闭合），残留盲区见 C-1。** 引号感知分段/分词（`Compiler.ts:107-191`）、包装剥离（`:70-100,235-250`）、位置无关判定（`:198-224`）确已落地；`git push origin main --force` / `git -C … push --force` / `sh -c "…"` / `sudo git push --force …` 均命中（`compilerMatcher.test.ts:172-231`）。旧谓词下确为红的判别断言成立（`--force-like-*` 的旧 `\b` 误命中、管道段、反引号段）。
4. **C-4 status 文案 — 通过。** `cli.ts:509` 已改为「左侧为高层：profile/approval 取高层先声明者；deny 类列表取并集；低层只能加限制、不能放宽」，与 `PolicyLoader.ts:257-294` 语义一致；`PolicyLoader.ts:90-91` 的 `inspectPolicyLayers` JSDoc 同源更新。反向污染已清除。
5. **C-5 `version` 高层优先 — 通过。** `PolicyLoader.ts:300` `decls.find(d => d.version)`，低层不再改写版本号（`mergeScopes.test.ts:333`）。

## B. 是否仍有可放宽面（逐字段枚举 `PolicyDeclaration`，`shared/src/policy.ts:55-79`）

`profile`/`approval`/`version` = first-wins（不可放宽）；`git.force_push`/`network.default`/`audit.details` = 取最严（`PolicyLoader.ts:145-149,162-169`）；`filesystem.protected|deny_read`、`shell.deny`、`tools.deny`、`network.deny_domains`、`audit.events` = 并集（只能收紧）；`filesystem.confinement` = any-true；`filesystem.allow`/`shell.allow` = first-declared；`shell.scoped_rules`/`tools.rules` = 按 action 分流。
**未发现任何"低层可放宽默认配置"的通路**；放宽只能来自 `sessionOverrides`（`PolicyLoader.ts:38-39`，在 merge **之后**）＝ `compose.ts:179` 的 `--permission`。余下三处非默认条件通路见 C-2/C-4/C-5。

## C. 未闭合清单（按严重度）

- **R-1 [中] C-3 残留盲区（自述项经静态复核全部成立）。** `git push origin +main`：`isForcePushOption`（`Compiler.ts:198-203`）只认 `-f`/`--force*`/短选项簇，`+refspec` 不命中；`env -S "git push --force"`：`-S` 被当作取值选项消费掉脚本 token（`:89` → `:247`），剥离后剩 `['origin','main']` → false；`eval …` / `xargs git push --force`：不在 `PRIVILEGE_WRAPPERS`（`:70-72`）、非 `git` 首 token → false；`sh script.sh`：`shellDashCArg` 返回 null（`:227-232,266`）；深度 >4 与包装链 >5 轮一律 `return false`（fail-open，`:255,270,275`）。
  **可利用性判定**：默认策略下**不可利用**——`shellTool.ts:46` `requiredPermission='danger-full-access'` + `configs/policy.default.yaml:6-7`（workspace-write/never）→ `Engine.ts:89-90` needsApproval → `:99` deny（非白名单 Shell 全拒）。`--permission danger-full-access` 会话下**可利用**（`compose.ts:179` 覆盖 profile）⇒ `git push origin +main` 等一句即绕过被宣称为唯一防线的 deny 规则，而 S006 判据正是该模式下的 force-push 拒绝。**风险等级：中**（前提是用户显式 opt-in 全权模式）。最小修复：`+<refspec>` 计入 force；`eval`/`xargs`/`sh<无-c>`/超深包装改为 **fail-closed**（无法解析 ⇒ 命中 deny）。
- **R-2 [低-中] `guidance` 无条件并集是提示注入面**（`PolicyLoader.ts:310` → `compose.ts:244,283`）：克隆仓库可携带 `.harness/policy.yaml`（无 trust 门，`cli.ts:196-198` 仅 `existsSync`）把任意文本写进 `policyGuidance`。不影响硬执法，但违反"不可信文本不进 Prompt"的项目纪律。
- **R-3 [低] allow 空档在非默认配置下可达**：`--policy` 指向未声明 `allow` 键的自定义 system 文件（指挥侧探针 `scripts/probe-residual.ts:14,16` 正是这种最小文件），或 system 层缺失时 `decls[0]` 变成 project（`PolicyLoader.ts:230,300,308`）⇒ project 的 allow 属性全量生效。默认配置与"部分装载"告警（`cli.ts:223-224`）使其不构成默认路径缺陷。
- **R-4 [低] 健壮性**：`firstDeclared` 用 `higher !== undefined` 判空，YAML 里裸 `allow:`（null）会走 `[...null]` 抛 TypeError（`PolicyLoader.ts:195`）。方向是 fail-loud（不静默放行），但会以异常终止装载。
- **R-5 [低] 语义不一致**：`scoped_rules` 分流判据是"**最高层**"（`isTopLayer=index===0`）而非"首个声明该键的层"，故 system 无 `shell` 块时 project 的 allow scoped 规则被丢弃（fail-closed；`:288-290` JSDoc 已如实写明）。
- **R-6 [低] 潜伏**：`git/network/audit` 未登记键低层可补空位（`:245-253`），当前编译器无消费者（不可利用）；顶层 `session` 键在 mergeScopes 被静默丢弃（`Compiler.ts:11` 视为已知键 vs `PolicyLoader.ts:298-365` 不处理）——方向安全，属诚实性余项（`policy status` 仍不跑编译校验，承继 R20-C6）。

## D. 测试真实性核验

`mergeScopes.test.ts` 实为 **32 例**、`compilerMatcher.test.ts` **16 例**（逐 `it(` 计数，与声称一致）；两文件无 `skip`/`skipIf`/`if` 守卫/`expect(true)` 型永真断言（全文实读）。"修复前必红"清单可独立复算成立（`mergeScopes.test.ts:15-19,234-237`；`compilerMatcher.test.ts:172,180,194,204,233`）。**上一轮的藏身处已封**：`:189-201,:381-400,:434-446` 真走 `mkdtemp` + `writeFileSync` 真实文件 + `loadPolicyArtifacts` 全链，`㉚㉛㉜` 正是修复前必红的端到端判别。缺口：`apps/cli/src/policyStatus.test.ts:323` 只锁 `生效层序: system > project`，未锁 C-4 新文案（旧文案回潮不会变红）。

## E. 总判

**ACCEPT**（针对本轮 C-1→C-5 的闭合性）。五条修复**无一为表面修复**：C-1/C-2 的判据经静态溯源成立且由**走 `loadPolicyArtifacts` + 真实文件**的端到端用例锁死，C-3 的四种声称绕过形与 C-4/C-5 均已闭合；逐字段枚举未发现"低层放宽默认配置"的新通路；`sessionOverrides` 仍在 merge 之后（`PolicyLoader.ts:38-39`），deny 并集、profile/approval first-wins、`git.force_push` 取最严、`--permission` 覆盖四项回归均未破坏（`:116-152,338-359,445-456`）。
未随 ACCEPT 一并闭合的是 **R-1（中）**：若验收线是"`--permission danger-full-access` 会话下 force-push deny 不可被一句话绕过"，本轮应判 **REJECT**，最小修复方向即 R-1 的 fail-closed 化。其余 R-2…R-6 为低严重度/条件通路，建议下一轮与 R-1 合并收口。

（静态审查，未复跑命令；无代码改动。）
