# EVALUATION-REPORT-18 — Round 14 验收（A：CLI 失败出口 `--json` 化 / B：lane 端点覆盖 + 两处修复）

> 对抗立场：先假设实现有错、E2E 是假绿。**静态审查，未复跑任何命令**（无 tsc / vitest / git / CLI）。
> 指挥侧数据（tsc 0、9/9、22/22、gate 423s 复跑）仅作交叉参考，未采信为证据。
> 基线：工作树现状（`PRODUCT-STATE.md:44` 称 Round 14 进行中）。

## A. `apps/cli/src/cli.ts` 其余失败出口 `--json` 化 —— **ACCEPT（逐条抽查成立）**

1. **出口确实走 `fail(...)`**：全仓 `console.error` 67 处在 `cli.ts` 内，逐一归类后**无残留** `console.error(msg); return N;` 形失败出口。抽查 8 处跨 6 个命令族，均 `return fail(N, msg, flags, () => console.error(msg))`：`run` `:313/:367/:429`、`models` `:506`、`provider` `:608/:627/:632/:641/:651/:667/:684/:691/:707/:720`、`provider export/import` `:742/:757/:773/:780/:789/:799/:806`、`endpoint test` `:921/:927/:935/:944/:991/:1003`、`usage` `:1040/:1095`、`pricing override` `:1260/:1320/:1344/:1349`、`pricing sync` `:1379`、`bench-report` `:1548/:1555/:1571`、`serve/web` `:1604/:1656`、`dispatch` `:1696/:1707/:1738`、`main` `:1795`。
2. **`flags` 作用域正确**：抽查点全部取**本命令形参**的 flags（`cmdRun`/`cmdModels`/`cmdProvider`/`cmdProviderExport`/`cmdProviderEndpointTest`/`cmdUsageRecompute`/`cmdPricingOverride`/`cmdBenchReport`/`cmdServe`/`cmdWeb`），跨函数分派处取 `parsed.flags`（`:1696/:1707/:1738/:1795`），**未见**取外层同名变量或 undefined 的情形。`:1707` 仍传 `target.exitCode`（未硬编码）。
3. **退出码一致**：用法类恒 `2`、运行期类恒 `1`，与周边同族分支一致（`provider set` 缺 id=2、`run` MCP 配置坏=1、`models` 拉取失败=1、`endpoint --set-default` 无端点=1）。
4. **human 闭包逐字等价**：`fail`（`apps/cli/src/output.ts:24-32`）非 JSON 分支直接调 `human()`，无前后缀；单行用 `console.error(msg)`，与改造前两行完全同形。
5. **多行文案恰 5 处**（`:651 :733 :773 :921 :1320`）：均为 `fail(N, msgLines.join('\n'), flags, () => { for (const msgLine of msgLines) console.error(msgLine); })`。逐行 `console.error` 每次追加 `\n`，与 `join('\n')` **字节等价**（含空行元素情形）；JSON 侧 `message` 为 `\n` 连接，符合声明。
6. **未误改非失败出口**：`:749`（export 成功摘要，exit 0）、`:820-821`（import 明文 apiKey 警告，exit 0）、`:1805`（入口 `.catch` → `process.exit(1)`）**均保持 `console.error` 原样**；`:540-541/:652/:734/:774/:922/:1321` 是 human 闭包本体，非残留。
7. **测试判别力（`apps/cli/src/jsonErrorExits.test.ts`，9 例）**：主用例与对照均**真 `JSON.parse`**（`:143`/`:158`），`code` 与 `expect(code).toBe(...)` 同源（`:148` vs `:168/:243`），human 侧用 `toBe` 逐字 + `expect(()=>JSON.parse()).toThrow()` 反向锁（`:157-158`），stdout 用空串（非仅 trim）断言（`:171/:197`）。**无永真断言**（`:167` 的 `not.toBe(0)` 与 `:147` 非空校验属冗余但非恒真）。**若把任一被覆盖出口还原为 `console.error`**：用例 1/3/5/6/7/8/9 必红（`JSON.parse` 抛）；用例 2 是 human 模式对照，本就不该检出 JSON 化回退——合理。覆盖为 7 条出口（用例 4 再叠加 7 条），其余约 48 处仅由静态 grep 锁定。

**未闭合项（本片口径内的真实缺口，非本轮 57 处断言的反例）**
- **U1（产品级，中）**：仍有 5 处**非 JSON 失败出口**，`--json` 下打人类文案并返回非零——其中 4 处写 **stdout**（违反 `output.ts:5-6`「stdout 只允许一段可解析 JSON」）：`cli.ts:1012-1013`（`setup` 非 TTY，exit 2）、`:1401-1403`（`pricing sync` offline，exit 1）、`:1446-1447`（`pricing` 未收录模型，exit 1）、`:1755-1756`（裸 `vessel` 非 TTY 无 `--prompt`，exit 2）；另 `:1022-1023`（setup 取消，exit 1）。均不在 9 例测试内。最小修复：四处改 `return fail(N, msg, flags, () => console.log(msg))`（`cmdSetup` 需把 `_flags` 改名使用；`dispatch` 用 `parsed.flags`）。
- **U2（覆盖）**：其余约 48 处出口 `--json` 化无测试锁，只有 grep/静态核对；建议按命令族补 3–5 条同类断言即足。

## B. `benchmarks/runners/src/lane/opencodeGoProvider.ts` 端点覆盖 —— **ACCEPT**

- **唯一入口**：全仓 `VESSEL_OPENCODE_GO_BASE_URL` 的**唯一读取点**是 `:80`（其余为注释/测试/文档）。`:77` 新增可选 `env` 形参，既有调用点零改动。
- **语义**：`env.X?.trim()` 真值判断 → 纯空白视为未设（回落 preset）；`replace(/\/+$/,'')` 剥尾斜杠。未设分支是单条 preset 查找 + 原错误文案（`:82-86`），静态看与改动前一致（**无 git diff 可比对，逐字等价仅到「同形单一分支」这一层**）。
- **两条路径都受影响**：chat 经 `opencodeGoEndpoint`（`:110`）→ `resolveOpencodeGoProvider`（`:137`）；models 经 `fetchOpencodeGoModels`（`:258`）；probe 亦经 `:341`。✅
- **产品运行时不受影响**：全仓无第二处消费 `opencodeGoBaseUrl`/`opencodeGoEndpoint`；CLI/TUI 走 `@vessel/application` preset 注册表与 `@vessel/llm` 自有常量，不经本函数。✅
- **残余风险（低）**：① 覆盖值为 `/` 或 `///` 时 trim 后真值、剥完变**空串**并直接返回（不再回落 preset）→ 会拼出相对 URL（`:80-81`）；最小修复 `const s = override.replace(/\/+$/,''); return s || preset.baseUrl;`（需把 preset 查找提为共用）。② 覆盖 URL 会经 `ModelSource.note = 'live from ${url}'`（`packages/application/src/providers/modelFetcher.ts:66`）被 `run-opencode-lane.ts:130` 打印并写入报告 note（`run-v11f-verify.ts:67`）；若网关把凭据放 query/path 即随日志/报告落地（API key 本身仍走 headers，默认不泄）。

## B 修复① 测试隔离 —— **ACCEPT**

- 顶层 `beforeEach/afterEach`（`:62-74`）快照 → `delete` → 还原，对文件内**所有** describe 生效；`:87` 显式注入空 env `opencodeGoBaseUrl({})`。✅
- **2 条默认端点断言仍在、未放宽**：`:85` `preset.baseUrl === 'https://opencode.ai/zen/go/v1'`；`:126` 先断言 `process.env.VESSEL_OPENCODE_GO_BASE_URL` 为 `undefined`，`:128` 再对 `opencodeGoEndpoint(...).baseUrl` 用 `toBe` 精确相等。✅（与指挥侧「设/不设 env 都 22/22、判别性 2 例红」一致。）
- **新增 2 条有判别力**：`:92-96` 尾斜杠剥离（若实现不回剥 → 得 `.../v1/`，红）；`:98-100` 空白=未设（若实现按 `!== undefined` 判断 → 返回空白串，红）。二者非恒真。✅
- **残余（低）**：无「缺省参数确实读 `process.env`」的用例——`:128` 在 env 已被删除的前提下，实现若把默认参数误改为 `{}` 仍会绿。最小补一条：`process.env.X='https://e.test/v1'; expect(opencodeGoBaseUrl()).toBe('https://e.test/v1')`。

## B 修复② 门禁注记证据化 —— **ACCEPT（有一条需加固）**

- `deriveUnitFailureNote`（`:228-271`）分支 A 需**同时**满足 `failedFileCount===1` **且** `failedTestFiles.length===1` **且** 该文件为 process-tree（`:233-237`），才写 flaky 注解，并附归因依据（`:244-245`）。其余走分支 B/C：列 stats、失败文件、并显式写「未自动归因」+「勿据此忽略回归」（`:249-269`）。调用点 `:343-347` 限 `status==='fail' && id==='unit'`，且是**追加**（保留 executor 原 note）。
- **截断到只有汇总行的情形**（`:148-149` 已声明只留尾部 18 行）：`failedTestFiles=[]` → 分支 B，输出「vitest 汇总行：…」「失败用例数=…」「evidence.detail 未出现任何 *.test.ts 路径」，**不产生任何因果断言**。✅
- 全 runners 无第二处 `flaky` 归因（grep 命中仅本文件）。✅
- **加固点（中，唯一能写出「未经证据支持的归因」的路径）**：`:237` 用 `endsWith('process-tree.test.ts')`，`foo-process-tree.test.ts` 这类文件名也会命中，而此时注解硬编码的「失败行只命中 packages/runtime/.../process-tree.test.ts」即为**假陈述**；应改为与 `PROCESS_TREE_TEST_FILE` 归一化后**全等**比较。
- **加固点（中，设计固有）**：分支 A 由「唯一失败文件=该文件」推出「非回归 / 隔离单跑 11/11 通过 / 视为环境性 flaky」——这是历史事实而非本次运行证据；`process-tree.test.ts` 内若有真实回归，仍会被写成 flaky。最小修复：附条件语（「若该文件本轮有改动或该断言连续复现，则为真实回归，须人工确认」）或要求失败行含 timeout 语义。
- **覆盖缺口（中）**：`extractUnitFailureFacts`/`deriveUnitFailureNote` 为模块私有、**零单测**（全仓 4 处命中全在实现文件）；本修复正确性目前只由指挥侧一次 423s 手工复跑背书。最小修复：导出二者 + 三条分支的表驱动用例（含「只有汇总行」截断用例）。

## 结论：**ACCEPT**（本片四项主张均经静态逐条核实；附 6 项未闭合观察，不构成本轮 REJECT 依据）

未闭合清单（按严重度）：U1 `--json` 下仍有 5 处人类文案失败出口（4 处污染 stdout）→ 改走 `fail`；B② `endsWith` 应改全等；B② flaky 因果语需限定；B② 归因函数零测试；B `.`/`/` 覆盖值产生空 baseUrl；A 出口测试覆盖 9/57。
