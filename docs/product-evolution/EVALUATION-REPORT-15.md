# EVALUATION-REPORT-15 — Round 11 复评 / Round 12 初评 / Round 13 初评（进行中）

> 独立 Evaluator（全新上下文，对抗立场：先假设实现有错、修复是假的）。**静态审查，未复跑任何命令**；
> 指挥侧的 `tsc -b` 0 / 126 文件 / 1335 passed + 1 skipped / exit 0 仅作参考，本报告未复核、未采信为证据。

## 第一部分：Round 11 复评（上轮 REJECT 三条必修）

1. **生效时机 ✅**：「harness 已存在 → 确认即生效」在 `chat.ts:482-484`（slash 分支）落实——置好 `pendingPermission/pendingModel`
   （`:473-478`，含「切回当前值即撤销挂起」）后立刻 `await applyPendingChanges()`；而 `applyPendingChanges`（`:402-435`）
   先落新值到外层变量 → `await previous.close()`（`:415-421`）→ `await buildHarness()`（`:422`）→ `syncSessionMeta()`（`:425`，
   `:369-387` 走 get→put 保留 `createdAt`）。尚未懒建（`harness === null`）时两个分支都不重建，交给首次构建带上新值
   （`:492-494`），与「不凭空建会话」一致。「先 NL 后 `/permission` 再 `/quit`」正是测试 `chat.test.ts:864-869` 的顺序：
   三次输入后登记表 `permission === 'read-only'` 且 `toHaveLength(1)` → **复现了指挥侧那例失败且已由「立即应用」修掉**。
2. **重建失败容错 ✅（对象层）/ ⚠️ 资源层降级**：`buildHarness()` 抛错被 `:426-434` 捕获 → 回滚 `permission/model`、
   `harness = previous`、清挂起项、打印 `[错误] 重建会话失败（已保留原设置：…）`（`:433`）。不崩、不丢对象、状态自洽 → 满足
   BRIEF-12 错误场景 2。但 `previous.close()`（`:417`）在重建**之前**执行，回滚回来的是一个**已被 close 的** harness：
   - `Session.close()`（`packages/core/src/session/Session.ts:250-260`）把 `fd=null` **并删除 `.lease`**；而 `Session.append`
     的惰性重开（`:168-170` `if (!this.fd) this.fd = await fs.promises.open(...)`）**不重新获取租约**。故回滚后本会话继续追加时
     是**无租约写入**——单写者 fail-closed 不变量在本会话余下时间里静默失效，第二个进程（如 `vessel run --session-id`）此时能
     `acquireLease` 成功并与本进程交错写同一 JSONL。这是本改动引入的真实降级（概率低：需先有一次 buildHarness 失败）。
   - `compose.ts:361-368` 的 `close()` 还 `telemetry.detach()`（解绑该 bus 的订阅）并关闭 `mcpClients`；回滚后的 previous 继续
     被使用，于是**后续回合无遥测投影**、MCP 客户端已死（会话记录本身由 loop 直接 append，不受影响）。今日 TUI 未接 MCP
     （`mcpClients` 为空），MCP 一项暂时不可达；遥测一项可达。
   - 判定：**「不丢、不崩、报错、状态一致」成立，降级可接受但不该长期保留**；建议下一批把 `Session.append` 的惰性重开改为
     「重开并重新获取租约」（或在 `Session` 内记 `leaseHeld` 后重取），并把 close 顺序/资源复活策略写进注释。
   - 另注：若 `composeHarness` 在 `Session.open`（`compose.ts:164`）**之后**抛错（`:168` 策略加载 / `:220` behavior 加载），
     新会话的 fd 与 `.lease` 无清理地泄漏；但回滚后的 previous 与它**同 id 同目录**，下一次重建的 `previous.close()` 会顺带删掉
     该租约，故自愈、不构成死锁（静态推断，未运行验证）。
3. **孤儿会话已消除 ✅**：`buildHarness` 复用 `sessionId: currentSessionId ?? opts.sessionId`（`chat.ts:335`）→ 重建落回同一
   目录，登记表 `get(harness.session.sessionId)`（`:344`）命中既有项 → `put` 覆盖而非新增。测试 `:868` 断言 `toHaveLength(1)`。
4. **测试真实性 ✅，无永真断言，但有两处空隙**：6 例（`chat.test.ts:812-958`）全部走真实 `runChat`，且都带对照——
   ① `:819-827` 非法/缺参**断言字段不存在**（`'permission' in bogus === false`）而非只看文案；② `:835-837` 同款；
   ③ `:856-859` 负对照路径权限为 `workspace-write` 且 `not.toBe` 判别组；④ `:881-882` 判别组「每一次调用都带新 model」+
   `:889` 对照仍是旧 model（`:879` 先断言 `length>=1`，故 `:881` 的 `toEqual` 不空转）；⑤ `:911-916` deny 面
   （`/\[DENIED\]/`、不含 `[错误]`、`requests.length>=2` 证明回合继续）+ `:918-925` 对照文件真被创建且内容逐字相同 →
   上轮「AC1 只有文件没被写一个 bit」的替代解释（回合没跑）已被排除；⑥ `:937-957` en/zh/缺文件三态差分，并钉住
   `VESSEL_SETTINGS_ROOT`（`:713-743`）→ 不回落真实 `~/.vessel`。
   空隙（非阻塞）：(a) 无「重建失败 → 回滚 + 报错」的回归测试（`:433` 那一支改坏了仍会全绿）；(b) `syncSessionMeta` 的
   `createdAt: prev.createdAt`（`:380`）无断言，改成 `now` 也能过。
   另有一处**非本轮引入**的口径差：`buildHarness` 登记 `model: effModel`（`:349`，经 `planProvider` 解析）而 `syncSessionMeta`
   写 `model`（原始值，`:378`）；对会改写模型名的 preset（如 opencode-go）两者可能不同。

**结论：ACCEPT**（三条必修均已闭合；第 2 条的租约降级与第 4 条两处覆盖空隙记入后续批次，不构成本轮推翻理由）。

## 第二部分：Round 12 初评（G-13-P2 / P3）

1. **`cmdExplain` locale 解析 ✅**：`--locale` 显式优先并校验（`guideCommands.ts:64-70`，非法值 stderr + 返回 2）；
   否则 `settingsStoreFor(opts).load().locale`（`:74`），**读取任何失败回落 `'zh'`**（`:73-77`）。优先级 = `--locale` >
   settings.locale > `'zh'`（第三档由 `SettingsStore.load()` 的默认值给出，`settings.ts:107`）。
   唯一**行为改动**就是新增的这个 catch（改前设置损坏会让 explain 失败），属本轮要求；副作用是口径不对称：
   `cmdGuide`（`:104`）**没有** catch，损坏时仍 fail loud。建议后续统一（或明写「explain 必须可用、guide 允许 fail loud」）。
2. **`resolveChatLocale` ✅**：`chat.ts:226-232` = `new SettingsStore({rootDir}).load().locale`，捕获一切异常回落 `'zh'`；
   在**进循环前解析一次**（`:452`），`/explain`（`:649`）与 `? <术语>`（`:561`）共用同一个 `ctx.locale`（`:552`）→ 会话内
   稳定，与 `vessel explain` 跟随 settings 的口径一致。`cli.ts:1611/1637` 未传 `settingsRoot`，走 env/`~/.vessel`（与改前一致）。
3. **theme 文案四处诚实 ✅，无自相矛盾**：`settings.ts:54-55`（中英均「仅保存、不影响任何输出/渲染」）、
   `guideCommands.ts:137`（用法行）与 `:164`（set 成功提示）、`glossary.ts:114-115`、`guide.ts:25` 与 `:36`。
   `cli.ts:91-94` 帮助文本只说「设置项」，无虚假生效暗示。仓库其它包 grep `theme|主题` 零命中 → 无遗漏的第五处。
4. **无行为改动（除上述 explain 容错）✅**：`SETTINGS_DEFS` 合法值与默认值未变（`settings.ts:51-72`）、
   `isAllowedValue` 仍精确匹配（`:87`）、`set()` 仍 fail loud + 原子写（`:144-160`）、`guide.test.ts` 既有断言（`:140-174`）不需改动。
   小瑕疵（既有、非本轮）：`settings.ts:83` 注释写「大小写不敏感」，实现 `v.value === value`（`:87`）是大小写敏感；注释不实。

**结论：ACCEPT**。

## 第三部分：Round 13 初评（G-11 MCP 半，**进行中，本轮不验收**）

**已实现且静态成立的两片：**
1. `packages/tools/src/mcp/McpClient.ts`：`StdioTransport(command, args, opts)` 支持任意命令（`:76-87`）；
   `resolveSpawnCommand`（`:45-54`）**只**在 `platform === 'win32'` **且**命令命中 `npx/npm/pnpm/yarn/uvx` 白名单时 `shell: true`，
   其余（含所有非 win32）一律 `shell: false` → 无「无条件 shell」；stdout 缺失**显式 throw**（`:88-94`，先 `kill()` 再抛），
   已无 `fallback → process.stdin`（全文件 `process.stdin` 仅出现在注释 `:90`）。文档注释（`:56-75`）与实现一致。
2. `apps/cli/src/mcp/config.ts`：纯读取器——只 import `node:fs/os/path` 与 `@vessel/shared`（`:1-4`），**零 `@vessel/tools`**、
   不 `new transport`；root 解析 `opts.rootDir` > `VESSEL_MCP_ROOT` > `~/.vessel`（`:193-196`），空/纯空白 env 视为未设（`:90-95`）；
   ENOENT → `[]`（`:216`）、非 ENOENT IO 错误原样上抛（`:217`）、JSON 非法（`:224`）、非对象/缺 `servers` 键/`servers` 非数组
   （`:227-235`）、重复 name（`:242-244`）全部 throw；`cwd:""`/非字符串 → throw（`:176-179`，`requireNonEmptyString` `:124-129`）；
   原子写 = `mkdirSync` + `.tmp` + `renameWithRetry`（`:282-287`）。三个判断点（缺 `servers` 键 = 损坏、空串 env = 未设、空串 cwd = 配置错误）
   均合理且与文件头声明自洽。

**未完成项清单（下一批卡直接可用）：**
- [ ] **接线 1/3**：`apps/cli/src/cli.ts` 的 `composeOpts` 无 `mcp:`（全仓 grep：`McpConfigStore` 仅出现于其自身文件）→ `vessel run` 不生效。
- [ ] **接线 2/3**：`chat.ts` 的 `buildHarness`（`composeHarness` 调用 `:320-336`）无 `mcp:` → TUI 不生效。
- [ ] **接线 3/3**：compose 侧 transport 构造不存在——`resolveSpawnCommand` / `new StdioTransport` 全仓**零调用点**，需在
      `packages/application/src/compose.ts` 侧按 `McpServerConfig[]` 构造 `ComposeMcpConnection[]`（类型 `:35-37`）。
- [ ] **降级语义**：现 `compose.ts:247-250` 对每个连接直接 `await registerMcpTools(...)`，任一 server 失败即整体抛错——
      必须改成逐 server `try/catch` + `{serverName, ok:false, reason}` 列表并打印（brief §6 明确禁止静默/一刀切）。
- [ ] **重复 spawn 防护**：`/permission`、`/model` 触发重建（`chat.ts:482-484`）会重新走 `buildHarness`；当前无任何 transport 缓存，
      必须给出去重方案（缓存连接或确认 `compose.ts:365-367` 的 `close()` 真回收）与验证方式（验收 5）。
- [ ] **测试全缺**：`packages/tools/src/mcp/mcp.test.ts` 现有 6 例只覆盖 in-process transport，对 `resolveSpawnCommand`
      （win32 白名单/非 win32 不 shell）与 `StdioTransport` 任意命令、stdout throw **零覆盖**；
      `apps/cli/src/mcp/` 下**无 `config.test.ts`**（288 行校验逻辑零覆盖）→ AGENTS.md §7 未满足。
- [ ] **验收 1（真跨进程）未做**：临时 root + `fixtures/echo-server.ts` → `registry.listVisible()` 含 `mcp__demo__add` 且
      `execute` 返回 `42`；验收 2（win32 `npx` shim）未验证；验收 4 的损坏/重复名用例未落地。
- [ ] 次要：`resolveMcpRoot()`（`:85-87`）与构造函数（`:195`）各写一遍同一解析逻辑；`save()` 尚无 CLI 消费者（`mcp add/remove` 未做）。

**结论：NOT-ACCEPTED（进行中）**——已交的两片静态正确，但接线、降级、去重、测试、E2E 五类均未开始，不接受本轮验收。

## 汇总

| 部分 | 结论 | 备注 |
| --- | --- | --- |
| Round 11 复评 | **ACCEPT** | 残留：失败回滚后租约丢失（`Session.append` 惰性重开不重取租约）；无失败路径回归测试；`createdAt` 未被断言 |
| Round 12 初评 | **ACCEPT** | 唯一行为改动 = explain 读失败回落 `'zh'`（要求内）；`cmdGuide:104` 口径不对称待统一 |
| Round 13 初评 | **NOT-ACCEPTED（进行中）** | 见上未完成清单（接线 3 项 + 降级 + 去重 + 测试 + E2E） |

最小修复方向（Round 11 残留）：让 `Session` 记录租约状态，惰性重开时重新 `acquireLease`（或在 `applyPendingChanges` 失败回滚后显式重取），
并补一例「buildHarness 抛错 → 旧会话仍可追加且租约仍在」的测试。
