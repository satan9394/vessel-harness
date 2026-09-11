# EVALUATION-BRIEF-02 — Round 2 独立验收指令（G-03 / G-12 / G-16）

> 给**独立 Evaluator**（全新上下文，不继承任何 Implementer 推理）。立场：**假设实现有错**。
> 需求源：`IMPLEMENTATION-BRIEF-02.md`（验收标准 1–6）。实现提交：`22c1463`（+ 一个文案微修 commit）。
> 产出：`docs/product-evolution/EVALUATION-REPORT-03.md` + 结论 **ACCEPT / REJECT**（REJECT 给最小修复方向）。

## 待验改动

| 文件 | 声称做到 |
|---|---|
| `apps/cli/src/startupError.ts`（新） | 纯函数 `describeStartupFailure(err)`：4 类判定（config-corrupted / file-missing / permission / unknown）+ 路径提取 + 恢复指引；不打印裸栈、不调 `process.exit` |
| `apps/cli/src/cli.ts` | 入口 `main().then(...).catch(...)`：渲染 `describeStartupFailure(err).message` → `process.exit(1)` |
| `apps/cli/src/tsconfig.json` | references 增 `{ "path": "../../apps/local-server" }` |
| `packages/shared/src/events.ts` | 新增运行时事实源 `MESSAGE_SOURCES`（`as const`）+ `type MessageSource`；`source?: MessageSource` |
| `apps/cli/src/startupError.test.ts`（新，9 例） | 4 类分类 / 路径提取（win/posix/转义） / 无裸栈守卫 / 空占位 |
| `packages/shared/src/messageSources.test.ts`（新，3 例） | 漂移守卫：`MESSAGE_SOURCES` 中除 `user`/`steer` 外必须全在 `INJECTED_MESSAGE_SOURCES`；`user`/`steer` 不得在内；`environment` 必须在 |

## 必查验收点（逐条给 通过/不通过/无法判定 + 文件:行 或原始输出证据）

1. **G-03 崩溃面**：`startupError.ts` 是否**真的不**调 `process.exit`、不读文件、不抛异常（纯函数）？4 类判定是否有真实分支（而非全部落到 unknown）？路径提取是否会在无路径时**不产生空占位**（`path === undefined` 且无「涉及文件：」空行）？
2. **入口接线**：`cli.ts` 末尾是否只在 ESM entry 处加 `.catch`？**退出码语义**是否未被改变——未知命令仍 **2**（`cli.ts:1493-1499` 区域）、成功仍 **0**、兜底失败 **1**？
3. **G-12 构建边**：`apps/cli/tsconfig.json` 是否确有 local-server reference（给出该行）？是否与 `cli.ts` 的 `@vessel/local-server` import 对应？
4. **G-16 契约**：`events.ts` 的 `MESSAGE_SOURCES` 是否与 `source?: MessageSource` 绑定（类型由它派生，而非两处手写）？是否**没有**遗漏联合成员（对照改动前联合：user/steer/inject/instruction/compacted-summary/plan/memory/handoff）？改类型别名后是否有其它使用点会因类型收窄而破坏（grep `source:` 赋值点）？
5. **测试真实性（重点挑错）**：
   - `startupError.test.ts` 是否**真断言分类**（而不是只断言 message 非空）？「无裸栈守卫」是否真能失败（例如实现若拼接 `err.stack` 会否变红）？有无永真断言（如 `expect(typeof x).toBe('string')` 充数）？
   - `messageSources.test.ts` 的漂移守卫**是否具判别力**：若把 `plan` 从 `INJECTED_MESSAGE_SOURCES` 移除，第一条用例是否必然失败？若把 `steer` 加进去，第二条是否失败？若不具判别力 → 不通过。
6. **回归/越界**：本轮是否只动上述文件（无无关重构）？`INJECTED_MESSAGE_SOURCES` 是否仍被 MockProvider 用作唯一消费点？`MESSAGE_SOURCES` 的加入是否影响 wire 序列化（不应，仅类型/常量）？
7. **文案质量**：E2E 输出是否**没有**多余额外标点/空占位（本条在一次微修后应已修正，请核验 `涉及文件：` 行是否以路径干净结尾）。

## 指挥侧原始证据（须独立核验与代码一致性，不要照抄）

- `npx tsc -b tsconfig.json` → **exit 0**
- `npx vitest run` → **116 文件 / 1247 passed + 1 skipped / exit 0**（Round 1 末为 114 / 1235+1）
- **崩溃面 E2E**（注入临时 root，写坏配置文件）：
  - `settings.json = '{not json'` → `vessel settings list`：输出「配置文件损坏：…／涉及文件：<tmp>\settings\settings.json／原始错误：…／可把该文件移走后重试：vessel setup（交互向导）或 vessel provider add」→ **exit 1**
  - `providers.json = '{broken'` → `vessel provider list`：同类输出 → **exit 1**
  - 两例均**无** `node:internal` / `at ` 栈行
- 过程中由指挥 E2E 发现并已修复的缺陷（供你判断修复质量）：`startupError.ts` 最初把 `~/.vessel/**/*.json` 写进 JSDoc，`**/` 的末两字符 `*/` 提前闭合块注释 → esbuild `Unexpected "*"`，整个 CLI 不可运行；已改为不含 `*/` 的表述。

## 输出格式

`docs/product-evolution/EVALUATION-REPORT-03.md`：逐点 通过/不通过/无法判定 + **你自己的**证据（读了哪行/你跑没跑命令，未跑要如实标注"静态审查，未复跑命令"）；结论 **ACCEPT / REJECT**；REJECT 列最小必修条目按严重度 + 修复方向。**不要改代码。**
