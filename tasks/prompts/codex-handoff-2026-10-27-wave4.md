# Codex 任务书（第四波）· 2026-10-27 · 五个小任务

> 用法：把本文件路径交给 Codex，说明「按波次顺序跑完五项」。额度有限，五项都刻意做小；
> 跑完交报告，协调者逐项复跑定向测试 + 全量门禁再落卡。
> 沿用第二波 §0 的全局约定与 §10 的交付格式；**不新建任务卡**，结果只追加到指定卡。

## 1. 五项与模型/档位

| 编号 | 任务 | 顺序 | 实现 | 复核 | 依据 |
|---|---|---|---|---|---|
| T1 | 查清 `npm pack --dry-run --json` exit 1 的原因 + 根 `dist` 新鲜度 | 1 | `gpt-6.1-terra` / medium | 不需要 | 只读诊断 + 写卡 |
| T2 | packaging gate 判据硬化：探针非零退出不再被当成 pass | 2（等 T1，因为两者都写卡 351） | `gpt-6.1-sol` / medium | `gpt-6.1-terra` / medium | 改 gate 判据，必须只收紧不放宽 |
| T3 | `vessel trash restore` 之后会话索引不恢复 | 可并行 | `gpt-6.1-sol` / medium | `gpt-6.1-terra` / medium | 跨 CLI + registry，涉及索引一致性 |
| T4 | 卡 260/275 的真实视口截图（补齐最后一次复拍） | 可并行 | `gpt-6.1-terra` / medium（用 IAB） | `gpt-6.1-terra` / medium | 只写 evidence + 追加卡 |
| T5 | 价目升级差分脚本（卡 356 的可选项） | 可并行 | `gpt-6.1-terra` / medium | `gpt-6.1-terra` / low | 单脚本 + 3 条测试 |

冲突：T1 与 T2 都要追加 `tasks/351-packaging-gate-run.md`，所以 **T1 → T2 串行**。
T3 / T4 / T5 文件集互不重叠，可与 T1/T2 并行。不用 Ultra、不开 Fast。

---

## T1 · `npm pack --dry-run --json` 为何 exit 1（W4）

**实现** `gpt-6.1-terra` / medium；不设复核。

### 背景

`tasks/351-packaging-gate-run.md` 已记录：packaging gate 返回 `pass`，但它的 `npm pack --dry-run --json` 探测 **exit 1、stdout/stderr 均 0 字节**；根 `dist/index.js` 时间戳是 2026-09-10。

### 要做

1. 复现该命令，分别试：仓库根、`apps/cli`、`apps/web` 三个位置；记录每次 exit 与输出（写 `%TEMP%`）。
2. 逐个排除：npm 版本（`npm --version`）、`package.json` 的 `files`/`bin` 字段、`workspaces` 存在时的行为、是否有 `prepare`/`prepack` 脚本、Windows 下路径/权限。给出「确定原因」或「已排除 A/B/C，无法确定」。
3. 判断根 `dist` 是否需要重建：跑一次 `tsc -b`，看 `dist/index.js` 时间戳是否变化，并说明它是否被 git 忽略。
4. 结论追加到 `tasks/351-packaging-gate-run.md` 末尾（不改判据、不改产品代码）。

### 允许改的文件

`tasks/351-packaging-gate-run.md`（只在末尾追加）。允许运行只读命令与 `tsc -b`（产物已 gitignore）。

### 自验

```
node node_modules/typescript/bin/tsc -b tsconfig.json
npm --version
npm pack --dry-run --json        # 记录 exit 与输出（不必修好）
```

### 验收

- 给出 exit 1 的可复现原因，或「已排除 A/B/C 仍无法确定」，不许猜。
- 明确写「本次仍不构成打包成功证据」。

---

## T2 · packaging gate 判据硬化（只收紧）

**实现** `gpt-6.1-sol` / medium；**复核** `gpt-6.1-terra` / medium。

### 问题与证据

`benchmarks/runners/src/release-gates/gates.ts` 的 `judgePackagingProbe`：只有 `probeFailed || !rootHasDist` 才 `pending`，否则按 `entryExists` 给 `pass`/`fail`。
而 `probeFailed` 仅在**命令抛异常**时为真；`gateDefaultRunCommand` 把非零退出转成返回值（不抛），于是 `npm pack` exit 1 被完全忽略，gate 照样 `pass`。
这不是「判据不够严」的口头问题：它会把一个失败的打包探测说成通过。

### 要做

1. 让探针的**非零退出**（以及 stdout/stderr 同时为空这类无法判定）进入 `pending`，而不是被当成成功；`pending` 的 note 要写明「探针失败，未取得可判定结果」。
2. 只收紧：`dist` 缺失仍然 `pending`；`dist` 与入口都在且探针正常时仍然 `pass`；入口缺失仍然 `fail`。不允许让任何情形更容易通过。
3. 补测试：探针 exit≠0 → `pending`；探针正常 + dist/entry 齐 → `pass`；dist 缺 → `pending`；entry 缺 → `fail`。
4. 不改其它 gate，不改 `gateDefaultRunCommand` 的签名。

### 允许改的文件

`benchmarks/runners/src/release-gates/gates.ts`、`benchmarks/runners/src/release-gates/release-gates.test.ts`、
`tasks/351-packaging-gate-run.md`（末尾追加）。

### 自验

```
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/release-gates
node node_modules/vitest/vitest.mjs run benchmarks/runners
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

### 验收

- 四种情形各一条测试，且都断言 `status` 与关键 evidence 字段。
- 报告里说明「改后本机实际跑该 gate 得到什么」（若仍 `pending`，照实写，不要为了让它是 pass 而改判据）。

---

## T3 · `vessel trash restore` 之后会话索引不恢复

**实现** `gpt-6.1-sol` / medium；**复核** `gpt-6.1-terra` / medium。

### 问题与证据

卡 345c 的 Result 明确写过：`trash restore` 只恢复目录与日志字节，**不重建已删除的会话索引**，所以 `vessel sessions list` 里看不到还原回来的会话。这是真实缺口，不是文案问题。

### 要做（先定位，再选最小修法）

1. 定位索引存储与写入路径：`SessionRegistry`（`packages/application`）的索引文件在哪、`remove` 时怎么持久化、有没有可用的「重新登记」入口。给 `path:line`。
2. 二选一，报告里写明选了哪个与为什么：
   - **真恢复**：CLI `trash restore` 遇到 `kind === 'session'` 时，把该会话重新登记进索引（复用 registry 现有方法，不手写 JSON）；失败时报错并保持目录已还原的状态，明确提示下一步。
   - **显式提示**：若 registry 没有安全的重登记入口、或重登记需要工作区上下文而 CLI 拿不到，则在 restore 成功输出里给出可执行的提示（例如重新 `vessel sessions list` 会重建 / 需要 `--reindex` 的说明），并把该边界写进 `docs/DELETION-AND-RETENTION.md`。
3. 测试：真恢复路线 → 断言 restore 后 registry 能列出该会话、且再次 restore 同一 id 被拒；提示路线 → 断言输出含可执行提示，且不谎称已恢复。
4. 不改 `trash.ts` 的删除/保留语义，不动 HTTP 层。

### 允许改的文件

`apps/cli/src/commands/trashCommand.ts`、`apps/cli/src/commands/trashCommand.test.ts`、
`packages/application/src/session/SessionRegistry.ts`（仅当确需新增安全的重登记入口）、
对应测试文件、`docs/DELETION-AND-RETENTION.md`、`tasks/345-app-trash-and-retention.md`（末尾追加 345d 段）。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/cli/src/commands/trashCommand.test.ts
node node_modules/vitest/vitest.mjs run packages/application
node node_modules/vitest/vitest.mjs run apps/cli
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

### 验收

- 报告写清选了哪条路线、`path:line` 依据、以及「恢复后 `vessel sessions list` 里能不能看到它」的实测结果（两种路线都要回答）。
- 不许把「提示用户」写成「已自动恢复」。

---

## T4 · 卡 260/275 的真实视口截图

**实现** `gpt-6.1-terra` / medium（用 Codex 应用内的 IAB）；**复核** `gpt-6.1-terra` / medium。

### 背景

第三轮已修：W1 Stop 失败提示插入后立即滚入视口；W2 新建文件 `Write` 发只读 `/dev/null` Diff。
协调者的真实进程验证（`evidence/sessions/2026-10-27-w2-e2e/PROOF.md`）证明 SSE 真会推 `diff_inspector`、覆盖写 0 widget，但**缺真实浏览器视口截图**。协调者的宿主里 `bsk` 守护进程被 Job Object 拦住，只能用 IAB。

### 要做（只写证据，不改产品）

1. 用隔离夹具工作区（系统 TEMP，独立 `USERPROFILE`/`HOME`），起 `vessel serve`（5678）与本地脚本桩 provider（可复用 `%TEMP%\vessel-iab-run2-1b21431d\provider.cjs` 思路，改成写两行 `before\nsecond\n`）。
2. **W1**：在 917×567 视口制造一次 Stop 失败（浏览器侧拦截 `POST /interrupt` 返回 503，或等价的受控失败），截图证明「停止请求失败…」整段文字完整可读、不被消息区底边裁切；同时记录 `disabled` 在请求中为 true、失败后恢复 false。
3. **W2**：新建会话 → 让脚本桩发 `Write({path:'fixture.txt',content:'before\nsecond\n'})` → 等 Write 完成 → 打开 Inspector → Changes → Patch，截图证明能看到 `fixture.txt`、`+2/−0`、`@@ -0,0 +1,2 @@`、`+before`/`+second`，且**没有** apply/discard/revert 按钮；核对磁盘字节与「只写一次」。
4. 报告写到 `evidence/sessions/2026-10-27-iab-acceptance-run3/report.md`，截图同目录；结论追加到 `tasks/275-ui-final-acceptance.md` 末尾。

### 允许改的文件

`evidence/sessions/2026-10-27-iab-acceptance-run3/**`（新建）、`tasks/275-ui-final-acceptance.md`（末尾追加）。
**不改产品代码、不改测试、不新增卡。**

### 验收

- 两张图分别对应 W1 与 W2，且能读出上述关键文本/字段；截图不得包含真实用户会话或非夹具项目名。
- 若某项仍无法验证，写明「无法验证 + 原因 + 试过的手段与实测值」，不要用 DOM 存在代替「看得见」。
- 结束前停掉自建服务与脚本桩，端口监听数回 0。

---

## T5 · 价目升级差分脚本（卡 356 的可选项）

**实现** `gpt-6.1-terra` / medium；**复核** `gpt-6.1-terra` / low。

### 背景

`vessel pricing override repair --file <repairs.json>` 已存在（值守卫三态），但**没有**「对比两版内置价目自动生成 reps」的工具。卡 356 把它列为可选项、默认不做；现在做掉，补上模型管理最后一块。

### 要做

1. 新建 `scripts/pricing-upgrade-diff.mjs`：`--from <旧价目.json> --to <新价目.json> --out <repairs.json>`。
2. 只输出「旧值 → 新值」的条目；同值跳过、只在旧价目里有的条目跳过、新价目新增的条目跳过（并说明理由）。
3. 输出格式必须能被 `vessel pricing override repair --file` 直接消费：先读 `apps/cli/src/usage/pricingOverride.ts` 的 `PricingRepair` 类型与 `apps/cli/src/cli.ts` 的 `repair` 分支，确认字段与校验规则后再写生成逻辑。
4. 非法 JSON / 缺字段 / 数值为负 → 非零退出 + 可读错误，不产出半截文件。
5. 三条单测：同值跳过、缺条目跳过、结构非法报错。测试用 `node:test` 或与仓库一致的方式，别引入新依赖。
6. 在 `docs/PRICING.md` 或 `tasks/356-…` 末尾写一句用法（二选一，别两处都写）。

### 允许改的文件

`scripts/pricing-upgrade-diff.mjs`（新建）、`scripts/pricing-upgrade-diff.test.mjs`（新建）、`tasks/356-pricing-value-guard-docs.md`（末尾追加）。
如需文档，只允许 `docs/PRICING.md`。

### 自验

```
node scripts/pricing-upgrade-diff.test.mjs
node node_modules/vitest/vitest.mjs run apps/cli/src/usage/pricing-override.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
```

### 验收

- 脚本对真实 `configs/pricing.json` 自我对比（`--from` 与 `--to` 同一文件）时输出空 repairs 且 exit 0。
- 三条单测全绿；不新增依赖；不改 `pricingOverride.ts` 的运行逻辑。

---

## 2. 交回来时给什么

每项贴：改动文件、每条命令 + exit + 计数、未做与原因、被拒命令原文。协调者复跑定向 + 全量门禁后再落卡。
