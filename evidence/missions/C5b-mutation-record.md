# C5b 突变实测原始记录：AgentLoop 异常路径（全部发生在 `%TEMP%` 副本内；真实工作树零变异）

任务卡：`tasks/C5b-mutation-agentloop.md`（P0，补 C5 交证 §5 的诚实缺口）
执行日期：2026-09-13
结论一句话：**C4① 已被突变杀死（是绊线）**，但杀死它的位置**不是**卡面点名的 `:189/:210/:211`——见 §5 的两条实测与一条说明。

---

## 1) 副本路径与创建方式

- 副本路径：`C:\Users\Satanchen\AppData\Local\Temp\composable-mut-c5b`
  （`$env:TEMP` = `C:\Users\SATANC~1\AppData\Local\Temp`；两者同一目录）
- 创建命令：
  ```
  robocopy E:\Code_file\Projects\Composable_Agent_Harness <COPY> /E /XJ /XD node_modules dist .vitest .turbo coverage .git
  ```
  - **robocopy exit 1**（= 有文件被复制，成功码）；结果：`Dirs 2044 / Files 4228 / 61.47 m`
  - `.git` 一并排除（副本只用于跑 vitest，无 git 元数据；不影响测试解析与 `git status`——真实树查询不经过副本）
  - 副本内 `packages/telemetry/src/turnEndBoundary.test.ts` 存在（C4 未提交文件已被复制：`True`）
- 依赖接线：`<COPY>\node_modules` 建为**真实目录**，其下**逐条 Junction**（**不是**整目录 Junction）：
  - 真实 `node_modules` 顶层 75 项 = 64 目录 + 1 文件（`.package-lock.json`）+ 10 个 `@scope` 目录
  - 副本内：`.package-lock.json` 用 `Copy-Item` 复制；**跳过 `.vite`**（仅 1 项）；其余 63 个非 scope 目录逐个 `New-Item -ItemType Junction → 真实同名目录`（含 `.bin`）
  - 10 个 `@scope` 建成**真实目录**，其下 66 个子包逐个 Junction ⇒ 合计 **129 个 Junction**（与 C5 的 129 完全一致）
  - **`@vessel` 的 18 个子包刻意改指向副本自身**（`<COPY>\packages\*`、`<COPY>\apps\*`、`<COPY>\benchmarks\runners`），而不是真实树——比 C5 更严：即使某条解析绕开了 vitest alias，也只会读到副本里的源码（即被变异的源码），不会读到真实源码
  - `apps\web\node_modules`：**整目录 Junction → 真实**（沿用 C5 已验证做法；本卡不跑 web 测试）
    - 已实测该目录在真实树里**只有 `.vite`** 一个子目录（就是个缓存目录），故本卡额外加了 GUARD-B（见 §4）专门盯它
  - 副本 `node_modules\.vite` 起点不存在（`Test-Path` = False），运行后副本自己的缓存落在 `<COPY>\node_modules\.vite\vitest\results.json`（312 B / `19EDECEA19FE8F95522CFF7F4D422F12C93556E530F91FEA669253FC2E94A236`）⇒ 缓存确实写在副本内
- 副本 `AgentLoop.ts` 创建时哈希 == 真实树：`8085DFF430C131C85F0BD32F5252B2D40EA43C44F22A37E0E1B91EE6EC81DC35`（55778 B）
- vitest 版本：`RUN v2.1.9 C:/Users/Satanchen/AppData/Local/Temp/composable-mut-c5b`（**从副本根跑**，不是真实树）

## 2) 变异内容（逐字）

变异点（副本与真实树逐字节相同，行号一致）：`packages/core/src/agent-loop/AgentLoop.ts:462-464`

变异前（原始，3 行）：

```ts
      } else {
        throw err;
      }
```

### 变异 A（第 1 轮，≡ 卡面「建议的变异方向」第一条：总能收尾）

把 `:463` 的 rethrow 换成"记录错误收尾后继续走到 `:528` 的 `turn/end`"（`:462`/`:464` 的 `else {`/`}` 保留）：

```diff
       } else {
-        throw err;
+        kind = 'error';
+        finalText = finalText || (err as Error).message;
       }
```

- 新 `:463-464`；变异后副本哈希：`B275733E41289CD0C9892441D78A9824E2C1314C7E37E1260172DF5C7535D93C`
- 效果：`catch` 不再短路，控制流继续到 `:497` 之后的收尾段并执行 `:528 session.appendSync({type:'turn/end', kind:'error', …})` ⇒ **异常回合也收尾并落 `turn/end`**，`runTurn` **不再 reject**

### 变异 B（第 2 轮，最小可行变体：保留 rethrow，但先落 `turn/end`）

先把副本 `AgentLoop.ts` **从真实树还原**（还原后哈希回到 `8085DFF430C131C85F0BD32F5252B2D40EA43C44F22A37E0E1B91EE6EC81DC35`，确认只有一处变异），再做单点插入：

```diff
       } else {
+        await session.appendSync({
+          type: 'turn/end',
+          turnId,
+          kind: 'error',
+          stats: {
+            steps: this.state.snapshot().steps,
+            toolCalls: this.state.snapshot().toolCalls,
+            durationMs: Date.now() - startedAt,
+          },
+        });
         throw err;
       }
```

- 插入后 `:463-472` 为新代码，`:473` 仍是 `throw err;`；变异后副本哈希：`904FA2649E22075DAF637EAC476C3C9B0F43C4FCB217A68852C5DEAAF4F85F68`
- 效果：**只加"错误路径也落 `turn/end`"这一件事**，`runTurn` 的 reject 契约逐字不变（`:176` 仍通过）

两个变异都只改 AgentLoop.ts 的 catch 尾分支，不改 Telemetry、不改任何测试文件、不改其它文件。

## 3) 变异跑的原始输出（副本内 `npx vitest run packages/telemetry --reporter=verbose`）

两次运行都在副本内（workdir = 副本根），vitest 累计 **2 次**，未跑 `tsc -b` / `test:all`。
日志：`C5b-run1-mutationA.log`、`C5b-run2-mutationB.log`

### 第 1 轮（变异 A）：`1 failed | 26 passed (27)`，exit 1，`Test Files 1 failed | 2 passed (3)`

变红的是 **C4①** 本身，但红在它**更早**的一条断言上——`turnEndBoundary.test.ts:176`：

```
 × packages/telemetry/src/turnEndBoundary.test.ts > B09 turn/end 边界 —— 两条反例的判别性用例（C4） > 异常路径（无并发；provider 抛不可重试错误）：有 before_turn 而无 turn/end ⇒ 实时侧计到该轮、纯回放侧计不到
   → promise resolved "{ …(6) }" instead of rejecting
```

```
 FAIL  packages/telemetry/src/turnEndBoundary.test.ts > … > 异常路径（无并发；provider 抛不可重试错误）…
AssertionError: promise resolved "{ …(6) }" instead of rejecting

- Expected
+ Received

- [Error: rejected promise]
+ Object {
+   "durationMs": 26,
+   "finalText": "Model call failed after 1 attempt(s): invalid request: malformed prompt",
+   "kind": "error",
+   "steps": 1,
+   "toolCalls": 0,
+   "turnId": "turn_1789291048265_364dbe",
+ }

 ❯ packages/telemetry/src/turnEndBoundary.test.ts:176:38
    174|     // `:649-651` 抛出包装错误 → `:451-465` 的 catch 里既非 `TurnInter…`
    175|     // 也非 `DenialLimitError` ⇒ `:462-463` 直接 rethrow（本路径的核心…）
    176|     await expect(loop.runTurn('boom')).rejects.toThrow(/Model call fai…`
       |                                      ^
```

**卡面点名的三行（`:189` / `:210` / `:211`）在本轮没有被执行到**——`:176` 失败即抛出，`it()` 中止（详见 §5）。

### 第 2 轮（变异 B）：`1 failed | 26 passed (27)`，exit 1，`Test Files 1 failed | 2 passed (3)`

变红的正是卡面第一条点名的断言 `turnEndBoundary.test.ts:189`：

```
 × packages/telemetry/src/turnEndBoundary.test.ts > … > 异常路径（无并发；provider 抛不可重试错误）… 
   → expected [ { type: 'turn/end', …(5) } ] to have a length of +0 but got 1
```

```
 FAIL  packages/telemetry/src/turnEndBoundary.test.ts > … > 异常路径（无并发；provider 抛不可重试错误）…
AssertionError: expected [ { type: 'turn/end', …(5) } ] to have a length of +0 but got 1

- Expected
+ Received

- 0
+ 1

 ❯ packages/telemetry/src/turnEndBoundary.test.ts:189:18
    187| 
    188|     const ends = records.filter((r): r is TurnEndRecord => r.type === …
    189|     expect(ends).toHaveLength(0);
       |                  ^
    190|     expect(ends.filter((e) => e.turnId === turnId)).toHaveLength(0);
```

`Test Files 1 failed | 2 passed (3)`、`Tests 1 failed | 26 passed (27)`、exit 1。

### 其余用例状态（两轮一致，如实记录）

- 第 1 轮 26 passed / 第 2 轮 26 passed：`telemetry.test.ts` 全部 20 条（含 ⑯`:746`、⑰`:798`）、`auditRecordWiring.test.ts` 全部 6 条、C4② `turnEndBoundary.test.ts:216`（`:319`/`:325`）
- **两轮都没有出现"预期外"的红**：唯一变红的就是 C4①，唯一绿→红的差异只由注入的变异解释
- 基线只做对照、未额外占额度：C5 记录的绿基线为 `27 passed (27)`；本卡两轮都是 `1 failed + 26 passed = 27`，即**除被变异杀死的那一条外，27 条用例的判定与基线逐个相同** ⇒ 副本环境与真实树功能等价（未跑第三次基线，属额度内的取舍，已如实记录）

## 4) 真实树哈希前后对照 + `git status --short`

| 文件 | 开工前 SHA256 | 收尾后 SHA256 | 一致 |
|---|---|---|---|
| `packages/telemetry/src/Telemetry.ts`（37867 B） | `A6A0F935D978C261FD1FDEEF1FEA79FC34A634734B810DDDD0D2DFCFAD901229` | `A6A0F935D978C261FD1FDEEF1FEA79FC34A634734B810DDDD0D2DFCFAD901229` | ✅ |
| `packages/core/src/agent-loop/AgentLoop.ts`（55778 B） | `8085DFF430C131C85F0BD32F5252B2D40EA43C44F22A37E0E1B91EE6EC81DC35` | `8085DFF430C131C85F0BD32F5252B2D40EA43C44F22A37E0E1B91EE6EC81DC35` | ✅ |

`git status --short`（收尾后，仍 **9 项**，与开工前逐字相同）：

```
 M docs/ARCHITECTURE.md
 M docs/BENCHMARK-SPEC.md
 M docs/product-evolution/PRODUCT-STATE.md
 M packages/shared/src/unwiredRecords.test.ts
 M packages/telemetry/src/Telemetry.ts
 M packages/telemetry/src/telemetry.test.ts
?? DSH_RECOVERY_CHECKPOINT.md
?? DSH_RECOVERY_REPORT.md
?? packages/telemetry/src/turnEndBoundary.test.ts
```

写穿守卫（跑完两轮后复查，均**逐字节未变**；均已在上表之外单独记录长度+毫秒级 mtime+哈希）：

- **GUARD-A**（C5 同款）真实 `node_modules\.vite\vitest\results.json`：323 B / mtime `2026-09-13T02:11:27.4897965-07:00` / `EB51AB728BB014BABAC7FD569665AFF99EE8977803A025F18BED811B55194F5C` ⇒ 未变
- **GUARD-B**（本卡新增，专盯 `apps\web\node_modules` 整目录 Junction）真实 `apps\web\node_modules\.vite\vitest\results.json`：829 B / mtime `2026-09-12T13:29:19.5425243-07:00` / `246A39727D8E1ABCCED0EDC617955AFDE10FE620661CF9416D0166D94EFDDD4A` ⇒ 未变
- 收尾后真实 `node_modules` 顶层仍 75 项，`node_modules\vitest\package.json`、`node_modules\argparse\package.json` 均在，`node_modules\@vessel\core` 仍是指向真实 `packages\core` 的 Junction（原样）
- 真实 `packages\core\src\agent-loop\` 下 18 个文件齐全，`AgentLoop.ts` 55778 B
- 收尾后副本已不在（见 §6），真实树无任何哑数据残留（`Test-Path <REAL>\node_modules\argparse\through.txt` = False）

## 5) 结论：C4① 是否已被突变证明为绊线

**是——C4① 是可判别的绊线（突变体被杀），但杀死它的不是卡面点名的三行中的任意一行；卡面点名的 `:189` 由"最小可行变体"（变异 B）单独钉死；`:210`/`:211` 本卡**未能**观测到变红，原因是结构性的（见下）。**

逐条如实说明：

1. **变异 A（≡ 卡面建议的"总能收尾"）杀死了 C4①，但红在 `:176`**：
   `:176` 是 C4① 的第一条断言 `await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 1 attempt/)`。把 rethrow 改成"收尾并返回"后，`runTurn` 由 reject 变成 resolve（返回 `kind:'error'`、`finalText:'Model call failed after 1 attempt(s): invalid request: malformed prompt'`）⇒ `:176` 立刻红。
   ⇒ 事实上 C4① 用一条断言就把"异常路径也能收尾"这个行为钉死了（该变异体被杀死），**它不是橡皮图章**。但卡面预期的 `:189/:210/:211` 在本轮**根本没被执行**：`it()` 内某条 `expect` 一失败，后续断言不再求值。
2. **变异 B（最小可行变体：保留 rethrow，只在 `throw err` 前落一条 `turn/end`）⇒ `:189` 精确变红**：
   `expected [ { type: 'turn/end', …(5) } ] to have a length of +0 but got 1`。这证明卡面点名的 `expect(ends).toHaveLength(0)`（`:189`）**确实是"错误路径不得落 `turn/end`"这个行为的绊线**，且该变异体是最小的——只加一件事（一条 appendSync），不触碰 reject 契约、不触碰 Telemetry。
3. **`:210`/`:211` 没有被实测观测到**（结构性原因，如实标注为**未验证**）：
   同一个 `it()` 内 `:189`（以及 `:190`、`:194`）先失败即中止，`vitest ≤2 次` 的额度已用尽，故本卡**没有**做"把 `:189/:190/:194` 摘掉后再看 `:210/:211`"的第三次运行。
   **代码层面的推断（推断，非实测）**：变异 B 写入的记录是唯一一条 `turn/end`，而 `:209` 的 `replay` 是一个**全新 `Telemetry()`**（`liveTurnIds` 为空）⇒ `Telemetry.ts` 的 `case 'turn/end'` 会 `counters.turns += 1` ⇒ `replay.turns` 会变成 1 ⇒ `:210` 的 `expect(replay.turns).toBe(0)` 会红；同时 `live.turns` 仍为 1（`before_turn` 计一次）⇒ `:211` 的 `expect(replay.turns).not.toBe(live.turns)` 也会红。**要把它从"推断"变成"实测"，最小代价是删掉 `:189`/`:190`/`:194` 三条中的前两条后再跑一次变异 B（需 1 次 vitest 额度）。**
4. 因此对卡面验收标准的准确回答：
   - "C4① 是否已被突变证明为绊线" ⇒ **是**（变异 A 杀死它；变异 B 在点名行 `:189` 杀死它）
   - "卡面点名的三条断言是否都被观测到变红" ⇒ **否**（只观测到 `:189`；`:210`/`:211` 因测试内 fail-fast + 额度上限未被执行）
   - 最小可行变异方案 ⇒ **变异 B**（插入 10 行 `appendSync({type:'turn/end', kind:'error', stats:{…}})` 到 `throw err;` 之前）；理由是它不掩盖 `:176` 的 reject 契约，能把"错误路径也落 `turn/end`"这一个行为单独暴露出来，且爆炸半径仅限该路径（其余 26 条用例两轮全绿）

## 6) 副本清理情况 + 偏差/未完成项

- **回收前排练（哑数据，全在 `%TEMP%`，不涉及真实仓库）**：
  - `%TEMP%\c5b-rehearse-target`（真目录，放 `keepme.txt`）+ `%TEMP%\c5b-rehearse-holder`（内含 Junction `link → c5b-rehearse-target`）
  - 经 Junction 写入 `c5b-rehearse-holder\link\through.txt`（实际落在 target 里，确认写入确实穿透 Junction）
  - `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('…c5b-rehearse-holder','OnlyErrorDialogs','SendToRecycleBin')`
  - 结果：`holder gone: True`、**`target survived: True`**，target 里 `keepme.txt,through.txt` 两条**都在** ⇒ **回收站删除不跟随 Junction**（本次副本的 Junction 结构安全）
- **实际清理**：`[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('C:\Users\Satanchen\AppData\Local\Temp\composable-mut-c5b','OnlyErrorDialogs','SendToRecycleBin')` ⇒ `exists after: False`；排练两个目录也已同法回收（`False / False`）。**未使用任何永久删除类 API**
- **回收后复查真实 `node_modules` 完好**：顶层 75 项、`vitest`/`argparse` 等在位、`@vessel/core` Junction 原样、真实两个文件哈希不变、`git status --short` 仍 9 项 —— 全部见 §4（该复查在回收**之后**执行）
- 偏差 / 未完成项（逐条）：
  1. **未跑副本内基线**：vitest 额度 2 次全部用于两个变异（卡面要求"确认 C4① 变红"优先）；补偿证据是两轮均 `26 passed`（与 C5 基线逐条一致）
  2. **`:210`/`:211` 未实测变红**（§5.3），只给推断 + 具体补测方法；这是额度与 fail-fast 共同导致的
  3. **`apps\web\node_modules` 仍用整目录 Junction**（沿用 C5 做法，未改成空目录）；新增 GUARD-B 专门盯它的 `.vite` 缓存，两轮后哈希/mtime 均未变。若要彻底消除该残余风险，下一次可把该路径建成空目录（本卡未改，避免动到已证可用的副本结构）
  4. **比 C5 更严的一处**：`@vessel` 18 个子包在副本里指向副本自身源码（C5 记录未说明其指向），消除了"变异了副本、却解析到真实源码"这一假阴性风险
  5. 命令文本内未出现任何永久删除类 API 字面名（全部走 `Microsoft.VisualBasic.FileIO.FileSystem` 回收站路径）
