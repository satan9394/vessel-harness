# C5 突变实测原始记录（全部发生在 `%TEMP%` 副本内；真实工作树零变异）

## 副本

- 路径：`C:\Users\Satanchen\AppData\Local\Temp\composable-mut-20260913-021252`
  （`$env:TEMP` = `C:\Users\SATANC~1\AppData\Local\Temp`）
- 创建：`robocopy E:\Code_file\Projects\Composable_Agent_Harness <COPY> /E /XJ /XD node_modules dist .vitest .turbo coverage .git`
  - robocopy exit 1（= 有文件被复制，属成功码）
  - 排除 `.git`（副本仅用于跑 vitest，不含任何 git 元数据；不影响测试解析）
- 依赖：`<COPY>\node_modules` 建为**真实目录**，其下对真实 `node_modules` 的 129 个顶层条目逐个建 **Junction**（`@scope` 目录建成真实目录 + 子包 Junction），**跳过 `.vite`** ⇒ vitest 缓存只落在副本内，真实 `node_modules/.vite` 一个字节都不写。
  - `<COPY>\apps\web\node_modules` 为整目录 Junction（本卡不跑 web 测试，无写入）。
- 副本 `Telemetry.ts` 创建时哈希 == 真实树哈希：`A6A0F935D978C261FD1FDEEF1FEA79FC34A634734B810DDDD0D2DFCFAD901229`

## 变异 1（必做）：删掉 `case 'turn/end':` 分支

- 目标文件（副本内）：`packages/telemetry/src/Telemetry.ts`
- 删除行号：**435–445**（原始行号，副本与真实树逐字节相同故行号一致）
- 删除内容（逐字）：

```
      case 'turn/end':
        // B09 记录的回放面（见类注释「B09 `turn/end` 记录的接线」）。
        // 身份 = `turnId`（与 `before_turn` 载荷同值）：实时已观测过这一轮 ⇒ 该轮的
        // turn/toolCalls 已由 `before_turn`/`after_tool` 事件计过，记录侧**一律不加**（防双计）；
        // 纯回放（未 attach 总线）⇒ 记录是唯一真源，按这一轮的 summary 如实补上。
        // 刻意**不**读 `kind`（`interrupts` 仍只取 `after_turn` 事件面：合成收尾记录会让
        // 崩溃恢复冒充人工打断），也不读 `stats.steps`/`tokensUsed`/`costEstimate`（理由见类注释）。
        if (this.liveTurnIds.has(r.turnId)) break;
        this.counters.turns += 1;
        this.counters.toolCalls += r.stats.toolCalls;
        break;
```

- 变异后副本文件哈希：`CF5ED0BC41C51E703C19466DEB647BFFADC75B2CC80AA6E0FFB67344ECFB20A3`
- 运行：`npx vitest run packages/telemetry --reporter=verbose`（workdir = 副本）
- 结果：**3 failed | 24 passed (27)**，exit **1**；Test Files 2 failed | 1 passed (3)
- 变红用例与失败点：
  1. ⑯ `telemetry.test.ts:746` `expect(counters.turns).toBe(1)` → `expected +0 to be 1`
  2. ⑰ `telemetry.test.ts:798` `expect(replay.turns).toBe(live.turns)` → `expected +0 to be 1`
  3. C4② `turnEndBoundary.test.ts:325` `expect(replay.turns).toBe(2)` → `expected +0 to be 2`
- **未红**：C4①（`turnEndBoundary.test.ts` 第一条，异常路径）—— 见下节结论。
- 原始输出：`C5-run1-mutation1.log`

## 变异 2（可选，1 轮）：去掉 `liveTurnIds` 身份去重

- 先从真实树把副本 `Telemetry.ts` 还原（哈希回到 `A6A0F935…`），再做**单点**变异
- 删除行号：**442**，删除内容（逐字）：

```
        if (this.liveTurnIds.has(r.turnId)) break;
```

- 变异后副本文件哈希：`FFF44DBAB7D5A328DDFE7B824F0980C96D50EDB3F978D0F236CBED7E00CDB550`
- 运行：同上命令（workdir = 副本）
- 结果：**2 failed | 25 passed (27)**，exit **1**；Test Files 2 failed | 1 passed (3)
- 变红用例与失败点：
  1. ⑰ `telemetry.test.ts:790` `expect(live.turns).toBe(1)` → `expected 2 to be 1`
  2. C4② `turnEndBoundary.test.ts:319` `expect(live.turns).toBe(2)` → `expected 4 to be 2`
- **未红**：⑯（纯回放不受去重影响，符合预期）、C4①（同上）
- 原始输出：`C5-run2-mutation2.log`

## 基线（绿）

复用 C4 那次真实树运行：`npx vitest run packages/telemetry` ⇒ 27 passed / 3 files / exit 0。
本卡在真实树**只取哈希与 `git status`，未跑任何测试**。

## 判别力矩阵（绊线判定）

| 用例 | 变异 1（删 case 'turn/end'） | 变异 2（删 liveTurnIds 去重） |
|---|---|---|
| ⑯ `telemetry.test.ts:711` | 🔴 `:746` turns 0≠1 | ✅ 绿（不受影响） |
| ⑰ `telemetry.test.ts:756` | 🔴 `:798` replay 0≠live 1 | 🔴 `:790` live 2≠1 |
| C4① `turnEndBoundary.test.ts:156` | ✅ 绿 | ✅ 绿 |
| C4② `turnEndBoundary.test.ts:216` | 🔴 `:325` replay 0≠2 | 🔴 `:319` live 4≠2 |

## 结论：绊线判定（逐条）

- **⑯（`telemetry.test.ts:711`）= 已证明是绊线**：删掉 `case 'turn/end':` ⇒ `:746` 红（turns 0≠1）。这正是它注释里自述的"改哪行会红"。
- **⑰（`:756`）= 已证明是绊线，且是双向绊线**：变异 1 红在 `:798`，变异 2 红在 `:790`。
- **C4②（`turnEndBoundary.test.ts:216`）= 已证明是绊线，且是双向绊线**：变异 1 红在 `:325`（纯回放侧），变异 2 红在 `:319`（实时侧）。它的注释预告的两条"改哪行会红"逐条兑现。
- **C4①（`turnEndBoundary.test.ts:156`）= 本卡**未**能证明是绊线（两轮均绿）**，如实记录：
  - 该用例的 Telemetry 侧断言是 `replay.turns === 0` / `replay.turns !== live.turns`；本场景里**根本没有 `turn/end` 记录**，所以"有没有 `case 'turn/end':` 分支"对它是**不可判别**的（删掉分支后 `replay.turns` 仍是 0）⇒ 这两条断言对变异 1 是重言式。
  - 它的真实绊线在 `AgentLoop.ts` 侧：`:462-463` 的 `else { throw err; }`（不落 `turn/end`）、`:208-212` 的 `before_turn`、以及 `llm/retry{decision:'abort',attemptNo:1}` 落盘。本卡只允许变异 `packages/telemetry/src/Telemetry.ts`，故这部分**未测**。
  - **建议后续卡（C6）**：在副本内把 `AgentLoop.ts:462-463` 改成"总能收尾"（例如不 rethrow），确认 C4① 的 `expect(ends).toHaveLength(0)` / `expect(replay.turns).toBe(0)` 变红 —— 那才是 C4① 的完整绊线证明。

综上：**⑯、⑰、C4② 是已用突变证明的绊线；C4① 的绊线尚待 AgentLoop 侧变异证明（本卡范围外）。**

## 卡面哈希更正（如实记录）

C5 卡面把 C1 快照期的 `c4f18bda…` 当作基线哈希；C2 已改过 `Telemetry.ts`，故该值必然过期。指挥侧已更正，本卡改用**开工实测值** `A6A0F935D978C261FD1FDEEF1FEA79FC34A634734B810DDDD0D2DFCFAD901229`（37867 B）作为前后对照基线。

## 真实树零写入证据（副本运行期间）

- 真实 `node_modules/.vite/vitest/results.json`：323 B / mtime `2026-09-13T02:11:27.4897965-07:00` / SHA256 `EB51AB728BB014BABAC7FD569665AFF99EE8977803A025F18BED811B55194F5C` —— 两轮跑完**完全未变**（副本自己的缓存落在 `<COPY>\node_modules\.vite\vitest\results.json`）
- `robocopy <COPY> <REAL> /L`（list-only 差异扫描）= 唯一差异是副本里被变异的 `Telemetry.ts` 本身
- 收尾复查：真实 `Telemetry.ts` SHA256 前后相等；`git status --short` 仍 9 项
