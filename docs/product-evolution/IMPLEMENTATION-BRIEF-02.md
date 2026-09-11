# IMPLEMENTATION-BRIEF-02 — CLI 崩溃面收敛 + 构建边补全 + 来源集合漂移守卫

> Round 2 切片（Orchestrator 产出，供独立 Implementer 执行）。来源：`PRODUCT-GAP-MAP.md` 的 **G-03 / G-12 / G-16**（三者为"同一处入口 + 极低成本"的耦合小问题组）。
> 证据：`docs/product-audit/RELIABILITY-REPORT.md`（R1/R5）、`docs/product-audit/ARCHITECTURE-REPORT.md`（问题 1）、`docs/product-evolution/EVALUATION-REPORT-02.md`（N4）。

## 目标

让"配置损坏"不再以裸栈崩溃收场，让干净 clone 的构建顺序有图可依，并给注入来源集合加一道防退化护栏。

## 用户场景

1. 用户机器上 `settings.json` / `secrets.json` / `providers.json` 被外部改坏 → 运行 `vessel run` / `vessel provider list` / `vessel usage` → 现状：`node:internal/...` 级未捕获栈 + 无指引；期望：**一句"什么坏了 + 文件路径 + 怎么恢复"**，exit 1。
2. 新维护者干净 clone（无 dist）→ `tsc -b` → 期望构建顺序由图决定，不出现 TS2307（现在 `apps/cli` 对 `@vessel/local-server` 的引用边未声明）。
3. 未来有人新增一种"上下文注入"消息来源（如新的 `source:'<x>'`）→ 期望**测试变红**，而不是 mock 匹配静默把注入内容当真实输入（本轮 `plan/handoff/inject` 就是这样被 Evaluator 抓出的）。

## 当前问题（证据）

- **G-03**：`apps/cli/src/cli.ts` 入口 `main().then((code) => process.exit(code))` **无 `.catch`**（约 1513-1515 行）；多处 store 构造（`defaultProviderStore()`、`composeHarness()`、`settingsStore.load()`、`resolveChatStore()`）在命令内部 try 之外 → 配置损坏即裸栈崩溃。
- **G-12**：`apps/cli/tsconfig.json` 的 references **未声明** `apps/local-server`，但 `cli.ts` 顶部 `import { createVesselServer } from '@vessel/local-server'` → 干净 clone 下构建顺序无约束（TS2307 风险）。
- **G-16**：`ChatMessage.source` 为裸 `string`，`INJECTED_MESSAGE_SOURCES` 手写 7 项 → 无编译期或测试期绑定，新增注入源会静默退化。

## 理想行为

1. **统一失败出口**：给入口加 `.catch` —— 用现有 `describeProviderError` 渲染原因；按错误特征识别"配置文件损坏"（JSON 解析失败 / `CredentialError` / ProviderStore 损坏）并追加**一句可操作指引**（含文件绝对路径 + 「已隔离为 *.corrupted-<ts>，请重新配置：vessel setup / vessel provider add」或等价建议）；`return 1`。
2. **关键构造进 try**：`cmdRun` 的 `defaultProviderStore()`/`composeHarness()`、TUI 的 `resolveChatStore()`/`buildHarness()` 等处于 try 外的构造点，纳入可捕获范围（或在 `.catch` 里兜住，二选一，至少要保证**不再出现未捕获栈**）。
3. **构建边**：`apps/cli/tsconfig.json` 补 `{ "path": "../../apps/local-server" }`（对齐 task 098 为 bench-runners 声明边的做法）。
4. **漂移守卫**：新增测试断言——`packages/shared/src/events.ts` 的 source 联合类型里，**除 `user`/`steer` 外的全部取值都必须在 `INJECTED_MESSAGE_SOURCES` 内**（`environment` 为 Builder 合成标记，可单独列出）。

## 涉及模块

`apps/cli/src/cli.ts`、`apps/cli/src/tui/chat.ts`、`apps/cli/src/providers/setup.ts`（如指向恢复指引）、`apps/cli/tsconfig.json`、`packages/shared/src/{provider,events}.ts`、新增测试文件（放在 `apps/cli/src/` 下的小文件）。

## 不能破坏什么

- 既有退出码语义：**未知命令 = 2**（本轮刚建立）、正常成功 = 0；新增的兜底失败应为 **1**。
- 全量 `npx vitest run`（现 114 文件 / 1235 passed + 1 skipped）+ `tsc -b` 全绿。
- 测试隔离（AGENTS.md 约束 8）：凡构造默认 store 的用例必须注入临时 `VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT`/`VESSEL_SETTINGS_ROOT`；**不得读写真实 `~/.vessel`**。
- 错误文案不得包含真实密钥（沿用既有脱敏纪律）。

## 验收标准

1. 把临时 root 下的 `settings.json` 写成非法 JSON → 运行一个核心命令 → **exit 1**、stderr/stdout 含**文件路径**与**恢复指引关键词**（如「损坏」「隔离」「vessel setup」），且**不含** `node:internal` 或 `unhandled`。
2. 同上对 `secrets.json` 与 `providers.json` 各一次（至少 coverage 两种）。
3. 未知命令仍 exit 2、成功路径仍 exit 0（对照用例）。
4. `apps/cli/tsconfig.json` 含 local-server reference；`tsc -b` 0。
5. 漂移守卫测试存在且具判别力（临时把某个注入源从集合里删掉，该测试必须变红）。
6. 新增 Vitest 用例覆盖 1/2/3/5；全量 vitest + tsc 绿。

## 错误场景

- 配置文件不存在（正常首次运行）→ 不得报错，沿用现状（自动创建/默认值）。
- 配置文件是合法 JSON 但结构不对（缺字段）→ 同样给可读原因，不必精确分类。
- 无 TTY 下运行 TUI 入口 → 行为不变。

## 测试要求

- 用例放在**新的小测试文件**里（便于独立执行器写入），如 `apps/cli/src/cli.crashSurface.test.ts`。
- 采用"写入型执行器 + 指挥复跑验证 + 独立静态 Evaluator"三件套（本环境跑命令的执行器会中断，见 `PRODUCT-STATE.md` 风险节）。
