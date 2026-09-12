# IMPLEMENTATION-BRIEF-15 — 策略可装载 / 可见 / 不静默降级（G-17，P0）

> 来源：`ROUND-15-DIRECTION.md`（独立现状重审 + Orchestrator 判别性实测）。
> 定位：**这是产品差异化（Behavior IR + Policy 编译执法）的核心承诺在真实使用场景下退化为空的问题**，不是新增能力。

## 目标

用户在**自己的工作区**里能：① 用文档宣称的方式声明策略并**真的生效**；② **看到**当前生效的策略来自哪些层、是否缺失；③ 在"部分装载"（系统策略缺失而其它声明存在）时**不被静默放过**。

## 用户场景

用户读完 `docs/POLICY-SPEC.md:457-458`，在项目里写 `<ws>/.harness/policy.yaml`（比如禁止某类工具），然后跑 `vessel run --prompt "..."`。现状：**该文件被完全忽略**（实测：放进合法策略后仍报 `no policy declaration found`、exit 1），而用户以为"护栏已生效"。用户也无从查询到底哪一层在起作用。

## 当前问题（实测证据）

| 事实 | 证据 |
|---|---|
| 项目级策略未被读取 | 实测：`<ws>/.harness/policy.yaml` 存在且合法（2.7KB，取自 `configs/policy.default.yaml`），从该目录跑 `run --prompt` 仍 `exit 1` + `policy loader: no policy declaration found` |
| 无人给 `policyProjectPath` 赋值 | `grep policyProjectPath apps/**` = **0 命中**；`packages/application/src/compose.ts:47` 声明、`:175` 透传 `projectPath` |
| 文档宣称四层 | `docs/POLICY-SPEC.md:457-458`（user/project）、`:469-475`（workspace trust）、`docs/ARCHITECTURE.md:325`（system>user>project>session） |
| 用户无法自查 | `dispatch`（`cli.ts:1678-1771`）无 policy 子命令 |
| 缺失时行为 | `PolicyLoader.ts:16-31`：`systemPath` 不存在则**静默跳过**；只有"声明全空"才抛 → **部分装载静默通过** |

## 理想行为

1. **project 层打通**：`<workspace>/.harness/policy.yaml` 存在时接上 `policyProjectPath`；不存在是**合法缺省**（可选层，不报错）。
2. **生效策略可见**：新增 `vessel policy status`（只读）打印每层的：**层名 / 路径 / 是否存在 / 声明条数 / 内容哈希**，以及**合成后的生效层序**；`--json` 输出同信息（沿用 `output.ts` 的 `emitJson` 纪律：stdout 只有一段 JSON）。
3. **不静默降级**：当**系统策略缺失**而其它层有声明（"部分装载"）时，给出**明确警告**（含"缺了哪一层"与"如何补齐"），**不阻断**运行（层可选），但**绝不让用户以为完整生效**。警告事实与 `policy status` **同源**（一处计算、两处展示）。
4. **诚实**：文档与实现一致。若本轮决定不做 user 层/trust 门，必须在 `POLICY-SPEC` 明确标注"未实现"（**不得**继续宣称已支持）。

## 涉及模块

`apps/cli/src/cli.ts`（接线 + 新命令 + 警告输出）、`packages/policy/src/risk/PolicyLoader.ts`（**只读地**暴露层次事实；不要改执法语义）、`docs/POLICY-SPEC.md`（诚实化未实现层）。

## 不能破坏什么

- `--policy <path>` 显式覆盖 systemPath 的既有语义。
- 既有的"声明全空 → 抛错"行为（`PolicyLoader.ts:29-31`）与其既有测试。
- 全部既有门禁：`tsc -b` 0、全量 vitest 绿（当前 **130 文件 / 1401 passed + 3 skipped**）、发布门禁 **8/8**。
- 测试隔离（AGENTS.md §8）：涉及默认根的新路径必须注入临时根。
- 不引入依赖；不碰 TUI 的既有命令集（`vessel policy status` 先在 CLI 落地）。

## 验收标准（可判别）

1. **AC1（判别性）**：临时工作区放入合法 `<ws>/.harness/policy.yaml` → `run --prompt` **不再**报 `no policy declaration found`，且策略真的参与（用一条**可观测**的判据，例如该策略禁止的工具被拒绝 / `policy status` 显示 project 层声明条数 > 0）。
   **负对照**：删除该文件 → 回到"无声明"行为（exit 非 0 或明确缺层提示）。
2. **AC2**：`vessel policy status` 打印四类事实（层/路径/存在/条数/哈希）且与真实文件一致；**改动文件内容 → 哈希变化**（锁"哈希来自真实内容"而非常量）。
3. **AC3**：`policy status --json` 的 stdout 是**单一可解析 JSON**（`JSON.parse` 成功），失败走 stderr 信封（沿用 `fail`）。
4. **AC4**：系统策略缺失、而 project 层**有**声明时，运行输出**含明确警告**（含缺失层名），且**仍然运行**（不阻断）；**负对照**：四层齐备时**不得**出现该警告。
5. **AC5（诚实）**：`POLICY-SPEC` 中未实现的作用域被明确标注未实现（grep 可查）；不得留下"宣称支持但代码无"的条目。

## 错误场景

- `<ws>/.harness/policy.yaml` 存在但 **YAML 非法/结构非法** → **fail-loud**（明确路径 + 原因），不得静默忽略（"看着配了其实没配"是本次要消灭的形态）。
- `policy status` 在不含任何配置的目录 → 如实显示"各层均缺失"，退出码 0（只读查询，不是错误）。
- `--policy` 指向不存在路径 → 保持既有行为（不因本次改动改变）。

## 测试要求

- 走**真实 `main()`**（沿用 `jsonErrorExits.test.ts` / `jsonCommands.test.ts` 的风格：捕获 stdout/stderr、注入临时四根）。
- **AC1/AC4 必须有负对照**（缺文件 / 层齐备），以证明断言不是恒定值。
- 交付链：写入型微任务（单文件、禁跑命令）+ 指挥复跑 `tsc`/全量 vitest + **真实 CLI E2E**（临时工作区放/不放 `.harness/policy.yaml` 各跑一次）+ 独立静态 Evaluator 复核（重点：AC1 是否真"参与执法"而非只"读到了文件"）。
