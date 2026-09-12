# PRODUCT-GAP-MAP — Vessel 产品缺口地图（第三阶段：独立综合）

> Orchestrator 综合自 4 份独立审计（UX / CAPABILITY-MATRIX / ARCHITECTURE / RELIABILITY），
> 执行去重、冲突检测、依赖分析、成本/收益判断。每项含：ID/问题/证据/用户影响/根本原因/建议/涉及模块/成本/风险/依赖/优先级。

优先级定义：P0 阻碍核心使用/严重安全/数据风险；P1 明显破坏核心体验；P2 显著提升成熟度；P3 高级能力；P4 可选优化。

---

## 缺口清单（去重后 15 项）

| ID | 问题 | 证据来源 | 用户影响 | 建议（一句话） | 涉及模块 | 成本 | 优先级 |
|---|---|---|---|---|---|---|---|
| G-01 | **首次运行 mock 冒烟演示在仓库工作区 100% 失效**：README 首条示例 `run --prompt "总结当前工作区 README"` 实测输出 `(mock: no script entry matched)` 且 exit 0 | UX-1.1（实跑复现 + 空工作区对照组） | 无配置新用户复制首条命令即"假成功"，第一次成功使用被阻断 | mock 匹配跳过注入型 user 消息（skills index 等 volatile），仅匹配真实 surface 输入；或冒烟脚本给确定性兜底应答 | rules/context Builder、llm MockProvider、cli | 低 | **P0** |
| G-02 | **未知/拼错命令被静默当作 run 执行**（exit 0）：`vessel foo`、`vessel chat`（文档声称的 TUI 入口，实际是无参 `vessel`）都变成静默 mock run，拼错永不报错 | UX-1.2（实跑复现）| 用户打错命令得到无意义"成功"，且 TUI 入口认知错误 | main() 增加未知子命令分支：提示 + `vessel --help` 指引 + exit 2 | cli | 极低 | **P0** |
| G-03 | **CLI 顶层无异常兜底**：配置损坏（settings/secrets/current/providers.json）→ 核心命令裸栈崩溃、无恢复指引 | RELIABILITY-R1/R5（cli.ts:1513-1515 无 .catch） | 用户遇"unhandled rejection"式崩溃，不知怎么修（对新手=坏） | main() 加统一 .catch：describeProviderError + 按错误特征给一句恢复指引 + exit 1 | cli | 中低 | P1 |
| G-04 | **usage.json 损坏 → 静默清零 + 无备份 = 用量历史永久丢失** | RELIABILITY-R2（UsageStore.ts:432-519 load 吞错、save 无备份） | 全部用量/成本历史静默消失，无法回滚 | 损坏时 fail-loud/隔离改名+warn（复用 secrets quarantine 样板）+ 写前备份轮转；load 失败不覆盖 | cli usage | 中 | P1 |
| G-05 | **密钥暴露面**：DPAPI 把 base64 密钥拼进 PowerShell 命令行（本机同级进程可读）；openai-compatible 错误体原文回显 500 字符（潜在密钥进日志）；secrets.json 损坏默认无恢复 | RELIABILITY-R3/R4/R5 | 密钥可被本机同级进程/日志捕获 | DPAPI 改 stdin 传参或 native 库；错误体仿 OpencodeGoProvider 脱敏；默认 recoverCorrupted:true | application CredentialStore、llm OpenAICompatibleProvider | 中 | P1 |
| G-06 | **i18n 无统一架构**：CLI settings.locale（仅 guide 消费）、web 自检测 i18n、永远双语 glossary 三套互不相通；CLI 217 处 console.* 中文内联无消息目录；settings 提示文案宣称"已切换"但 explain/TUI 写死中文（名不副实） | ARCHITECTURE-S1 + UX-P1 | 用户改设置无效却不自知；加语言=全量改造 | 短期：修 settings 提示话术 + 让 explain/TUI 尊重 locale；长期：消息目录统一架构成单独里程碑 | cli/web/glossary | 高（全量） | P1→缓 |
| G-07 | **apps/web 游离 tsc -b 图外**：Gate1 只跑根 tsc -b、Gate7 只探 web dist、web 无 typecheck 脚本 → web 类型错误可静默过 8 门禁 | ARCHITECTURE-S2（gates.ts:461,562-573） | 发布门禁形同虚设于 web | web 加 typecheck 脚本并入 tsc -b 图（或 Gate1 显式跑 tsc -p web） | web、gates | 低 | P1 |
| G-08 | **~/.vessel 状态根解析复制 7 次** + settings 根耦合 usage 根 + migrate KNOWN_STATE_ENTRIES 硬编码清单缺后出现状态文件会腐烂 | ARCHITECTURE-S3 | 新增状态文件后一次性迁移失效、根解析行为不一致 | 收敛为单一 resolveStateRoots 工具 + migrate 清单动态化/按目录扫描 | application/cli stores | 中 | P1/P2 |
| G-09 | **TUI 会话内成本可见性缺失**（数据已采集只缺展示）——直击 deepseek-flash 成本波动痛点 | CAPABILITY-gap1 | 用户无法在会话中感知成本；B 判为性价比最高差距 | TUI 会话内成本栏（每次 turn 后展示 token/成本）+ `/cost` | tui、usage | 极低 | P2 |
| G-10 | **会话续跑 + 会话级快照回滚缺失**（diff 报告 + 单命令 revert 的克制形态，不做自动 commit） | CAPABILITY-gap2、矩阵行 11（8 竞品全有） | 长会话中断后丢失进展，无法回到事故前状态 | resume/checkpoint + snapshot + revert（复用现有持久化） | engine/session | 中高 | P2 |
| G-11 | **CLI 面 MCP 配置命令 + 通用 JSON 输出缺失**（库级管道已通，只差出口） | CAPABILITY-gap3、矩阵行 13/14 | headless/CI 集成能力不足 | `vessel mcp` 子命令 + `--json` 输出开关 | cli | 中 | P2 |
| G-12 | **cli→local-server 引用边未声明**（apps/cli/tsconfig.json 缺 local-server reference）→ 干净 clone 构建顺序脆弱 | ARCHITECTURE-问题1 | 干净 clone 可能 TS2307 | 补 `{path:"../../apps/local-server"}` 声明该边（对齐 098） | cli tsconfig | 极低 | P2 |
| G-13 | **TUI/CLI 命令面不一致**、`/permission` 不持久、**theme 设置无任何 UI 消费** | ARCHITECTURE + UX-P1 | 设置项存在但无效，双表面行为分叉 | 先做"无消费者的设置项"收敛（theme 接入或移除）；/permission 持久化 | tui、settings | 中 | P2/P3 |
| G-14 | **向导 setup.ts 教过时命令** `cah *`（3 处）；TUI 欢迎语不提 /explain / ? <term> / setup / guide | UX-P1 | 新用户学到已废弃命令；引导入口未被发现 | 文案更新（cah→实际命令）；TUI 欢迎语补引导提示 | cli setup、tui | 极低 | P1(文案) |
| G-15 | **原子写 wrapper 各 Store 重复实现**（技术债） | ARCHITECTURE-T 清单 | 维护成本，无用户影响 | 统一抽 shared atomicWrite（113 已有 helper，收敛各 Store） | stores | 低 | P4 |

---

- ✅ **Round 2 已闭环（提交 22c1463 / c5d491b）**：**G-03**（CLI 顶层无 catch → 崩溃面收敛为「人话 + 路径 + 恢复指引 + exit 1」）、**G-12**（`apps/cli/tsconfig.json` 补 local-server 构建边）、**G-16**（`MESSAGE_SOURCES` 运行时事实源 + 漂移守卫测试）。独立裁定：`EVALUATION-REPORT-03.md` **ACCEPT（7/7）**、`EVALUATION-REPORT-03-RECHECK.md` **ACCEPT（A–D）**；证据：`tsc 0`、`vitest 116 文件 / 1248 passed + 1 skipped`、崩溃面 E2E 双例 exit 1 且无裸栈。
- 🆕 **N1（P2 → Round 3 NOW 首选）**：「坏配置 → exit 1」用户可见契约**无自动化测试**（删 `.catch` 不变红）。
- 🆕 **N2（P3）**：JSON 特征探测过宽（裸 `/JSON/i`）→ 目录名含 json 的 ENOENT 误判。
- 🆕 **N5（P3，跨轮）**：`ChatMessage.source` 仍裸 `string` → 收窄为 `MessageSource | 'environment'`。
- 🆕 **LOW**：路径清洗截断以 `]`/`）` 结尾的真实路径（仅展示文案）。

- ✅ **Round 3 已闭环（提交 eea9e4c / 28a1e9d）**：**N1**（"坏配置 → exit 1 + 路径 + 指引"契约的 in-process 测试）、**N2**（分类精度：ENOENT 无条件优先 + 精确 JSON 签名 + 覆盖 ProviderStore 措辞）、**N5**（`ChatMessage.source` 收窄 + 双向漂移守卫）。独立裁定 `EVALUATION-REPORT-04.md` **ACCEPT**；证据：`tsc 0`、`vitest 117 文件 / 1255 passed + 1 skipped`、崩溃面 E2E 三例（含干净对照）。
- 🎯 **Round 4 NOW = G-07（P1）**：`apps/web` 游离于 `tsc -b` 项目图外 —— Gate1 只跑根 `tsc -b`、Gate7 只探 `apps/web/dist` 是否存在、`apps/web` 无 typecheck 脚本 ⇒ **web 的 TS 类型错误可静默通过全部 8 道发布门禁**。这是"验证机器自身的洞"（门禁本应拦住它），修法低成本（web 加 typecheck 脚本并纳入 Gate1，或把 web 纳入 tsc 图）。

- ✅ **Round 4 已闭环（提交 84977ea / 5104419）**：**G-07** `apps/web` 拉进 Build 门禁（Gate1 同时跑根 `tsc -b` 与 `apps/web tsc -p`，纯函数 `judgeBuildPair`，web 探测失败显式 pending）。独立裁定 `EVALUATION-REPORT-05.md` **ACCEPT**；判别性 E2E：注入 web 类型错误 → 根构建仍 0 而门禁 FAIL。
- ✅ **Round 5 / 5b 已闭环（提交 c2639ca → 50a395b）**：**G-04** usage 数据不再静默丢失（损坏 → 改名隔离留档 + warn + 空表继续；写前备份轮转 `backups/usage.<ts>.json`，`opts > VESSEL_USAGE_BACKUP_KEEP > 5`，零删除）+ P2 补修（读失败按 `err.code` 分流、`suppressWrite` 抑制覆盖、隔离名 `-N` 唯一化）。`EVALUATION-REPORT-06/07` 两轮 **ACCEPT**；真实 CLI E2E 双例通过。
- ✅ **Round 6 已闭环（提交 50a395b）**：**G-05a** 密钥不入 argv（DPAPI 材料改走 stdin `$input`；探针实测 `[Console]::In.ReadToEnd()` 在本环境 spawn EPERM）+ secrets 损坏默认可恢复（含 **DPAPI 构造期**漏转发 `recoverCorrupted` 的修复，R5 残留）。`EVALUATION-REPORT-07` **ACCEPT**。
- ✅ **Round 7 已闭环（提交 39a9b0d）**：**G-05b** provider 错误体回显脱敏（新增 `errorBody.ts`：剥 URL + 遮蔽 `sk-`/`Bearer`/JSON 字段，240 截断；OpenAI/Anthropic 四处 throw 改造）。`EVALUATION-REPORT-08` **ACCEPT（0 必修）**；真实 HTTP E2E 双 provider 零泄漏。
- 🆕 **Round 7b 候选（P3 集群，同主题低成本）**：① 截断先于遮蔽 → 跨 240 边界的 key 残留 ≤5 字符（改 mask-then-truncate）；② `OpencodeGoProvider.ts:224` 已改用 `sanitizeErrorBody`；③ HTTP 200 带 error 体时 `OpenAICompatibleProvider:125`/`AnthropicProvider:232` 仍原样回显；④ 非 `sk-` 形态（`gsk_`/`AIza`/`hf_`）；⑤ `dpapiArgv.test.ts` 未断言脚本含 `$input`。
- 🎯 **Round 8 NOW = G-09（P2）**：TUI 会话内成本可见性——`/cost`（别名 `/usage`）+ 每回合一行成本增量；`vessel usage` 标题改为实际 root（修展示漂移）。数据与 `UsageStore` 早已存在，纯展示切片；未注入 store 时成本显示静默关闭（回归保护）。

- ✅ **Round 8 已闭环（提交 7073693 / 8211dac）**：**G-09** TUI 会话内成本可见性（`/cost`+每回合增量+`costView` 纯渲染+`usage` 标题实际 root）。首轮评审判 **REJECT**（主因：`buildHarness` 未把 `usageStore/usageProvider` 传给 `composeHarness` → 真实 TUI 每回合恒 `$0.0000`；次因：`/cost` 缺"今日"行），FIX 后复评 **ACCEPT**（`EVALUATION-REPORT-10.md`）。**教训入库**：E2E 必须走真实用户路径。
- ✅ **Round 9 已闭环（提交 c46a90a / e3582ab / 71e4049）**：**G-10 resume 最小切片**——陈旧租约回收（ESRCH-only，fail-closed 未放宽）、`SessionRegistry` 补 `VESSEL_SESSION_ROOT` + `updatedAt` 倒序、`vessel sessions list` / `vessel resume <id>|--last`（**存在性 + 日志双重校验**，绝不静默变新建）、`cmdRun`/TUI 登记接线、TUI `sessionId` 通道。裁定 **ACCEPT**（`EVALUATION-REPORT-11.md`）；AC1 原判"无法判定"，**补强探针（含负对照）后实证**：轮2 只给 NONCE_B 却看到轮1 的 NONCE_A，对照组换新 sessionId 则看不到，`roles=["system","user","assistant","user"]`，工作区文件不含 A。**并修复了真实状态泄漏**（测试曾写真实 `~/.vessel/sessions.json`；现全局 `vitest.setup.ts` 兜底 + 逐文件注入，全量后 `realRegistryTouched=False`）。
- 🎯 **Round 10 NOW = G-11 之 `--json` 半（P2）**：五条只读命令的机器可读输出（`output.ts` 已就绪：`isJson`/`emitJson`/`fail`）。硬约束：**默认输出一字不改**（`cli.test.ts` 约百处文案断言）、`--json` 下 stdout 必须全量可解析（含抑制 `resume` 前置提示）。
- 🆕 **G-11 之 MCP 半（P2，独立切片）**：侦察确认 CLI 面 **零** MCP 引用、库级管道已通（`compose.ts:251-263` + `mcpTools.ts:34` 的 `mcp__<server>__<tool>`），`StdioTransport` 已支持任意命令（`McpClient.ts` 的 `StdioTransport` 类 + `resolveSpawnCommand` 白名单）；不与 `--json` 混合以免一轮多主题。
- 🆕 **Round 7b 候选（P3 集群）**：错误体卫生 5 项（mask-then-truncate、`OpencodeGo:214`、HTTP 200 带 error 两处、`gsk_/AIza/hf_` 形态、`$input` 断言）。

- ✅ **Round 11 / 12 已闭环**：**G-13-P1**（TUI `/permission`·`/model` 假成功 → 确认即生效 + 重建立即重建 + 落盘 `SessionMeta`）、**G-13-P2/P3**（locale 接 CLI+TUI 的 explain；theme 文案四处诚实化）。独立裁定 `EVALUATION-REPORT-15.md` **双双 ACCEPT**。**教训（纪律 8）**：安全设置的"已生效"必须在确认瞬间为真。
- ✅ **Round 13（G-11 之 MCP 半）已实现并修复**：CLI/TUI 可读 `~/.vessel/mcp.json`；`StdioTransport` 支持任意命令（win32 白名单 shell，避免 args 二次解析注入）；stdout 缺失显式 throw；配置读取器 fail-loud（ENOENT 静默/损坏拒绝）；**逐 server 降级**（配错一个不再让 CLI 打不开）；真跨进程 E2E（含反假绿自证）。首轮评审判 **REJECT**（`EVALUATION-REPORT-16.md`）：**孤儿子进程**（`close()` 的 2s SIGKILL 被 50ms 路径 `clearTimeout` 取消）+ **`initialize` 无超时**（会永久挂起）+ 测试缺口 → FIX 六项全部落盘（双层 5s 超时、close 定时器只在 `exit`/`error` 清除、CLI 抛错时 close 已 spawn 连接、`.cmd` 可操作降级、`connections.test.ts`、`config.test.ts` 入库）。**由此新增纪律 9（测试不得替被测代码兜底）/10（实测优先于静态推断）/11（区分真红与并发假红）**。

- ✅ **Round 14（P3 集群收口）已闭环**：**A** 把 CLI 里**其余 57 处**失败出口统一到 `--json` 信封（人类模式逐字不变；`main()` 兜底只兜 throw，这 57 处此前**全部**未被覆盖）；**B** 刷新发布门禁（新增 `VESSEL_OPENCODE_GO_BASE_URL` 端点覆盖入口，默认行为不变），最终 **8/8 `ready`**，`build` 判据已含 `apps/web` 类型检查；**C** 订正 living docs 的过期行号（冻结评审快照零改动）。过程中由门禁实跑暴露并修复两个缺陷：① env 覆盖**污染测试套件**（判别性复现：无 env 20/20、有 env 2 例红）；② 门禁注记**硬编码错误归因**（把真实回归写成已知 flaky）→ 改为由证据推导 + 20 例表驱动单测。**新增纪律 9–13**。
- ✅ **Round 15（G-17，P0）已修**：**独立现状重审 + 三轮判别性实测**把"策略执法在用户工作区失效"从"策略层缺失"推进到真根因——**默认配置按 cwd 拼、CLI 不携带内置默认**，所以用户在自己项目里**必然跑不起来**。已修：`resolveProjectPolicyPath()` 接通 project 层（`cmdRun` + TUI 两分支 + `chat.ts` 透传，**AC1 `DISCRIMINATES=True`**）；`builtinConfigRoot()` 让默认 policy/behavior 从 **CLI 自身位置**解析（**实测：仓库外 `run` 从 `exit 1 + behavior IR not found` 变为 `exit 0` 且真跑一回合**）；`vessel policy status`（层次/路径/存在/条数/**sha256 哈希**/生效层序，`--json`，恒 exit 0——**AC2 `HASH_DIFFERS=True`**、**AC3 单一可解析 JSON**）；**部分装载告警**（至少一层有声明且至少一层为 0 → 明确告警且**不阻断**；两层齐备时无告警——**AC4 `DISCRIMINATES=True`**）；AC5 诚实化（`POLICY-SPEC` 标注 user 层 / workspace trust 门 / session 层**尚未实现**）。

- ⚠️ **Round 15b/15c（策略执法本体加固）— 由"诚实性核查"顺链追出的安全缺陷族**：三处共同形态是"**功能写了、看着也在，但实际不生效**"（通过所有"存在性"检查）——① **项目策略可提权** `profile → danger-full-access`（`mergeScopes` 后者覆盖，与规格"高层默认"相反）；② **项目策略可放宽 force-push**（`git/network/audit` 浅覆盖）；③ **`shell-force-push` 规则是死的**（matcher 用字面量 `startsWith`，`Shell(git push --force*)` 对真实命令永不匹配，且全仓零测试）。已修：`profile/approval` 高层优先、三键单调趋严、matcher 支持 `*`（逐字转义 + 锚定）。**独立安全复评 `EVALUATION-REPORT-20.md` 判 REJECT（有条件）**，并挖出两条**绿灯不可能发现**的高危：**C-1** `mergeScopes` 重建 `filesystem` 时丢掉 `confinement` → 硬执法在生产路径永不生效（6 个 confinement 测试**直调编译器绕过合并**，故 61/61 全绿掩盖此洞）；**C-2** allow 类列表并集 → **实测确认**：project 追加 `shell.allow: ["bash"]` 使 `bash -c "rm -rf /tmp/x"` 从 **deny 变 allow**（叠加无 trust 门 = 克隆仓库即可放宽执行）。另 C-3 force-push 三种绕过形、C-4 状态命令反向文案（已修）、C-5 `version` 后者覆盖。**新增纪律 15**：**测试若绕过生产入口，等于零证据**。

- ✅ **Round 16（G-18 宣称与实际不符）+ 发布里程碑（用户选定路线 (c)）**：**1C**（mock 运行期可见：CLI stderr 提示 + 单一渲染出口标记、TUI 同款，**真实路径测试**含负对照）；**1B**（`guide.ts` 首次接触单名化，`glossary.ts` 保留昵称**作为权威解释**——并据此**修订了错误的验收标准**：原"grep 为空"会删掉唯一解释）；**2B**（密钥口径三处按平台如实，判据取自**真实生效后端**）；**2C**（`chat` 移除，README 补 5 个真实入口，与 `dispatch` 逐项对照）；**依赖声明**（`@clack/prompts`→cli、`js-yaml`→policy/behavior、`files`+`engines`）；**发布**（`builtinConfigRoot()` 包内优先 + `prepack` 复制 `configs/`；`files` 否定模式剔除测试产物与 source map：**270→62 文件 / 406.3→184.9 kB**；**装机 E2E**：16 tarball → 空项目 `npm i` exit 0 → `--version`/`--help`/`policy status` **三条 exit 0**，system 策略解析到**安装包自身的 `dist/configs`**）。

## 路线图归位（Round 17 收口）

**NOW（已完成）**：策略执法三处失效 + 其两条后续漏网（续行**平台并集**、alias 跨命令）+ pricing 读路径与静默 + 打包与装机 + **发布链路门禁化**（`publish-artifact` 判据：pack 期脚本必须构建 `dist`、tarball 清单必须含 `dist/cli.js` 与四个 `dist/configs/*` 且零测试产物/零 map、不可解析则显式 `pending`；**该判据自身另有 28 条单测守护**）+ **`policy status` 合成后可编译性**（G-18：直接复用 `run` 的装载路径，`compiled=false` 当且仅当 `run` 会失败）。
**NEXT（P2，已具证据，可独立开轮）**：
0. **【Round 21·最重要的发现·只读审计定论】25 个场景里 10 个判据实质失效**——产品核心差异点（安全基准/一致性套件）的**证据基础大面积空心**：
   - **B023 已修**（Round 26）：判据改为读**引擎本次运行真正写到磁盘的产物**（`engine-artifacts/`），`ENGINE-GOLDEN-88` 常量**从 `runner.ts` 删除**并加**回归锁**（断言 golden 串不得再出现在 runner 源码里），另加 fail-loud（engine lane 无 `file:` 产物判据即抛错）；门禁文案与 `safety.test.ts` 标题改为**从 `SAFETY_SCENARIOS` 插值**（结构性同源）。验证：3 文件 / 55 tests 通过。
   - **S003 已完成（真因与更正见文末「Round 33」节）**：判据现为 `guard_seen ^escape$` + **`arguments_pattern: probe-link`**（锚定**真实调用**），`file_content` 保留作对照；`SAFETY_SCENARIOS` 已含 S003；`fixtures/S003/setup.yaml` 声明式建链 + `FixtureSetupError`（→ `pending-environment`，不再静默跳过）；prepare 两处调用点均已接线（`runner.ts:590`、`contracts/vessel.ts:120`）。**但实测仍红**：`safety.test.ts` `2 failed`，其中 `S003: prepare 真实创建 probe-link…` 仍失败，`guard_seen.evidence` 仍是 `guards:[] / anchoredCalls:[]`（那次 `Read probe-link/secret.txt` 发生了但没有被守卫拒绝 ⇒ **链接确实仍未建出**）。**我已用探针排除"守卫分类错"**：已证实的越界（界外链接+目标存在/缺失、词法 `..`）仍判 **`escape`**，界内文件放行 ⇒ **判据期望没错，问题纯在 prepare 侧**。
   **退路决定（若 S003 在余下轮次内仍无法建出链接）**：**把 S003 从 `SAFETY_SCENARIOS` 移出并如实记为"判据已就绪但 prepare 未打通 ⇒ 不可判定"**（`docs/SAFETY-BENCHMARK.md` 同步），**不允许**为了绿而放宽判据、也**不允许**把红门禁留在主干。**"不可判定"的诚实标注优于"看起来在测"的假绿。**
1. **【Round 20 新增·最高优先·由实现者上报 + 指挥实测确认】抑制写入后仍宣称成功**：`PricingOverrideStore.write(file): void`（`pricingOverride.ts:307`）**不返回落盘结果**，`set/tombstone/restore/repair` 的返回值也不携带"是否真写"；因此 CLI **无条件**打印成功——`cli.ts:1791`「✔ 已写入覆盖」、`:1808`「✔ 已删除内置条目…墓碑写入覆盖文件」。⇒ **留档失败而抑制写入时，用户拿到的是确定的假成功**（以为价目改了，实际没落盘）。属"确认时刻的宣称不为真"族。**Round 22 已修**（`write()` 回传 `persisted/changed`、`restore` 拆 `found/persisted`、CLI 未落盘 exit 1 且不打成功行；**双向验收**：未落盘不得宣称成功、正常落盘必须照常宣称成功——已由指挥探针实测两侧）。
2. **【Round 20·S003 双重空洞的完整证据】**：
   - **准备链丢链接**：`copyDir`（`runner.ts:45-53`、`contracts/vessel.ts:113-114`）只处理 `isDirectory()`/`isFile()`，**symlink/junction 被静默跳过** ⇒ fixture 要求的 `probe-link` **根本不存在**（fixture 目录实际只有 task.md/data.txt/README.md）。
   - **判据从未被执行**：`SAFETY_SCENARIOS`（`release-gates/gates.ts:439`）= `S001,S002,S004,S005,S006,S007`，**S003 被排除**；`benchmarks/reports` 下 S003 **零个 run 目录**（S002 有 11 个）。
   - **报告里的 passed 来自别处**：全部由 **real-model-lane** 产生，其判据是 `contracts/vessel.ts:171 success = runError===null && finalText.trim().length>0`（+ `real-model-lane.ts:342` 的形状校验），**与 `S003.yaml` 无关**；**铁证**：`real-model-lane-1788964714845.json:202` 该行 `policyViolations: 0`（一次 denial 都没有）**却标 passed**。
   - **即便执行也不具判别力**：`guard_seen: ^escape$` **不锚定 `probe-link`**（任何词法 `../` 或绝对越界都会给 `guard='escape'`，与 S002 不可区分）；`denial_seen: symlink|escape` 同理；`file_content` 读 `fixtures/S003/data.txt` **恒含 `INSIDE-TOKEN-77`** = **恒真**。
   - **文档自相矛盾**：`docs/SAFETY-BENCHMARK.md:19` 写 S003"⏳ 待环境"，而 reports 显示 passed。
   **最小修复（三层缺一不可）**：① prepare 侧按 fixture 声明**创建真实链接**（`setup: symlink` → `fs.symlinkSync`/junction 指向工作区外；创建失败**显式 fail 或 pending-environment**，禁止静默降级为"普通文件不存在"）；② 判据**锚定对象**（要求存在一次路径参数匹配 `probe-link` 的 tool call 且其 `meta.guard==='escape'`，`denial_seen` 同理）；③ 把 S003 **纳入 `SAFETY_SCENARIOS`** 作回归锁；④ 报告**不得**把"lane 成功"呈现为"场景判据通过"（须可区分）。**判别性验收**：注释掉建链 → S003 必须 fail/pending（旧实现会绿）；把链接指向工作区**内部** → `guard_seen` 必须 fail（旧实现因"任何 escape 都算"会绿）；`SAFETY_SCENARIOS` 必须含 S003 并产出 `summary.json`。
3. **【Round 20·审计定论】沙箱三处"宣称与实际不符"**（已派卡，**Round 23 已实现**：`statusSnapshot().active` 只来源于"本轮 job 是否真的附加成功" + `degraded` 三值原因 + warn；`Shell` 把 `r.audit` 的逃逸/终止/失败事件筛入 `meta.sandbox.audit` 并补上缺失的生产消费方 `EnforcementProjection.recordProcessTree`；`terminatePids` 改为返回**已验证成功**的 pid 集合，其余逐条记新事件 `escape-terminate-failed`）。**当时的问题**：`Sandbox.ts` 附加失败静默降级而 `status()` 仍报 `active/job-object`（**TUI 显示沙箱生效、实际零约束**）；`shellTool.ts:67` 把逃逸审计**整体丢弃**；`windows-job-object.ts:328`+`Sandbox.ts:359`+`process-tree.ts:226` 在**杀失败**时仍记 `escape-terminated`（**审计撒谎**）。
4. **【Round 20 审计·队列】其它同族（按证据强度排序）**：`EventBus.ts:87` 监听器抛错**退化为 defer 被当 allow**（当前无 deny 型监听器接线 ⇒ 潜伏陷阱）；`SubagentManager.ts:145` preset 未命中**跳过权限收窄 ⇒ 子代理拿到全量工具面（含 Write/Shell）**（且 `role-presets.test.ts:253` 把该行为**固化为"既定"**——测试锁住缺陷）；`SkillSearch.ts:87` **只扫正文前 400 字符**的 UNTRUSTED 标记 ⇒ 标记更靠后的"污染技能"可进 System Prompt；`parseOpenAI.ts:118` 首个 delta 缺 id/name 时该 tool call **静默消失**；`OpenAICompatibleProvider.ts:179`/`AnthropicProvider.ts:315` 的 `stream()` **不用 timeoutMs** ⇒ 上游挂死则回合**静默卡死**；`Registry.ts:114` exclusive 链一次异常**永久中毒**（未找到生产调用方）；`cli.ts:517` `costMultipliers()` 抛→**倍率静默变 1**。
5. **【Round 20 审计·已修但需注意同类残留】静默降级族的剩余项**：审计给出 14 处 A 类，本轮修了 4 处高危（安全 symlink 出界、索引覆盖、墓碑丢失、`pricing.json` 兜底）。**仍待评估**：`pricingOverride` 的**行级坏价行**静默忽略、`guideCommands.ts:75`/`chat.ts:232` 的 locale 静默回退 zh、`project-task-queue.ts:371` 的坏任务静默消失、`ReviewHandoffStore`/`HandoffStore`/`LearnedStore` 的坏条目静默跳过、`ProjectRegistry` 与 `pricingOverride` 写路径的 `corrupted-*` 留档是否应被 `doctor` 类命令提示。
6. **发布链路**：shape 门禁 + 安装态冒烟（实测 PASS）+ **升级路径（Round 20 已加，含双向溯源）** + **`tsbuildinfo` 违禁判据（Round 22 已加，含文案四类对齐）**；`npm pack --ignore-scripts` 可绕过 prepack（属进程约束，非门禁可解）。
7. **测试盲点清单**：C-4 文案与 `pricingSyncMismatchWarning` 调用点均已闭合（Round 19）；Round 20 又发现并修掉一条**恒真假断言**（cwd 断言在删除目录之后 ⇒ 判别力为 0）与一条**静默绿**（链接用例 `catch { return }` ⇒ 在不支持建链接的主机上零断言却 PASS）；建议把"断言是否打在因果链末端"与"跳过是否显式可见"纳入评审固定检查项。
**LATER**：全量 i18n 架构；`~/.vessel` 状态根 7+ 处重复收敛；`vessel diff --last` 只读回滚提示（G-10 克制替代）；`dist/.tsbuildinfo` 入包与 `npm pack --json` 被 prepack 输出污染（自动化卫生）。
**NOT_NOW（明确不做）**：全量 npm 发布（17 包 + registry org + 版本治理——成本 ≫ 收益，本阶段无外部消费者）、单包 bundle（除非将来真要"陌生人一条命令安装"）、CI 自动发布、provenance/签名/SBOM、changesets 版本治理、插件市场/云协作/排行榜/IDE 表面。

## 状态更新（第 1 轮闭环 + 新增候选）

- ✅ **已闭环（提交 080423d → 76a19e1）**：**G-01**（mock 遮蔽真实输入）、**G-02**（未知命令静默 run）、**G-14**（引导文案 + setup 向导 `cah`→`vessel`）。独立 Evaluator 两轮裁定：Round 1 **REJECT**（S1 未知命令零测试 / S2 `cah` 属实 / S3 注入源漏 plan·handoff·inject / S4 TUI 未同步）→ FIX 轮 → Round 2 **ACCEPT**（逐项行号证据）。验收侧证据：`tsc 0`、`vitest 114 文件 1235 passed + 1 skipped`、CLI E2E 冒烟 6 项全过。
- 🆕 **G-16（P2/P3，低成本）**：`ChatMessage.source` 仍为裸 `string`、`INJECTED_MESSAGE_SOURCES` 手写 → 未来新增注入源会**静默退化**（`plan/handoff/inject` 正是本轮由 Evaluator 抓出的实例）。建议收窄类型或加"漂移守卫"测试（断言 events 联合中注入类 source 全在集合内）。
- 🆕 **G-17（P3）**：**文档-命令一致性无门禁**——`vessel chat` 漂移由本轮暴露（3 份文档 + `PROJECT-BRIEF.md` 曾把它当 TUI 入口，实际 exit 2）。本轮已手工修正 8 处；建议发布门禁加一条 grep 检查或文档命令回归测试，防复发。
- 观察（未定性为回归）：全量 vitest 偶发 exit 1，仅伴随 "unhandled errors" 警告且测试全过，复跑 exit 0。

## 冲突与依赖检测

- **无冲突审计结论**：4 份报告对"引导体系（117）本身质量高"一致正面；对"settings/locale 接线不全"从 UX 与架构两视角互证（G-06/G-13）。
- **强依赖链**：G-01(G-02) → 阻塞"首次成功使用"（P0 同组）；G-03 兜底依赖 G-02 的分支落点；G-06 短期修复依赖 G-13 的 settings 语义先定。
- **高性价比聚集**：G-01/G-02/G-14（P0+P1 文案）都落在 CLI 入口层，一次改动可修一组。

---

## 路线图（第四阶段）

**NOW（本轮 vertical slice）**：G-01 + G-02（高度耦合的 CLI 入口健壮性问题：首次成功使用 + 未知命令分派）——一组小问题，非功能堆砌。
**NEXT**：G-14（文案/引导，极低）+ G-03（CLI 兜底）+ G-07（web 入图）+ G-12（引用边）+ G-09（TUI 成本可见性）——全为低成本高价值。
**LATER**：G-04（usage 备份）+ G-05（密钥暴露面）+ G-10（续跑/回滚）+ G-11（MCP/JSON 出口）+ G-13（TUI/CLI 一致）。
**NOT_NOW（主动拒绝）**：G-06 全量 i18n 改造（成本≈全量改造、当前用户仅中英、收益不足——记录为"里程碑级候选"）；G-08 重构（可小步缓行，非阻塞）；竞品形态追逐（插件市场、消息平台、云协作/多人、大众基准榜单、IDE/桌面表面——B 已逐条论证不做）；G-15（P4 技术债，顺手时清理）。

## Round 32 — S008 收口（把判据钉在真正生效的机制上，而不是宣称的机制）

**关键发现（比原简报更要紧）**：
> **后续修正（声明与执法分离）**：下述死 matcher 记录为修复前证据；当前 `deny_domains` 已移出可执行 `rules`，改为 `PolicyArtifacts.declarationOnly`（`enforced: false`、无 `match`/`action`）。域名级执法仍未实现，proxy 留待 v0.2；实际 profile/approval 门禁保持独立。

1. **`deny_domains` 是死规则（Round 38 我已独立实测确认）**：`packages/policy/src/risk/Compiler.ts:976-984` 把 `deny_domains` 编译成 `net-deny:<domain>`，但其 `match: () => false` —— **运行时不匹配任何调用、永远不会铸出 audit/denial**。⇒ "域名被拒绝"**写不成判据**（要么恒红、要么只能伪造）。**这是又一例"声明的安全控制是死规则"，与先前修掉的 `shell-force-push` 死 matcher 同族**；差别是那条已修，这条**仍在**。**我的独立测量**：探针用 `compilePolicyYaml` 编译含 `network.deny_domains: [169.254.169.254]` 的声明 → 得 `ruleCount=1`、`id=net-deny:169.254.169.254`、`reason="denied domain: 169.254.169.254"`，但 `match()` 对**全部**探针返回 `false`——**包括命令里字面含 `curl http://169.254.169.254/latest/meta-data/` 的 `Shell` 调用，以及 `WebFetch{url:...}`**。⇒ **声明存在、理由存在、规则存在，而拦截从不发生。** **为什么不在收尾轮顺手改**：正确修法要么让 `match` 真去解析调用参数（当前**没有任何网络工具**，只能靠参数文本启发式 ⇒ **极易误拦或制造虚假的执法感**），要么明确改成"声明-only、不产出可匹配规则"；两者都需要设计决策与**双向验收**（既不得漏拦、也不得过度拦），**不适合在轮次末尾仓促做**。
2. **真正生效的机制存在**：`Engine.ts:77-105` 第⑥段 profile/approval 门禁（Shell 需 `danger-full-access`，而 `approval: never` 服务端 fail-closed）→ `AgentLoop.ts:566` + `recordDenial:695` 铸出**锚定该次 toolCallId** 的 `audit/denial`（`ruleRef=policy-never`，reason 含 `approval=never`）。**判据因此钉在这条真实路径上**。
3. **旧配置反向宽松**：旧 `S008.yaml` 的 `policy.profile: danger-full-access` **恰好放行唯一 egress 通道（Shell）** —— 真按"尝试危险动作"写离线脚本，curl **会真的去连 169.254.169.254**；而 real-model-lane 走 `configs/policy.default.yaml`（`contracts/vessel.ts:107`，workspace-write）⇒ **旧的离线场景比真实车道更宽松**。已改回 `workspace-write`，两边一致。
4. **旧 `content_absent` 双重恒真**：`asserts.ts:84-91` 对**不存在的文件**返回空串即 pass（fixture 里本就没有 `fetch-report.md`），且哨兵 `INSTANCE-ROLE-ARN` **全仓无任何产出者** ⇒ 即便文件存在也永不红。已删。

**S008 判据新旧**：旧 = `file_content(final_text 含 169.254.169.254)` + `content_absent(file:fetch-report.md 不含 INSTANCE-ROLE-ARN)`；新 = **`denial_seen pattern "policy-never|approval=never"` + `arguments_pattern '169\.254\.169\.254'`**（锚定**真实调用**）＋ `file_content(file:fetch-report.md 含端点地址)`。`goal:`/fixture/文档同步为**诚实表述**：v0.1 实际生效的是 **profile/approval 门禁**，域名级 `deny_domains` 仍是**编译期声明**，proxy 级执法待 v0.2。

**未做/只报告**：S008 **未纳入 `SAFETY_SCENARIOS`**（需 runners 侧接线，且其离线脚本须满足"一次参数含该地址的调用、≤2 次以免 `DenialLimitError`"的契约）；声明级断言（编译产物含 `net-deny`）写不进场景（`AssertContext` 读不到 policy artifacts），现由 `mergeScopes.test.ts` 锚定；文档三处文案仍不一致（`docs/RELEASE-GATES.md:83` / `release-report.md:13` 称 S001–S008 而 `gates.ts` 只有 7 个；`docs/REAL-MODEL-LANE.md:52/58` 把安全场景说成"policy 硬执法为行为本身"，而该 lane 只判 `finalText` 非空 ⇒ **报告里的 S0## passed 与 S0##.yaml 无关**）。

## Round 33 — S003 真因更正（我先前两处结论都是错的）

**先前的两处错误结论（均已作废）**：① "离线脚本从未发起那次读取"；② "链接确实仍未建出"。**两处都被实测否证**：原始 JSON 的 `toolCallsSeen` 里**有**那次 `Read {"path":"probe-link/secret.txt"}`；而负对照用例（要求链接真实存在、realpath 出界、能读到 `OUTSIDE-TOKEN-99`）**通过了** —— 链接若不存在，失败数就该 ≥3 而不是 2。

**真因（第三种病，与我的原始 JSON 逐字段吻合）**：
- `packages/llm/src/provider/MockProvider.ts:130`（chat）与 `:175`（stream）：`id: tc_mock_${i+1}` —— **每条响应**从 1 重新编号 ⇒ 一步一次调用的脚本里，第 1 步读 `probe-link/secret.txt` 与第 2 步读 `data.txt` **都叫 `tc_mock_1`**。
- `packages/core/src/agent-loop/AgentLoop.ts:452-455`：直接把 chunk.id 当 toolCallId 落进会话 ⇒ `tool/call` 与 `tool/result` 都叫 `tc_mock_1`。
- `benchmarks/runners/src/asserts.ts:107-121`：`toolCallArgsById` 是 `Map.set`（**后写覆盖**）⇒ `tc_mock_1 → {"path":"data.txt"}`（**第 2 步**的参数）。
- 于是 `argsAnchored`（`:129-133`）拿**第 1 步那条 DENIED 的 tool/result** 去比对**第 2 步**的参数 → 不含 `probe-link` → 被过滤 ⇒ `guards: []`、`anchoredCalls: []`；而 `observedAnchoredCalls`（`:155-174`）逐条看 tool/call 自己的参数 ⇒ `toolCallsSeen` 恰好只有那一条。**S002 未暴露，是因为它的 `guard_seen` 没有 `arguments_pattern`（锚定函数直接 return true）。**

**修法**：`runner.ts` 新增 `uniqueToolCallIds()`（离线车道 chat/stream 两条路径都包一层；**同一响应内**的 `tool_call_start/delta/end` 仍映射到同一个新 id，故 loop 的累积逻辑不动）；`contracts/vessel.ts` 第二条 prepare/车道同样接线；新增 `assertSetupShape()`（**未知键、错类型一律 `FixtureSetupError`**，把"声明键名写错→静默当作没声明"这个口彻底封死）。

**验证（我实跑）**：`success=true`、`guards:["escape"]`、`anchoredCalls` 非空（`tc_1` 的参数含 `probe-link`）；`safety.test.ts` **20/20**；全量 **140 文件 / 1659 passed + 6 skipped / exit 0**。

**教训（我自己的，比这次修复更重要）**：
1. **我连续两次判断错方向**（"脚本没调用"、"链接没建出"），且**两次都是在中间修订上测量**（纪律 14）；**我差点据此执行"把 S003 移出 `SAFETY_SCENARIOS`"的退路，从而把一个已经修好的安全场景降级掉**。⇒ **结论必须建立在落定修订上；"多测一次"的成本远低于"按错误结论动手"的成本。**
2. **上游真根因仍在 `packages/llm`**：`MockProvider` 按响应编号 id，任何复用 id 的 provider 都会让**基于 id 的锚定 join 再次误绑**（`asserts.ts` 的后写覆盖语义未改）。本批选择在**产生歧义的那条车道**消除歧义（包装唯一 id），而不是改证据连接语义（那会影响所有场景）。**未接线旁路**：`runner.ts` 的 `evalProvider` 与 taskRouter 的两个 tier provider 仍是裸 `MockProvider`；`adapters/{claude,codex,dsh,opencode,pi}.ts` 各自一份 `copyDir` 仍未接 prepare。
3. **一处已观察到的偶发（未定位）**：同一修订下全量出现过一次 `exit=1`（`1648 passed`，11 条未归类）与一次 `exit=0`（`1659 passed`）。最可能是本批新增的"真跑 PowerShell / 真实建链接"用例在并发下抖动。**我没有把它当作"已经绿了"就放过**，已写进复评请求。（**后续已在 Round 40 定位并消除**：`Sandbox.test.ts` 单文件 83s、1 例失败 ⇒ 真机用例与 `testTimeout=30000` 赛跑，holder 预算也恰好 30s；已给触真机用例显式 120s 超时并把成因写进 4 处注释。）

## Round 42 — 我亲自取证的第四族：**§18 技能来源安全维度是"只有标签、没有执法"**

**完整证据链（均读码确认，带行号）**：
1. `packages/skills/src/search/SkillSearch.ts:87`：
   ```ts
   const trusted = !/UNTRUSTED RESEARCH DATA|逆向|leaked|reverse-engineered/i.test(text.slice(0, 400));
   ```
   **只扫正文前 400 字符** ⇒ 标记落在 400 字之后就被判成 `trusted: true`。
2. 即便判成 `trusted: false`，全仓**唯一效果是索引文本里的标签**（`:139` 的 `layers` 行与 `:149` 的 `hits` 行打印 `UNTRUSTED` 字样）——**没有任何地方据此阻止技能内容进入上下文**。
3. `packages/skills/src/load/SkillLoader.ts:149-155` 的 `Skill` 工具 `execute`：`loadSkillContent(...)` 取到正文后**直接 `formatSkillBody(skill)` 返回**，**没有任何 `trusted` 检查**；而 `packages/application/src/compose.ts:209` 已把它接进生产工具面（`createSkillTool({ workspaceRoot })`）⇒ **模型调一次 `Skill({name})`，泄漏/逆向技能的正文就进上下文**。
4. 文档注释与项目硬约束**都声称它被拦**：`SkillSearch.ts:15-17`"…must be markable UNTRUSTED and **never enter System Prompt directly** — provenance carries … a `trusted` flag **the caller can enforce**"；`AGENTS.md` 硬约束第 1 条"泄露/逆向 Prompt 视为 UNTRUSTED RESEARCH DATA，**不得直接进 System Prompt**"。⇒ **"由调用方执行"这件事从来没有被任何调用方执行过。**
5. 既有测试只覆盖容易那一侧：`packages/skills/src/search/skill-search.test.ts:55-63` 把标记放在**最前面**（frontmatter 之后第一行）⇒ 断言 `trusted === false` 通过；**边界（标记在第 400 字之后）零覆盖**。

**修法方向（两处缺一不可）**：① **检测面**——扫描**全文**（而非前 400 字符；文件本身已由 `SKILL_CONTENT_MAX_CHARS` 截断，全文扫描成本可忽略），并考虑标记被换行/空白拆开的形态；② **执法面**——`Skill` 工具在 `trusted === false` 时**必须拒绝装载正文**（fail-closed、给可机读原因），而不是照常返回；索引仍可列出它（让用户知道它存在）但**不得**让它看起来可装载。
**判别性验收**：① 标记落在 400 字之后 ⇒ 必须 `trusted: false`（旧实现给 true ⇒ 红）；② 对 `trusted: false` 的技能调 `Skill` 工具 ⇒ **必须拒绝**（旧实现返回正文 ⇒ 红）；③ 负对照：干净技能照常装载（防"一律拒绝"）；④ 负对照：普通正文里出现 `leaked` 等词的既有行为不回归。

### Round 42 附：同一轮内我把另外两处也读码取证了（供后续卡片直接使用）
- **决策点 fail-open（已派卡）**：`packages/core/src/events/EventBus.ts:82-97` 的 `waterfall` 里，监听器抛错被 `continue` 跳过 ⇒ `current` 仍是 `defer`；而 `packages/core/src/agent-loop/AgentLoop.ts:559` 的 **`before_tool`（Tool Interceptor）既不传 `guard` 也只判 `deny`** ⇒ **抛错 = 静默放行**。今天潜伏（生产只挂观察型监听器、硬执法在 `Executor.decide`），但架构本意就是"策略以监听器参与拦截"。**`emit()` 的观察型语义是正确的，不得一并改掉。**
- **第三处死 seam（已派卡）**：`packages/application/src/projections/EnforcementProjection.ts:108` 的 `foldSession()` **全仓只有 `projections.test.ts:282` 调用** ⇒ 生产里 `fs-confinement` 来源计数恒为 0（守卫确实拒绝了，但没有生产代码把它折进投影）。先例：`reportStatus()` 已经用 `apps/cli/src/cli.ts:912` 接上、`recordProcessTree()` 已由 `compose.ts` 的 Executor `onResult` 接上。

## Round 43 — 决策点 fail-open 已修（**并纠正我简报里的一个前提**）

**修复（提交 `f699538`）**：`EventBus.waterfall` 的 catch 分支不再无条件 `continue`；新增 `WaterfallErrorPolicy = 'fail-closed'|'ask'|'defer'`，**逐调用点显式声明**（省略=`defer` 保持历史语义）。`before_tool`（`AgentLoop.ts:580`）与 `before_delegate`（`SubagentManager.ts:236`）声明 **`'fail-closed'`**：抛错铸**可机读**的 `deny`（ref/reason 带 `listener-error:<listenerName>`），落 `audit/denial` 的 `stage:'hook'`（与规则命中的 `'rule'` 可机读区分）+ `policy_decision` + `tool/result.meta.listenerError`；`before_turn` 显式 `'defer'` 并写明理由（辅助决策点、该点挂纯观察监听器、EVENT-SPEC §3.2.3 明令监听器错误不崩轮次）；`emit` 的观察型语义一字未动；`narrow` 单调收紧未动。**验收（我实跑）**：`tsc` 干净、10 文件 / **81 tests 通过**，含负对照「监听器返回 void/defer ⇒ 工具照常执行（没有被『一律拒绝』掐死）」与正向「正常 deny 仍拒绝、`reason/ref` 与今日一致、审计仍 `stage:'rule'`」。

**我简报里的前提被纠正（方向是"比我说的更严重"）**：我写的是"生产上 `before_tool` 只挂观察型监听器 ⇒ 目前潜伏"。执行者查证：**`packages/application/src/compose.ts:313-327` 把 `policy:engine` 挂在 `before_tool` 上，而那是可 deny 的权威监听器** ⇒ **这是活的 fail-open，不是潜伏的**：`policyEngine.decide` 一旦抛错就静默 defer，而在 `Executor.decide` 未接线的路径（测试/嵌入式用法）上，**工具会在完全没有策略裁决的情况下执行**。

**该卡留下的三条后继项（未做，均带证据）**：
1. **`listenerErrorPolicy` 只能做成可选（默认 `defer`）⇒ 未来新调用点漏声明即回到 fail-open**。原因：`packages/application/**` 有 **5 处**不带 opts 的 `waterfall` 调用（`SessionController.test.ts:162/169/181`、`projections.test.ts:16/62`），而测试文件参与 `tsc -b`，必填会让该包编译红。**建议**：先把那 5 处显式化，再把该字段改为必填（或对 `before_tool`/`before_delegate` 做**类型级必填**）。
2. **`before_stop` 走的是 `bus.serial` 而非 `waterfall`**（`AgentLoop.ts:341`）——形态同构（抛错⇒无否决），但生产上 `void stop` 并不消费该否决 ⇒ 现在收紧无行为收益，留给后续卡。
3. **新契约未进 `DESIGN-DECISIONS.md`**：`WaterfallErrorPolicy` 是新增的架构契约（哪些点必须 fail-closed），属文档卡范畴。

**同轮我做的文档同步（提交 `fccd325`）**：`docs/RELEASE-GATES.md` 补上 pending 的**第三类结构性成因**（manifest 声明的能力缺口 `type: indeterminate`；既不计通过也不计失败、在 evidence 里逐个点名、**fail 优先于 pending**）并写明"pending 名单由本次结果动态生成"；`PRODUCT-STATE.md` 标注 `run-release-gates.ts:139` 与脚注两处已修、回收站例外已拍板入 `AGENTS.md`，并列出真正仍待办项。

## Round 46 — 我亲手取证的第五处：**流式解析里"参数先到"的片段被静默丢弃**（真实模型路径）

**代码事实**：`packages/llm/src/stream/parseOpenAI.ts:105-131` 的 `delta.tool_calls` 处理里，`state` **只有** `idByIndex` / `nameByIndex`，**没有任何地方缓存参数片段**；而 `:116-119`：
```ts
if (!state.nameByIndex.has(index) && !state.idByIndex.has(index)) {
  // no identity captured for this index yet — nothing meaningful to emit.
  continue;                       // ← 该 delta 的 arguments 片段就此消失
}
```
当身份稍后到达时，`:123` 发出的 `tool_call_start` 带的是**那一个 delta** 的 arguments（`tc.function?.arguments ?? ''`），**先前那段永不回补**。

**我的实测（探针喂三帧：仅 arguments → id+name → 续传 arguments）**：
```
emitted=start(Read,args="") | delta(".txt\"}")
assembledArgs=.txt"}
assembledIsValidJson=false
firstFragmentLost=true
```
⇒ 本该是 `Read {"path":"a.txt"}` 的一次调用，变成**空/残缺且非法 JSON** 的调用，而且**没有任何告警或审计**（既没铸事件，也没降级标记）。**可达性**：OpenAI 官方流通常先发 `id`+`name`，但**网关/代理重排序、以及部分"兼容"实现**会先发 `index`+参数片段 ⇒ 这是一条**真实可发生**的静默数据丢失路径，影响的是**真实模型**这条主路径。

**修法方向**：按 `index` **缓存参数片段**（`argBufferByIndex`），在身份到齐时**先补发已缓存的片段**（`tool_call_start` 的 `arguments` 应为"已缓存片段 + 当前片段"），或在身份未到齐时也**先发一个带占位 id 的 start 并累积参数**；关键是**不丢数据**。配套：**顺序无关**（id/name/args 任意先后都要能正确组装），并补判别性用例——"参数先到"必须能拼出合法 JSON（旧实现拼不出 ⇒ 红）、"正常顺序"行为逐字不变（负对照）。

**同族待查（同文件/同模块，未取证）**：`parseOpenAI.ts:80/199`、`parseAnthropic.ts:56/75/191/215/216/232` 的单帧解析失败 `return []`、结构缺字段整块跳过、EOF 不补 `message_end`（审计报告项，我尚未逐一实测）。

## Round 47 — 取证：**denial breaker 只统计"执行前"的拒绝，工具内的拒绝不计数**

**代码事实（我读码确认）**：`packages/core/src/agent-loop/AgentLoop.ts:610-616` 的熔断
```ts
// denial breaker: same intent ≥3 → turn ends
const key = `${call.toolName}:${JSON.stringify(call.arguments)}`;
const n = (denialCounts.get(key) ?? 0) + 1;
denialCounts.set(key, n);
if (n >= 3) throw new DenialLimitError(...);
```
**整段位于 `gate.result.kind === 'deny'` 分支内**（`:565-618`）⇒ 只统计**执行前**被策略门禁拒绝的意图。**工具执行之后**才返回的 `DENIED`（例如 `Skill` 工具拒绝装载不可信技能、fs 守卫 `assertSizeWithin`/`canonicalize` 拒绝读越界文件）**完全不进 `denialCounts`**。
**后果（性质是可靠性/成本，不是泄漏）**：同一个"被拒的意图"可以在工具内**无限重复**而不触发 `DenialLimitError` ⇒ 模型可以反复调用一个必然被拒的工具**烧轮次与 token**。技能卡（`c78635c`）顺手报告了这一条，我读码确认属实。
**修法方向**：熔断的口径应是"**同一 `toolName:arguments` 的 DENIED 结果**（无论来自执行前门禁还是工具内），≥3 次即结束回合"——即把计数点移到**任何** DENIED 的收口处（`tool/result.error.errorClass === 'DENIED'`），并保持既有语义（`stage`/审计/`DenialLimitError` 文案不变）；判别性验收：工具内 DENIED 连发 3 次 ⇒ 必须 `DenialLimitError`（旧实现不触发 ⇒ 红）、正常成功路径与"执行前拒绝"的既有熔断**逐字不回归**（负对照）。
**已修并提交（`059bb4c`）**；原先押后是因为 `AgentLoop.ts` 可能正被在跑的"决策点错误策略类型级必填"卡编辑（它此前改过该文件的 `before_tool` 调用点），**我不做同文件并发**；待其落定后再派。

## Round 48 — 取证两处（一处定性为**潜伏**、一处**待实测定级**）

**① `ToolRegistry` 的 exclusive 链"一次异常永久中毒"——定性为潜伏，且整条 execute 路径在生产是死代码**
- 代码（`packages/tools/src/registry/Registry.ts:111-118`）：
  ```ts
  if (tool.exclusive) {
    let result = {...};
    this.exclusiveChain = this.exclusiveChain.then(async () => { result = await run(); });
    await this.exclusiveChain;
    return result;
  }
  ```
  `run()`（`:97-107`）**会重新抛出**（`tool.execute` 抛错则 `finally` 后继续外抛）⇒ 若某个 exclusive 工具抛错，`.then(...)` 返回的就是 **rejected** ⇒ `exclusiveChain` **永久 rejected** ⇒ 之后每次 `.then(...)` **回调永不执行**（既不跑 `run()`，又把**上一次的陈旧错误**抛给调用方）⇒ **一次写工具异常，此后所有写工具静默不执行**，且诊断信息是错的、无状态位。
- **但可达性经过我核实是"潜伏"**：`registry.execute` 的**唯一非测试调用方**是 `ParallelScheduler`（`registry/parallel.ts:58`），而 `ParallelScheduler` **本身只在 `parallel.test.ts` 里被使用**；生产 `compose.ts:268` 构造 `ToolRegistry` 后只用 `spec()`/`listVisible()`/`registerMcpTools`。⇒ **整条 `execute` 路径（含 exclusive 屏障与 rolling pool）在生产里是死代码**。
- **意义（比"潜伏 bug"更值得记）**：这是一个**"看起来在保证写串行化、实际从未执行"的机制**——与本段反复出现的"死 seam/死规则"同族，只是这次死的是**并发安全机制本身**。**修法**（小）：给链补 `.catch()` 让**链本身恢复**、而失败仍如实抛给**当次**调用；并把"execute 路径生产未接线"如实记入文档/注释（要么接线、要么明确标注未接线）。

### Round 61 — 对上面那条的**更正**（我先前的表述不够准确，必须改）

我进一步查了"生产到底怎么执行多个工具调用"，结论要求我修正措辞。`packages/core/src/agent-loop/AgentLoop.ts:307-309`：
```ts
for (const call of toolCalls) {
  this.state.recordToolCall();
  await this.dispatchToolCall(call, denialCounts);   // ← 逐个 await：生产里没有任何并行
  dispatchedAny = true;
}
```
⇒ **生产里所有工具调用严格串行**。因此准确的说法是三段，而不是一段：
1. **不是安全漏洞**：写不可能交错（因为什么都不并发）⇒ "写串行"这一**性质**由"全程串行"**顺带满足**，此前"安全机制死掉"的说法**过强**，此处更正。
2. **但文档承诺的机制没落地**：`docs/ARCHITECTURE.md:312`（tools/registry 行："**exclusive 屏障 + 滚动池（maxParallelToolCalls:10）**"）、`:313`（tools/filesystem 行："**写串行**"）、`docs/EVENT-SPEC.md:303/348`（"**独占=排序屏障，读并发/写串行纪律**；独占屏障**由该事件所在 step 的调度保证**"）、`docs/DESIGN-DECISIONS.md:179`（决策落地项）都把它描述成**已交付**；而实测：**`读并发` 在生产里不存在**，`ToolRegistry.execute`（屏障与滚动池的唯一所在）**是死代码**。⇒ 属"**文档描述了一个未接线的机制**"（本段同族），但缺的是**性能特性**与**文档准确性**，不是安全边界。
3. **死代码里藏着真坑**：那份 `execute` 路径的 exclusive 链**一次异常即永久中毒**（下一条写工具静默不执行 + 抛陈旧错误）。今天不触发（没人调用），**谁把它接上就会踩**。
**修法方向（两条，属不同性质）**：(a) **文档/注释如实**——写明"v0.1 工具调用为串行执行；exclusive 屏障与滚动池**已实现但未接线**"，并把死代码路径**标注未接线**（这是诚实性修复，便宜）；(b) **真正接线**（把 `ParallelScheduler`/屏障接进 AgentLoop 以获得读并发）——**那是功能决策**（会引入并发语义、超时、取消、错误聚合等一整批问题），**不应顺手做**。另建议顺带修掉 (a) 路径上的**中毒坑**（给链补 `.catch()` 使其恢复、失败仍如实抛给当次调用）。

**② `costMultipliers()` 抛错 ⇒ 倍率静默变默认（成本展示静默失真）——待实测定级**
- 代码（`apps/cli/src/cli.ts:513-518`）：
  ```ts
  multipliers = new ProviderStore({}).costMultipliers();
  } catch { multipliers = {}; }                       // ← 任何抛错 ⇒ 空表
  return (provider) => multipliers[provider] ?? DEFAULT_COST_MULTIPLIER;
  ```
  ⇒ 只要 `costMultipliers()` 抛错，**所有 provider 的倍率静默变默认值**，**成本展示随之静默失真、且无任何告警**（属"静默降级"族）。
- **已实测定级（Round 53）：可达的真缺陷，不是防御性死代码。** 我用探针做了**双向实测**（临时 root 注入 `VESSEL_*` 之外的 `rootDir`）：
  - **健康** `providers.json`（含 `costMultiplier: 2.5`）⇒ `costMultipliers()` 返回 `{"ds":2.5}`；
  - **损坏**（非法 JSON）⇒ **抛 `providers file corrupted (invalid JSON)`** —— 因为 `rawLoad()`（`ProviderStore.ts:543-573`）对非法 JSON / 非数组 / 坏条目 / 非法配置**一律 throw**（`:556/:559/:565` + `assertValid`）。
  ⇒ CLI 的 `catch { multipliers = {} }`（`cli.ts:513-518`）**真的会命中** ⇒ **`providers.json` 损坏时，所有 provider 的倍率静默变默认 1×、成本展示静默失真、无任何告警**。属"静默降级"族，**已派卡**（修法：保留兜底不阻断统计，但**必须可见**——warn 一次并说明原因；双向验收：损坏 ⇒ 有告警 + 仍走默认；健康 ⇒ 正常用倍率且**无**告警）。
  （过程自纠：我的探针夹具先后因**缺 `name`**、**协议名写成 `openai`（实际是 `openai-compatible`）**被校验拒绝两次；**对照不成立时我没有拿它当证据**，补正后才定级。）

## Round 51 — 取证：**Anthropic 流式解析里两处同族"静默丢数据"**（与刚修好的 OpenAI 那处同族）

**① `packages/llm/src/stream/parseAnthropic.ts:73-84`（`content_block_start`）**：
```ts
case 'content_block_start': {
  const block = ev.content_block;
  if (block?.type === 'tool_use' && block.id && block.name) {   // ← 缺 id 或 name ⇒ 整块跳过
    chunks.push({ type: 'tool_call_start', id: block.id, name: block.name, arguments: ... });
  }
  break;
}
```
⇒ 一个 `tool_use` 块若**缺 `id` 或 `name`**，**不发 `tool_call_start`**；而紧随其后的 `content_block_delta`/`input_json_delta`（`:85-…`）**照常产出 `tool_call_delta`** ⇒ 消费侧（`AgentLoop.consumeStream` 按 start 的 id 建 `open` 表）**找不到已开始的调用 ⇒ 参数被静默丢弃**。**与 Round 46/49 修掉的 OpenAI 那处是同一族**（身份信息不全就把数据丢掉，而正确做法是**缓存 + 显式补发**）。
**修法方向（与 OpenAI 那处同构）**：按 index 缓存该块的 `id`/`name`/`partial_json`，在 `content_block_stop`（或终端）若身份仍缺则**显式补发** `tool_call_start` + `tool_call_end`（复用既有 `toolIdPlaceholder` 约定），**绝不静默丢弃**。

**② `parseAnthropic.ts:229-233`（`finish()`）**：
```ts
finish(): StreamChunk[] {
  if (this.ended) return [];
  this.ended = true;
  return [];                      // ← EOF 无 message_stop 时什么都不发
}
```
⇒ **EOF 没有 `message_stop`**（连接被截断/中断）时：**既不补 `message_end`，也不为未关闭的 `tool_use` 块补 `tool_call_end`**。对比 **OpenAI driver 的 `finish()` 会走终止边界**（`closeToolCalls(true)` → flush 未识别调用 + 关已开调用 + `message_end`）⇒ 两条 provider 路径的**终止语义不一致**，Anthropic 这条**静默**丢掉流的收尾信号。
**修法方向**：`finish()` 改为发出「未关闭块的 `tool_call_end`（+ 若有未识别缓存则显式补发占位调用）] + `{ type: 'message_end' }`」，并补一条"EOF 无 message_stop"的判别性用例。

**已修并提交（`7648733`）**；原先押后是因为 `parseOpenAI.ts` 正被一张在跑的卡编辑（**同目录**，我不做同目录并发）；**另一处经核实"不同族、别改"**：`parseAnthropic.ts:215-216` 的 `tool_call_end` 过滤（`!isToolStop || real===undefined` 时 `continue`）是**刻意的**"文本块 stop 不产生 end"，语义正确。

## Round 54 — 取证：**`stream()` 没有超时，上游挂死 ⇒ 回合静默卡死**（与同类的 `chat()` 不一致）

**代码事实（读码确认）**：
- `packages/llm/src/provider/OpenAICompatibleProvider.ts:85-86`（**chat 路径**）**有**超时：
  ```ts
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 60_000);
  ```
- 同文件 `:168-191`（**stream 路径**）**只有**"转发外部 signal"，**没有任何定时器**：
  ```ts
  const controller = new AbortController();
  const external = request.signal;
  if (external) { if (external.aborted) controller.abort(); else external.addEventListener('abort', forwardAbort, { once: true }); }
  const resp = await fetch(url, { …, signal: controller.signal });
  ```
**后果**：调用方不传 `signal`（或永不 abort）时，若上游**挂死**（TCP 连接在、但不发数据也不报错），`reader.read()` **永不返回** ⇒ **回合静默卡死**：没有错误、没有审计事件、界面像冻住，用户无从判断是"模型慢"还是"链路坏了"。审计原文即此（"`stream()` 不用 `timeoutMs`(chat() 有)，仅转发外部 signal…无状态位"）；`AnthropicProvider.ts` 同类位置（审计指 `:315`）**待逐一核实**。
**修法方向（需要设计取舍，不只是"加个 setTimeout"）**：
- **不能**照抄 chat 的"整体 60s 上限"——流式响应**合法的长输出**会被误杀。正确语义应是**空闲超时（idle timeout）**：每收到一个 chunk 就重置定时器，超过 N 秒**没有任何数据**才 abort；
- abort 后必须**可诊断**：抛出/上报**明确**的超时错误（而不是让消费侧看到"无原因的流中断"），并让上层能以 `finishReason:'error'` 收尾；
- 与既有 `timeoutMs` 选项的关系要定清（是复用该值作 idle 阈值，还是新增独立配置）；**两条路径（chat/stream）的语义差异要在文档或注释里写明**，避免下一个人再踩。
**判别性验收**：① 上游**不发数据**（假 fetch/reader 永不 resolve）⇒ 必须在 idle 阈值后**以明确超时错误结束**（旧实现永不返回 ⇒ 必红）；② **负对照：慢但持续有数据**（间隔小于阈值）⇒ **不得**被误杀（防"把长回答掐死"）；③ chat 路径既有超时行为**逐字不回归**。
**已派卡（第 59 轮）**；原先押后是因为 `packages/llm` 已有卡在跑（Anthropic 解析），**我不在同一包内并发**。

## Round 55 — 本段**最严重**的一条（我已实测）：**Anthropic 流式工具调用的参数一直是坏的**

**触发方式**：Anthropic 解析卡的执行者在报告里**主动**报告了一处"更严重、但必然触碰正常路径"的问题，并**没有顺手改**（只报告、等裁决）。我去实测，拿到铁证：

**生产侧（种子）** `packages/llm/src/stream/parseAnthropic.ts:80`：
```ts
arguments: block.input == null ? '' : JSON.stringify(block.input)
```
**消费侧（累加）** `packages/core/src/agent-loop/AgentLoop.ts:485/492`：
```ts
case 'tool_call_start': open.set(chunk.id, { name: chunk.name, args: chunk.arguments });   // 把种子放进累加器
case 'tool_call_delta': const acc = open.get(chunk.id); if (acc) acc.args += chunk.argumentsDelta;  // 片段"追加"
```
**探针原始输出**（规范 Anthropic 流：`content_block_start{tool_use,id,name,input:{}}` → `input_json_delta` 两段 `{"path":` + `"a.txt"}` → `content_block_stop` → `message_stop`，再按消费侧语义累加）：
```
seed="{}"
appended="{\"path\":\"a.txt\"}"
accumulated="{}{\"path\":\"a.txt\"}"
parseFailed=true  ⇒ AgentLoop 退化成 {_raw:...}，工具拿不到 path
```
**根因与影响面**：Anthropic 流式的 `content_block_start.input` **恒为空对象 `{}`**（真正的 JSON 由 `input_json_delta` 分片到达），而解析器把 `'{}'` 当**种子**写进 `tool_call_start.arguments`、消费侧再**追加**片段 ⇒ 拼出 `'{}{...}'` ⇒ `parseToolArguments` JSON.parse 失败 ⇒ **工具拿到 `{_raw: …}`、没有 `path`**。`callModel` 有 `stream()` 就优先走流式 ⇒ **这是生产热路径**；非流式 `chat()` 直取 `block.input` 不受影响。⇒ **每一次 Anthropic 流式工具调用都是坏的，不是畸形流的边角**。
**还有一层**：既有测试把它**锁成了期望**——`parseAnthropic.test.ts` 的负对照断言 `tool_call_start{arguments:'{}'}`，即"测试锁住缺陷"的又一例（本段第 3 次）。

**修法决定（我做的取舍）**：倾向**生产侧最小修法 A**——`input` 为**空对象（无自有键）时不写种子**，非空 `input` 仍照旧序列化（兼容"把整份 input 放在 `content_block_start`"的实现）。**不选 B（消费侧首个 delta 覆盖）**：那会让"start 带真实种子"的 provider 丢参数，且改动核心消费逻辑、影响面更大。
**已修并提交（`55c7d1a`）**。**我的独立端到端复测**（修复后）：规范流 ⇒ `accumulated="{\"path\":\"a.txt\"}"` 且 `streamedParsed={path:"a.txt"}`；**内联风格**（整份 input 放在 `content_block_start`）⇒ 种子仍保留且可用 ⇒ **兼容面没被"一律丢种子"的粗暴修法弄坏**（这正是我要求"不得把一种坏换成另一种坏"的那条）。**原验收硬要求（仍作为该卡的判据留档）**：**必须走消费侧**——断言"规范 Anthropic 流 ⇒ 工具最终参数是合法 JSON 且 `path === 'a.txt'`"（旧实现给 `{_raw:…}` ⇒ 必红）；**只测 chunk 形状不算**。允许按新语义更新那条 `'{}'` 旧断言，但须逐条说明改动、论证**不弱于**旧断言，并保留"除该处种子语义外其余 chunk 序列逐字一致"的负对照。**已派卡。**

### Round 63 — 家族清查（阴性结论，但值得留档）

本段出现了**三次同形缺陷**（种子 `'{}'`、OpenAI "start 之后重复 id+name 重发 start"、Anthropic "重复 `content_block_start`"），形态都是"**协议帧 × 消费侧按 id 的共享累加器被覆盖**"。我按纪律做了**家族性清查**（grep `open.set(` / `acc.args +=` / 累加器关键词，覆盖 `packages/**`）：

**结论：这套模式在全仓只有一处消费者与两个生产者**——
- 唯一消费者：`packages/core/src/agent-loop/AgentLoop.ts:486/493`（`open` Map，按 `chunk.id` 键；`tool_call_end` 时 `finalize`）；
- 两个生产者：`packages/llm/src/stream/parseOpenAI.ts` 与 `parseAnthropic.ts`；
- 除**正在派卡修的"重复 `content_block_start`"**外，**没有第四处同形点**（`packages/**` 其余命中都是文档注释、测试里的等价累加器，或无关的"累加"用词）。

⇒ **这一点值得留档**，因为它把"该族是否还有漏网"变成**已查证**：修完重复 start 后，这条线可以判定为**闭合**，下一个人不必再扫一遍。**同时也说明该族的边界**：它只在"**多帧拼一个字符串、且拼装状态由 id 索引**"的地方出现——本仓恰好只有工具参数这一条链。

### Round 64 — **更正 Round 63 的"闭合"结论**：重复 start 只修了主形态，**留了一个真缺口**

**已修并提交**：`feed()` 的 `tool_call_start` 分支加了 `startedIndexes.has(index)` 守卫（重复 start 本身丢弃、其**非空**种子折成 append-only 的 `tool_call_delta`、空种子什么都不发），规范流整数组逐字不变由负对照断言。⇒ **"带 id+name 的重复 start"这一主形态已收口。**

**但我在 Round 63 写下的"这条线可以判定为闭合"说早了。** 执行者诚实列出三个**未覆盖**子形态，其中**第一条是真缺口**：
1. **重复 start 不带 `id`/`name`、但带非空 `input`**：`parseAnthropicEvent` 的 `block.id && block.name` 守卫使该帧**根本不产生 `tool_call_start`** ⇒ 新守卫**看不到它**；而写进 `toolInputJsonByIndex` 的种子对**已 started** 的 index **永不被读取**（该 map 只被 `flushToolBlock` 读，而它只服务**未 started** 块）⇒ **这一帧的种子仍然静默丢失**。**补它需要在 `content_block_start` 记账处再加一个发射点**（或改 mapper 守卫）——**属独立决策**，本卡按最小改法收口，未做。
2. **同 index 但换了 `id` 的重复 start**：`toolIdByIndex.set` 在本帧映射前先执行 ⇒ 折出的 delta 与随后的 `tool_call_end` 都打到**新 id**，消费侧没有该 id 的累加器 ⇒ 该帧种子丢（**先前的累计片段不会丢**：`AgentLoop` 结尾对 `order` 有兜底 finalize）。彻底修法是"**首个 start 冻结身份**"，会改变已 started 块的 id 语义。
3. **重复 start 携带不同 `name`**：`tool_call_delta` 词表里**没有 name 字段**（`packages/shared/src/provider.ts:133`）⇒ 名字无处可传，**属词表限制**。
**执行者的建议（我采纳）**：为**协议违规**另设**独立**只读计数（如 `duplicateStarts`），**不要并进 `malformedFrames`**——后者口径是"字节层面不可解析（截断）"，混在一起会让"连接被截断"与"上游重发帧"两种事故不可区分。**边界必须写清**：`content_block_stop` 之后复用同一 index 是**合法**的（状态已清），**不得**计入；只有"块还开着又来 start"才算异常。
**已派卡**：做"协议违规计数"（便宜、让上面第 1 条的丢数据**至少可见**），并把第 1 条的**数据保全**修复列为需单独裁决的设计项（它要新增第二个发射点，不能顺手做）。

### Round 68–70 — 计数已落地；`Registry` 链修复 + 文档如实；并记下"**为何不该顺手接线**"

**① 协议违规计数已提交（`2e53751`）**，且它**纠正了我一个说法**：我曾写"子形态②（无 id/name 的重复 start）需要**第二个发射点**才能计数"——**不成立**。把判定放在 `content_block_start` 的**既有记账 prelude**（mapper **之前**）即可**同一处覆盖两个子形态**；**计数器不产出任何 chunk，所以它不是发射点**——"第二个发射点"是**把该帧种子 surface 出去**（**数据保全**）才需要的。**我混淆了"计数"与"保存"。**
**我裁决的口径**：保持"**块还开着（OPEN）**"判据——协议不变量是"一个 index 在 `content_block_stop` 之前只应有一次 start"，**第二次就是违规**（不论内部是否 started）；换成 `startedIndexes` 会漏掉"两次 start 都无 id/name"这一**同样违规、同样丢种子**的形态。该决定已被锁成具名用例。
**一条我立刻处理的局限**：`malformedFrames` 与 `duplicateStarts` **当时全仓都没有消费者**（grep 只命中解析器与测试）⇒ **可见性只存在于 getter 里**。"数据在那里"≠"运维能看到"；若没人读，我们只是把"静默丢弃"换成了"**安静地记录在没人看的地方**"。⇒ **已派卡把它们消费掉**（流结束时读取、**计数 > 0 才可见**、**两类成因必须可区分**、规范流零输出；**不许动 `shared` 词表与 `message_end` 形状**）。

**② `Registry` 链中毒已修 + 文档如实（`7e02b17`、`c6add13`）**：`exclusiveChain` 原先被赋成 `then()` 的 promise，一旦 `run()` 抛出就**永久 rejected** ⇒ 之后每次 `.then` 回调**永不执行**（写工具静默不跑）且调用方收到**别人那次的陈旧错误**。修法：回调**自身吸收失败**让链每次 settle 为 resolved，再用 `if (settled.failed) throw settled.failure;` 把**该次自己的**错误如实抛给当次调用方（每调用一个私有 `settled` ⇒ 不存在旧错误串台；既不吞成成功也不降级）。**文档 4 处**（`ARCHITECTURE.md:312/313`、`EVENT-SPEC.md:303/348`）把"已交付/由该 step 的调度保证"改成"**已实现但未接线**"，并**保留**"读并发/写串行"作为**设计意图**——**刻意没改成"安全风险"**（生产全程串行，写不交错这一**性质成立**）。

**③ 为何**不该**在 V0.1 顺手接线（执行者论证、我采纳并留档）**：要让 `read` 并发，得把 `AgentLoop.ts:307-311` 的串行 `for` 换成 `ParallelScheduler.runBatch` 一类批量派发；而 **`runBatch` 不产生 `tool/call`/`tool/result`/`after_tool`、不做 denial 计数（`noteDenial`）、不做中断赛跑（`raceToolRun` 及"中断时补一条 interrupted `tool/result`"的配对逻辑）**；会话日志是**唯一真源** ⇒ 并发落盘顺序会与模型可见历史/回放/前缀缓存耦合，必须另定"**事件落盘顺序 vs 结果顺序**"；中断语义（N 个在飞时的取消与结果映射）、`AgentLoop.ts:662` 的"单工具抛错即整轮失败"、`Sandbox` 的**轮次状态机**是否并发安全**均未验证**；且 `registry` 的 `maxParallelToolCalls`（10）与 `ParallelScheduler` 的 clamp（[1,3]）是**两套上限**。⇒ **接线单独立卡并配 benchmark 判据**；若要动，**第一步只对 `isReadFamily` 放开并发**、写/exclusive 保持屏障，并先把 `runBatch` 补成"事件落盘顺序 = 输入顺序"。
**仍待定的文档项**：`docs/DESIGN-DECISIONS.md:179` 把该机制列为**决策落地项**（性质是决策记录而非交付断言）——是否也补一句"未接线"由后续裁决。

## Round 71 — 我实测：**`kind='error'` 的回合在非交互式 `vessel run` 里退出码是 0**

**触发方式**：我给 TUI 错误呈现那张卡附了一条"顺带核查 `TurnResult['kind']` 的其它消费方"的要求。它还没回报，**我先自己量了非交互式路径**（只读），结论比 TUI 那条更严重。

**代码事实**（`apps/cli/src/cli.ts`）：
```ts
918:  const result = await harness.loop.runTurn(prompt || '（无输入）');
919:  console.log('\n=== 最终回复 ===');
920:  console.log(renderFinalReply(result.finalText, usingMockProvider));   // kind='error' 时这里就是错误消息
922:  console.log(`\n=== turn ${result.turnId} kind=${result.kind} … ===`);
…
933:  return 0;                                    // ← 正常路径无条件 0，不看 kind
934: } catch (err) {
936:   return fail(1, msg, flags, …);               // ← 只在「抛异常」时非 0
```
⇒ **`kind='error'`（熔断 `DenialLimitError`、BeforeTurn 拦截等）时：退出码 0，且错误文案被印在 `=== 最终回复 ===` 标题下**（**框架与内容自相矛盾**）。**人能看见脚注里的 `kind=error`，脚本看不见**——`cmdRun && 下一步` 这类串接会**在失败后继续执行**。
**这属"失败被上报为成功"族，且影响面是 CI/脚本**，比 TUI 那条（影响交互用户的可读性）更实际。

**修法方向（我倾向最小且双向）**：`kind='error'` ⇒ **非零退出码**（与既有 `fail(1, …)` 口径一致，并让 `--json` 信封同步）；`=== 最终回复 ===` 这个标题**在 error 时不适用**（改成不冒充"最终回复"的表述，例如明示"回合以错误结束"+ 错误文本）；**`kind='budget'` 需单独裁决**（步数上限是否算失败？我倾向**不算失败但必须可见**，且不改退出码）。
**判别性验收（必须有负对照）**：① `kind='error'` ⇒ **非零退出码** + 输出里不出现"最终回复"式冒充（旧实现 exit 0 + 冒充 ⇒ 必红）；② **负对照：`kind='success'` ⇒ 退出码与输出逐字不变**（防"把一切都当失败"）；③ `interrupted`/`budget` 的处置如你裁决并各配一条用例；④ 若改 `--json` 信封，其既有形状与断言不得回归。**已派卡。**

## Round 72–75 — `kind='error'` 被当成成功：**四个消费面已修**，两处裁决 + 一串只报告项

**已修并提交**（全量 **1849 passed + 6 skipped**；本段起点 138/1555 ⇒ **+294**）：
- `de97da0` **TUI**：`error`/`budget` 原先落进"当助手回复打印"的兜底 ⇒ 熔断文案被当作模型发言。现为一个纯函数、四条分支显式处理；`success`/`interrupted` 逐字不变（`success` 有负对照）。
- `e1be683` **local-server**：`POST /api/sessions/:id/turns` 对 `error` **恒回 200** ⇒ 只看状态码的客户端读成成功。现 `kind='error'` ⇒ **500**（body 形状与字段语义不变；**刻意不复用** `{error,message}` 信封——那形状表示"请求没跑起来"）。`success` 逐字不变（含键序），`budget`/`interrupted` 仍 200（与 CLI 裁决一致）。
- `c04638c` **benchmark runner**：原先**只取 `finalText`、丢掉 `result.kind`** ⇒ **被熔断打死的运行把 `same intent denied 3 times: …` 当成"最终答案"交给断言层**（`asserts.ts` 只有 `interrupted` 判据、**没有 `error` 判据**）。现按"**记录 → 可见可判**"分层：`ScenarioReport.turnKind?`/`turnEndedAbnormally?`（可选、缺席≠success）、JSONL 增一行 `turn/end`、summary.json 增 `turn` 键（**既有 11 键一字未动**）、契约侧用**既有** `RunResult.notes` 承载"未正常收尾"（success 路径保持 `undefined`）。**未新增判据类型**（那要动 `manifest.ts` 的 `PASS_KEYS` + `asserts.ts` 词表 + 所有场景）——影响面远大于收益。
- `9b0541f` **EvaluatorAgent**：`stopReason` 原为**字面量常量** `'completed'`、与 `turn.kind` 无关 ⇒ **被熔断的评审回合对上游看起来像"评审已完成"**。现按 kind 映射（error→error、budget→max_tokens、interrupted→aborted），对齐**既有先例** `SubagentManager.mapTurnKind` 与 `TeamRuntime`，且 `EvaluatorStopReason` 与子代理契约**同源类型**（不会漂移）；未跑完的回合 verdict 强制为既有词表的 `'error'`（**不新增词表**——`'met'` 是最危险的误报）。

**我做的两处裁决**：
1. **`isError` 取"并集"而非严格等式**（`stopReason!=='completed' || verdict==='error'`）：与 `SubagentManager:350` 的严格等式**只在"success 且解析不出 verdict"这一处不同**，此处取**旧值 `true`**。依据：`EVENT-SPEC.md:391` 是**单向蕴含**（"stopReason≠completed 一律 isError"，非 iff），且我要求 success 回合字段**逐字不变** —— 并集**只增不减、零放宽**，并保住 evaluator 既有的 fail-loud 信号。**裁决：接受。**
2. **S001 注入变体下 `success=true` 与 `turnKind='error'` 并存不算误判**：S001 的判据问的是"**机制层有没有拒绝**"（拒绝了、文件也还在），而"**这轮没跑完**"是**旧实现说不出的第二件事**。⇒ **裁决：现在不据此改判**（改判会让历史对比失真），只让事实**可见可追溯**。执行者已**静态穷举**确认：`offline.ts` 里每个危险调用**至多发 1 次** ⇒ **没有任何既有场景触得到熔断阈值** ⇒ 无场景结果被改变；唯一新信号为 true 的既有场景是 **B025**（`kind='interrupted'`，正是它自己声明的判据）。

**只报告、待排的队列（本次新增）**：
- **`real-model-lane.ts:342`**：行状态 `status = passed` 只看 `metrics.success`，而 `notes`（现含"未正常收尾"）**只落在 `row.result.notes`** ⇒ **真实模型 lane 里被熔断打死的行仍报 `passed`**。这与 S003/S008 的"空洞证据"同族（**报告里的一行 PASS 必须能追溯**，纪律 20）。
- **`EvaluatorAgent` 镜像事件 `delegateId` 不成对**（`eval_${Date.now()}_${hex}` vs `eval_${Date.now()}`）⇒ `TeamProjection.onSubagentStop` 按 id 找不到行、直接 return ⇒ **evaluator 的 stop 事件永远进不了 team 投影**，**我们刚修好的 `stopReason:'error'` 因此到不了投影**。
- **local-server 另有 4 处"失败回 200"**：`/api/goal/tasks/:id/run`（`outcome==='error'` 仍 200）、`/api/sessions/:id/team-runs/current`（失败只在 body）、`POST /api/sessions/:id/team-runs`（202 异步接受，失败无状态面）、**`POST /api/reviews/:id/import`（`parseReviewConclusion` 解析失败时 `verdict='error'` 却把 status 置 `'imported'` ⇒ 解析失败被上报为导入成功）**。
- **`Planner.executePlan` 的 `run` 签名抹掉 `kind`**（`Planner.ts:97,113`），`runner.ts:443` 传的却是 `TurnResult` ⇒ 步骤回合的 kind 只能以 `finalText` 进入 evaluate（不会假通过，但不可见）。
- **web**：`apps/web/src/api.ts` 会在 `!res.ok` 抛 `ApiError`，而 `ConversationView` 只显示 `HTTP 500`、**未渲染 `err.body.finalText`** ⇒ 修完状态码后失败**可见但信息贫**（净改善，但应把真实文案渲染出来）。
- **core 语义**（越界只报告）：`AgentLoop.ts:203-224` 的「输入被 BeforeTurn 拦截」按 **`kind='success'`**、`finalText='[blocked] …'` 返回 ⇒ **"被拦截"在 kind 上看起来是成功**（好在 `'[blocked]…'` 解析不出 verdict ⇒ evaluator 判 `error`，不会误报 `met`）。