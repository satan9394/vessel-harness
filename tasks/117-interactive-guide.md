# 117 — 交互引导体系（术语中英双语解释 + 设置引导）

- 编号：117
- 状态：待验收
- 优先级：P1（用户明确需求：引导式交互——输入术语给中英文解释；设置项带说明）
- 创建日期：2026-09-10
- 关联：116（提示词工程引导线，独立并行）；CLI（apps/cli/src/cli.ts）+ TUI（tui/chat.ts）；055 预设
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标（用户需求转译）

构建 CLI/TUI 的**引导/解释体系**：
1. **术语中英双语解释**：输入任意术语（内建词库，如「小小蜜/小蜜」「Call（调用）」「Collect（收集/聚合）」
   「主题 theme」「中英文 locale」等）→ 给出**中文解释 + 英文术语 + 一句话用途**。
2. **设置引导**：主题设置、中英文（locale zh/en）等设置项**自带说明**（设置向导/`settings` 命令每项显示
   中英文解释与可选值说明）。
3. **guide 入口**：新手引导命令（分步介绍关键概念、常用命令、如何问"这是什么"）。

## 验收标准（执行器逐条勾选）

- [x] **术语词库**：内建 `GLOSSARY`（新文件如 apps/cli/src/guide/glossary.ts 或 data）：每条 =
      { term（可含别名，如 小小蜜/小蜜/vessel/小助手）, zh, en, usage（一句话用途）}；覆盖 ≥12 个核心术语
      （Call/Collect/Agent/Harness/Policy/Prompt/Lane/Bench/theme/locale/小蜜 等；含"小小蜜"这位小助手自己的解释）
- [x] **explain 命令**：`vessel explain <term>`（或 `vessel term <term>`，选型）→ 查词库给出中英文；未收录词
      → 友好提示"未收录，试试：vessel list-terms"；`vessel list-terms` 列出全部
- [x] **设置引导**：设置项（主题/语言）描述带中英文说明 + 可选值（如 `vessel settings set theme <dark|light>`
      说明、`set locale <zh|en>` 说明）；配置向导/列表显示每项说明
- [x] **guide 命令**：`vessel guide` → 分步新手引导（①这是什么（小蜜/vessel）②怎么问术语 ③常用命令 ④怎么设置
      主题/语言）——中英文双语可用（locale 影响输出语言）
- [x] **TUI 内解释**：chat 里输入 `/explain <term>` 或 `? <term>`（选型）触发同一词库（不重复实现）
- [x] 测试 ≥6 例：词库完整性/explain 命中与未收录/list-terms/settings 说明/guide 输出/locale 切换；
      `tsc -b` exit 0 + 全量 vitest（1198+ 无回归）+ web 82
- [x] 文档同步（README 或 CLI 帮助：guide/explain/settings 用法）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做引导/解释/设置说明（CLI + TUI 词库共用）。不改 core/策略/定价；不加依赖；不做 UI 大改。
- 词库文案我们自己的表述（不复制他人引导稿；与 116 的 clean-room 一致）。

## 涉及文件（指针，执行器自行精化）

- 新：`apps/cli/src/guide/`（glossary.ts + explain/guide/settings 命令逻辑）或并入 cli.ts（命令组）
- `apps/cli/src/cli.ts`（命令接线：explain/list-terms/guide/settings）+
  `apps/cli/src/tui/chat.ts`（`/explain <term>` 或 `? <term>`）
- 复用：defaultStore.ts（settings 若涉 provider/usage root，保持测试隔离）

## 方法

- 建词库 → explain/list-terms 命令 → settings 说明 → guide 分步 → TUI 入口 → 测试 → 全量验证

## 工作证明（执行器回填：词库条目/命令实现/输出示例/diff/测试输出/全量 vitest/tsc/web，全部写进本文件，勿留对话里）

### 1. 词库条目清单（apps/cli/src/guide/glossary.ts，**14 条 ≥ 12**，每条 { term, name, aliases?, zh, en, usage }）

| # | term | name | aliases | en（缩写） |
|---|---|---|---|---|
| 1 | 小小蜜 | 小小蜜 | 小蜜、vessel、小助手、xiaoxiaomi | Xiaoxiaomi — nickname of the Vessel CLI assistant |
| 2 | call | Call | 调用、工具调用、tool call | one tool invocation inside an agent loop |
| 3 | collect | Collect | 收集、聚合、gathering | gathering multiple results before synthesizing |
| 4 | agent | Agent | 智能体、代理 | a unit that plans and calls tools |
| 5 | harness | Harness | 框架、器、vessel 框架 | the host framework that carries/orchestrates components |
| 6 | policy | Policy | 策略、安全策略 | hard constraints enforced by the Policy Engine |
| 7 | prompt | Prompt | 提示词、提示 | instruction text steering the model |
| 8 | lane | Lane | 场景车道、车道、scenario lane | isolated per-scenario execution channel in benchmarks |
| 9 | bench | Bench | 基准、基准测试、benchmark | benchmark scenarios with deterministic criteria |
| 10 | theme | theme | 主题、配色 | UI/display color scheme preference (dark\|light) |
| 11 | locale | locale | 语言、中英文、语言设置 | output language of guide/explain (zh\|en) |
| 12 | token | token | 令牌、词元 | metering unit of model IO; API credential token |
| 13 | permission | Permission | 权限、权限模式 | read-only \| workspace-write \| danger-full-access |
| 14 | model | Model | 模型、llm | the LLM doing the thinking |

"小小蜜"词条 zh 解释 = 本项目 CLI/小助手的昵称（可组合 Agent Harness 助手，状态在 ~/.vessel），即回答「小小蜜是什么」。
查找：`findTerm()` 大小写不敏感 + term/aliases 双命中 + 去首尾空白；未命中 → undefined。

### 2. 命令实现与输出示例（实际冒烟 `npx tsx apps/cli/src/cli.ts ...`，设置 root 注入临时目录）

```
$ vessel explain 小小蜜            # 别名小蜜/vessel/小助手/xiaoxiaomi 同样命中
=== 术语解释: 小小蜜 ===
中文解释: 本项目 CLI/小助手的昵称：一个跑在本地、可组合、可验证、可替换行为层的 Agent Harness 助手。…
英文术语 (English): Xiaoxiaomi — the nickname of this project’s CLI assistant (the Vessel CLI).
一句话用途: 用途：用来称呼这个 CLI/助手本身——问【小小蜜是什么】就能得到这段解释。…

$ vessel explain Call
=== 术语解释: Call ===
中文解释: 一次工具调用：Harness 判断该调用某个工具（Read/Grep/Write 等）时，执行并把结果喂回模型的一轮交互。…

$ vessel explain 未收录词zz          # exit 2
未收录术语 "未收录词zz"。试试: vessel list-terms（查看全部 14 条），或换个叫法（如 小蜜/Call/Collect）。

$ vessel list-terms                 # 全 14 条，每行 name + en + zh 摘要 + 别名
=== 术语词库（14 条）=== …

$ vessel guide                       # 四步（①这是什么 ②怎么问术语 ③常用命令 ④怎么设置）中文
=== 新手引导 · Vessel / 小小蜜（vessel guide）=== …

$ vessel guide --locale en           # 英文
=== Getting Started · Vessel / Xiaoxiaomi (vessel guide) === …

$ vessel settings list
=== 设置项（vessel settings）===
[theme] 当前: dark
  中文: 界面主题：CLI 输出使用的配色方案（展示用偏好，实际换肤由 UI 层消费）。
  English: UI theme: the color scheme the CLI output uses …
  可选值: - dark 深色（默认）/ dark (default) · - light 浅色 / light
[locale] 当前: zh
  中文: 输出语言（中英文）：guide/解释等引导文案的语言，zh = 中文，en = English。…

$ vessel settings set theme light    # exit 0，持久化；落盘 ~/.vessel 下 settings.json（测试注 root）
✔ 已设置 theme = light（浅色）
  当前: theme=light · locale=zh …

$ vessel settings set locale en
✔ 已设置 locale = en …；guide/解释输出语言已切换：vessel guide 现在用 English。

$ vessel settings set theme neon     # exit 2（非法值 fail loud，带可选值说明）
[vessel settings set] 设置 "theme" 不能取 "neon"；可选值: dark（深色（默认）） / light（浅色） …
```

`vessel --help` 已含 explain/list-terms/guide/settings 共 5 行用法说明。

### 3. diff 摘要

| 文件 | 改动 |
|---|---|
| `apps/cli/src/guide/glossary.ts`（新） | 14 条词库 + findTerm/listTerms/renderExplain/renderTermsList |
| `apps/cli/src/guide/guide.ts`（新） | GUIDE_ZH/GUIDE_EN 四步引导 + renderGuide(locale) |
| `apps/cli/src/guide/settings.ts`（新） | SETTINGS_DEFS（theme/locale，中英说明+可选值）+ SettingsStore（原子写）+ resolveSettingsRoot |
| `apps/cli/src/guide/guideCommands.ts`（新） | cmdExplain/cmdListTerms/cmdGuide/cmdSettings（log/error/settingsRoot 注入） |
| `apps/cli/src/guide/guide.test.ts`（新） | 19 例（词库/explain/list-terms/settings/guide/locale/TUI 复用） |
| `apps/cli/src/cli.ts` | import 4 命令 + USAGE 5 行 + main() 分发（explain/term/list-terms/guide/settings） |
| `apps/cli/src/tui/chat.ts` | `? <term>` 前缀 = `/explain`；dispatchSlash 加 explain/term；/help 补行 |
| `README.md` | 命令参考表 + 3 行（explain/list-terms/guide/settings）；斜杠命令注补 /explain、? <术语> |

未触碰：`core/策略/定价/configs/behavior*/packages/behavior*`（116 执行器的行为层改动按其归属提交，本卡未混入）。

### 4. 测试/命令输出

- 定向：`npx vitest run apps/cli/src/guide/guide.test.ts` → **19 passed**（69ms）；
  `apps/cli/src/cli.test.ts + tui/chat.test.ts` → **71 passed**（无回归）。
- 冒烟：explain 命中/未收录、list-terms、guide zh/en、settings list/set/非法值——输出如上节，exit 码符合约定（成功 0 / 用法与非法值 2）。
- 测试隔离：settings 用例全部注入 `settingsRoot: <mkdtemp>`；dispatchSlash 用例用显式 tmp root 的 ProviderStore；
  不构造默认 ProviderStore；不读写真实 ~/.vessel（冒烟也注入临时设置 root）。

### 5. 全量验证

- `npx tsc -b tsconfig.json` → **exit 0**。
- 全量 vitest（root）：**112 文件 / 1220 passed | 1 skipped（1221）**（基线 1198+1；本卡新增 19 例，另含 116 执行器在跑的行为层测试，全绿无回归）。
- apps/web vitest：**9 文件 / 82 passed**（web 82 保持）。
- 遗留：root 全量 vitest 是本机非受限语言模式直跑成功的（未遇 esbuild spawn EPERM）；git 状态中 `configs/behavior.default.yaml`、`packages/behavior/src/compiler/Compiler.test.ts`、`docs/BEHAVIOR-DEFAULTS.md` 为 116 执行器改动，**未纳入本卡提交**。

### 6. 踩坑

- `vessel settings set` 失败时要显示「当前值 + 可选值」说明——`store.load()[key]` 需要类型收窄，用 `key as keyof VesselSettings ?? def.default` 避免 undefined 打印。
- `? <term>` 走 dispatchSlash 需在 runChat 循环把 `input.startsWith('?')` 一并纳入斜杠分发，否则会被当自然语言送进 harness。
- 设置 root 复用 `VESSEL_USAGE_ROOT > ~/.vessel` 链（新设 `VESSEL_SETTINGS_ROOT` 优先）：沿用 cli.test.ts 既有隔离（USAGE_ROOT 已指 tmp），settings 读写天然不碰真实 ~/.vessel。
- 词库查找归一化：去空白 + 小写，中文不受影响；别名也走同一归一化，`小助手`/`vessel` 命中小小蜜。
- 删除铁律遵守：冒烟临时目录送回收站（`[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(..., 'SendToRecycleBin')`）。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：