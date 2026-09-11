# EVALUATION-REPORT-03 — Round 2 独立验收（G-03 / G-12 / G-16）

> 独立 Evaluator（全新上下文，不继承 Implementer 推理）。立场：假设实现有错，逐条反查。
> 需求源：`IMPLEMENTATION-BRIEF-02.md`（验收标准 1–6）；验收指令：`EVALUATION-BRIEF-02.md`（必查点 1–7）。
> 待验提交：`22c1463`（+ 文案/注释微修）。
> **方法声明：本报告为纯静态审查，未运行任何命令**（未跑 `tsc -b`、未跑 `vitest`、未跑 CLI E2E、未跑 `git`）。
> 证据来源：read/grep 逐行核对 + `glob` 工具的修改时间序列表（**非 git**，用于推测改动面）。

---

## 0. 结论速览

| # | 必查点 | 判定 |
|---|---|---|
| 1 | G-03 崩溃面（纯函数 / 4 类分支 / 路径提取） | **通过** |
| 2 | 入口接线与退出码语义（0 / 1 / 2） | **通过** |
| 3 | G-12 构建边（local-server reference） | **通过** |
| 4 | G-16 契约（MESSAGE_SOURCES 绑定 / 无遗漏 / 无收窄破坏） | **通过** |
| 5 | 测试真实性（真断言 / 判别力） | **通过**（含 2 处弱断言，非永真） |
| 6 | 回归与越界（改动面 / 唯一消费点 / wire 无影响） | **通过**（改动面为 mtime 推断） |
| 7 | 文案质量（`涉及文件：` 行干净结尾） | **通过** |

**总判：ACCEPT**（工程面 7/7 通过）。唯一未满足的是 `IMPLEMENTATION-BRIEF-02` **验收标准 6 的"新增 Vitest 覆盖 1/2"**——见 §9 N1（P2，必修跟进，非代码缺陷）。

---

## 1. G-03 崩溃面：`apps/cli/src/startupError.ts` —— **通过**

**纯度（无 exit / 无 IO / 不抛）**
- 全文件 156 行**无任何 import / require**（`startupError.ts:1-156` 通读），因此不可能触达 `fs` / `child_process` / 网络。
- 无 `process.exit` 调用；文件内 `process` 字样只出现在 JSDoc 注释 `:10`（"不调用 `process.exit`"）。
- 不抛：入口 `describeStartupFailure(err: unknown)`（`:101`）的取值路径全部是字符串操作 + 正则 + 字面量返回；`rawMessage`（`:84-90`）对 `Error` / `string` / 其他类型都有分支，`String(err)` 对任意值不抛（Symbol 也被 `String()` 接受），`err as {...}` 断言不产生运行时访问异常。三条 return 分支（`:113` / `:126` / `:139`）与末尾兜底（`:151`）构成全路径覆盖，无隐式 `undefined` 返回。

**4 类分支可达性（非全部落 unknown）**
- config-corrupted：`:112-123`，触发条件 `:107-110`（`instanceof SyntaxError` / `name === 'SyntaxError'` / 去掉 `.json` 后命中 `CONFIG_CORRUPTED_RE`）。真实生产者存在：`apps/cli/src/guide/settings.ts:113`（`settings.json 损坏（<file>）: Unexpected token … is not valid JSON`）、`apps/cli/src/providers/ProviderStore.ts:470/556`（`current/providers file corrupted (invalid JSON): <file>`）。✅
- file-missing：`:125-136`，`/ENOENT/` 分支独立成类，不被 JSON 探测吃掉（`syntaxProbe` 先剔除 `.json`，见 `:106`）。✅
- permission：`:138-149`，`/EPERM|EACCES|EBUSY/`。✅
- unknown：`:151-155`（`raw || '启动失败：…'` + 通用指引）。✅
- 四条 return 的 `kind` 与 `StartupFailure['kind']` 联合（`:21`）一一对应，无遗漏也无多余。

**路径提取不产生空占位**
- `compose()`（`:93-95`）丢弃 `undefined` / 空白行；三处 `涉及文件：` 均为三元守卫（`:118` / `:131` / `:144`）：`path ? \`涉及文件：${path}\` : undefined`。
- `extractPath` 无候选时返回 `undefined`（`:78`），`collectPaths` 过滤掉长度 <2 的残片（`:59`）与非文件形态的 POSIX 片段（`:61`），URL 的 `://` 尾巴在 `:56` 被显式剔除（`https://host/a.json` 从第二个 `/` 起匹配，`text.slice(start-2,start) === ':/'` 成立 → `continue`）。
- 静态推演 `new Error('boom')` → `path === undefined`、文案无 `涉及文件`，与 `startupError.test.ts:130-132` 的断言一致。✅

**微修核验（`*/` 提前闭合块注释）**
- `startupError.ts` 内 `*/` 只出现在合法注释结束位（`:12, :14, :16, :18, :20, :24, :33, :35, :38, :43, :71, :83, :92, :100`），`packages/shared/src` 无 `**/` 残留（grep 0 命中）。`:38` 的说明注释含 `...)` 但不含 `*/`，不会截断注释。✅

---

## 2. 入口接线与退出码 —— **通过**

- 唯一 `.catch` 在 ESM entry 判定内：`apps/cli/src/cli.ts:1534`（`if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1]))`）→ `:1537-1541`（`console.error(describeStartupFailure(err).message); process.exit(1)`）。`main()` 函数体（`:1476-1531`）内部**未**新增任何 catch/exit。✅
- 全仓 `process.exit` 只有两处：`cli.ts:1536`（成功码透传，未改动）与 `:1540`（新增兜底 = 1）。✅
- 退出码语义逐条复核（与 `IMPLEMENTATION-BRIEF-02:35` 的"不能破坏"一致）：
  - 未知命令仍 **2**：`cli.ts:1497-1500`（`console.error('未知命令 …'); return 2;`）**未被本轮触碰**。
  - 成功仍 **0**：`main` 各 `case`（`:1518-1528`）返回 0 / 子命令返回值。
  - 兜底失败 **1**：`:1540`。
  - 另注（非回归）：无 TTY 交互入口 `:1513-1516` 仍返回 2，与既有语义一致。
- **接线真实性静态追踪**（不经命令）：`vessel settings list` → `guideCommands.ts:92-95`（无 try，直接 `settingsStoreFor(opts)` 渲染）→ `settings.ts:103/111-114` throw → `main()` 返回的 promise reject → `cli.ts:1537` → exit 1；与指挥侧 E2E 输出（含路径 + 恢复指引、无 `at `/`node:internal`）在代码层自洽。`vessel provider list` 同理走 `ProviderStore.ts:556`。✅
- 边界观察（不判不通过）：`cmdSettingsSet` 的 catch（`guideCommands.ts:119-123`）会在坏文件时二次 `store.load()` 并再次抛出 → 该场景退出码由预期的 2 变为 1，仍是"更严的失败"且不吐裸栈。

---

## 3. G-12 构建边 —— **通过**

- `apps/cli/tsconfig.json:27`：`{ "path": "../../apps/local-server" }`（注释在 `:23-26`，格式与 task 098 的 bench-runners 边一致）。✅
- 与被声明 import 对应：`cli.ts:8` `import { createVesselServer } from '@vessel/local-server';`（唯一一处使用点，grep 命中）。✅
- 合法性：`tsconfig.base.json:11` `"composite": true` → 被引用工程具备 composite 前置条件（`apps/local-server/tsconfig.json:1-8` 继承 base，含 rootDir/outDir/tsBuildInfoFile）。✅
- 无环：`apps/local-server/src` **不含** `@vessel/cli` 引用（grep 0 命中）；`packages/**` 亦无（仅 `presets.data.ts:8`、`providers/index.ts:5` 的注释提及历史上那条被移除的边）。`tsconfig.json:18-19` 同时列出 `apps/cli` 与 `apps/local-server`，新边只把顺序显式化，不引入 TS5055/循环。✅

---

## 4. G-16 契约（`packages/shared/src/events.ts`）—— **通过**

- 单一事实源：`:30` `export const MESSAGE_SOURCES = ['user','steer','inject','instruction','compacted-summary','plan','memory','handoff'] as const;`，`:31` `export type MessageSource = (typeof MESSAGE_SOURCES)[number];`，`:46` `source?: MessageSource;` —— 类型由常量派生，**不是两处手写**。✅
- 无遗漏：与改动前的联合逐一对照（`FIX-BRIEF-01.md:20` / `EVALUATION-REPORT-01.md:39` 记录的 `user|steer|inject|instruction|compacted-summary|plan|memory|handoff`），**8 项、顺序、拼写完全一致**，无增无减。✅
- 无收窄破坏（grep 全仓 `source:` 赋值点 + 所有 `type: 'user/message'` 构造点逐一核对）：
  `AgentLoop.ts:689`('steer')、`Builder.ts:132`('instruction')/`:144`('memory')、`Compaction.ts:91`('compacted-summary')、`Planner.ts:84`('plan')、`StartFromHandoff.ts:99`('handoff')、`benchmarks/runners/src/runner.ts:135`('inject')、`Session.test.ts:67/87`('compacted-summary') —— **全部落在联合内**；其余 `source:` 命中均为无关领域（pricing / telemetry / enforcement / review handoff）或**读取侧**断言（`(r as { source?: string }).source === …`），不受收窄影响。
  `Builder.ts:165` 的 `source: 'environment'` 是 `ChatMessage`（wire 侧，字段仍是 `string`，见 `provider.ts:38`），不参与本次收窄 → **不会**因 `environment` 不在 `MessageSource` 中而报错。✅
- 唯一"不对称"（按需求有意为之）：`MESSAGE_SOURCES` 无 `environment`，而 `INJECTED_MESSAGE_SOURCES`（`provider.ts:53-61`）有；`EVALUATION-BRIEF-02:27` 明确允许"`environment` 单独列出"，故不判不通过（残留见 §9 N5）。✅

---

## 5. 测试真实性 —— **通过**

### 5.1 `apps/cli/src/startupError.test.ts`（9 例，与声称一致：`:27,:37,:48,:57,:66,:78,:86,:94,:107`）

- **真断言分类**（不是"只断言非空"）：`:30` `kind === 'config-corrupted'`、`:52` `'file-missing'`、`:61` 同上、`:71` 同上、`:81` `'permission'`、`:89` `'unknown'`、`:96/:102` 字符串/普通对象输入的分类。配合 `:42/:62` 的路径等值断言（`:62` 用 `toBe(posixPath)` 全等，最强）、`:44/:45` 的 `涉及文件：<path>` 精确拼接断言。✅
- **无裸栈守卫有判别力**：`STACK_LINE_RE = /\n\s+at\s/`（`:21`）与 `:122` 的 `not.toMatch` —— 若实现改为拼接 `err.stack`（Node 的 stack 为 `message\n    at …`），六个样本（`:108-116`）必然命中 → 变红。`not.toThrow`（`:119`）在实现含 IO/抛出时同样会红。✅
- **空占位守卫有判别力**：`:131-132` 断言 `path` 为 `undefined` 且文案不含 `涉及文件` —— 若实现改成 `涉及文件：${path}` 无条件拼接，文案将含 `涉及文件：undefined`，被 `:123` 与 `:132` 双重打红。✅
- **永真断言排查**：无 `expect(true)` 类写法。两处**弱断言**（如实记录，未构成"充数"）：`:125` `expect(['config-corrupted','file-missing','permission','unknown']).toContain(res.kind)` 与 `:126` `message.trim().length > 0`——由于 `kind` 已被字面量联合类型约束、`compose` 必有内容，这两条几乎不可能失败；但它们与 `:122-124` 的实质断言（无栈 / 无 `undefined` / 无 `[object Object]`）同处一个用例，属补充而非替代。`:41` `toBeDefined()` 亦为弱，但紧随其后的 `:42/:44` 是实质断言。**不判不通过。**
- 无 FS/网络依赖（`:13` 头注释声明，代码亦无 import）。

### 5.2 `packages/shared/src/messageSources.test.ts`（3 例，与声称一致）

- 判别力逐条推演（**这是本轮的重点挑错，结论：具判别力**）：
  - 用例 1（`:15-19`）：`injected = MESSAGE_SOURCES − {user,steer}` 当前 = `inject/instruction/compacted-summary/plan/memory/handoff`；`missing = injected − INJECTED_MESSAGE_SOURCES`。**临时把 `plan` 从 `INJECTED_MESSAGE_SOURCES`（`provider.ts:53-61`）移除 → `missing === ['plan']` → `toEqual([])` 必红。** ✅
  - 用例 2（`:21-24`）：**把 `steer` 加入 `INJECTED_MESSAGE_SOURCES` → `wrong === ['steer']` → 必红。** ✅
  - 用例 3（`:26-28`）：`environment` 必须在内；当前 `provider.ts:54` 有 → 绿；删除即红。✅
- 覆盖可行性：`vitest.config.ts:37-44` 的 include 含 `packages/*/src/**/*.test.ts` 与 `apps/cli/src/**/*.test.ts`；两文件相对 `.js` 导入与 `packages/shared/src/pricing.test.ts` 等同构，可被收集。✅
- 残留（不判不通过，见 §9 N5）：守卫只覆盖 `MESSAGE_SOURCES → INJECTED` 一条边；`INJECTED ⊄ MESSAGE_SOURCES` 与"生产端新写未登记 source"仍无人检查。

---

## 6. 回归与越界 —— **通过（改动面为 mtime 推断）**

- **未跑 git**，故用 `glob` 工具的修改时间序列做范围旁证。本轮代码改动窗口（升序 mtime，序列尾部）：`apps/cli/tsconfig.json`、`packages/shared/src/events.ts`、`apps/cli/src/cli.ts`、`packages/shared/src/messageSources.test.ts`、`apps/cli/src/startupError.test.ts` 连续相邻；`apps/cli/src/startupError.ts` 因**后续注释微修**被单独排在更晚位置。窗口内**无其他源码文件**，其后到序列末尾只有各包 `dist/**` 构建产物、`docs/product-evolution/EVALUATION-BRIEF-02.md` 与 `node_modules/.vite/vitest/results.json`。
  ⇒ 改动面 = 声称的 6 个文件（无第 7 个源码文件），**未见无关重构**。⚠️ 该结论基于文件 mtime 而非 git，属**受限判定**（同一提交内改完再还原的文件无法据此排除）。
- `INJECTED_MESSAGE_SOURCES` 消费点：全仓 grep 命中 `provider.ts:53`（定义）、`MockProvider.ts:2`（import）、`MockProvider.ts:56`（唯一使用，`!INJECTED_MESSAGE_SOURCES.has(m.source ?? '')`）、`messageSources.test.ts`（新测试）。**运行时唯一消费点仍是 MockProvider**。✅
- wire 序列化：`MESSAGE_SOURCES` 全仓消费点仅 `events.ts:30`（定义）与 `messageSources.test.ts:3,16`（测试）；`SessionRecord` 未新增字段、无序列化器引用该常量，`dist` 产物中新增的 `packages/shared/dist/messageSources.test.js` 只是测试编译产物。⇒ 对 wire/真实 provider 无影响。✅
- 无新依赖、无 package.json 改动（mtime 窗口内无该文件）。✅

---

## 7. 文案质量（`涉及文件：` 行干净结尾）—— **通过**

- 真实错误文案形态：`settings.ts:113` = `settings.json 损坏（<绝对路径>）: <V8 原始信息>`；`ProviderStore.ts:556` = `providers file corrupted (invalid JSON): <绝对路径>`。
- `WINDOWS_PATH_RE`（`:34`）的 `[^\s"']+` 会吃到路径后的 `）:`（在 `settings.ts:113` 形态下，路径后紧跟 `）: `），由 `trimTrailingPunctuation`（`:39-41`，字符类含 `）:：;；,。]}>"'` 等）剥掉尾随标点 → `涉及文件：C:\…\settings.json` **以路径干净结尾**，不会出现 `…settings.json）` 或 `…settings.json:`。✅
- 空占位不存在：无路径时该行整个不产生（§1 已证）。✅
- 与指挥侧 E2E 记录（`<tmp>\settings\settings.json` / `providers.json` 干净结尾、exit 1、无 `at ` 栈行）**无冲突**；该记录**未由本报告复跑**（静态审查，未复跑命令）。

---

## 8. 对照 `IMPLEMENTATION-BRIEF-02` 验收标准 1–6

| # | 标准 | 判定 | 依据 |
|---|---|---|---|
| 1 | 坏 `settings.json` → exit 1 + 路径 + 恢复指引 + 无 `node:internal`/`unhandled` | **静态通过 / 未复跑** | 代码链 `settings.ts:113 → guideCommands.ts:92-95 → cli.ts:1537-1541`；文案 `startupError.ts:116-121` 含「配置文件损坏」+ 路径 + `vessel setup`/`vessel provider add`；只打印 `.message` 故无栈 |
| 2 | 另对 `secrets.json` / `providers.json` 至少覆盖两种 | **静态通过（providers）/ 无法判定（secrets）** | `ProviderStore.ts:556` 形态可命中 config-corrupted；`secrets.json` 的凭据后端错误未在代码中找到可确定命中的 JSON 关键字路径，落 unknown 分支（仍 exit 1、无裸栈、有通用指引，符合「不必精确分类」） |
| 3 | 未知命令仍 2、成功仍 0 | **通过** | `cli.ts:1497-1500` / `:1518-1528` 未被改动；`cli.unknownCommand.test.ts:37` 断言 2 |
| 4 | tsconfig 含 local-server reference；`tsc -b` 0 | **通过（静态）/ 未复跑 tsc** | `apps/cli/tsconfig.json:27`；`tsc -b` 未独立复跑（`apps/cli/dist/startupError.*` 等产物存在，间接支持曾构建成功，但不作权威结论） |
| 5 | 漂移守卫存在且具判别力 | **通过** | `messageSources.test.ts:15-24`，删 `plan` / 加 `steer` 均必红（§5.2 推演） |
| 6 | 新增 Vitest 覆盖 1/2/3/5；全量 vitest + tsc 绿 | **不满足（部分）** | 5 ✅（`messageSources.test.ts`）；3 ✅ 但由**既有** `cli.unknownCommand.test.ts` 覆盖而非本轮新增；**1/2 无任何 Vitest**（`startupError.test.ts` 只测纯函数，不经过 `main()`/入口），仅指挥侧手工 E2E。全量 vitest 未复跑 |

---

## 9. 非阻断残留（按严重度）

**N1（P2，本轮唯一实质缺口，建议合并为下一张小卡）—— 验收标准 6 的自动化覆盖不全。**
`startupError.test.ts` 全程使用合成 error（`:13` 头注释亦声明"不读写文件系统"），**不经过 `main()` 与入口 catch**。因此"配置损坏 → exit 1 + 路径 + 指引"这条**用户可见契约**目前无回归保护：若日后有人删掉 `cli.ts:1537-1541` 的 `.catch`，或某子命令自行吞掉 store 构造异常，现有 116 个测试文件**不会有任何一个变红**（对照 Round-1 的 `cli.unknownCommand.test.ts` 覆盖了 exit 2 的做法）。
最小修复方向（无需子进程，规避本环境 EPERM）：新增 `apps/cli/src/cli.crashSurface.test.ts`，`mkdtemp` + `VESSEL_SETTINGS_ROOT`/`VESSEL_PROVIDER_ROOT`（遵守 AGENTS.md 约束 8），写入 `'{not json'` 后断言 `await expect(main(['settings','list'])).rejects.toThrow(/损坏/)`，并断言该 rejection 经 `describeStartupFailure(...)` 渲染后含**文件路径**与「vessel setup」；再补一条 `main(['provider','list'])` 同理。这样把 exit-1 契约锁在"main 必须 reject 且错误可渲染"这一层（entry 的 `process.exit` 仍不必测）。

**N2（P3）—— 分类探测的误报面。** `CONFIG_CORRUPTED_RE`（`:25-26`）本质是子串匹配（`/JSON/i` 等）。反例：`ENOENT: no such file or directory, open '/home/me/json-store/config'`（目录名含 `json`，无 `.json` 扩展名，`syntaxProbe` 不会剔除）→ 被判成 config-corrupted，文案说"配置文件损坏"而非"文件不存在"；Provider 层任何措辞含 `JSON` 的启动期报错同样会被贴上"配置文件损坏"。建议 probe 收紧为 `Unexpected|is not valid JSON|position \d+|Unexpected end of` 等组合，而非裸 `JSON`。

**N3（P3）—— 非语法类配置损坏落 unknown。** `settings.ts:116`「格式非法（…）：需要 JSON 对象」、`:122`「theme=… 不是合法值（dark|light）」既非 SyntaxError 也不含 JSON 关键字 → 走 `:151-155` unknown，只给「vessel --help」通用指引，弱于 config-corrupted 分支的「移走后 `vessel setup`」。建议把 `格式非法|损坏` 纳入探测词。

**N4（P3）—— 未复用 `describeProviderError`，且 unknown 不再留栈。** `IMPLEMENTATION-BRIEF-02:24` 的"理想行为"点名用 `describeProviderError` 渲染；实现另起 `startupError.ts`。后果：opencode-go 分类错误在启动期丢失 `providerFactory.ts:129-130` 的「提示：…」一行（分类信息本身仍在 `原始错误：` 行内）；同时 `kind === 'unknown'` 的异常不再有任何 stack，排障成本上升。建议 unknown 分支把 `err.stack` 落日志文件（非 stdout），或保留 hint。
（注：`describeProviderError` 本身不做脱敏，故"错误文案含真实密钥"的风险相对旧行为**未增加**——旧路径的未捕获栈同样会打印 message。）

**N5（P3，跨轮残留）—— 漂移守卫只覆盖一条边，wire 侧仍未收窄。** `ChatMessage.source` 仍是裸 `string`（`provider.ts:38`），而 `MESSAGE_SOURCES` 唯一定义在 `events.ts:30`。因此：①「往 `INJECTED_MESSAGE_SOURCES` 里加一个不在联合中的值」无人检查；②生产端（`Builder.ts:165` 这类）新写一个未登记的 `source` 字面量仍能编译、且无测试变红——这正是 `IMPLEMENTATION-BRIEF-02:14` 场景 3 想防的路径，只是本轮按 `:27` 的明文只做了「联合 ⊆ 集合 ∪ {user,steer}」这一条。建议下一轮把 `ChatMessage.source` 收窄为 `MessageSource | 'environment'`（并把 `environment` 显式建模），让 ②在编译期就红。
（`MockProvider.ts:47-52` 与 `Builder.ts:47-48` 的注释仍只列旧 4 源，文档性陈旧，一并随下轮刷新。）

---

## 10. 无法判定 / 证据局限（如实标注）

- **`npx tsc -b` exit 0**：未复跑 → **无法独立判定**。静态面未发现会破坏构建的因素（新增 reference 的目标工程具 `composite: true`；无循环；`startupError.ts` 无 `*/` 注释截断问题；`MessageSource` 收窄的全部赋值点均在联合内）。
- **`npx vitest run`（116 文件 / 1247 passed + 1 skipped）**：未复跑 → **无法独立判定**。静态面确认两个新测试文件落在 vitest include 内、相对 `.js` 导入与既有测试同构。
- **崩溃面 E2E（exit 1 / 无栈行）**：未复跑 → 代码链与输出形态**自洽**，但退出码与 stderr 实测值以指挥侧记录为准。
- **改动面完备性**：未跑 `git`，用 `glob` 的 mtime 序列推断（§6），属受限判定。
- **`file-missing` 分支的真实生产者**：静态可达（单测覆盖），但多数既有读点自带 `existsSync` 守卫或自吞 ENOENT（如 `ProviderStore.ts:461-465`、`PolicyLoader.ts:21-27`），故未找到"必然到达 main 的 catch"的真实 ENOENT 路径；`permission`（EPERM/EACCES/EBUSY，Windows 杀软/占用）同理无 E2E 例证。两分支均为兜底分类，误判面为零风险，**不构成不通过**，但若要宣称"4 类均经真实 E2E 验证"，尚缺证据。

---

## 11. 总判：**ACCEPT**

- 必查点 1–7：**1✅ 2✅ 3✅ 4✅ 5✅ 6✅（受限） 7✅**。核心承诺（不再裸栈、一句话定位坏文件 + 恢复指引、退出码语义不变、构建边补全、来源集合有漂移守卫）在静态审查中**逐条成立且无发现实现级缺陷**；两个新测试文件的断言具备真实判别力（删实现/漂移集合必红），未发现永真断言充数。
- 唯一未达标项是**验收标准 6 的自动化覆盖**（退出码 1 的端到端契约无测试）：列为 **N1（P2）必修跟进**，因其属"缺回归保护"而非"行为错误"，且本环境存在子进程不可用的客观约束（指挥侧已用人工 E2E 顶替），故**不构成 REJECT**。
- 建议下一轮最小切片：N1（补 `main()` 层的 crash-surface 用例）→ N2/N3（收紧分类探测）→ N5（收窄 `ChatMessage.source`），N4 可与 N5 合并。

> 本报告全程**静态审查，未复跑任何命令**（未跑 tsc / vitest / CLI E2E / git）；所有文件:行证据均来自 read/grep 直读，改动面旁证来自 glob 工具的修改时间序列。
