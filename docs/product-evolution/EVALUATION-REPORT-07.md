# EVALUATION-REPORT-07 — Round 5b（G-04 P2 补修）+ Round 6（G-05a）独立验收

> 立场：对抗性，先假设实现有错。方法：**静态审查，未复跑命令**（未执行 tsc / vitest / CLI；指挥侧证据仅作一致性参照）。
> 审查对象：commit `50a395b`，工作树干净。结论：**第一节 ACCEPT ／ 第二节 ACCEPT**，附 1 项必修 P2（文档）+ 3 项 P3。

---

## 第一节：Round 5b（`apps/cli/src/usage/UsageStore.ts`）— **ACCEPT**

**① 三处改动与行为一致性 — PASS**
- 字段：`UsageStore.ts:411` `private suppressWrite = false;`。
- 分流：`UsageStore.ts:457-464` catch 取 `err.code`；`459` `ENOENT` 静默空表；`461` 置位；`462` `console.warn` 含 code 与 `this.file`。非 Errno 抛错（`code === undefined`）走 `unknown` 分支置位，安全侧正确。
- 早退位置：`UsageStore.ts:627` `if (this.suppressWrite) return;` 位于 `628` `mkdirSync` **之前** ✓。全类唯一写 `usage.json` 的是 `save()`（`631` 写 tmp、`636` rename）；`backupBeforeWrite()`（`589-623`）只被 `save()`（`629`）调用，抑制后不可达 → **置位后确实不再写**（含不写 backups、不建目录）。

**② 隔离成功后仍可写新表 — PASS**
`UsageStore.ts:563-565` 成功分支**不**置位；仅 `566-570` rename 失败分支置位（`568`）。成功隔离后 `save()` → `backupBeforeWrite()` 读原文件得 ENOENT → `596` 跳过 → 写出新表；与 `defaultStore.recovery.test.ts:153-154`、`UsageStore.recovery.test.ts:90-91` 的既有口径一致。

**③ 隔离名唯一化 — PASS（残留可忽略）**
`UsageStore.ts:560-562`：`bak = <file>.corrupted-<ts>`，`while (fs.existsSync(bak)) bak = <file>.corrupted-<ts>-${++n}`。同毫秒二次损坏：第一次命中 existsSync → 退化为 `-1`，**不会覆盖上一份** ✓。`Date.now()` 在循环内重算，极端跳毫秒时退化为新 ts（仍唯一），不构成缺陷。仅存跨进程 TOCTOU（existsSync→rename 之间），单进程 CLI 语义下可忽略。

**④ 未越界 — PASS**
diff 仅落在 `411`（新字段）、`457-464`（catch 分流）、`560-570`（唯一名 + 失败置位）、`627`（早退）四处；`backupBeforeWrite`(`589-623`)、`record`(`648-776`)、`recompute`(`797-981`) 零改动 ✓。

**遗留（不改变判定，但必须补）**
- **P2｜覆盖缺口**：`suppressWrite` 与 `-N` 唯一名分支**没有任何测试**——全仓 grep `suppressWrite` 只命中实现文件（`411/461/568/627`），`UsageStore.recovery.test.ts` 未新增用例（本 commit 未改该文件），且现有用例均不触发二次同毫秒损坏或读失败。AGENTS.md 规则 7（新功能必须有 Vitest 测试）在此**未满足**。最小补法：注入 `vi.spyOn(fs,'readFileSync')` 抛 `{code:'EACCES'}` → 断言 `record()` 后 `usage.json` 不存在且 warn 含路径；再以固定 `Date.now` 造同毫秒双损坏 → 断言目录内 2 份隔离文件。

---

## 第二节：Round 6（G-05a）— **ACCEPT**

**① argv 无材料 — PASS（附残余风险说明）**
脚本 `CredentialStore.ts:340-347` / `361-368` 只含 `$o.payload` / `$o.entropy` 属性名与 `$input`，**无任何材料字面量**；材料仅经 `354` / `375` 的 `input: JSON.stringify({payload, entropy})`。测试的 argv 检查是**无分隔全文拼接**（`dpapiArgv.test.ts:48-50` `call[0]+call[1].join('')`），且同时校验 `options.input` 存在、为字符串且含全部必需材料（`56-72`），三例分别覆盖写/读/probe（`105-109`、`133-137`、`155-164`）✓。
- **残余风险 1（P3）**：三例 mocked 用例只证明「argv 干净 + input 被传」，**不证明脚本真的消费了 stdin**（不变量「材料确实到达脚本」无断言）。该保证全靠 `dpapiArgv.test.ts:183-217` 的真实往返，而它在非 Windows `skipIf`、在 PowerShell/ProtectedData 缺失时**静默 `return`（`204-206`）** → 在无 DPAPI 的机器上，本修复的回归保护归零。廉价加固：在 mocked 用例补 `expect(call[1].join('')).toContain('$input')`（或断言脚本含 `ConvertFrom-Json`），确定性且跨平台。
- **残余风险 2（P3）**：`$input` 是**按行枚举**的管道输入，`ConvertFrom-Json` 逐项绑定；当前 `JSON.stringify` 无缩进、payload/entropy 均为无换行 base64 → 成立。若将来 payload 变为多行（prettify/换行）会静默失配。建议固化为 `$o = ($input -join '') | ConvertFrom-Json`，或在 `input:` 处加注释固定「必须单行」不变量。现有脚本未出现 `$input` 被 `Add-Type` 或其它语句消费的情况（`Add-Type` 在其之前且不读 stdin）。
- 落盘面：真实用例断言 `secrets.json` 不含明文/明文 base64（`213-215`）✓。

**② 真实往返 — PASS**
`dpapiArgv.test.ts:186-189` `vi.doUnmock('node:child_process')` + `vi.resetModules()` + 动态 import 拿真实现 ✓；假 key `FAKE_KEY = 'sk-test-not-a-real-key-123'`（`22`）与假熵（`24`）✓；非 Windows `it.skipIf(process.platform !== 'win32')`（`183`）✓；真实用例置于文件末尾（mock 解除顺序正确）✓。

**③ 三处转发 / 显式 false fail-loud / 库层默认未偷改 — PASS**
- 三处 `readSecretsFile` 调用点全部转发 `{ recover: this.recoverCorrupted }`：`CredentialStore.ts:231`（Plaintext.read）、`430`（Dpapi.read）、`449`（`readOrCreateEntropy`，构造期，赋值顺序 `395` 先于 `397` 调用 ∅ 无未初始化风险）✓ 全仓仅此 3 处。
- 显式 false 仍 fail-loud：`134-137`（invalid JSON）、`144-146`（形状不符）在 `opts.recover` falsy 时 `throw CredentialError`；`readSecretsFile` 默认形参 `= {}`（`118`）→ 库层默认仍 fail-loud ✓。
- 默认值未被偷改：`66`（文档「false（默认）」）、`218` / `395`（`?? false`）；工厂 `651` 原样透传调用方选项，恢复仍须调用方显式开启 ✓。测试 ③（`160-189`）同时覆盖直接构造与工厂路径，并断言「不隔离、不静默」✓。

**④ ENOENT 不误伤 — PASS**
`CredentialStore.ts:122-124` ENOENT 早返回空结构，不进 quarantine、不 warn、不产生 `*.corrupted-*`；测试 ④（`191-216`）断言无隔离文件、无「损坏/隔离」告警、不凭空造 `secrets.json`（DPAPI 的 `readOrCreateEntropy` 只读不写：`448-452`）✓。

**⑤ 越界 — PASS**
源码仅改 3 个声明文件（`CredentialStore.ts` / `defaultStore.ts` / `UsageStore.ts`），测试文件为**纯新增**（numstat `217/0`、`218/0`）。既有 `CredentialStore.test.ts:311/358` 的 fail-loud 断言不受影响；无任何既有测试依赖「默认 store 对损坏 secrets 抛错」。

**必修 P2（文档缺陷，本 commit 引入）**
`defaultStore.recovery.test.ts:30-41` 文件头仍以现在时断言「后者目前**没有**把 `recoverCorrupted` 传下去（`readSecretsFile(this.secretsFile)`，无 `{ recover }`）……用例 ①/② 会 RED」——与当前实现（`CredentialStore.ts:449` 已转发）**直接矛盾**，会误导后续读者/agent 去「重修」已修好的点。最小修法：把该段改写为历史叙述（「修复前 DPAPI 构造期未转发；本文件用例 ①/② 即该缺陷的回归锁」）。连带 `102` / `204` 的 `if (!store) return;` 是**不可达死代码**（其前的 `expect(...).not.toThrow()` 会先失败），删除以免被误读为「构造失败也算过」。

**测试缺陷扫查（必查 ④）**：未发现永真断言或断言错对象。`FAKE_KEY`/`ENTROPY_B64` 均非空串，`not.toContain` 断言有效；`dpapiCalls()` 过滤限定了 `powershell.exe` + `-Command`，不会因空数组而恒真（其后均有 `toHaveLength(1/2)` 兜底，`97/128/152`）。已知 `ds2`（`defaultStore.recovery.test.ts:136-137`）已正确改写为「避免 duplicate id 的测试侧约束」，注释说明了原因，属**正确处理**，不是把测试缺陷记为实现缺陷。

---

## P3 扫查结论
1. **属实**：`vessel usage` 标题硬编码 —— `apps/cli/src/cli.ts:924` `'=== 使用统计（~/.vessel/usage.json）==='`，而实际根目录受 `VESSEL_USAGE_ROOT` 控制（`UsageStore.ts:367-369`，`store.rootDir` 为 public，`391`）。同一文件 `892` / `894`（recompute 落盘提示）同病。最小修法：改用 `store.rootDir`（`cmdUsage` 已有 `store` 实例；recompute 分支需把 store 传入）。
2. **提交信息瑕疵**：commit 标题含孤立反斜杠 `（DPAPI via stdin \)`，疑似转义残留，建议 amend 描述（不改代码）。
3. `defaultStore.recovery.test.ts` 除上述头部注释外，其余断言（不删隔离文件、恢复后 `get` 可读回、显式 false 不静默）指向实现而非测试缺陷，判定正确。

## 结论
- 第一节 **ACCEPT**（Round 5b 三项语义与 BRIEF-05 硬验收项「不得覆盖损坏文件」一致；须补 suppressWrite / `-N` 分支测试）。
- 第二节 **ACCEPT**（argv 无材料、构造期转发、库层默认未变、ENOENT 不误伤均成立；须清理 `defaultStore.recovery.test.ts` 头部过期注释与死代码，并建议补 $input 消费断言）。
- 本报告为静态审查，未复跑 `tsc -b` / `vitest` / 真实 CLI E2E；指挥侧证据（120 文件 / 1271 passed + 1 skipped、credential 包 2 文件 36 用例、损坏 secrets 的 CLI E2E）未独立复现，仅用于一致性比对。
