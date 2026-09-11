# EVALUATION-REPORT-15 — Round 11 复评 / Round 12 初评 / Round 13 初评（进行中）

> 独立 Evaluator（全新上下文，对抗立场：先假设实现有错、修复是假的）。**静态审查，未复跑任何命令**；
> 指挥侧 `tsc -b` 0 / 126 文件 / 1335 passed + 1 skipped / exit 0 仅作参考，未复核、未采信为证据。

## 一、Round 11 复评（上轮 REJECT 三条必修）

1. **生效时机 ✅**：`chat.ts:482-484`（slash 分支）在置好挂起项（`:473-478`，含「切回当前值即撤销挂起」）后立刻
   `await applyPendingChanges()`；该函数（`:402-435`）落新值 → `await previous.close()`（`:415-421`）→ `buildHarness()`（`:422`）
   → `syncSessionMeta()`（`:425`；`:369-387` get→put 保 `createdAt`）。尚未懒建则继续挂起、由首次构建带上新值（`:492-494`）。
   「先 NL 后 `/permission` 再 `/quit`」正是 `chat.test.ts:864-869` 的顺序：末态 `permission==='read-only'` 且 `toHaveLength(1)`
   → **指挥侧那例失败确已被「harness 已存在即立即应用」修掉**，切换后立即 `/quit` 确实把登记表写成新值。
2. **重建失败容错 ✅（对象层）/ ⚠️ 资源层降级**：`buildHarness()` 抛错被 `:426-434` 捕获 → 回滚 `permission/model`、
   `harness = previous`、清挂起项、打印 `[错误] 重建会话失败（已保留原设置：…）`（`:433`）→ 不崩、不丢对象、状态自洽。
   但 `previous.close()` 在重建**之前**跑，回滚的是**已 close 的** harness：`Session.close()`（`packages/core/src/session/Session.ts:250-260`）
   删 `.lease` 且 `fd=null`，而 `Session.append` 的惰性重开（`:168-170`）**不重取租约** → 回滚后本会话余下时间**无租约写入**，
   单写者 fail-closed 失效（第二个进程此时能拿到租约并与本进程交错写同一 JSONL）；`compose.ts:361-368` 的 `close()` 还
   `telemetry.detach()` 并关闭 `mcpClients`，回滚后的 previous 后续回合**无遥测投影**、MCP 客户端已死（MCP 今日未接线，
   暂不可达；遥测可达）。判定：**降级可接受但不应长期保留**——「宣称切了却没生效」不成立（变量已回滚 + 明示保留旧设置）。
   另：`composeHarness` 在 `Session.open`（`compose.ts:164`）之后抛错（`:168` 策略 / `:220` behavior 加载）会泄漏 fd 与 `.lease`；
   但 previous 与其同 id 同目录，下次重建的 `previous.close()` 会顺带清掉 → 自愈、无死锁（静态推断，未运行验证）。
3. **孤儿会话已消除 ✅**：`sessionId: currentSessionId ?? opts.sessionId`（`chat.ts:335`）复用同一目录，登记走 `get`（`:344`）
   → 覆盖而非新增；`chat.test.ts:868` 断言 `toHaveLength(1)`。
4. **测试真实、无永真断言，但有两处空隙**：6 例（`chat.test.ts:812-958`）全部走真实 `runChat` 且都带对照——①`:819-827`
   非法/缺参断言**字段不存在**；②`:835-837` 同款；③`:856-859` 负对照为 `workspace-write` 且 `not.toBe` 判别组；④`:879-889`
   先断言 `length>=1`（使 `:881` 的 `toEqual` 不空转）+ 对照仍旧 model；⑤`:911-925` deny 面（`/\[DENIED\]/`、不含 `[错误]`、
   `requests.length>=2` 证明回合跑完）+ 对照文件真创建且内容逐字相同 → 上轮「只有一个 bit、回合可能没跑」的替代解释被排除；
   ⑥`:937-957` en/zh/缺文件三态差分且 `VESSEL_SETTINGS_ROOT` 已钉（`:713-743`）。空隙：(a) 无「buildHarness 失败 → 回滚 + 报错」
   回归测试（`:433` 改坏仍全绿）；(b) `createdAt: prev.createdAt`（`:380`）无断言。附带（非本轮引入）：`buildHarness` 登记
   `model: effModel`（`:349`）而 `syncSessionMeta` 写原始 `model`（`:378`），对改写模型名的 preset 两者可能不一致。

**结论：ACCEPT**（三条必修闭合；第 2 条租约降级与第 4 条空隙记入后续批次，不构成本轮推翻理由）。

## 二、Round 12 初评（G-13-P2 / P3）

1. **`cmdExplain` ✅**：`--locale` 显式优先且校验非法值（`guideCommands.ts:64-70`，stderr + 返回 2）；否则
   settings.locale（`:74`）且**读取任何失败回落 `'zh'`**（`:73-77`）。优先级 = `--locale` > settings > `'zh'`（第三档由
   `settings.ts:107` 默认值给出）。唯一**行为改动**即该 catch（本轮要求）；副作用：`cmdGuide`（`:104`）无 catch，损坏时仍
   fail loud，口径不对称，建议后续统一或注明理由。
2. **`resolveChatLocale` ✅**：`chat.ts:226-232` 读 settings，异常回落 `'zh'`；进循环前解析一次（`:452`），`/explain`（`:649`）
   与 `? <术语>`（`:561`）共用同一 `ctx.locale`（`:552`）→ 会话内稳定。`cli.ts:1611/1637` 未传 `settingsRoot`，走 env/`~/.vessel`（同改前）。
3. **theme 文案四处诚实 ✅ 无遗漏**：`settings.ts:54-55`、`guideCommands.ts:137` + `:164`、`glossary.ts:114-115`、`guide.ts:25`/`:36`
   均明示「仅保存、不影响任何输出/渲染」；`cli.ts:91-94` 无虚假生效暗示；`packages/**` grep `theme|主题` 零命中。
4. **无行为改动（theme 侧）✅**：合法值/默认值（`settings.ts:51-72`）、校验（`:87` 精确匹配）、`set()` fail loud + 原子写（`:144-160`）
   与 `guide.test.ts:140-174` 既有断言均未动。瑕疵（既有）：`:83` 注释称「大小写不敏感」而实现是敏感。

**结论：ACCEPT**。

## 三、Round 13 初评（G-11 MCP 半，**进行中，本轮不验收**）

已交两片静态成立：①`McpClient.ts`——`StdioTransport(command, args, opts)` 支持任意命令（`:76-87`）；`resolveSpawnCommand`
（`:45-54`）**只**在 win32 **且**命中 `npx/npm/pnpm/yarn/uvx` 白名单时 `shell: true`，其余（含非 win32）一律 `false`，无无条件 shell；
stdout 缺失**显式 throw**（`:88-94`，先 kill 再抛），全文 `process.stdin` 仅存于注释（`:90`）。②`apps/cli/src/mcp/config.ts`——纯读取器，
只 import `node:fs/os/path` + `@vessel/shared`（`:1-4`），零 `@vessel/tools`、不建 transport；root = `opts.rootDir` > `VESSEL_MCP_ROOT`
> `~/.vessel`（`:193-196`，空/纯空白 env 视为未设 `:90-95`）；ENOENT→`[]`（`:216`）、其余 IO 错误上抛（`:217`）、JSON 非法（`:224`）、
非对象/缺 `servers`/`servers` 非数组（`:227-235`）、重复 name（`:242-244`）全 throw；空串 `cwd` → throw（`:176-179`）；原子写
`mkdirSync`+`.tmp`+`renameWithRetry`（`:282-287`）。三个判断点合理，与文件头声明自洽。

**未完成项清单（下一批卡直接用）：**
- [ ] 接线：`cli.ts` `composeOpts` 无 `mcp:`；`chat.ts` `buildHarness`（`composeHarness` 调用 `:320-336`）无 `mcp:`；
      compose 侧无 transport 构造——`resolveSpawnCommand` / `new StdioTransport` 全仓**零调用点**（grep 已验证），需在
      `compose.ts` 按 `McpServerConfig[]` 组 `ComposeMcpConnection[]`（类型 `:35-37`）。
- [ ] 降级语义：`compose.ts:247-250` 现直接 `await registerMcpTools(...)`，任一 server 失败即整体抛——须改逐 server `try/catch` + `{serverName, ok:false, reason}` 列表并打印（brief §6 禁止静默/一刀切）。
- [ ] 重复 spawn 防护：重建路径（`chat.ts:482-484`）会重走 `buildHarness`，当前无 transport 缓存，需给去重方案与验证（验收 5）。
- [ ] 测试全缺：`mcp.test.ts` 6 例只覆盖 in-process transport，对 `resolveSpawnCommand`、任意命令 spawn、stdout throw **零覆盖**；`apps/cli/src/mcp/` **无 `config.test.ts`**（288 行校验零覆盖）→ AGENTS.md §7 未满足。
- [ ] E2E 未做：验收 1（临时 root + `fixtures/echo-server.ts` → 可见 `mcp__demo__add` 且 execute 返回 `42`）、验收 2（win32 npx shim）、验收 4（损坏/重复名）均未落地；须证明走的是 `StdioTransport` 真子进程。
- [ ] 次要：`resolveMcpRoot()`（`:85-87`）与构造函数（`:195`）重复同一解析逻辑；`save()` 尚无 CLI 消费者（`mcp add/remove` 未做）。

**结论：NOT-ACCEPTED（进行中）**——已交两片静态正确，接线、降级、去重、测试、E2E 五类均未开始。

## 汇总

| 部分 | 结论 | 备注 |
| --- | --- | --- |
| Round 11 复评 | **ACCEPT** | 残留：回滚后租约丢失（惰性重开不重取）；无失败路径回归测试；`createdAt` 未被断言 |
| Round 12 初评 | **ACCEPT** | 唯一行为改动 = explain 读失败回落 `'zh'`（要求内）；`cmdGuide:104` 口径待统一 |
| Round 13 初评 | **NOT-ACCEPTED（进行中）** | 见清单（接线 3 项 + 降级 + 去重 + 测试 + E2E） |

最小修复方向（Round 11 残留）：`Session` 记录租约状态、惰性重开时重新 `acquireLease`（或回滚后显式重取），并补一例
「buildHarness 抛错 → 旧会话仍可追加且租约仍在」的测试。
