# PRODUCT-STATE — Vessel 产品演进状态（Orchestrator 维护）

> 每轮结束更新。本轮 = Product Evolution Orchestrator 第 1 轮（Phase 1–8）。
> 相关产物：`docs/PROJECT-BRIEF.md`、`docs/product-audit/*`（4 份独立审计）、`docs/product-evolution/PRODUCT-GAP-MAP.md`、`IMPLEMENTATION-BRIEF-01.md`、`IMPLEMENT-BRIEF-01-STATE.md`、`EVALUATION-BRIEF-01.md`、`EVALUATION-REPORT-01.md`（待）。

## 当前成熟度

| 维度 | 评估 |
|---|---|
| 内部工程成熟度 | **高** — 依赖零环、8 道发布门禁、1225+ 测试、存储层原子写与凭据纪律（审计一致确认） |
| 对外可启动成熟度 | **本轮前：低**（新用户无法自行完成第一次成功使用）；**本轮后：显著改善**（首跑示例可用、未知命令不再静默） |
| 差异化护城河 | **稳固** — Behavior IR + Policy 编译四伪物硬执法、Generator/Evaluator 分离 + review 交接单、供应商管理纵深 + 本地价格库（7 竞品均无持久成本库） |
| 主要短板 | i18n 无统一架构（三套 locale 互不相通）；web 游离 `tsc -b` 图外；CLI 顶层无异常兜底；usage.json 损坏静默丢历史；密钥暴露面（DPAPI 命令行传参） |

## 已解决问题（本轮 NOW 切片）

- **G-01（P0）首跑示例失效**：仓库工作区 `run --prompt` 曾 100% 输出 `(mock: no script entry matched)` 且 exit 0（假成功）。根因：ContextBuilder 将 volatile skills index 作为**最后一条 user 消息**追加，MockProvider 只匹配最后一条 user 消息。修复：`ChatMessage.source` 溯源 + Builder 标记 volatile 为 `environment` + MockProvider 只匹配真实 surface 输入 + 确定性兜底文案。
- **G-02（P0）未知命令静默 run**：`vessel foo`、`vessel chat` 曾静默跑一次 mock 任务并 exit 0。修复：main() 未知子命令 → stderr「未知命令 <x>。可用：vessel --help」+ **exit 2**（实测）。
- **G-14（文案）**：TUI 欢迎语补 `/explain`·`? <术语>`·`vessel guide`（已完成）。**订正**：`cah *` 并非审计误报——指挥早前 PowerShell 检索失效误判，独立 Evaluator 已证伪并定位 `apps/cli/src/providers/setup.ts:7/103/237/268/301`（4 处用户可见文案）→ 列入 FIX 轮（`FIX-BRIEF-01.md` S2）。
- 附带：空工作区/无 README 时给友好提示，不再把裸 `TOOL_FAILURE` 当"最终回复"。

验收侧证据（Orchestrator）：`tsc -b` exit 0；`vitest` **114 文件 / 1235 passed + 1 skipped / exit 0**（基线 1220+1 → 本轮 +15 用例）；CLI 冒烟 6 项 E2E 全通过（含**带参数已知命令** `explain 小小蜜` / `provider list` / `settings list` 均 exit 0，证明未知命令分支未过度拦截）；`source` 经查不进入任何真实 provider 请求体（三路均显式挑字段）。
**独立 Evaluator 裁定：ACCEPT**（Round 1 全静态 → **REJECT**（S1–S4）→ FIX 轮 → Round 2 全静态 → **ACCEPT**，逐项行号证据见 `EVALUATION-REPORT-01.md` / `EVALUATION-REPORT-02.md`）。

## 仍存在缺口（按路线图）

- **NEXT（低成本高价值，建议下一轮 NOW）**：G-03 CLI 顶层 `main()` 无 catch（配置损坏即裸栈崩溃、无恢复指引）；G-07 `apps/web` 游离 `tsc -b` 图外（类型错误可静默过 8 道门禁）；G-12 `apps/cli/tsconfig.json` 缺 `local-server` reference（干净 clone 构建顺序脆弱）；G-09 TUI 会话内成本可见性（数据已采集只缺展示，直击 deepseek-flash 成本波动痛点）。
- **LATER**：G-04 usage.json 损坏静默清零 + 无备份轮转（数据丢失类）；G-05 密钥暴露面（DPAPI 经 PowerShell 命令行传密钥 ×  openai-compatible 错误体回显 500 字符 ×  secrets 损坏默认不恢复）；G-10 会话续跑 + 会话级快照回滚；G-11 CLI 面 MCP 配置命令 + 通用 JSON 出口；G-13 TUI/CLI 命令面不一致、`/permission` 不持久、theme 无消费者。
- **NOT_NOW（主动拒绝）**：G-06 全量 i18n 改造（成本≈全量改造、当前用户仅中英）；G-08 `~/.vessel` 状态根 7 处重复的重构（可小步缓行）；G-15 原子写 wrapper 重复（P4）；竞品形态追逐（插件市场 / 消息平台 / 云协作 / 大众榜单 / IDE·桌面表面）——竞品审计已逐条论证不做。

## 新发现问题（本轮过程中）

1. **提交者把 WIP 交证落盘的链条很脆**：连续 3 个 Implementer 在"读文件/跑命令"阶段失败（本环境子代理执行长命令会中断）→ 应对：改用**写入型窄任务**（禁跑命令）+ 由指挥跑验证 + 保命 WIP 提交。
2. **第 4 轮 Implementer 引入语法回归**（模板字符串内嵌反引号 → TS1005，连带两个测试套件 transform 失败）——被验收侧复跑即时捕获，FIX 阶段修复。**教训：写入型执行器虽能完成，但必须强制验收侧复跑 tsc/测试**（否则该回归会静默进主干）。
3. **"未检索到" ≠ "不存在"**：G-14 的 `cah *` **属实**（`setup.ts` 4 处用户可见文案）——我最初用 PowerShell `Get-ChildItem -Include` 组合检索返回空，据此误判"审计误报"并写进状态文件，被独立 Evaluator 证伪。教训：核验一律用 ripgrep 类工具，并复核检索式本身是否有效。
4. **N4（Round-2 提出，建议下一轮小卡）**：`ChatMessage.source` 仍是裸 `string`、`INJECTED_MESSAGE_SOURCES` 手写集合 → 未来新增注入源会**静默退化**（无人报错）。建议：收窄为联合类型，或加"漂移守卫"测试（断言 events 联合里的注入类 source 全部在集合内）。
5. **N5（低危）**：`MockProvider.ts:47-52` / `Builder.ts:47-48` 注释仍只列举 4 个 source（实际 7 个）。
6. **N2 文档-命令漂移**：`vessel chat` 已不再是入口（现 exit 2），但有 3 份文档仍当它作 TUI 入口——本轮已修 `PROVIDER-MANAGEMENT.md`（3 处）、`REAL-MODEL-LANE.md`（3 处）、`PROJECT-BRIEF.md`（2 处）→ 建议后续把"文档命令一致性"纳入发布门禁或加一条 grep 检查。
7. **偶发**：全量 vitest 有一次 exit 1 但仅伴随 "unhandled errors" 警告（测试全过），复跑 exit 0 —— 记为观察项，非本轮改动引入。

## 当前最高价值下一步

按 NEXT 组选**下一轮 NOW 切片**：优先 **G-03（CLI 顶层异常兜底）**——它是本轮 G-02 的自然延伸（同一处入口），一次改动消除"配置损坏 → 裸栈崩溃、无恢复指引"这一整类用户可见故障；可与 **G-12（tsconfig 补边，极低成本）** 合为一个小切片；若还有余量，顺手做 **N4 漂移守卫测试**（断言 events 联合里的注入类 source 全部在 `INJECTED_MESSAGE_SOURCES` 内，防止未来新增注入源静默退化）。

## Round 2（G-03 / G-12 / G-16）— 已闭环

**交付**：`apps/cli/src/startupError.ts`（纯函数：4 类判定 + 路径提取 + 恢复指引）＋ `apps/cli/src/cli.ts` 入口 `.catch` → 人话 + **exit 1**；`apps/cli/tsconfig.json` 补 local-server 构建边；`packages/shared/src/events.ts` 新增运行时事实源 `MESSAGE_SOURCES`（`MessageSource` 类型由此派生）＋ 漂移守卫测试 3 例；`startupError.test.ts` 10 例。

**验收侧证据（指挥 E2E，非实现者自证）**：`tsc 0`；`vitest` **116 文件 / 1248 passed + 1 skipped / exit 0**；崩溃面 E2E 双例（写坏 `settings.json` / `providers.json`）→「配置文件损坏 + 涉及文件（路径干净收尾）+ 恢复指引」+ **exit 1** + 无裸栈行；带参数已知命令（`explain 小小蜜`/`provider list`/`settings list`）零回归。

**独立裁定**：`EVALUATION-REPORT-03.md` **ACCEPT（7/7 必查点）**；`EVALUATION-REPORT-03-RECHECK.md` **ACCEPT（A–D）**，并给出判别力推演（回退正则后首个红灯为 `startupError.test.ts:146`）。

**本轮由"验证"而非"实现者自证"捕获的 3 个缺陷**：
1. `startupError.ts` JSDoc 内 `**/` 提前闭合块注释 → esbuild `Unexpected "*"`，**整个 CLI 无法运行**；
2. `涉及文件：` 行尾残留全角 `）:`；
3. 上述"修复"**实际未生效**——真根因是字符类内 `]` 未转义（正则永不匹配），需读实现才定位。
   **教训**：执行器报"完成"与功能"生效"是两件事；**指挥 E2E + 读码定位 + 判别性断言**三者缺一不可。

**残留（→ Round 3 候选）**：
- **N1（P2，建议首选）**：「坏配置 → exit 1 + 路径 + 指引」这条**用户可见契约无自动化测试**（删掉 `.catch` 不变红）→ 补 `cli.crashSurface.test.ts`（in-process 断言 `main()` reject + `describeStartupFailure` 渲染，避开子进程 EPERM）。
- **N2（P3）**：分类探测用裸 `/JSON/i` → 目录名含 "json" 的 ENOENT 会被误判为"配置文件损坏"。
- **N3（P3）**：内容类错误（格式非法 / theme 非法值）落 `unknown`，指引偏弱。
- **N4（P3）**：未复用 `describeProviderError`（丢掉 opencode-go 的 hint）；unknown 分支不再保留 stack。
- **N5（P3，跨轮）**：`ChatMessage.source` 仍为裸 `string`（守卫只覆盖"联合→集合"一条边）→ 建议收窄为 `MessageSource | 'environment'`。
- **LOW**：路径清洗会截断以 `]`/`）` 结尾的**真实**路径（仅影响展示文案）。

## Round 3（N1 / N2 / N5）— 已闭环

**交付**：`apps/cli/src/cli.crashSurface.test.ts`（新，3 例：坏 `settings.json` / 坏 `providers.json` → `main()` reject 且渲染含路径+`vessel setup`+无 stack；干净对照 → resolve 0）；`startupError.ts` N2（判定顺序 ENOENT→file-missing 最优先、`CONFIG_CORRUPTED_RE` 收紧为精确 JSON 签名**并补** `invalid JSON|corrupted` 以覆盖 ProviderStore 措辞）；`packages/shared/src/provider.ts` N5（`source?: MessageSource | 'environment'`）；`messageSources.test.ts` 双向全等守卫；`MockProvider.test.ts` 类型化适配。

**验收侧证据（指挥 E2E + 全量）**：`tsc 0`；`vitest` **117 文件 / 1255 passed + 1 skipped / exit 0**；崩溃面 E2E：坏 `settings.json` →「配置文件损坏 + 干净路径 + 指引」exit 1；坏 `providers.json` → 同样（修复前曾退化为 unknown）；干净对照 exit 0；无裸栈行。

**独立裁定**：`EVALUATION-REPORT-04.md` **ACCEPT**（5 点中 1–4 通过，第 5 点为 P3 文档残留）。

**本轮由验证（非实现者自证）捕获的问题**：
1. N5 类型收窄**立刻**让 `tsc` 变红（`MockProvider.test.ts:96` 传裸 `string`）——证明收窄有效；
2. **N2 副作用**：ProviderStore 措辞被判 `unknown`（新增的 N1 用例②恰好变红把它暴露）→ 补 `invalid JSON|corrupted` 修；
3. 修正则的执行器报"失败"实为**写完即死**（文件已改）→ 坚持"核验文件而非采信回报"；
4. 想用 `Remove-Item` 清临时文件被**全局铁律拦截**（删除必须走回收站）→ 改用"另建干净 root" 做对照，零删除。

**残留 P3（均非阻断）**：① `provider.ts` 的 `source` JSDoc 仍把 `steer` 写成注入来源、漏 plan/handoff/inject；② 裸 `corrupted`/`invalid JSON` 关键词仍有极窄反向误报面（建议与 file/config/`.json` 同现）；③ `cli.crashSurface.test.ts` 干净对照用例不封"分类漂移"（该哨兵在 `startupError.test.ts`）；④ 路径清洗会截断以 `]`/`）` 结尾的真实路径（仅展示）；⑤ 内容类错误（格式非法/theme 非法值）落 `unknown`，指引偏弱；⑥ 未复用 `describeProviderError`（丢 opencode-go hint），unknown 分支不留 stack。

## Round 4（G-07：web 拉进类型门禁）— 已闭环

**交付**：`apps/web/package.json` 增 `typecheck`；`gates.ts` Gate1 现同时跑根 `tsc -b` 与 `tsc -p apps/web/tsconfig.json`，判定抽为纯函数 `judgeBuildPair`；criterion 文案与 `docs/RELEASE-GATES.md` 同步；web 侧探测失败**显式 pending**（不静默通过）。

**判别性 E2E（决定性证据）**：注入 `apps/web/src/__probe_bad.ts`（类型错误）→ **根 `tsc -b` 仍 exit 0**（证明 web 原本在门禁视野外），而 **build 门禁 verdict=fail**（`web tsc exit=2`）；清理后回 `pass`。**独立裁定 `EVALUATION-REPORT-05.md`：ACCEPT**。

## Round 5（G-04：用量数据不再静默丢失）— 已闭环（含 P2 补修）

**交付**：`UsageStore.quarantineCorrupted()`（损坏 → 改名 `<file>.corrupted-<ts>[-N]` 留档 + `console.warn` + 空表继续）、`backupKeepOpt` + `resolveBackupKeep()`（**opts > `VESSEL_USAGE_BACKUP_KEEP` > 默认 5**）、`backupBeforeWrite()`（`backups/usage.<ts>.json`，超限改名+覆盖最旧，**零删除**，失败只 warn）、`save()` 中调用；新增 5 例恢复测试。**P2 补修**：`load()` 读失败按 `err.code` 分流（ENOENT 静默 / 其它 code warn + `suppressWrite`）、隔离名唯一化、rename 失败置 `suppressWrite`、`save()` 开头抑制检查。

**验收侧证据（指挥真实 CLI E2E）**：损坏 `usage.json`（`{oops`）→ `vessel usage` 打出「已隔离为 …\`usage.json.corrupted-<epochMs>\`（内容保留，未删除）」、exit 0、目录仅剩隔离文件且内容 = `{oops`；连跑 3 次 → `backups/` **5** 份（默认上限）；`KEEP=0` → 不建 backups 目录。全量 **120 文件 / 1271 passed + 1 skipped / exit 0**、`tsc 0`。独立裁定 `EVALUATION-REPORT-06.md`：**ACCEPT**（两项 P2 已补修，交 Round 5b 复核）。

## Round 6（G-05a：密钥不进命令行 + secrets 损坏默认可恢复）— 实现完成，评审在途

- **密钥不再进 argv**：`dpapiProtect/dpapiUnprotect` 改为固定脚本 + `$o = $input | ConvertFrom-Json`，材料只经 `execFileSync(..., { input })` 走 **stdin**（`CredentialStore.ts:342/363`）。
- **secrets 损坏默认可恢复**：`defaultStore` 传 `recoverCorrupted: true`；并补上 **DPAPI 构造期路径**的漏转发（`CredentialStore.ts:449` → `readSecretsFile(this.secretsFile, { recover: this.recoverCorrupted })`，`readSecretsFile` 三处现已全部转发）；库层默认仍 fail-loud，显式 `false` 语义不变。
- **测试**：新增 `dpapiArgv.test.ts`（4 例：argv 无材料 / 材料只在 `input` / probe 双调用 / **真实 ProtectedData 往返**）与 `defaultStore.recovery.test.ts`（4 例：默认可恢复 / 恢复后仍可用 / 显式 false 仍抛 / ENOENT 不误伤）。
- **本轮由验证捕获的硬缺陷**（3 项）：① stdin 第一版用 `[Console]::In.ReadToEnd()` 使真实 DPAPI 往返 **5 例红**，探针实测该形态 `spawnSync EPERM`、`$input` 成功 → 改形态；② DPAPI **构造期**漏转发 `recoverCorrupted`（R5 残留，由测试作者独立发现）；③ 新测试用例②因 seed 占用 `id:'ds'` 报 duplicate（测试缺陷，非实现）。
- **行为证据（真实 CLI）**：损坏 `secrets.json` → 「[credential] secrets 文件损坏（invalid JSON …）已隔离备份到 `<tmp>\secrets.json.corrupted-<epochMs>`，凭据被重置为空；请核对后重建。」+ `provider list` **exit 0**（此前硬抛、CLI 全灭）+ 隔离文件内容 = `{oops`。
- 下一轮候选：**错误体回显脱敏**（R4：`OpenAICompatibleProvider` 回显 500 字符原文，建议复用 OpencodeGo 的 `sanitizeWireSnippet` 口径）；其后 G-09（TUI 成本可见性）、G-10/G-11/G-13。

## Round 7（G-05b：错误体回显脱敏）— 已闭环

**交付**：`packages/llm/src/provider/errorBody.ts`（`sanitizeErrorBody`：复用 `sanitizeWireSnippet` 剥 URL/压空白/截断 + 遮蔽 `sk-…`/`Bearer …`/JSON 的 `api_key|authorization|token`）；`OpenAICompatibleProvider:120/195`、`AnthropicProvider:227/318` 四处回显改造；`errorBody.test.ts` 7 例。

**验收侧证据**：`tsc 0`；**121 文件 / 1280 passed + 1 skipped / exit 0**；**判别性 E2E**：本地假 provider 回 401（体内含 `sk-live-abcdef1234567890` 与 `api.internal.example.com`）→ 两 provider 抛出的 message 均为 `…: {"error":{"message":"invalid api key sk-<redacted> — see <url>`，`leaksKey=false leaksUrl=false`。

**独立裁定 `EVALUATION-REPORT-08.md`：ACCEPT（0 必修项）**。新发现 4 项 P3（主题同一，留作下一小切片）：① 截断先于遮蔽 → 恰好跨 240 边界的 key 会残留 ≤5 字符片段（建议 mask-then-truncate）；② `OpencodeGoProvider.ts:214` 的 detail 只走 `sanitizeWireSnippet`、**不遮密钥**；③ HTTP 200 带 error 体时 `OpenAICompatibleProvider:125`/`AnthropicProvider:232` 仍原样回显 `body.error.message`；④ 非 `sk-` 形态（`gsk_`/`AIza`/`hf_`）在自由文本里不遮。另确认 Round 6 遗留 P3 属实：`dpapiArgv.test.ts` 未断言脚本含 `$input`。

## Round 8（G-09：TUI 会话内成本可见性）— 实现中

- 目标：`/cost`（别名 `/usage`）命令 + 每回合一行成本增量；`vessel usage` 标题不再硬编码 `~/.vessel`（展示与实际一致）。
- 设计要点：`UsageStore` 由 `cli.ts` TUI 入口注入（`cli.ts` 第 280 行已有同款用法），**未注入时全部成本显示静默关闭**（回归保护）。
- 状态：两件实现卡首轮均未落盘，已重派。

## 纪律

- 并发执行器上限 2；一卡一执行器；删除走回收站；密钥不落盘；测试隔离（`VESSEL_*_ROOT` 注入）。

## 技术债

G-15 原子写 wrapper 各 Store 重复（P4）；architecture 审计的 T1–T9 清单（详见 `docs/product-audit/ARCHITECTURE-REPORT.md`）。

## 风险

- 执行器不稳定（跑 tsc/vitest/tsx 的子代理必中断；跨多文件中等任务亦常败）→ 已确立并**实证有效**的三件套：**写入型微任务（单文件、禁跑命令）+ 指挥跑验证 + 独立静态对抗 Evaluator**。
- 独立 Evaluator：命令型 4 次连败 → 全部改为**静态对抗审查**（新上下文 + 对抗立场 + 附指挥原始证据，报告如实标注"命令未复跑"）。
  **有效性已被证明**：Round 1 抓出 4 项实质缺陷（含指挥自身一处错误结论），Round 2 判 ACCEPT。
- 交付链脆弱：多次出现"执行器写完即中断、交证丢失"——对策：指挥每步 `git` 保命提交 + 亲自复跑验证。
