# EVALUATION-REPORT-13 — Round 10 复评（AC4/AC1）+ Round 7b 初评（BRIEF-11）

> 独立 Evaluator，全新上下文，对抗立场：先假设修复是假的。
> **静态审查，未复跑任何命令**（hard constraint）；不运行测试、不跑探针，全部结论来自读源码 + 读既有测试。
> 指挥侧证据（`tsc 0` / 1320 passed / E2E `PARSED_OK` / 掩蔽探针）按"转述证据"采信，但不替代静态核验。

## 第一部分 Round 10 复评

### 必修 1 / AC4（`--json` 下错误出口必须是 JSON）— **ACCEPT**

① 点名 5 处全部改走 `fail(...)`，静态核对逐条成立：`cli.ts:419`（provider 不存在，原 `return 2`）、`452-455`（models 拉取失败，原 `return 1`，human 回调保留 detail+hint 两行）、`992`（usage 日期参数，`return 2`）、`1589`（sessions 未知子命令，`return 2`）、`1631`（未知命令，`return 2`）。`fail()`（`output.ts:24-32`）在 `isJson` 时只输出 `{error:{message,code}}` 到 stderr，不带 human 回调 → 这 5 条在 `--json` 下**再无人类文案出口**。
② 兜底：`main()`（`1682-1690`）`try { dispatch(parsed) } catch (err) { if (!isJson(parsed.flags)) throw err; return fail(1, describeStartupFailure(err).message, parsed.flags); }`。`providers.json` 损坏由 `cmdProvider → store.getCurrent()` 抛出，早于任何 stdout 打印 → stderr 单段合法 JSON、无人类标题（与指挥 E2E `PARSED_OK` 一致）。
③ 非 JSON 路径**确实 rethrow**（`1687` 无 try 包裹、无吞异常），入口 `.catch`（`1696-1700`）渲染 + `exit 1`。`cli.crashSurface.test.ts` 的 `rejects.toThrow(/providers\.json/)`（②）与 `rejects.toThrow(/settings\.json/)`（①）仍是同一 `main()` 导出，崩溃面契约未回归。
④ 退出码语义未变：`fail` 直接返回传入 code（5 处维持 2/2/1/2/2，与改前 return 值逐条对应）；兜底为 1，与改动前入口 `.catch → exit 1` 一致。
**残余（不推翻本项判定，但需记档）**：`--json` 是全局 flag，`cli.ts` 仍有约 60 处 `console.error` 未走 `fail`，其中**在 `dispatch` 内的 `1599`（`resume` 目标无效）**会向 stderr 打 `[vessel] …` 人类文案并返回其 exitCode；`usage recompute --json`、`bench-report --json`、`serve --json`、`provider add/set/remove/export/import --json` 同理。若 AC4 按"任何 `--json` 错误出口"的字面全量口径解释，则**尚未闭合**；按本轮点名的 5 处 + 兜底路径口径，则达成。

### 必修 2 / AC1（`jsonCommands.test.ts` 覆盖五条命令）— **REJECT**

- **覆盖不全**：BRIEF-10 §2 明列五条 = `usage` / `provider list` / `models` / `sessions list` / `settings list`。7 例实际只覆盖 4 条（1/2/7=usage、3=provider list、4/6=sessions、5/6=settings），**`models --json` 零用例**（该命令有 mock / 实时 / 内置三分支，`cli.ts:422-426`、`442-445`、`460-462`）。
- **空表永真**：用例 3 走临时空 provider root，`providers` 恒为 `[]`，`not.toContain('"apiKey"')` 与"逐条键不含 apiKey"是**空集上的永真断言**，未真正验证白名单外扩。判别性要求 seed 一个含 `apiKey` 的 provider（内存假凭据后端 / `store.setSync`）后仍无 `apiKey`。
- **缺 AC4 判别用例**：EVALUATION-REPORT-12 第 50 行点名要的"`provider list --json` + 损坏 `providers.json`"用例**未落地**；用例 7 是 `usage.json` 损坏→隔离降级（`return 0`、`cap.err()` 为空），恰恰不是错误出口，不能作为 AC4 的判别证据。
- **数值一致（用例 2）成立**：`/估算成本:\s*\$([0-9.]+)/` 取文本数值后 `Math.abs(textCost - jsonCost) < 1e-4`，是**数值比较**而非格式化字符串比较 ✅。仅提示判别力边界：seed 成本 0.00082，文本侧 `toFixed(4)`=0.0008，容差 1e-4 覆盖了四舍五入；若 JSON 分支改用相近量级的错误价目，本断言可能不挂。
- 用例 1/6/7 判别性成立（键齐全 + 数值来自真实记录 + 默认路径仍是人类文案且非合法 JSON + 隔离留档不删原字节）。

**最小修复方向**：补 `models --json`（mock 分支即可）1 例；用例 3 先 seed 含 `apiKey` 的 provider；新增 `provider list --json` + 损坏 `providers.json` → `code===1` 且 `JSON.parse(stderr).error.code===1` 1 例。

## 第二部分 Round 7b 初评（BRIEF-11）— **REJECT**（3/5 项达成，验收 3 直接未达成）

- **顺序证据（验收 1）✅**：`errorBody.ts:23-29` 先 `.replace(...)` 四次遮蔽，末尾才 `sanitizeWireSnippet(masked, max)`（剥 URL/压空白/截断）；注释明确"先遮蔽、后截断"。旧缺陷（先截断致边界密钥碎片躲过 `{6,}`）静态上已消除。
- **无 `\b` ✅**：`/(?:sk[-_]|gsk_|hf_)[A-Za-z0-9_-]{6,}/g`、`/AIza[A-Za-z0-9_-]{10,}/g` 均无左边界断言；`Bearer`、JSON 字段正则同样无。
- **前缀覆盖 ✅**：`sk-`/`sk-ant-`/`sk-proj-`（前缀匹配）、`gsk_`、`hf_`、`AIza`、`Bearer`、`"(api_key|api-key|authorization|token)":"…"` 均可达。
- **HTTP 200 带 error 体（验收 4）✅ 已改**：`OpenAICompatibleProvider.ts:125` → `provider error: ${sanitizeErrorBody(body.error.message ?? body.error.type ?? 'unknown')}`（前缀保留）；`AnthropicProvider.ts:232` 同形。
- **`dpapiArgv.test.ts`（验收 5）✅**：`expectMaterialsOnlyOnStdin` 末条断言脚本含 `$input`（`74-75`），三处 mocked 用例（`109`/`137`/`159+164`）全部经该 helper，覆盖 set/get/probe。
- **验收 3 未达成 ✗（明确未完成项）**：`OpencodeGoProvider.ts:214` 仍是 `sanitizeWireSnippet(extractWireErrorMessage(bodyText) ?? bodyText)`，**未改用 `sanitizeErrorBody`**，BRIEF-11 理想行为 3 / 验收 3 直接落空——opencode-go 401 体里的 `sk-live-…`（BRIEF §当前问题 2 的原案例）仍会随 `message` 外显。
- **验收 2 的"单测各一条"未达成 ✗**：`errorBody.test.ts` 仍是 Round 7 的 7 例（URL/OpenAI sk-/Bearer/JSON 字段/截断/空串/自定义 max），**零新增**；全仓 grep `gsk_|AIza|hf_` 在测试中零命中。指挥侧的六前缀探针是**一次性运行证据，不是持久化用例**——回归时无人守。
- **挑战①（去 `\b` 的误遮蔽）**：判定**可接受**，不算缺陷。`sk-format` 一类会被掩成 `di`+`sk-<redacted>`（`disk-format` 确会中招），但该函数只作用于 provider 错误体短文本，不参与任何机器可读路径（`--json` 信封的 `message` 也只是错误文案），且注释显式声明了该取舍。若要消误伤，最小加固是给后缀加熵约束（如要求尾部含数字或大写），但会牺牲纯小写密钥，**不建议本轮改**。
- **挑战②（`sk_live_`）**：**不属于验收 2 未达成**——验收 2 明文只列 `gsk_`/`AIza`/`hf_`/`sk-ant-`。且需注意：本评审**会话进行中该文件被改过一次**（首次读：29 行、仅 `sk-`；末次读：30 行、`/(?:sk[-_]|…/`，注释新增 `sk_live_/sk_test_`）——按末次读，`sk_live_`/`sk_test_` **已能匹配**。副作用：Stripe 变体被统一改写成 `sk-<redacted>`，丢失前缀语义（观感损失，非泄漏）。因其无对应用例，仍计入上面的测试缺口。

**最小修复方向**：① `OpencodeGoProvider.ts:214` 改 `sanitizeErrorBody(extractWireErrorMessage(bodyText) ?? bodyText)`（注意避免与 `errorBody.ts` 形成循环 import：`errorBody → OpencodeGoProvider`，反向 import 会成环，需把 `sanitizeWireSnippet` 下移到独立模块或本地内联遮蔽）；② `errorBody.test.ts` 补 `gsk_`/`AIza`/`hf_`/`sk-ant-`/`sk_live_` 各 1 例 + 1 条跨 240 边界判别例（`'a'.repeat(238)+'sk-abcdef123456'`，断言不含 `sk-abcdef`）；③ 两处 HTTP 200 分支与 opencode-go detail 各补 1 例含假 key 的响应断言。

## 结论

| 项 | 判定 |
| --- | --- |
| Round 10 必修 1 / AC4（点名 5 处 + 兜底） | **ACCEPT**（残余：dispatch 内 `1599` 等未点名出口仍打人类文案） |
| Round 10 必修 2 / AC1（五条命令用例） | **REJECT**（缺 `models`；空表永真；无 AC4 错误路径用例） |
| BRIEF-11 整体 | **REJECT**（验收 3 未做；验收 2/3/4 用例缺失；验收 1/4/5 静态达成） |

标注：**静态审查，未复跑命令**（未运行 `tsc` / `vitest` / 任何探针）；接受指挥侧运行证据为转述。另注：`packages/llm/src/provider/errorBody.ts` 在本评审会话期间发生过一次并发修改，故以末次读（30 行版本）为准，建议指挥确认工作树已冻结后再定稿。
