# M1 残留清理：措辞与陈旧引用（零断言改动）

- 状态：待执行（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P1**
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 3
- 来源：**planned**（第 3 轮评审 `.dsh-mission/evidence/M2-review-verdict-3.md` §5/§7 列出的 4 条残留 + C8 的 R8 陈旧指针）

## 目标（**只改文字，不动任何断言**）

1. **`packages/telemetry/src/telemetry.test.ts:340-342`**：现文「去掉反引号 ⇒ `recordTokens()` 抽不到它（上面两条 `toContain` 先红 = 清单漏检），**同时裸 token 报警器在这里点名** ⇒ 不留"静默漏掉一个未消费项"的口子」。
   **事实**：按 fail-fast，`toContain` 先红时 `:343` 的 `expect(bareRecordTokens(unwired)).toEqual([])` **不会被执行** ⇒ "在这里点名"是**角色/机制**说法，不是实跑事实（同文件 `:372-373` 已给出正确口径）。
   **改法**：把它改成与 fail-fast 一致（例如"报警器**留作**新增裸词项的绊线；本条路径上它会先撞在 `toContain` 上"），保留"不留静默漏检口子"的原意。
2. **`packages/telemetry/src/turnEndConditionGuard.test.ts:28`**：「（`Telemetry.ts`、**三份 docs**、本包测试文件自身）」→ **四份 docs**（实现实读 `ARCHITECTURE` / `BENCHMARK-SPEC` / `EVENT-SPEC` / `PRODUCT-STATE`，见 `:40-43`）。这是**少报**，改准即可。
3. **`tasks/121-doc-condition-guards.md`** 的陈旧引用（该卡已提交，本轮**修它就是为了让读者不再被旧数字误导**）：
   - `:28` 的「`telemetry.test.ts`（**962 行**）」→ 现值 **973 行**（或明写"当时 962 行，最终 973 行"）
   - `:146` 的「`59  4  packages/telemetry/src/telemetry.test.ts`」→ 最终 **`72  6`**（同为 numstat，口径一致）
   - `:79` 的「**E7** 那处是补集形式」→ 标号应为 **R1-7**（内容属实，只错标号）
   - `:52`/`:214`/`:220` 与 §9 里的 `mission2-slice-final2.patch` → 明写**已由 `mission2-slice-final3.patch` 取代**（或直接改指 `final3`：10013 B / `364B330E…A757`）
   - `:145` 的 `telemetry.test.ts` 旧哈希 `8501D7B0…` → 最终 `B3F23885…410E`（或标注"§8.1 坐标，最终见 §8.2"）
   - **原则**：**不得删除历史层**；要么改准，要么就地标注"历史坐标，最终以 §8.1/§8.2 为准"。
4. **`docs/product-evolution/PRODUCT-GAP-MAP.md:430`**（R8）：现引「`EVENT-SPEC.md:600` 不变式」，而该不变式现在在 **`:605`**（另有 `:470` 一处）。按纪律 25 **优先给符号名**（如"`EVENT-SPEC.md` 的『不变式（贯穿全图）』那一段"）；若保留行号，必须与当前文件一致，并在旁边注明"行号会漂移"。

## 硬边界

- **不得改任何断言**（`.test.ts` 里 `expect(...)`/`it(...)` 逐字不动；只动注释）；本卡**不得新增**断言
- **不得改**运行时源码（`packages/*/src/**` 非测试文件）、**不得改** `docs/ARCHITECTURE.md` / `docs/BENCHMARK-SPEC.md` / `docs/EVENT-SPEC.md` / `docs/product-evolution/PRODUCT-STATE.md`（它们是被守卫的对象 —— 改了就要动守卫，超本卡授权）
- **不得改** `RUN_STATE.md`、`.dsh-mission/**`（除本卡自己的回填）
- 若发现 `docs/product-evolution/PRODUCT-GAP-MAP.md` 被某个测试读取，**改完必须跑那一次定向 vitest**并贴证据；若该文件被守卫钉住内容而你的改法会红 ⇒ **停下报 BLOCKED**
- 定向 vitest **≤1 次**；**不得**跑 `tsc -b` / `test:all`（那是指挥侧的额度）
- 不做 git 写操作；不 install；不建子 Agent；命令文本不得含永久删除类 API 字面名

## 验收标准（客观门禁）

- [ ] 四条残留逐条改准（贴改前/改后逐字对照）
- [ ] **零断言改动**：`grep -c "expect("` 与 `it(` 计数前后一致；`git diff` 里没有任何 `expect`/`it` 行变化
- [ ] `docs/product-evolution/PRODUCT-GAP-MAP.md:430` 的引用与当前文件一致（行号若保留，逐条核对）
- [ ] 定向 vitest（若跑）**43 passed / exit 0**
- [ ] `git status --short` 恰为预期文件（**不得**多出无关项）
- [ ] 历史层未被删除（`tasks/121` 的 §2/§4/§9 若改，必须保留"当时坐标"的可追溯性）

## 涉及文件

- 改（注释/文字）：`packages/telemetry/src/telemetry.test.ts`、`packages/telemetry/src/turnEndConditionGuard.test.ts`、`tasks/121-doc-condition-guards.md`、`docs/product-evolution/PRODUCT-GAP-MAP.md`
- 只读：`.dsh-mission/evidence/M2-review-verdict-3.md`、`.dsh-mission/evidence/M2-review-verdict.md`

## 预期证据（执行器回填）

- [x] 逐条改前/改后对照（E1–E4，见下）
- [x] 零断言改动的机械证明（计数 + `git diff -U0` 过滤 `expect|it(`）
- [x] 定向 vitest 原始输出与退出码（跑了 **1 次**：`npx vitest run packages/telemetry`）
- [x] `git status --short`（4 项，恰为预期）
- [x] 偏差 / 未完成项（见"偏差"一节；**无 BLOCKED**）

### E1 `packages/telemetry/src/telemetry.test.ts:340-342`（只动注释，净 0 行）

改前（`:341-342`）：

```
    // 去掉反引号 ⇒ `recordTokens()` 抽不到它（上面两条 `toContain` 先红 = 清单漏检），
    // 同时裸 token 报警器在这里点名 ⇒ 不留"静默漏掉一个未消费项"的口子。
```

改后：

```
    // 去掉反引号 ⇒ `recordTokens()` 抽不到它；**既有**项被去掉反引号时，上面两条 `toContain` 会先红
    // （清单漏检本身；fail-fast ⇒ 本行轮不到执行）。裸 token 报警器**留作新增裸词项的绊线** ⇒ 不留"静默漏掉一个未消费项"的口子。
```

- `:343` 的 `expect(bareRecordTokens(unwired)).toEqual([]);` 逐字未动，行号未漂（3 行注释换 3 行注释；文件仍 **973 行**）。
- 与同文件 `:372-373` 已有的正确口径一致：报警器是**新增**裸词项的绊线；"既有项被去反引号"这条路径由 `toContain` 先红（fail-fast ⇒ 本行不执行）。原意"不留静默漏检口子"保留。

### E2 `packages/telemetry/src/turnEndConditionGuard.test.ts:28`（只动注释，净 0 行）

改前：` *  - **不镜像**（纪律 22）：直接读真实文件（`Telemetry.ts`、**三份** docs、本包测试文件自身），`
改后：` *  - **不镜像**（纪律 22）：直接读真实文件（`Telemetry.ts`、**四份** docs、本包测试文件自身），`
（与实现实读的 4 份一致：`ARCHITECTURE.md` / `BENCHMARK-SPEC.md` / `EVENT-SPEC.md` / `PRODUCT-STATE.md`，见 `:40-43`。文件仍 168 行。）

### E3 `tasks/121-doc-condition-guards.md`（10 行改，全部就地标注，**未删任何历史层**）

| 行 | 改前（要点） | 改后（要点） |
|---|---|---|
| `:28` | ``telemetry.test.ts`（962 行）` | ``telemetry.test.ts`（**当时坐标 962 行**；重做轮修复后为 **973 行**，最终字节见 §8.2）` |
| `:50` | `本卡冻结产物：… mission2-slice-final.patch、…` | 前加`（**首轮坐标**；最终冻结与门禁见 §8.2）`，并在 `mission2-slice-final.patch` 后加`（**已被 `backup/mission2-slice-final3.patch` 取代**）` |
| `:52` | `前序同族证据（Mission 1）：`backup/turn-end-slice-final2.patch`、…` | 加`（**注意同名不同物**：这是 Mission 1 的 `turn-end-slice-*` 补丁，不是 Mission 2 的 `mission2-slice-final2.patch`；后者**已由 `mission2-slice-final3.patch` 取代**，见 §8.2）` |
| `:79` | `E7 那处是补集形式` | `R1-7 那处是补集形式` |
| `:145` | `工作树冻结时 SHA256（…）：… `8501D7B0…`（962 行）、…` | 加`（**本行是首轮坐标，最终字节与行数一律以 §8.2 为准**——`telemetry.test.ts` 最终 = `B3F23885…410E`（58604 B / 973 行））`，旧哈希原样保留 |
| `:146` | ``59  4  packages/telemetry/src/telemetry.test.ts`。` | 加`（**首轮坐标**；重做轮起为 **`72  6`**，最终见 §8.2）` |
| `:214` | `| …mission2-slice-final2.patch | 9826 | 686DA6C5… |` | 文件名后加`（**已被 `mission2-slice-final3.patch` 取代**，见 §8.2）` |
| `:220` | `…final2.patch` ⇒ exit 0（原样零输出）。` | 加`**注意**：`final2` **已被 `mission2-slice-final3.patch` 取代**（见 §8.2）……后续取证/回退**必须**用 `final3`。` |
| `:288` | `…mission2-slice-final2.patch`（重做轮）、…` | 加`（重做轮；**已被 `mission2-slice-final3.patch` 取代**，见 §8.2）` |
| `:303` ④ | `④ 本卡 §2/§4/§9 仍是…陈旧数字与指针（`final`/`final2`）…` | 句末**追加**（未改原字）`（**M1 残留清理卡已就地改准**：§2/§4/§9 现均写明"当时坐标 / 最终坐标"并指到 §8.1/§8.2 —— 历史层原样保留，本条判决记录的"当时状态"亦未删改）` |

### E4 `docs/product-evolution/PRODUCT-GAP-MAP.md:430`（1 行改，行号未漂 ⇒ 交叉引用仍有效）

改前：`` `turn/start → turn/end` **配对破坏**（`EVENT-SPEC.md:600` 不变式）。``

改后（引用文本，**优先符号名 + 保留一致行号 + 漂移声明**）：

```
`turn/start → turn/end` **配对破坏**（`EVENT-SPEC.md` 的「不变式（贯穿全图）」那一段，当前 `:605`；B06/B07 的配对不变式另见 `:470`。**行号会漂移，以符号名为准**）。
```

逐条核对：`docs/EVENT-SPEC.md:605` = `不变式（贯穿全图）：\`turn/start→turn/end\`…`（实测命中）；`:470` = B06/B07 行的「配对不变式」。文件仍 **555 行**、本条仍在 **`:430`** ⇒ `ARCHITECTURE.md:176`、`EVENT-SPEC.md:605`、`packages/telemetry/src/Telemetry.ts:212`、`tasks/120` 里指向 `PRODUCT-GAP-MAP.md:430` 的引用全部继续成立。

### 零断言改动的机械证明

```
BEFORE: telemetry.test.ts expect(=146 it(=35 | guard expect(=18 it(=11 | repo 320 files expect(=13157 it(=3397
AFTER : telemetry.test.ts expect(=146 it(=35 | guard expect(=18 it(=11 | repo 320 files expect(=13157 it(=3397)
```

```
$ git diff -U0 -- packages/telemetry/src/telemetry.test.ts packages/telemetry/src/turnEndConditionGuard.test.ts
  → 变更行（+/-，去掉 +++/---）共 6 行；过滤 'expect\(|it\(' ⇒ <EMPTY>
```

（注：对**全仓** `git diff -U0` 做裸 `expect|it(` 过滤会命中 3 行 —— 1 行是 git 为 `guard:28` 附的 hunk 上下文头 `@@ -25,7 +25,7 @@ import { describe, it, expect } from 'vitest';`，2 行是 `tasks/121` 那处 **Markdown 散文**里引用的 `expect(...)`/`it()` 字样；两者都不是被改动的断言行。）

### 定向 vitest（1 次，原始输出）

```
$ npx vitest run packages/telemetry
 ✓ packages/telemetry/src/turnEndConditionGuard.test.ts (10 tests) 29ms
 ✓ packages/telemetry/src/auditRecordWiring.test.ts (7 tests) 22ms
 ✓ packages/telemetry/src/turnEndBoundary.test.ts (2 tests) 84ms
 ✓ packages/telemetry/src/turnEndWitness.test.ts (4 tests) 140ms
 ✓ packages/telemetry/src/telemetry.test.ts (20 tests) 685ms
 Test Files  5 passed (5)
      Tests  43 passed (43)
VITEST_EXITCODE=0
```

stderr 复现一条 `DEP0137`（`FileHandle` GC 告警，即既有残余 ⑤）：是告警不是失败。

### `git status --short`

```
 M docs/product-evolution/PRODUCT-GAP-MAP.md
 M packages/telemetry/src/telemetry.test.ts
 M packages/telemetry/src/turnEndConditionGuard.test.ts
 M tasks/121-doc-condition-guards.md
```

`git diff --numstat` = `1 1` / `2 2` / `1 1` / `10 10`（**只改行、不增删行**）。受保护文件（`Telemetry.ts`、四份被守 docs）**零改动**；`.dsh-mission/**` 除本卡回填外**零改动**；无 `git add` / 无提交。

### 偏差 / 未完成项（无 BLOCKED）

1. **`tasks/121:52` 按卡面字面改会引入新错**：该处的 `backup/turn-end-slice-final2.patch` 是 **Mission 1** 的补丁（`backup/` 下只有 `turn-end-slice.patch` / `-final.patch` / `-final2.patch`，**没有** `turn-end-slice-final3.patch`），**不是** `mission2-slice-final2.patch`。故未按字面改指 `final3`，改为"同名不同物"的就地辨析 + 指向 §8.2。卡面原理（"要么改准，要么就地标注"）得到遵守 ⇒ **不构成 BLOCKED**。
2. **超出卡面逐条清单的两处追加注记**：`tasks/121:50`（§4 冻结产物指针）与 `:303` ④（§10 残余清单）也各自就地追加了一处指向 §8.2 的注记 —— 卡面原则明确覆盖"§2/§4/§9 陈旧指针"，且均为**追加**、未删历史。
3. 未跑 `tsc -b` / `npm run test:all`（卡面禁止）；未做 git 写操作；未 install；未建子 Agent；未改任何运行时源码与被守 docs。
4. `docs/product-evolution/PRODUCT-GAP-MAP.md` **未被任何测试读取**（全仓 grep 该文件名只在 `Telemetry.ts:212`、`parseOpenAI.test.ts:204` 的注释里出现，无 `readFileSync`）⇒ 按卡面该次 vitest 非强制，仍照跑以覆盖 E1/E2 两个 `.test.ts`。

## 验收结论（Evaluator / 指挥会话回填）

- 结果：
- 备注：
