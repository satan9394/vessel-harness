# RELIABILITY-REPORT — Vessel (Composable Agent Harness) 可靠性 & 安全审计

> 审计 Agent：RELIABILITY_SECURITY_AUDITOR（独立审计，未读其它审计报告，未改任何代码）
> 基准：`docs/PROJECT-BRIEF.md` + 源码阅读（未执行任何命令；全部结论来自静态证据，行号以审计时工作树为准）
> 立场：**假设系统必然会失败**——网络、模型、密钥、配置损坏、任务中断、上下文耗尽、升级迁移、数据恢复、危险操作、命令执行。
> 纪律遵守：未改代码；未输出任何真实密钥（仅描述机制）；无删除操作。

---

## 1. 总体结论

Vessel 的「存储层纪律」整体优秀：providers/current/usage/settings 全部原子写（tmp+rename，Windows 有界重试）、ProviderStore 有写前备份轮转、凭据默认 DPAPI、错误处理普遍 fail-loud。但**对外可恢复性**存在系统性短板：`apps/cli/src/cli.ts` 入口 `main()` 无顶层 catch（第 1513-1515 行），任何未捕获异常都会以裸 Node 栈崩溃收场，且大量关键失败路径（settings.json 损坏、secrets.json 损坏、providers.json 损坏、compose/构造阶段）不在命令内部 try 里——真实用户遇到时**没有一句可操作的恢复指引**。另有三个高优先级单体风险：usage.json 损坏**静默清零且无备份**（数据永久丢失）、openai-compatible 错误体把上游响应原文回显 500 字符（潜在密钥进日志）、DPAPI 调用把密钥基 64 形式放进 PowerShell 命令行（本机同级进程可观测）。

**Top 3 风险**：

1. **配置损坏（settings.json / secrets.json / current.json / providers.json）→ 多个核心命令裸栈崩溃，无恢复指引**（cli.ts:1513-1515 无顶层 catch 放大器；settings.ts:113-128 fail-loud 但无兜底）。
2. **usage.json 损坏 → 静默回退空表，下一次写入把唯一数据源覆盖，永久丢失全部用量历史，且无备份轮转**（UsageStore.ts:432-519 的 load 全捕获 + save 无备份）。
3. **API 错误路径诊断性不足 + 潜在密钥泄露**：openai-compatible 401/400/429 无分类提示（OpenAICompatibleProvider.ts:117-120），网络失败只见 "fetch failed"（cause 丢失），且错误体原文回显 500 字符；DPAPI 经 PowerShell 命令行传密钥（CredentialStore.ts:339-372）。

---

## 2. 风险清单（按优先级）

### P1 — 真实用户可遇到、影响大、应尽快修

#### R1. CLI 顶层无异常兜底：一切未捕获错误以裸栈崩溃
- **证据**：`apps/cli/src/cli.ts:1513-1515` `main().then((code) => process.exit(code))`，无 `.catch`；`main()` 内命令分发无统一 try。
- **触发**：任何命令在「非命令内部 try 覆盖区」抛错，即：cmdRun 的 `defaultProviderStore()`/`composeHarness()`（cli.ts:223、257-269 在 try 外）、runChat 的 `resolveChatStore()`/`buildHarness()`（chat.ts:204、279 在 try 外）、cmdGuide/cmdSettingsList 的 `settingsStore.load()`（guideCommands.ts:85、93 无 try）、cmdModels 的 store 构造、cmdProvider 大部分子命令。
- **影响**：用户看到 `node:internal/process/esm_loader` 级栈 + `unhandled rejection`，无「原因 + 怎么修」；对新手（117 引导体系的目标用户）等于「坏」，且与项目「CLI 低对外成熟度、看重可交接」的现状直接冲突。
- **概率**：中（配置损坏/策略文件缺失即触发）。
- **建议**：给 `main().then(...)` 加统一 `.catch`：`describeProviderError` + 按错误特征给一句恢复指引（配置文件损坏 → 提示路径 + `vessel provider backup`/手工移走隔离 + 重新配置），exit 1。把 cmdRun 的 compose/ProviderStore 构造移进 try。
- **优先级**：**P1**（一个改动修复一大类用户可见故障）。

#### R2. usage.json 损坏 → 静默清零 + 无备份轮转 = 用量历史永久丢失
- **证据**：`apps/cli/src/usage/UsageStore.ts:432-519` `load()` 内 `JSON.parse` 失败被 `catch { return { file: empty, legacy: false } }` 吞掉（无任何 warn）；`save()`（521-530）**没有** `backupBeforeWrite`（对比 ProviderStore.ts:485-529 有备份）。
- **触发**：usage.json 半写/杀软锁坏/手工改坏 → 下次 `record()`/`recompute()` 把空表写回，原数据被覆盖。
- **影响**：全部用量与成本历史**静默永久丢失**，用户无感知（`vessel usage` 显示 0）；无备份可回滚。
- **概率**：低-中（写入频繁，每次 turn 记录都会写盘）。
- **建议**：损坏时 fail-loud 或隔离改名 + console.warn（复用 secrets 的 quarantine 模式，CredentialStore.ts:155-171 已有样板）；为 usage.json 接入与 providers.json 相同的写前备份轮转；load 失败时保留损坏文件不覆盖。
- **优先级**：**P1**（数据丢失类唯一高危）。

#### R3. DPAPI 经 PowerShell 命令行传密钥 → 本机同级进程可观测
- **证据**：`packages/application/src/credential/CredentialStore.ts:339-372` `dpapiProtect/dpapiUnprotect` 把 base64(密钥) 直接拼接进 `powershell.exe -Command` 字符串；`execFileSync(..., { stdio:'pipe' })`（命令行为进程可见数据，同级用户进程可经 WMI/ETW/任务管理器读取）。
- **触发**：任何写/读 DPAPI 凭据的路径（provider add/set/迁移、每次 load 解析 secretRef）。
- **影响**：API key 以「base64 == 可逆」形式出现在 powershell 进程命令行，本机任意同级进程（含被攻破的辅助进程、AV/监控）可读到；违反「密钥不落日志/不落盘明文」的初衷（盘上是密文，命令行是明文）。
- **概率**：确定发生（机制即如此），危害面=本机同级进程。
- **建议**：改走 PowerShell **stdin 传参**（`-EncodedCommand` 仍是可读编码，不解决；正确做法是 `$input`/管道喂 stdin 或写临时文件+删除），或换引 native 库（如 `node:sqlite` 不可达时用 `binding`/WASM DPAPI）；至少把保护期压缩到单次调用并 `windowsHide`（已有）。机制描述见 §3。
- **优先级**：**P1**（密钥暴露面，机制性）。

#### R4. openai-compatible 错误体原文回显 500 字符 → 潜在密钥/内部信息进日志
- **证据**：`packages/llm/src/provider/OpenAICompatibleProvider.ts:117-120`（非流式）与 192-195（流式）：`throw new Error(\`OpenAI-compatible ${status} ${statusText}: ${text.slice(0, 500)}\`)`——上游响应体**未脱敏**直接入错误信息；该信息经 cmdRun `describeProviderError` 打到终端（cli.ts:290）、TUI `[错误]`（chat.ts:290）。
- **触发**：任一网关在错误体里回显请求（调试型代理/私有网关常见）或含内部标识。
- **影响**：若网关 echo 了 Authorization 头或请求体，密钥/会话标识进入用户可见输出与终端 scrollback（等同日志泄露）。
- **概率**：低（多数正规网关只回 error.message），但危害=一次性泄露全部凭据，且无任何防护。
- **建议**：仿 `sanitizeWireSnippet`（原在 OpencodeGoProvider，已下沉至 `errorBody.ts:14`：去 URL、压空白、截断 240）与 `extractWireErrorType/Message` 结构化提取；对 openai-compatible 同样只暴露 `error.type/error.message` 并脱敏。
- **优先级**：**P1**。

#### R5. secrets.json 损坏 → 全部依赖 ProviderStore 的命令砖（构造期即抛）
- **证据**：`CredentialStore.ts:118-149` 默认 `recover=false` 对损坏文件 `throw CredentialError`；`defaultStore.ts:35-44` `createDefaultProviderStore` **未传** `recoverCorrupted`；`readOrCreateEntropy`（CredentialStore.ts:442-446）在**构造期**就 `readSecretsFile` → 损坏文件连构造都过不去。
- **触发**：secrets.json 半写/外部改动。
- **影响**：`vessel run/chat/provider/models/usage`（usage 需读 provider 倍率，cli.ts:180-188 已容错）几乎全灭；报错只给路径，无恢复建议（用户不知可把文件改名隔离后重录 key）。
- **概率**：低（该文件写频低）。
- **建议**：默认路径开启 `recoverCorrupted: true`（损坏 → 改名 `secrets.json.corrupted-<ts>` 隔离 + warn + 空结构，用户重录 key 即恢复，机制 CredentialStore.ts:155-171 已备好）；或至少在 CLI 错误文案里加「移走该文件后重新 `vessel provider set --api-key`」。
- **优先级**：**P1**。

### P2 — 影响真实、概率较高，应安排修

#### R6. 网络失败诊断性差："fetch failed" 丢 cause，与超时/代理问题不可区分
- **证据**：Node fetch 网络错误为 `TypeError: fetch failed`，真实原因在 `err.cause`；`describeProviderError`（providerFactory.ts:125-131）只取 `(err as Error).message`；openai-compatible 路径无 kind 分类 → 用户只见 "fetch failed"。opencode-go 好一些（networkError 带 hint，OpencodeGoProvider.ts:564-571）。
- **触发**：代理没开、base-url 错、DNS 失败、断网。
- **影响**：用户无从判断是「网络/代理/base-url/key」哪一类；`--base-url` 不缺时报错即死。对照 opencode-go 的分类体系（401/429/5xx/网络各有中文行动建议，OpencodeGoProvider.ts:262-285），普通 openai-compatible 是空白。
- **概率**：高（真实用户首次配置必踩）。
- **建议**：给 OpenAICompatibleProvider 加统一的 `classifyHttpError(status, body)`（401→key、429→限流、400→请求/参数、5xx→服务端、AbortError→超时、fetch-网络→cause 提取），并把 `err.cause` 并入展示；`describeProviderError` 对任意 provider 复用同一串提示。
- **优先级**：**P2**。

#### R7. current.json / providers.json 损坏 fail-loud，但 CLI 不指路到 backups/ 回滚
- **证据**：ProviderStore.ts:470-474（current 损坏抛错）、556-559（providers 损坏抛错）；备份机制齐全（ProviderStore.ts:502-529，`~/.vessel/backups/`），但错误文案只给文件路径，从不说「可从 backups/ 拷回」。
- **影响**：用户知道坏了，但不知道能自愈；对非开发者（117 面向的新手）等于死路。
- **概率**：低。
- **建议**：错误文案加一句：`可从 ~/.vessel/backups/ 内最近备份拷回（如 provider 损坏）；current.json 可直接删除（回退 mock）`。
- **优先级**：**P2**。

#### R8. 非 Windows 平台沙箱为 passthrough：硬执法只剩 Policy 层
- **证据**：`packages/runtime/src/sandbox/Sandbox.ts:129-165` `isActive()` 仅 Windows Job Object 为 true；macOS/Linux `confine` 返回 `enforcement:'partial'`，`run()` 仍执行（仅隔离 cwd），status() 诚实上报 `backend:'none'`。
- **影响**：macOS/Linux 上 Shell 类的「进程树整体终止、防 fork-bomb、逃逸终止」不生效；危险命令唯一防线是 Policy Engine 的 pre-execute deny（Executor.ts:33-45，fail-closed，仍然有效），但「工具已放行后的 OS 级收口」缺失。文档化边界（注释已声明），不是静默谎报，属已知取舍；但对要求「硬边界」的产品定位是缺口。
- **概率**：中（跨平台使用场景）。
- **建议**：保持诚实上报（勿改），在架构文档/`vessel run --help` 明示「非 Windows 需依赖 Policy 层」；Linux 至少接 bwrap 或用 `taskkill` 等价物补进程树。属长线。
- **优先级**：**P2**（安全边界完整性）。

#### R9. Shell 工具运行在隔离临时目录而非工作区
- **证据**：`shellTool.ts:67` `sandbox.run(command, [], ...)` 不传 cwd → Sandbox.run 默认 `cwd: isolation.path`（Sandbox.ts:306-309），TMP/TEMP 也被指到隔离目录。
- **影响**：模型 `ls/pwd/cat 相对路径` 时看到的是临时目录而非工作区，可能误判「文件不存在」→ 多轮无谓工具调用（上下文与成本膨胀，呼应 PROJECT-BRIEF 已知的 1.31M token 观察）；用户构造的命令（如读取工作区产物）在隔离目录执行，`pwd` 类结果与预期不符。
- **概率**：高（每次 Shell 调用）。
- **建议**：明确设计意图——若隔离 cwd 是刻意防范，则文档化并在 tool 描述里写清；若否，Shell 应与 fs 工具同一 workspace cwd（隔离仅靠 Job Object 进程树）。至少让描述字段告诉模型「命令在临时隔离目录运行」。
- **优先级**：**P2**。

#### R10. migrate 复制不校验、回收站时序：中断可能造成「部分迁移」
- **证据**：`apps/cli/src/migrate.ts:123-158`：`copyKnownState` 完成后**无复制校验**（count/size/字节比对）即送旧目录进回收站；若复制中途抛错（磁盘满）则异常上抛（不会回收，可重试，安全）；但若复制「静默部分成功」（个别文件被占用未拷？copyFileSync 会抛，故主要是磁盘满在复制中途失败→上抛，实际上安全）。
- **影响**：实际风险低（copyFileSync 失败会抛、不回收），但「复制成功→回收站→用户清空回收站→才发现某文件没拷」的窗口存在（无校验）；且新根已存在时**skip 并保留旧根**，旧根数据不会自动并合。
- **概率**：低。
- **建议**：回收前比对 `copiedCount` 与目标文件存在性；迁移结果写一条迁移日志（时间、条目、校验和）落 `~/.vessel/migrated-<ts>.json`，供事后核对。
- **优先级**：**P2**。

#### R11. DPAPI 读取失败静默返回 null → 「有 key 但读不出」与「没配 key」不可区分
- **证据**：CredentialStore.ts:466-481 `getSync`：backend 标签不符/无熵/Unprotect 失败一律 `return null`（不抛、不 warn）。
- **触发**：secrets.json 被从另一 Windows 用户/机器拷来、熵被改、密文损坏。
- **影响**：`vessel run` 报「缺 key」类失败（401 或 Missing API key），用户以为是自己没配，实际是凭据不可解；白折腾。
- **概率**：中（换机/账号场景）。
- **建议**：Unprotect 失败时区分「条目不存在」与「存在但不可解」（后者抛 CredentialError 或至少 warn 一行「凭据存在但无法解密，可能跨用户/机器，请重新录入」）。
- **优先级**：**P2**。

### P3 — 有影响但影响面小/概率低

- **R12. settings.json 损坏 → guide/settings 命令裸栈（无恢复指引）**：`settings.ts:112-128` load 对损坏/非法值 throw；guideCommands.ts:85/93 无 try；叠加 R1 无顶层 catch → `vessel guide`/`settings list` 裸栈。`settings set` 路径自身有 try（guideCommands.ts:117-124）恢复指引良好。修正 R1 即一并解决。概率低（文件小、写频低）。**P3**（若 R1 落地可关）。
- **R13. settings.json / usage.json 的 tmp 文件名固定（`<file>.tmp`），无防并发**：settings.ts:155-157、UsageStore.ts:523-524。单用户 CLI 场景窗口极小；两个并发进程同时写会互相覆盖（末写者胜，内容各自完整，不会半写）。**P3**。
- **R14. 原子写无 fsync**：全部 writeJsonAtomic/save/settings.set 用 writeFileSync（未 `fsync`，ProviderStore.ts:489、UsageStore.ts:524 等）；断电可能丢最后一条记录（rename 前 crash 最多残留 .tmp，不会半写，原文件完整——这是注释已声明的取舍）。**P3**。
- **R15. `vessel run` 的 mock 兜底路径**：未配置 provider 时静默降级 mock（cli.ts:225、243-255），用户以为跑的是真模型，实际是离线脚本——若用户从未配置成功，得到「假答案」而无显著警告。对新手是隐性误导。**P3**（建议 mock 兜底时打一行「当前为离线 mock」）。
- **R16. 备份轮转的「改名覆盖最旧」在磁盘满时可能损失一个备份槽**：ProviderStore.ts:515-529：rename 成功后若 writeFileSync 失败，最新旧内容可能未写入新名（主文件仍安全，原子写在后）。概率低、影响=备份槽降级。**P3**。
- **R17. pricing.json / model-catalog.json 缺失或损坏 → 静默回退空表/默认价**：pricing.ts:58-72（catch 返回 default-only）、modelCatalog.ts:66-72（catch 存在）。单价可能被静默低估（成本统计失真），无 warn。**P3**（建议损坏时 warn 一行）。
- **R18. setup 向导 429 被归为 network**：setup.ts:135-139 分类只认 401/403/404/405，429 → 'network'，提示错位。**P3**。
- **R19. `askApiKey` 提示文案「明文存 ~/.vessel」过时**：setup.ts:74——Windows 下实为 DPAPI 密文；对新手是错误信息。**P3**。

### P4 — 观察/低优先

- **R20. `settings` 的 locale 只作用于 `vessel guide`**：cmdExplain（guideCommands.ts:42-62）与 TUI `/explain`（chat.ts:307-315）不读 settings，`settings set locale en` 后 explain/词库仍中文——「切换失败」的用户观感（不是故障，是接线不全）。theme 无任何 UI 消费（settings.ts:12-14 自述「展示用偏好」）。**P4**。
- **R21. 词库/引导文案为内建常量（glossary.ts:37-150、guide.ts:19-39），无文件依赖 → 「词库缺失 fallback」风险不存在**（好事）；但新增词条需改码发版，无热更新。**P4**。
- **R22. usage 文件 version 字段未用于实际迁移判定**（UsageStore.ts:513-515 以「有没有 daily 字段」判定 legacy，version 只作声明）。功能正常，但 schema 演进文档应写明。**P4**。

---

## 3. 安全重点专项

### 3.1 密钥（DPAPI / secretRef / 日志泄露）

- **机制**：apiKey 写盘走 `secretRef = credential:vessel/<id>`（ProviderStore.ts:614-625），providers.json 永不落明文；Windows 默认 DPAPI（ProtectedData/CurrentUser，密文 base64 存 `~/.vessel/secrets.json`，带 32B 随机熵）；不可用显式降级 plaintext 并 warn（CredentialStore.ts:634-663）。导出命令默认脱敏、拒绝 `--with-secrets`（cli.ts:549-555）。设计良好。
- **发现的问题**：
  1. **DPAPI 命令行暴露（R3）**：Protect/Unprotect 用 `powershell -Command "…FromBase64String('<b64-key>')…"`——密钥 base64 形式出现在进程命令行，同级进程可读。**机制性缺口**（见 R3 修复建议）。
  2. **错误体回显（R4）**：openai-compatible 把上游错误响应原文 500 字符入错误信息 → 终端；网关如 echo 请求即可见 Authorization。opencode-go 已做剥离（sanitizeWireSnippet），普通协议没做。
  3. **静默不可解（R11）**：DPAPI 解不开 = 静默 null，用户无从得知凭据已失效。
  4. **导出提示正确**：换机需重录 key（DPAPI 绑定 Windows 用户），文档与错误文案均覆盖（cli.ts:551-553、578-579）。
- **好实践确认**：错误信息不含密钥本身（各 provider 都不把 apiKey 打进 message）；对话/会话日志 `session.jsonl`（SessionDir.ts）只记消息与工具活动，无凭据字段（凭据只经 CredentialStore 同步读入内存）。

### 3.2 命令执行

- **执行链**：模型 → AgentLoop → Executor（policy re-check，Executor.ts:33-45，fail-closed）→ Shell 工具 → Sandbox（Windows Job Object 进程树终结 + 隔离目录 + 逃逸检测，Sandbox.ts:244-337）。
- **硬执法覆盖**：Policy Engine 决策序（Engine.ts:31-120）：denied_tools → deny 规则 → ask → allow → profile 比较；`approval:'never'` 时 ask/needsApproval → **服务端 deny**（fail-closed，无法绕过）；Shell 默认 `requiredPermission:'danger-full-access'`（shellTool.ts:46），workspace-write 档下危险命令必被 deny。**Agent 工具调用层的硬执法是真实存在的。**
- **边界（明确声明，符合设计）**：
  1. **CLI 侧「用户自己敲的危险命令」不拦截**——Policy 只约束 agent 的工具调用；用户在自己的终端 `rm` 任何东西、或 `vessel run --permission danger-full-access` 显式放宽，均不受限。这是 dev 工具的设计取舍，但 PRODUCT-BRIEF 的「硬策略边界」叙事下值得在文档里写明「谁保护谁」。
  2. `--policy <任意路径>` 可加载完全放开的策略（cli.ts:261）——开发者自选，正常。
  3. **非 Windows 无 OS 级 sandbox（R8）**：macOS/Linux 下硬执法=仅 Policy 层。
- **注入面**：Shell 执行的是模型生成的命令串（`shell:true` → cmd.exe/sh）；policy 在 execute 前拦，沙箱在 execute 时收口；没有发现「CLI 把用户输入无转义拼进 shell」的路径（migrate 的回收站脚本仅拼接固定 `~/.dsh` 路径并转义单引号，migrate.ts:108-116；DPAPI 仅拼 base64，无注入字符集风险）。
- **If-Match/路径遍历**：本仓库无 HTTP If-Match 语义；`path.join`/`path.resolve` 统一拼接（ProviderStore.ts:188 注释明示 Windows 安全）；`review import/bench-report --input` 读用户指定本地文件（cli.ts:611、1346），路径由用户自己给，无服务端暴露面；local-server 仅绑 127.0.0.1（cli.ts:1312），无远程面。

### 3.3 文件系统

- **原子性**：全部状态文件 tmp+rename（掉电至多残留 .tmp）；Windows rename EPERM/EBUSY 有共享有界重试（3 次 5/15ms，见 ProviderStore.ts:482-491 注释与 shared/renameWithRetry）。
- **备份**：providers/current 写前备份 + 轮转 ≤N 份、轮转**不做删除**（改名复用，ProviderStore.ts:502-529，符合删除铁律）；**secrets.json 无备份**（凭据可重录，可接受）；**usage.json 无备份（R2，数据不可重录，问题）**；settings.json 无备份（小文件可重录，可接受）。
- **删除纪律**：代码内无 `rm`/`unlink` 永久删除路径；migrate 回收站路径明确（Microsoft.VisualBasic → SendToRecycleBin，migrate.ts:101-117）；沙箱隔离目录 dispose 走回收站（Sandbox.ts:36 注释）。

---

## 4. 「引导/设置新增（task 117）」专项结论

新引入的 settings/theme/locale/guide 体系**没有引入新的高危可靠性风险**，但有三点：

1. **settings.json 损坏路径未闭环（R12）**：load() fail-loud 设计合理（不静默吞默认值掩盖用户选择），但对损坏文件用户无恢复路径（无备份、无「删除文件恢复默认」提示），叠加 R1 顶层无兜底 → 裸栈。→ 修复 R1 + 错误文案加「删除该文件将回到默认值」。
2. **locale 接线不全（R20）**：`settings set locale en` 只影响 `vessel guide`；`vessel explain`/TUI 词库不跟随——对「切换失败」的观感是半成品，不应算作完成（对照 PROJECT-BRIEF「引导/解释体系是重要改善」的期待）。
3. **「guide 词库缺失 fallback」风险不存在**：词汇与引导文案全部是内建 TS 常量（glossary.ts、guide.ts），不读盘；不存在文件缺失/损坏路径。guide 命令也先校验 `--locale` 值（guideCommands.ts:79-82），settings.locale 有取值白名单（settings.ts:125-128），非法值 fail-loud 带可选值说明——这部分设计是干净的。

---

## 5. 可恢复性评估（核心路径失败后，用户能否自己恢复）

| 核心路径 | 失败形态 | 用户能否自恢复 | 恢复动作 / 缺口 |
|---|---|---|---|
| `vessel run` 网络失败 | "fetch failed"（无 cause） | ⚠️ 部分 | 凭经验查代理/base-url；缺诊断提示（R6） |
| API key 错误（opencode-go） | 401/429/credits 分类+中文提示 | ✅ 是 | 提示明确（换 key/充值/重试） |
| API key 错误（openai-compatible） | 裸 `HTTP 401 …` 原文 | ⚠️ 部分 | 用户得自己悟「查 key」（R6） |
| run 中途 Ctrl+C | 两段式中断，turn kind=interrupted，TUI 不退出 | ✅ 是 | 会话日志保留，可继续聊（chat.ts:97-126、286） |
| 任务中断/进程被杀 | 会话 jsonl 在 `.harness/sessions/`，turn/end 可能缺失 | ✅ 基本 | 重启 TUI 新 turn；无 resume/handoff 恢复机制（PROJECT-BRIEF 未承诺） |
| 上下文膨胀 | auto-compaction 80% 阈值 + 保尾 16%（compose.ts:333-334） | ✅ 基本 | 极长链仍可能 400（已知 1.31M 观察）；可降低 --max-steps 重跑 |
| Loop 预算用尽 | exhausted 哨兵可查「为什么停」（RunControl.ts:142-153） | ✅ 是 | 调 budget 重跑；pause/resume 不丢半步 |
| providers.json 损坏 | fail-loud 报路径 | ⚠️ 部分 | 可从 backups/ 拷回，但 CLI 不指路（R7） |
| current.json 损坏 | fail-loud 报路径 | ⚠️ 部分 | 删除文件即回 mock；不指路（R7） |
| secrets.json 损坏 | 全命令砖（构造期抛） | ⚠️ 部分 | 手工改名隔离 + 重录 key；无指引（R5） |
| settings.json 损坏 | guide/settings 裸栈 | ⚠️ 弱 | 无指引（R12）；`--locale` 标志可绕过 guide 的 settings 读取 |
| usage.json 损坏 | **静默清零** | ❌ 否 | 数据已丢且无备份（R2） |
| pricing.override.json 损坏 | 空覆盖（文档化容错） | ✅ 是 | 自动，无感知 |
| pricing.json / model-catalog.json 损坏 | 静默回退默认价/空表 | ⚠️ 部分 | 不崩但成本失真（R17） |
| migrate 中断 | 复制抛错→不回收→可重试 | ✅ 是 | 安全；回收后无校验（R10） |
| 端口占用 | EADDRINUSE → 明确提示换 --port | ✅ 是 | cli.ts:1396-1398 |
| 非 TTY 跑 setup | 明确提示改用 provider add | ✅ 是 | cli.ts:822-824 |

---

## 6. 做得好的地方（防回归清单，勿在修复时破坏）

- 原子写 + Windows rename 有界重试全状态文件统一成 `renameWithRetry`（ProviderStore/UsageStore/CredentialStore/SettingsStore 一致）。
- ProviderStore 写前备份 + 「轮转不做删除」的回收站纪律落地（R16 仅边缘）。
- Policy Engine fail-closed（approval=never → deny 服务端判，Engine.ts:97-112）；Executor 对非模型通道也 re-check（Executor.ts:28，POLICY-SPEC §2.3）。
- usage v1→v2/字段演进全部字段级容错 + legacy 标注不猜价（UsageStore.ts:444-518、recompute 幂等 + dry-run）。
- opencode-go 错误分类 + 可操作中文提示是**全项目应推广的样板**（OpencodeGoProvider.ts:262-285）。
- Compaction 平衡切割（tool/call-result 不断对，Compaction.ts:108-121）+ 事务锁；IsolatedRuntime 子代理也接线（IsolatedRuntime.ts:124-134）。
- secrets 损坏隔离改名样板（CredentialStore.ts:155-171）——建议推广给 usage.json（R2）。

---

## 7. 建议排期（P1 快速修复清单）

1. **（R1）** `main()` 加顶层 `.catch` + cmdRun/runChat 构造期入 try —— 一处改动消一类故障。
2. **（R3）** DPAPI 密钥改 stdin/临时方式传入 PowerShell，不落命令行。
3. **（R4）** openai-compatible 错误体脱敏 + 结构化提取（复用 sanitizeWireSnippet）。
4. **（R2）** usage.json 损坏隔离 + warn + 写前备份轮转。
5. **（R5）** defaultStore 默认开启 `recoverCorrupted`（或加恢复文案）。
6. **（R6）** 统一 provider 错误分类提示（借 opencode-go 文案体系覆盖 401/429/网络/超时）。

> 本报告为独立审计产出；修复项建议均不改动 Policy/存储既有语义，仅补「可诊断、可恢复、不丢数据」三件事。