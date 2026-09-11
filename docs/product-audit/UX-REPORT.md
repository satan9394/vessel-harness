# Vessel (Composable Agent Harness) — 独立 UX 审计报告

> 审计角色：PRODUCT_UX_AUDITOR（独立 Subagent）
> 审计视角：一个**完全不了解 Vessel / 小小蜜 / Agent Harness** 的新用户
> 审计日期：2026-09 · 审计基线：`v0.10.0`（`apps/cli` dist 编译产物 + src 同源）
> 依据：`docs/PROJECT-BRIEF.md` + 仓库源码 + **实跑 CLI 命令实测**（Windows / PowerShell / Node v24，`npx tsx apps/cli/src/cli.ts`）
> 范围：首次安装 / 首次启动 / Onboarding / 语言 / 主题 / 导航 / 功能发现 / 默认配置 / 设置 / 核心用户路径（run / chat / provider / pricing / usage / guide）/ 错误反馈 / 空状态 / 学习成本 / 恢复 / 升级
> 约束：只读 + 实跑；未修改任何代码；未触碰真实 `~/.vessel`（所有写命令均在临时隔离 root 下执行）

---

## 0. 结论总览（TL;DR）

**一个完全不了解 Vessel 的人，无法靠自己完成第一次成功使用。** 三个致命点叠加：

1. **默认 mock 冒烟演示在仓库工作区 100% 失效** —— README「快速开始」里唯一一条可复制的示例命令，
   实测输出 `(mock: no script entry matched)` 且 **exit 0**（假装成功）。
2. **未知/拼错的命令会被静默当成一次 run 执行**（exit 0）—— 包括 PROJECT-BRIEF 声称的 TUI 入口 `vessel chat`。
   打错命令永远不报错，只会跑一次无意义任务。
3. **设置体系名不副实** —— `settings set theme` 没有任何 UI 消费（CLI 无颜色、Web 跟随系统）；
   `settings set locale en` 只影响 `vessel guide`，`vessel explain` 与 TUI 解释仍写死中文，
   但成功提示文案宣称「guide/解释输出语言已切换」。

刚加的中英双语引导词库（`explain / list-terms / guide` 与 TUI `? <term>` / `/explain`）本身质量高、
能自启动（全部实测通过），但它**不在关键路径上**：首次 `run` 没有任何指针引导用户去 `guide`；
TUI 欢迎语只提 `/help` 与 `/quit`，不提 `/explain` / `? <term>` / `setup` / `guide`。

问题清单：**11 项**（P0×2、P1×2、P2×3、P3×3、P4×1），详见第 1~5 节；正面发现见第 6 节；环境与复现备注见第 7 节。

---

## 1. P0 —— 阻断首次成功，必须修复

### 1.1 默认 mock 冒烟演示在仓库工作区永远不命中 → README 首条示例命令产出无效结果

**问题**：README「快速开始④」的示例 `vessel run --prompt "总结当前工作区 README"`（无配置、走默认 mock）
实测输出只有 `(mock: no script entry matched)`，**exit 0**。新用户复制的第一条命令即失败（且不报错）。

**证据（实测）**：
```
$ npx tsx apps/cli/src/cli.ts run --prompt "总结当前工作区 README"
=== 最终回复 ===
(mock: no script entry matched)
=== turn turn_... kind=success steps=1 toolCalls=0 ===
[exit: 0]
```
对照组（空工作区，同一条命令路径）：
```
$ npx tsx apps/cli/src/cli.ts run --workspace <空目录> --prompt "read README"
=== 最终回复 ===
已通过 Read 工具读取工作区文件。内容开头：
[TOOL_FAILURE] read failed: ENOENT: ...README.md
[exit: 0]   # steps=2 toolCalls=1 —— mock 脚本在空工作区是能命中的
```
仓库内与仓库外行为不一致 → 根因成立。

**根因（源码）**：`ContextBuilder.assemble()` 把 volatile skills index 作为 **最后一条 user 消息**
追加在用户输入之后（`packages/context/src/builder/Builder.ts:154-161`）；而 `MockProvider` 只拿
**最后一条 user 消息**做脚本匹配（`packages/llm/src/provider/MockProvider.ts:53-55,60-66`）。
仓库工作区存在 skills index → 最后 user 消息变成 `[环境] <skills index>`，`when: /阅读|read|总结|summary/i`
永远命中不了。测试全绿是因为测试注入的是**无 skills 的临时工作区**（`apps/cli/src/tui/chat.test.ts:215-248`
注释明说 "the mock smoke script answers read/summary"）—— 线上首次运行场景被测试环境掩盖。

**影响**：无配置用户的「第一次成功」= 得到一坨无意义文本 + exit 0；TUI（无参 `vessel`）同源使用同一份
冒烟脚本 + composeHarness，同样失效。README 承诺的「离线确定性冒烟」名存实亡。

**建议**：mock 匹配应跳过 volatile/instruction/memory 等注入型 user 消息（只匹配真实 `surface` 用户输入，
或把这些注入消息的 role 改为 `system`）；或把 CLI 冒烟脚本的 `when` 兜底放宽（任一输入都有确定性应答）；
并在空工作区 README 不存在的场景做友好提示（当前把 `TOOL_FAILURE` 原样当"最终回复"也不够新手友好）。

### 1.2 未知/拼错子命令被静默当作 run 执行（exit 0）—— 含文档声称的 TUI 入口 `vessel chat`

**问题**：任意不认识的第一参数都会落到 `cmdRun`，静默跑一次 mock 任务并以 **exit 0** 结束；
从不提示「未知命令」。

**证据（实测）**：
```
$ npx tsx apps/cli/src/cli.ts foo
=== 最终回复 ===
(mock: no script entry matched)
[exit: 0]

$ npx tsx apps/cli/src/cli.ts chat      # PROJECT-BRIEF.md:52 声称 TUI 入口是 vessel chat
=== 最终回复 ===
(mock: no script entry matched)
[exit: 0]
```

**根因（源码）**：`main()` 对未识别子命令没有分支，直接落入 `switch(parsed.command)` 的 `case 'run'`
（`apps/cli/src/cli.ts:1466-1510`；`parseArgs` 默认 `command='run'`，cli.ts:118）。

**影响**：
- 新用户打 `vessel provder list` / `vessel sttings` 等拼错命令 → 不报错，反而「成功」exit 0；
- `PROJECT-BRIEF.md` 声称的 TUI 入口 `vessel chat` 实际是一条静默 run（TUI 真实入口是**无参** `vessel`）——
  文档指引与实现不一致，直接误导（另见 3.3）。

**建议**：`main()` 增加未知子命令分支：打印 `未知命令 "<x>"（vessel --help 查看）` 到 stderr，exit 2；
同步修正 `docs/PROJECT-BRIEF.md` 的 TUI 入口描述。

---

## 2. P1 —— 高影响，严重损害信任与新手引导

### 2.1 设置体系名不副实：theme 无任何 UI 消费；locale 只影响 guide（explain/TUI 写死中文）

**问题**：新用户按引导执行 `settings set theme light` / `settings set locale en` 后**看不到任何变化**，
且成功文案宣称已生效。

**证据（实测 + 源码）**：
```
$ npx tsx apps/cli/src/cli.ts settings set theme light
✔ 已设置 theme = light（浅色）
  主题已设为 浅色（light）（展示偏好，UI 换肤由 UI 层消费）。   # 提示本身就承认"未真正换肤"
[exit: 0]

$ npx tsx apps/cli/src/cli.ts settings set locale en
✔ 已设置 locale = en（English（英文））
  guide/解释输出语言已切换：vessel guide 现在用 English。        # 只对 guide 生效，见下
[exit: 0]

$ npx tsx apps/cli/src/cli.ts explain call   # locale=en 已持久化，explain 仍是中文输出
=== 术语解释: Call ===
中文解释: 一次工具调用：...
```
- `SettingsStore` 的消费方**仅有 guide 命令族**（grep 全仓：`apps/cli/src/guide/*`）；CLI 全输出无任何 ANSI 颜色
  （grep `picocolors|chalk|\x1b` 于 `apps/cli/src` 无命中）；Web 遵循 `docs/UI-THEME.md`「跟随系统、不做手动切换」。
- `cmdExplain` 调 `renderExplain(entry)` 写死默认 zh（`apps/cli/src/guide/guideCommands.ts:60`）；
  TUI 解释同样写死 zh（`apps/cli/src/tui/chat.ts:313` `renderExplain(hit)`）—— 都不读 settings locale。
- Web 有自己的语言体系（localStorage `vessel.ui.lang`，`apps/web/src/i18n.ts:19`），与 CLI settings 完全割裂。

**影响**：首个「设置」体验 = 设置成功但无任何变化 → 用户怀疑功能坏了或以为自己操作错；
locale 文案承诺「解释输出语言已切换」与事实不符（`vessel explain` 永远中文）。

**建议**：二选一 ——（a）真正接线：`explain`/TUI 解释读取 settings locale；CLI 输出按 theme 渲染（或未来 Web 消费）；
（b）文案诚实化并在 `settings list` 标注「当前版本仅存储、未作用于渲染」，避免引导用户做无用操作。
默认值也与 `docs/UI-THEME.md`（Web 浅色默认）不一致（CLI 默认 dark）。

### 2.2 供应商配置向导仍在教用户过时命令 `cah *`

**问题**：首次配供应商的交互向导（`vessel setup` 与 TUI `/provider`）在成功/失败提示里引导用户使用
**已不存在的 `cah` 命令**（V0.9 已彻底移除 `cah` 别名，见 `CHANGELOG.md` 0.9.0 与 `docs/VESSEL.md:4`）。

**证据（源码）**：`apps/cli/src/providers/setup.ts`
- L103：`把 "${id}" 设为当前默认供应商？（cah run 立即使用）`
- L237：`多次尝试后 API Key 仍无效。可稍后用 cah provider add / cah models 再试。`
- L268：总结屏 `作用域: ~/.vessel（影响本机所有 cah run）`

**影响**：新用户在向导里被教唆输入 `cah …`，命令不存在 → 叠加 1.2 的静默 run 陷阱（`cah run` 会被当成
未知命令静默跑一次），双重迷惑。

**建议**：三处全部改为 `vessel …`；向导在编译期/测试里加防回归断言（禁止 `cah` 字样进入用户可见文案）。

---

## 3. P2 —— 中等影响，功能发现与文档一致性问题

### 3.1 TUI `/model <id>` 与 `/permission <mode>` 只打印成功文案，实际不生效（假成功）

**问题**：TUI 里执行 `/model deepseek-chat` 或 `/permission read-only` 会输出「已切换（会话内生效）」，
但会话的模型与权限**没有变化**：`runChat` 对斜杠命令只打印返回值然后 `continue`
（`apps/cli/src/tui/chat.ts:271-276`），`dispatchSlash` 的 `/model`、`/permission` 分支仅返回提示文本
（chat.ts:357-364），不更新任何状态、不重建 harness；提示行 `providerId/model [permission]` 在 /model 后
仍显示旧模型 —— 用户会看到"没变"却被告知"已切换"。

**影响**：新用户用 TUI 斜杠命令调整模型/权限 → 静默无效，后续 run 用错模型/权限，排查困难。

**建议**：落地实现（改 model 变量 + 重建 harness）或诚实化文案（「暂未生效，请用 /provider 重配」），
并补一个 UI 断言（/model 后提示行模型名变化）。

### 3.2 引导体系发现路径仍然偏深；TUI 的 `? <term>` 与自然语言发生抢占

**问题**：
1. TUI 欢迎语（chat.ts:261）只说 `输入 /help 查看命令，/quit 退出`，未指向本次引导体系核心
   `/explain` / `? <term>` / `setup` / `guide` —— 新用户必须先知道 `/help`。
2. 任何以半角 `?` **开头**的输入都被当作术语查询（chat.ts:271,307-315），例如自然语言
   `? 请总结一下` 会被查词失败；而全角 `？`（中文用户更常用）不会被劫持 —— 行为不一致，难以预测。

**证据**：`input.startsWith('?') → dispatchSlash → findTerm(raw)`；`? 请总结一下` → `未收录术语 "请总结一下"`。

**建议**：欢迎语与首次交互提示增加 `（输入 ? <术语> 可查解释，/help 查看全部命令）`；
`?` 触发改成「`?` 后跟随已知词条才走词库，否则回退自然语言」或要求 `? ` 后为无空格的术语键。

### 3.3 用户文档与实现不一致（按文档自启动的障碍）

| 文档 | 位置 | 内容 | 事实（实测/源码） |
|---|---|---|---|
| `docs/PROJECT-BRIEF.md` | L52 | TUI 入口 `vessel chat` | `vessel chat` 是静默 run（exit 0）；TUI 真实入口是无参 `vessel` |
| `docs/PROVIDER-MANAGEMENT.md` | §1 L11 | 配置存 `~/.dsh/providers.json` | 已迁移 `~/.vessel/providers.json`（同文档 §2 才写对） |
| `docs/VESSEL.md` | §一·五 L47 | 「当前 285 绿」 | 现 1200+ 测试 |
| `apps/cli/package.json` | bin `dist/cli.js` | （运行依赖） | `npm link ./apps/cli` 前必须先 `npm run build`，README 已提示，但首次 npm install 后直接 `npm link` 会得到不存在的命令 |

**影响**：新用户按 briefing/文档复制的入口命令无效或行为与描述不符，排查成本高。

**建议**：统一校正文档；给 `vessel chat` 加显式别名（进 TUI）或显式报错，消除「文档入口静默跑 run」的坑。

---

## 4. P3 —— 低-中影响，体验粗糙点

### 4.1 `vessel pricing deepseek-chat` 查不到 README 示例模型

**问题**：README 快速开始用 `--model deepseek-chat`（DeepSeek 官方 API 模型名），但
`vessel pricing deepseek-chat` 实测 `未找到模型 "deepseek-chat" 的目录条目`（exit 1）；
`configs/model-catalog.json` 里是 `deepseek-v4-flash / deepseek-v4-pro` 等（目录名与 README 示例错位）。

**建议**：README 示例改用目录内存在并命中的模型名（或目录补充 README 所用模型），保证「照着文档做」能闭环。

### 4.2 settings.json 损坏（用户手改）→ `vessel guide` / `settings list` 未捕获异常直接崩

**证据（源码）**：`guideCommands.ts` 的 `cmdGuide` / `cmdSettingsList` 直接调
`settingsStoreFor(opts).load()`，无 try/catch；`settings.ts:112-117` 对损坏文件刻意 `throw`；
`cmdSettingsSet` 反而有 try/catch（友好）。用户手改 `~/.vessel/settings.json` 写坏后，
`vessel guide` 与 `settings list` 会以未捕获异常崩溃（其他命令不受影响）。

**建议**：guide/settings 读取统一走「损坏 → 打印修复指引 + 回退默认值」或至少 catch 后友好报错。

### 4.3 `explain` 未收录词条：提示走 stdout 且 exit 2

**证据（实测）**：`vessel explain nosuchterm` → `未收录术语 "nosuchterm"。试试: vessel list-terms ...`
出现在 **stdout**（`guideCommands.ts:57` 用 `log` 而非 `error`），exit 2。错误反馈应走 stderr，
避免管道/脚本把错误文本当正常输出。

---

## 5. P4 —— 打磨项

### 5.1 `list-terms` 中文解释被截断 30 字符且无省略标记

**证据**：`glossary.ts:206` `e.zh.slice(0, 30)`，实测输出如 `一次工具调用：Harness 判断该调用某个工具（Read/`（戛然而止）。
建议加 `…` 或改为换行完整输出。

### 5.2 TUI 提示行对新手不可读

`mock/mock-model [workspace-write]> `（chat.ts:265）对完全新手无任何说明（mock 是什么？workspace-write 是什么？）。
欢迎语已提示 `/help`，但一行行的「黑话」仍是学习成本；可在首次进入 mock 模式时追加一行
`（当前为离线 mock，未配置真实模型；/provider 或 vessel setup 配置后再试）`。

---

## 6. 正面发现（做得好的，建议保持）

1. `vessel --help` 覆盖全部命令族，中文为主、结构清晰（实测完整输出）。
2. 中英双语词库本身质量高、可自启动：`vessel explain 小小蜜 / Call / locale / theme`、`vessel list-terms`
   （14 条）、`vessel guide`、`vessel guide --locale en`、settings 持久化闭环 **全部实测通过**，
   错误提示（未收录词 / 非法 locale / 非法设置值）均给出可操作的下一步。
3. 非 TTY 降级体验好：`vessel setup` 无终端时提示命令行替代方案；无参 `vessel` 无终端时提示
   `run --prompt` / `setup`；exit 2 语义正确。
4. `vessel usage` 空状态可读（全部 0 + 供应商/模型合计），无 NaN/空屏。
5. 存储设计克制：settings 原子写、环境变量隔离（`VESSEL_SETTINGS_ROOT` > `VESSEL_USAGE_ROOT` > `~/.vessel`）、
   损坏 fail loud 有意图与测试覆盖（尽管 4.2 的落地处理缺失）。
6. `vessel provider switch nope` 等错误路径 exit 1 + stderr 提示，语义基本正确。

---

## 7. 审计方法 / 环境备注（复现与可信度说明）

- 环境：Windows / PowerShell / Node v24.14.0；命令均以 `npx tsx apps/cli/src/cli.ts <cmd>` 直跑。
  首批命令曾因本审计用的 PowerShell 包装函数参数解析问题（把整串参数当一个参数传入）误显示为"子命令被吞"，
  直接裸跑后确认为包装函数问题，非产品缺陷 —— 报告内所有结论均以**裸跑实测**或**源码行号**为准。
- 写路径全部隔离：`VESSEL_PROVIDER_ROOT / VESSEL_USAGE_ROOT / VESSEL_SETTINGS_ROOT` 指向 `%TEMP%\vessel-audit-*`，
  未读写真实 `~/.vessel`；仅 `vessel migrate` 为只读探测，实测本机已存在 `~/.vessel`（环境事实，跳过）。
- 网络相关命令（`pricing sync`、`models` 实时拉取、`setup` 向导的模型抓取）**未执行**：
  `pricing sync` 会改写仓库 `configs/model-catalog.json`（违反只读纪律），实时拉取依赖外网；
  相关结论以源码 + 离线路径实测为准。
- TUI（无参 `vessel`）依赖真实 TTY，本会话无法交互实测；TUI 相关结论以 `apps/cli/src/tui/chat.ts` 源码 +
  `apps/cli/src/tui/chat.test.ts` 测试断言为依据。
- 未阅读任何其它审计/评审报告（`REVIEW-REPORT-*`、`INTERNAL-REVIEW`、`EXTERNAL-REVIEW` 等），
  本报告结论独立于既有结论。

---

*报告完 · 仅事实与建议，未修改任何代码*