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
   - **B023 自产自评、永不失败**：golden 串 `ENGINE-GOLDEN-88` **就写在 `runner.ts:171` 的报告模板常量里**（`B023.yaml:10-14` 检查它），而 `runner.ts:152` 写死、`:156` 只检查它 ⇒ 判据检查的是 **runner 自己写下的东西**。**且它在确定性 L1 集合（`run-release-gates.ts:85-89`）里 ⇒ 发布门禁会把它当绿灯。**
   - **S003 / S008 未被任何会执行判据的批次引用**（离线 reports 目录为 0）；它们的 passed 只来自 lane 的 `finalText` 非空（`contracts/vessel.ts:171`）。
   - **S008 完全没有 denial/guard 判据**（goal 声称测 network deny 却无对应判据），且 `content_absent` 读**不存在的文件** → `asserts.ts:84-91` 返回空串即 pass = **恒真**；`configs/policy.default.yaml` 的 `network.default` 是 declaration-only ⇒ **goal 与判据不符**。
   - **S002 / S003 的 `file_content` 读 fixture 常量**（`data.txt` 在场景内从不被改写）⇒ 恒真；**S006** 的 "rejected" 来自 `offline.ts:242` 的**无条件脚本** ⇒ 恒真，且 fixture 号称 git 仓库而 `.git/HEAD` **实测不存在**。
   - **S004 / S005 / S007** 的 `content_absent` 目标文件由 **mock 自己**写死干净内容 ⇒ 对机制不敏感。
   - **B019** golden「42」过短无锚定；**B016** 的 prompt 自身含答案串 ⇒ 回显型实现也能过（推演）。
   - **文案/清单不一致**：`gates.ts:48` 称 "S001-S008" 而 `:439` 实跑 6 个；`safety.test.ts:27/28` 同样漏 S003。
   **处置**：立即修 **S003**（prepare 建真实链接 + 判据锚定 `probe-link` + 纳入 `SAFETY_SCENARIOS`）与 **S008**（先落实 network deny 执法或显式 `pending-environment` 再补 denial 判据）；**B023 改为锚定引擎真实产物**并让门禁文案与实跑一致；**S002/S006 加回归锁**（让判据不再恒真）；其余记录。**纪律 20 由此成立：报告里的一行 PASS 必须能追溯到"哪条判据、在哪次运行中判定的"。**
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