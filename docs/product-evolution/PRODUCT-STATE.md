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

## 纪律

- 并发执行器上限 2；一卡一执行器；删除走回收站；密钥不落盘；测试隔离（`VESSEL_*_ROOT` 注入）。

## 技术债

G-15 原子写 wrapper 各 Store 重复（P4）；architecture 审计的 T1–T9 清单（详见 `docs/product-audit/ARCHITECTURE-REPORT.md`）。

## 风险

- 执行器不稳定（跑 tsc/vitest/tsx 的子代理必中断；跨多文件中等任务亦常败）→ 已确立并**实证有效**的三件套：**写入型微任务（单文件、禁跑命令）+ 指挥跑验证 + 独立静态对抗 Evaluator**。
- 独立 Evaluator：命令型 4 次连败 → 全部改为**静态对抗审查**（新上下文 + 对抗立场 + 附指挥原始证据，报告如实标注"命令未复跑"）。
  **有效性已被证明**：Round 1 抓出 4 项实质缺陷（含指挥自身一处错误结论），Round 2 判 ACCEPT。
- 交付链脆弱：多次出现"执行器写完即中断、交证丢失"——对策：指挥每步 `git` 保命提交 + 亲自复跑验证。
