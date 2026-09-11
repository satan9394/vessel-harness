# EVALUATION-REPORT-01 — 独立验收报告（Phase 7）

> Evaluator：新上下文、对抗立场（假设实现有错）。**未运行任何命令**（不跑 tsc/vitest/npm/tsx/git），
> 全部结论来自静态阅读 + 与 Orchestrator 原始证据的一致性核验。
> 需求源：`docs/product-evolution/IMPLEMENTATION-BRIEF-01.md`；指令：`docs/product-evolution/EVALUATION-BRIEF-01.md`。
> 待验改动：工作树 + WIP 98a3b1d（未做 git diff 复核，见 §0 限制）。

## 0. 核验方式与限制

- 读了：`packages/shared/src/provider.ts`、`packages/shared/src/events.ts`、`packages/context/src/builder/Builder.ts`、
  `packages/context/src/instructions/Instructions.ts`、`packages/context/src/compaction/Compaction.ts`、
  `packages/llm/src/provider/{MockProvider,MockProvider.test,OpenAICompatibleProvider,AnthropicProvider,OpencodeGoProvider,createProvider}.ts`、
  `packages/application/src/compose.ts`、`packages/core/src/agent-loop/AgentLoop.ts`、`packages/skills/src/index.ts`、
  `apps/cli/src/cli.ts`、`apps/cli/src/tui/chat.ts`、`apps/cli/src/tui/chat.test.ts`、`apps/cli/src/cli.test.ts`、
  `apps/cli/src/providers/setup.ts`、README、docs 相关篇目。
- **无法判定项**：`tsc -b` / `vitest run` 的复跑结果（硬性禁止跑命令）；WIP commit 的精确 diff（同上）。
  这两项已在下文显式标注，不做「照抄即通过」处理。
- 越界检查用文件 mtime 聚类替代 git diff：本 slice 时段内改动的源文件只有
  `packages/shared/src/provider.ts`、`packages/context/src/builder/Builder.ts`、`packages/llm/src/provider/MockProvider.ts`、
  `apps/cli/src/cli.ts`、`apps/cli/src/tui/chat.ts`、`packages/llm/src/provider/MockProvider.test.ts`（+ 文档），无其它 src 文件。

---

## 1. G-01 实现正确性 —— **通过（附带一处证据修正）**

**通过的部分**

- volatile 层确实被标成 `environment`：`Builder.ts:163-166`（`{ role:'user', content: '[环境] …', source:'environment' }`），
  且 :169 只在 `content` 非空时 push，空 volatile 不会产生空 user 消息。
- MockProvider 确实跳过注入型 source：`MockProvider.ts:54-58`
  `[...messages].reverse().find(m => m.role==='user' && !INJECTED_MESSAGE_SOURCES.has(m.source ?? ''))`；
  `context()` 走它（:90），chat/stream 共用 `resolve()`（:111-114），无第二份匹配逻辑。
- source 集合：`provider.ts:46-51` = environment / instruction / memory / compacted-summary。
- 各注入路径的标记与转发齐全：instruction（`Builder.ts:132`）、memory（`Builder.ts:144`）、
  compacted-summary（`Compaction.ts:91`）→ `recordToMessage` 只对 `user/message` 转发 `r.source`（`Builder.ts:41-50`）。

**漏标（同类问题未覆盖，中低severity）**

`events.ts:39` 的 `source` 联合类型共 8 个值，其中三个同样会被转发进 `ChatMessage.source`，却**不在** `INJECTED_MESSAGE_SOURCES`：

| source | 写入点 | 是否在集合内 |
|---|---|---|
| `inject` | `benchmarks/runners/src/runner.ts:135`（Evaluator 结论回投父上下文） | ✗ |
| `plan` | `packages/agents/src/planner/Planner.ts:84`（计划作为 user 消息注入，注释自称 "first-class object"） | ✗ |
| `handoff` | `packages/engine/src/handoff/StartFromHandoff.ts:99`（续跑上下文） | ✗ |
| `steer` | `AgentLoop.ts:689` | ✗（**有意**：`MockProvider.ts:52` 明确声明 steer 属真实驱动输入，可接受） |

`provider.ts:44` 的注释声称该集合「kept next to the contract so producer and consumer cannot drift apart」，
但它是手写常量、与 `SessionRecord.source` 联合类型无编译期约束，**已经漂移**（3/8 未列）。
`plan` 尤其接近本 bug 形态：`injectPlan` 追加的 user 消息会成为下一步模型调用的最后一条 user 消息，
`when: /阅读|read|总结/` 这类定向脚本会再次被遮蔽。对本次验收目标（repo 工作区 `run`）不构成阻塞，但属同一缺陷类未修完。

**必须修正的证据（关键）**：Brief/审计把根因写成「仓库工作区存在 skills index」，**当前仓库不成立**。

- `listIndex(workspaceRoot)` 默认 scope='project'，只扫 `<ws>/.vessel/skills` 与 `<ws>/.agents/skills`（`packages/skills/src/index.ts:30-33`），
  空则 `formatIndexText` 返回 `''`（:76-78）；volatile 的唯一接点是 `compose.ts:255,263`。
- 实测文件系统：仓库根 **不存在** `.vessel`、`.agents`（`Test-Path` 均为 False），全仓 `**/SKILL.md` 仅存在于
  `benchmarks/fixtures/B021/.vessel/skills/bench-demo/SKILL.md` 与 benchmarks 报告工作区。
  ⇒ 仓库工作区的 volatile 层是**空**的，`[环境] …` 消息根本不会被追加。
- 真正在仓库工作区遮蔽真实输入的是 **AGENTS.md instruction 消息**：`AgentLoop.ts:219-225` 先追加用户输入，
  `Builder.ts:126-135` 随后追加 instruction，故 replay 顺序为 `[user(prompt), user(AGENTS.md)]`，
  pre-fix 的「最后一条 user 消息」= AGENTS.md 全文；而仓库 `AGENTS.md` 不含 `阅读|read|总结|summary`（grep 0 命中）。
  ⇒ pre-fix 输出 `(mock: no script entry matched)`、post-fix 命中读 README —— **证据链成立且是有判别力的**，
  但机制是 `instruction`，不是 `environment`。

结论：修复**真的有效**（两个 source 都在集合里），但报告若继续以「skills index」解释仓库工作区的复现，
属证据失实；且**没有**任何测试覆盖「仓库形态（有 AGENTS.md、无 skills）」或「有 skills」的端到端路径（见 §2、§6）。

## 2. 测试真实性（重点挑错）—— **不通过**

`packages/llm/src/provider/MockProvider.test.ts` 5 个用例逐个判定：

| 用例 | 行号 | 是否真构造 `source:'environment'` 且位于最后一条 user | 判别性（删掉实现是否会失败） |
|---|---|---|---|
| A | :17-34 | ✅ 是（`[system, user(真实), user(environment)]`，env 在最后） | **✅ 强判别**：删掉 filter 后 haystack=env 文本 → 不命中 → `toBe('OK')` 失败 |
| A2 | :36-44 | 构造了，但 env 在**前**、真实输入在最后 | ❌ 弱：无 filter 也通过（最后一条本来就是真实输入） |
| A3 | :46-53 | 只有 env 一条 | ❌ 弱：无 filter 时 haystack=env→同样不命中→同样断言默认文案，**删除实现仍通过** |
| B | :55-69 | n/a | 只验证 `MockProviderOptions.fallbackText` 选项；**不验证 cli.ts 的接线**；CLI 真实兜底串 `（mock 离线冒烟）已收到你的输入…`（`cli.ts:265`）在全仓测试里 0 引用 |
| C | :71-92 | n/a（tool 场景） | **✅ 强判别**：对照组 `okMessages → 'FALLBACK-ENTRY'` 在 `whenToolResult` 被忽略时会失败；确实覆盖 `[TOOL_FAILURE]` 前缀分支 |

断言没有出现 `!== undefined` 之类永真写法；A/C 是真判别用例，不是空壳。
**但验收 Brief 第 3 条要求的三类测试有两类缺失：**

1. **未知命令 exit 码测试：完全没有。**
   全仓 grep `未知命令`（*.ts）只命中 `cli.ts:1497` 与 TUI 的 `chat.ts:375` / `chat.test.ts:177`（那是 slash 命令提示，不是子命令分派）；
   `main(['foo'])` / `main(['chat'])` 在测试中 0 次出现；`cli.test.ts:108-1226` 通读后无该分支用例。
   `IMPLEMENT-BRIEF-01-STATE.md:23` 自己把它列为「必需」，未交付。⇒ 该分支现在**无任何回归保护**。
2. **端到端（经 ContextBuilder/composeHarness）的注入场景测试：没有。**
   既有 CLI 冒烟 `cli.test.ts:124-139` 用临时工作区 + 手写 README.md，既无 skills 也无 AGENTS.md
   （grep `skills|SKILL` 于 `cli.test.ts` = 0 命中），注入路径根本没被走到 —— 正是 Brief 警告的「空工作区把 bug 掩盖」。
   新增的 A/A2/A3 只在 provider 单元层直接拼 messages，不经过 builder，无法证明 assemble() 真的把 source 标了出来。
3. `cli.ts:257` 的失败正则（含 DENIED/INVALID_ARGS/TIMEOUT/SANDBOX_DENIAL）与 `cli.ts:265` 兜底文案均无测试；C 只覆盖了 MockProvider 的匹配器本身。

## 3. `source` 字段泄漏风险 —— **通过**

三条真实 provider 序列化路径全部**显式挑字段**，无 `{...m}`、无整体 `JSON.stringify(messages)`：

- OpenAI 兼容：`OpenAICompatibleProvider.ts:26-44`（`toOpenAIMessages`：role/content/name/tool_call_id/reasoning_content/tool_calls），
  请求体 `:102-109` 与流式 `:178-185` 都只传转换结果。
- opencode-go：`OpencodeGoProvider.ts:320-338`（`toOpencodeGoWireMessages` 同样逐字段），请求体 `:479-483` / `:503`。
- Anthropic：`AnthropicProvider.ts:102-158`（`toAnthropicMessages` 重组 content blocks）+ `:80-88`（splitSystem 只取 content），
  请求体 `:202-218` / `:293-320`。
- 全仓 grep `JSON.stringify(messages` 仅命中 `Builder.ts:181`（token 估算，不进网络）；`\.\.\.m` 展开无命中。
- 其它 `fetch` 均无 messages（`packages/application/src/providers/modelFetcher.ts:54` 是 GET 模型列表）。

⇒ `source` 不会进入任何上游 HTTP body，**不构成 REJECT 项**。

## 4. G-02 未知命令分派 —— **通过（静态）**，附三个边界提醒

- 分支位置正确：`cli.ts:1493-1499` 在全部已知子命令之后（`1479-1492`：provider/models/setup/usage/pricing/migrate/review/explain|term/list-terms/guide/settings/bench-report/serve/web）。
- `run` 不会被拦：`parseArgs` 在 `cli.ts:124` 直接消费 `run`（不进 positionals），故 `vessel run --prompt x` → `first===undefined`；
  `vessel run --bench B001 …` 同理（`package.json:37`、文档示例均不受影响）。
- `--help`/`-h`/`--version`/`-v` 在 `cli.ts:122-123` 提前 return，`vessel --help`、`vessel run --help` 均不会误判。
- 无参 `vessel`：`first===undefined` → `cli.ts:1501-1516`，TTY 进 `runChat`（TUI）；非 TTY 无 `--prompt` 给引导并 return 2（该行为在 `docs/TEST-REPORT-V07.md:46` 已有 B6 记录，非本次新增回归）。
- 返回码：`return 2` → ESM 入口 `cli.ts:1533-1535` `main().then(code => process.exit(code))`，无 `exit(0)` 覆盖。
- 既有测试不被拦：全仓 `main([...])` 的首参只有 run/provider/models/usage/pricing/bench-report/serve/web/review/--help/--version，均在白名单内。
- 边界（建议记一笔，非阻塞）：① `vessel help`（裸词）现在落进未知命令 exit 2 —— 白名单里只有 `--help`，`help` 不在 `1479-1492`；② `vessel foo --help` → 报 `未知命令 foo`（help 意图被位置参数压过）；③ `vessel run B001 --bench` → `未知命令 B001`（只有 `--bench <id>` 形式可用）。三者都不违反 Brief 明文，但对新用户不友好。
- **未复跑**：exit code 2 与 stderr 文案的运行时结果无法在本会话独立验证（禁跑命令），仅静态推导；与 Orchestrator 证据（`foo`/`chat` → 未知命令 + exit 2）一致。

## 5. 越界 / 回归风险 —— **通过（除两处文档性遗留）**

- **未误改 `cah`**：`setup.ts` 相关行未被改动（见 §6 该文件仍是原样，问题在于「该不该改」而非「被改坏」）。
- **README 未动且正确**：mtime 为 9/10 21:30（早于本 slice），`README.md:50,61` 均写「无参 `vessel` = TUI/chat」，无 `vessel chat` 入口表述。grep `vessel chat` 在 README 上 0 命中。
- **`chat.ts:261` 无 TS1005**：欢迎语是单一模板字符串（`` `${VESSEL_LOGO}Vessel — 交互会话开始…「vessel guide」有新手指引。` ``），内层用「」，无嵌套裸反引号；既有断言 `chat.test.ts:212` 依赖的「交互会话开始」仍在。
- **无无关重构**：本 slice 时段内只有 6 个源文件变更（mtime 聚类，见 §0），无第三方模块被动过。
- **既有 mock smoke 不回归**：`chat.test.ts:203-249`、`cli.test.ts:124-139` 断言的文本/长度均不受 source 过滤影响（这些场景本来就没有注入消息）。
- **无法判定**：`tsc -b`（exit 0）与 `vitest run`（113 文件 / 1225 passed + 1 skipped）**未独立复跑**。静态层面未发现新的类型错误（`source?: string` 与 `INJECTED_MESSAGE_SOURCES` 均从 `@vessel/shared` 正常导出，`shared/src/index.ts:3`），但权威结论以 Orchestrator 的复跑为准。

## 6. Brief 覆盖度逐条对号 —— **标准 1 部分 / 2 通过 / 3 不通过 / 4 部分**

| Brief 验收标准 | 判定 | 依据 |
|---|---|---|
| 1. G-01：含 skills index 注入的 workspace 下不再输出 `(mock: no script entry matched)`；exit 0 | **部分通过** | 实现正确（§1）；但「仓库工作区含 skills index」这一前提在当前仓库**不成立**（无 `.vessel/skills`、`.agents/skills`），实际生效的是 instruction 遮蔽；且无任何端到端测试锁死该场景（§2）。实跑证据（Orchestrator）本身有判别力，但**理由错误**，需改写 |
| 2. G-02：`foo`/`chat`/任意未知首参 → 未知命令 + exit 2；已知命令不变 | **通过（静态）** | §4；运行时未复跑 |
| 3. 测试真实性：注入场景测试 + 未知命令 exit 码测试 + 全量绿 | **不通过（部分）** | 注入场景有单元级强判别用例 A/C（:17-34、:71-92），但 A2/A3/B 判别性弱或与非实现无关；**未知命令 exit 码测试完全缺失**；无 CLI/端到端注入用例；`tsc`/`vitest` 未复跑 |
| 4. G-14：setup 无 `cah *` 残留；TUI 欢迎语补引导；README 与 TUI 入口一致 | **部分通过** | TUI 欢迎语 ✅（`chat.ts:261` 含 `/explain`、`? <术语>`、`vessel guide`）；README ✅（无 `vessel chat`）；**setup.ts 仍教过时命令** ❌（见下） |

**`cah *` 的「误报」结论被证伪（必须纠正记录）**

`IMPLEMENT-BRIEF-01-STATE.md:27` 与 `PRODUCT-STATE.md:19` 均称「全仓库仅测试临时目录名命中，无用户可见文案」。
实际 grep（`apps/`）命中 **4 处用户可见文案，全部在 `vessel setup` 向导主路径上**：

- `apps/cli/src/providers/setup.ts:103` — `clack.confirm({ message: '把 "…" 设为当前默认供应商？（cah run 立即使用）' })`
- `apps/cli/src/providers/setup.ts:237` — `clack.log.error('…可稍后用 cah provider add / cah models 再试。')`
- `apps/cli/src/providers/setup.ts:268` — 写入确认摘要 `作用域: ~/.vessel（影响本机所有 cah run）`
- `apps/cli/src/providers/setup.ts:301` — `clack.log.success('已切换。cah run 现在走 …')`
（另有 `:7` 文件头注释 `cah setup interactive wizard`，无用户可见性。）

这与 Brief 标准 4「setup 向导无 `cah *` 过时命令残留（grep 验证）」**直接冲突**，也与 Orchestrator 的核验结论冲突 ——
审计报告这次不是误报，是验收侧的证据核验有误。

**另一处文档与新行为冲突**：`vessel chat` 现已 exit 2，但仍被文档记为有效入口：
`docs/PROJECT-BRIEF.md:21,52`（"TUI：`vessel chat`"）、`docs/PROVIDER-MANAGEMENT.md:208,220`（可复制的命令示例 `vessel chat`）、
`docs/REAL-MODEL-LANE.md:349`。UX-REPORT §1.2 的建议明确要求「同步修正 docs/PROJECT-BRIEF.md 的 TUI 入口描述」，未执行。

**TUI 冒烟未同步修复（同一用户可见缺陷类）**：`apps/cli/src/tui/chat.ts:245-249` 的脚本既无 `fallbackText`，
也无 TOOL_FAILURE 友好分支；空工作区读 README 失败时会把 `（mock）读取结果：\n[TOOL_FAILURE] read failed: …`
原样当最终回复（Brief「错误场景」明令禁止），普通输入仍回 `(mock: no script entry matched)`
（Brief 理想行为 #2 要求确定性兜底）。`chat.test.ts:215-227` 只断言 `output.length > 1`，抓不到。
（G-01 本身在 TUI 侧已被共享的 MockProvider 过滤修好；缺的是兜底与失败文案。）

---

## 7. 结论：**REJECT**

核心两项功能修复（G-01 过滤、G-02 分派）**实现正确、无 source 泄漏、无越界重构**；REJECT 的理由是
**验收标准 3（必需的未知命令 exit 码测试）为零覆盖**、**标准 4 部分未达且其「误报」结论被证伪**，
外加同缺陷类的两处未收敛。以下为最小必修条目（按严重度）。

### S1（阻断标准 3，必须）未知命令分派零测试
- 现状：`cli.ts:1493-1499` 无任何测试；`main(['foo'])`/`main(['chat'])` 全仓 0 调用。
- 修法方向：在 `apps/cli/src/cli.test.ts` 新增用例（沿用其 `captureBoth()` + `VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT` 临时 root 纪律）：
  `expect(await main(['totally-unknown'])).toBe(2)`；`expect(logs.join('\n')).toContain('未知命令')`；
  同断言覆盖 `['chat']`；再各加一条已知命令（`['list-terms']`、`['--help']` 或 `['guide']`）不被拦的正向断言。

### S2（阻断标准 4，必须）`cah *` 残留与失实记录
- 现状：`setup.ts:103,237,268,301` 四处用户可见 `cah *`；`STATE:27` / `PRODUCT-STATE:19` 称其为误报（被 grep 证伪）。
- 修法方向（二选一，须显式落盘决策）：① 最小改动把这 4 处改为 `vessel run` / `vessel provider add` / `vessel models`（纯字符串，零风险）；
  ② 若坚持本轮不动，则必须改写 `IMPLEMENT-BRIEF-01-STATE.md:27` 与 `PRODUCT-STATE.md:19/34` 的理由为
  「已知残留、界定为下一轮 P1 文案卡」，不得保留「无误报、全仓仅测试目录命中」这一与事实相反的表述。

### S3（G-01 同类漏网，建议同轮修）`inject` / `plan` / `handoff` 未纳入
- 证据：`events.ts:39`（联合类型）、`runner.ts:135`、`Planner.ts:84`、`StartFromHandoff.ts:99`。
- 修法方向：把 `provider.ts:46-51` 扩为 `+ 'inject','plan','handoff'`（保留 `steer` 可匹配的现有语义并在注释里写清），
  或改为白名单语义（`source === undefined || 'user' || 'steer'` 才算 surface）以避免再度漂移；补一条 plan 注入的单测。

### S4（同一用户可见缺陷类，建议同轮修）TUI 冒烟无兜底
- 证据：`chat.ts:245-249`（无 `fallbackText`、无 TOOL_FAILURE 分支）；`chat.test.ts:215-227` 断言过弱。
- 修法方向：复用 `cli.ts:255-266` 的第二/第三条脚本 + `fallbackText`；测试改为断言输出**不含** `[TOOL_FAILURE]` 且非 `(mock: no script entry matched)`。

### S5（证据卫生 + 复现判别力）Brief/审计的「skills index」叙事需修正，并补端到端用例
- 证据：仓库根无 `.vessel`/`.agents`（`listIndex` 只扫这两处，`skills/src/index.ts:30-33`）；
  实际的仓库内遮蔽源是 AGENTS.md instruction（`AgentLoop.ts:219-225` + `Builder.ts:126-135`）。
- 修法方向：把标准 1 的复现命令补一条**真判别**版本（临时工作区放 `.vessel/skills/x/SKILL.md`，或直接用
  `benchmarks/fixtures/B021` 形态），并在 `EVALUATION-BRIEF-01.md:21-23` 与审计根因段落更正为
  「instruction / volatile 两类注入都会遮蔽」，避免下一轮拿错场景自证。

### 附：非阻塞项
`vessel help`（裸词）落入未知命令（可把 `help` 加入白名单映射到 USAGE）；`vessel foo --help`、`vessel run B021 --bench`
两个边界同上；`docs/PROJECT-BRIEF.md:21,52` 等三处文档仍把 `vessel chat` 当有效入口。
