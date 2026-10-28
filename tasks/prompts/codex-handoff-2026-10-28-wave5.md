# Codex 任务书（第五波）· 2026-10-28 · 收尾与最终验证

> 用法：把本文件路径交给 Codex，说明「按 V1 → V2/V3/V5 → V4 的顺序跑完」。额度充足，五项都值得做。
> 沿用第二波 §0 的全局约定与 §10 的交付格式；**不新建任务卡**，结果只追加到指定卡或写进指定证据文件。

## 0. 本波的两个变化

1. **PDW 全角色已切到 Codex**（`scan`/`test-plan` = `gpt-6.1-terra`；`implement` = `gpt-6.1-sol`/medium；`review`/`planner` = `gpt-6.1-sol`/high）。走 PDW 时不再用 DeepSeek；额度用尽才 `scripts/pdw-route.ps1 -Kind deepseek -All` 切回。
2. **最终验证交给 Codex，但必须换会话**：实现会话不得给自己的产物出验证结论；V4 的验证必须由另起的只读子代理完成，协调者最后再独立抽查一次全量门禁。这条不是形式主义——项目硬约束是「Generator/Evaluator 分离，Generator 不得自证完成」。

## 1. 五项与模型/档位

| 编号 | 任务 | 顺序 | 实现 | 复核 | 依据 |
|---|---|---|---|---|---|
| V1 | Windows 下 npm 探针可用，让 packaging gate 能给出真判据 | 1 | `gpt-6.1-sol` / medium | `gpt-6.1-terra` / medium | 改执行层命令构造，牵动 gate 判据 |
| V2 | 卡 260/275 的真实视口补拍（IAB） | 可并行 | `gpt-6.1-terra` / medium | `gpt-6.1-terra` / medium | 只写证据 + 追加卡 |
| V3 | `trash restore` 后运行中的 serve 看不到会话 | 可并行 | `gpt-6.1-sol` / **high** | `gpt-6.1-sol` / high | 跨进程状态一致性，最容易修错 |
| V4 | 最终全量验证 + 看板数字收口 | 最后 | `gpt-6.1-sol` / medium | `gpt-6.1-sol` / **high**（独立会话） | 验证必须独立于实现 |
| V5 | 提交前自检与建议提交分组（不 commit） | 可并行 | `gpt-6.1-terra` / low | 不需要 | 机械清单 |

冲突：V1 与 V4 都可能动 `HANDOFF.md`（V4 改数字），所以 **V1 先于 V4**；V2 只写 evidence 与卡 275，V3 写 server/docs/卡 345，V5 只写一份证据，三者互不重叠，可并行。
不用 Ultra、不开 Fast。

---

## V1 · Windows 下 npm 探针可用（packaging gate 的判据依赖它）

**实现** `gpt-6.1-sol` / medium；**复核** `gpt-6.1-terra` / medium。

### 问题与证据

上一轮 T1 查明：`gateDefaultRunCommand` 在 Windows 用 `execFile('npm', ...)`（无 shell）时直接 `ENOENT`，因为 npm 是 `npm.cmd`。
而 T2 之后判据已收紧：探针失败 ⇒ `pending`。于是 gate 现在**永远 pending**——判据没错，但执行层拿不到结果。

### 要做

1. 让默认 run command 在 Windows 能找到 npm：`npm.cmd` 或 `shell: true` 二选一，选**不改变其它平台行为**的方案；在报告里写清选择与理由。
2. 保留 `exit / stdout / stderr` 语义不变；`probeFailed` 的判定规则不动（T2 已定：抛出、非零退出、或两路输出同时为空 = 失败）。
3. 补测试：注入一个假 `exec`，断言命令名/参数正确（Windows 分支）；再断言非零退出仍 `pending`、正常退出且 dist/entry 都在才 `pass`。
4. 实跑一次该 gate，报告实际 verdict 与 `evidence.detail`（含 `npm pack exit=`、`stdoutBytes`、`stderrBytes`）。

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

- gate 实跑不再因 `ENOENT` 失败；`npm pack` 的真实 exit 与输出字节被写进 `evidence.detail`。
- 若 npm 探针修好后 gate 仍 `pending`（例如 stdout 为空），照实记录原因，不许放宽判据。

---

## V2 · 卡 260/275 真实视口补拍

**实现** `gpt-6.1-terra` / medium（IAB）；**复核** `gpt-6.1-terra` / medium。

### 背景

第三轮已修：W1 Stop 失败提示插入即滚入视口；W2 新建文件 `Write` 发只读 `/dev/null` Diff。
协调者的真实进程验证已证明 SSE 会推 `diff_inspector`（见 `evidence/sessions/2026-10-27-w2-e2e/PROOF.md`），但**没有真实视口截图**。
上一轮（run 3）IAB 报 `Browser is not available: iab`，记为 UNVERIFIED。

### 要做

1. 起 IAB；若报 unavailable，`js_reset` 后重试一次。仍不可用就**停**，写 UNVERIFIED（不得用 DOM 或旧证据代替）。
2. 隔离夹具工作区（系统 TEMP、独立 `USERPROFILE`/`HOME`/`VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT`），起 `vessel serve`(5678) + 本地脚本桩 provider（Write 两行 `before\nsecond\n`）。
3. **W1**：917×567 视口，制造一次受控 Stop 失败（浏览器侧拦截 `POST /interrupt` 返回 503，或等价），截图证明整段「停止请求失败…」完整可读、不被底边裁切；记录请求中 `disabled=true`、失败后恢复 `false`。
4. **W2**：新建会话 → 脚本桩发 `Write` → 等完成 → Inspector → Changes → Patch，截图证明 `fixture.txt`、`+2/−0`、`@@ -0,0 +1,2 @@`、`+before`/`+second` 可见，且**没有** apply/discard/revert；核对磁盘字节与只写一次。
5. 结束前停掉自建服务与桩，端口监听数回 0。

### 允许改的文件

`evidence/sessions/2026-10-28-iab-run4/**`（新建）、`tasks/275-ui-final-acceptance.md`（末尾追加）。不改产品、不改测试。

### 验收

- 两张图能读出上述关键文本/字段；截图不含真实用户会话或非夹具项目名。
- 某项无法验证就写「无法验证 + 原因 + 试过的手段与实测值」。

---

## V3 · `trash restore` 后运行中的 serve 看不到会话

**实现** `gpt-6.1-sol` / high；**复核** `gpt-6.1-sol` / high。

### 问题与证据

上一轮 T3 已让 `vessel trash restore` 真正重建索引（`SessionRegistry.restoreRemoved`，从 registry 自己的 journal 读历史元数据，不信任 trash 里的 `entry.json`）。
但它改的是 **CLI 进程**的 registry；**已运行的 `vessel serve` 内存里的 `sessionRegistry` 不会自动刷新**，所以 `GET /api/sessions` 仍看不到还原的会话。

### 要做（先定位，再选最小修法）

1. 定位：serve 侧 `sessionRegistry` 何时从磁盘读、`GET /api/sessions` 读的是内存还是每次读盘、journal 是否有可复用的增量读取入口。给 `path:line`。
2. 三选一，报告写明选择与理由：
   - **增量刷新**：列表接口前按 journal 增量把新增会话并入内存（不重建、不覆盖已有）；
   - **显式重载**：新增 `POST /api/sessions/reload`（只读式），文档写明何时需要调用；
   - **只写限制**：若两者都要动较多代码，则只更新 `docs/DELETION-AND-RETENTION.md` 与卡 345，明确「运行中的 serve 需重启才可见」，并报 blocker。
3. 补测试：真刷新路线 → 断言 restore 后无需重启即可在 `/api/sessions` 看到；只写限制路线 → 断言文档与卡内的限制描述存在，且没有谎称已自动可见。
4. 不改 `trash.ts` 的删除/保留语义，不改 345c 的删除事务。

### 允许改的文件

`apps/local-server/src/server.ts`、`apps/local-server/src/server.test.ts`、
`packages/application/src/session/SessionRegistry.ts`（仅当确需增量读取入口）、对应测试文件、
`docs/DELETION-AND-RETENTION.md`、`tasks/345-app-trash-and-retention.md`（末尾追加）。

### 自验

```
node node_modules/vitest/vitest.mjs run packages/application
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

### 验收

- 报告必须回答：**serve 运行中 restore 之后，`GET /api/sessions` 能否看到**（实测，不是推断）。
- 选「只写限制」路线时，必须同时改文档与卡，且不出现「已自动可见」的说法。

---

## V4 · 最终全量验证 + 看板数字收口（必须独立会话）

**实现/执行** `gpt-6.1-sol` / medium；**验证** `gpt-6.1-sol` / **high**，**另起只读子代理，不得复用实现会话**。

### 要做

1. 跑全量门禁：`pwsh -NoProfile -File scripts/gate-batched.ps1`，贴每步 exit 与计数（脚本自己会打印表格）。
2. 跑 `git diff --check`、`node scripts/check-append-only.mjs <本波追加过的卡>`，记录 exit。
3. 写 `evidence/sessions/2026-10-28-final-gate.md`：17 步表格、各段计数、三处 tsc、conformance、未跑项与原因。
4. 更新 `tasks/README.md` 的「当前未闭合」段与对应行；`HANDOFF.md` 的全量门禁数字、最近交付、待执行三行。**只改这几处，不动其它正文。**
5. 由独立只读子代理复核：逐项对照卡与证据，给 PASS/FAIL 与理由；不得修改文件。

### 允许改的文件

`tasks/README.md`、`HANDOFF.md`、`evidence/sessions/2026-10-28-final-gate.md`（新建）。

### 验收

- 门禁 17 步全绿（或有红项时逐条列出并说明不是本波引入）。
- 数字与我给的口径一致（根文件数 / passed + skipped；web 文件数 / passed）。
- 独立复核的 PASS/FAIL 附在证据文件末尾；**实现会话不得自己写 PASS**。

---

## V5 · 提交前自检与建议提交分组（不 commit）

**实现** `gpt-6.1-terra` / low；不需要复核。

### 要做

1. `git status --porcelain` 全量清单，按「代码 / 测试 / 文档与卡 / 证据 / 配置（`.pdw` 外）」分类，标出哪些是历史遗留未提交、哪些是最近三轮产生。
2. 给「建议提交分组」：每组路径 + 一句说明（例如「卡 353 租约修复：Session.ts + 两个测试 + 卡」）。**不执行 `git add`/`commit`**。
3. 自检：仓库内无 `.tmp` 残留、无把 `%TEMP%` 绝对路径写进文档正文、新增文件里 grep `apiKey|sk-|Bearer|secret` 无真实凭据。
4. 结论写进 `evidence/sessions/2026-10-28-precommit-audit.md`。

### 允许改的文件

`evidence/sessions/2026-10-28-precommit-audit.md`（新建）。只读其余全部；不改任何源码或卡。

### 验收

- 分组清单可直接照着提交（路径完整、无歧义）。
- 敏感字样检查有实际命令与结果，不是「我相信没有」。

---

## 2. 交回来时给什么

每项贴：改动文件、每条命令 + exit + 计数、未做与原因、被拒命令原文；V4 额外给独立复核的 PASS/FAIL。
协调者会在 V4 之后再独立跑一次全量门禁做最后抽查（不重复它的结论），然后落卡。
