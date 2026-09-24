# M2 · `DEP0137` 归因记录（执行器回传 · 2026-09-13）

任务卡：`.dsh-mission/tasks/M2-dep0137-attribution.md`
执行者：M2 隔离执行器（子代理）· HEAD `5f3ec0b` · Node v24.14.0 / vitest 2.1.9 / Windows

## 0. 结论（一句话）

`DEP0137` 的**泄漏句柄是 core 运行时造的**：`Session.loadExisting()` 合成收尾时
`this.append(...)` **没有 await**（`packages/core/src/session/Session.ts:141`），而
`Session.close()`（`:250-253`）只看 `this.fd` —— 重开日志后**立刻** close 的调用者
（`await` 之间没有时间片）必然让 close 看到 `fd === null`，随后 pending 的
`fs.promises.open` 才把 `this.fd` 赋值到一个已经关过的 Session 上 ⇒ FileHandle 永不关闭 ⇒
GC 时 `Warning: Closing file descriptor 4 on garbage collection` + `DEP0137`。

- **告警的直接触发文件（stderr 归属）＝ Mission 2 新文件 `packages/telemetry/src/turnEndWitness.test.ts`**（单独跑即可复现，见 §1 run1）。
- **触发用例＝用例①「崩溃合成收尾」**（`turnEndWitness.test.ts:160-198`，全文件里唯一 重开+立即 close 的路径）。
- **缺陷本体＝ `packages/core/**` 运行时源码** ⇒ 按任务卡硬边界 **只登记、不改**；测试文件里没有可做的"资源管理"修法（该用例**已经**调了 `close()`，`close()` 因竞态而空转），任何"修"都只能是在 close 前塞时间片，属于掩盖 core 的真实 fd 泄漏。
- 仓库工作树**零改动**（唯一新增文件在 gitignore 的 `.dsh-mission/evidence/` 下）。

## 1. 逐次运行（原始 stderr 未过滤 + 显式退出码）

日志文件（全部在 gitignore 的 `.dsh-mission/evidence/` 下）：
`M2-dep0137-run{1..4}.stdout.log` / `.stderr.log`、`M2-dep0137-minrep.{stdout,stderr}.log`

### run1（预算 1/4）—— 归因到文件
```
npx --no-install vitest run packages/telemetry/src/turnEndWitness.test.ts
EXIT=0      ✓ 4 tests passed
--- stderr（原样）---
(node:6164) Warning: Closing file descriptor 4 on garbage collection
(Use `node --trace-warnings ...` to show where the warning was created)
(node:6164) [DEP0137] DeprecationWarning: Closing a FileHandle object on garbage collection is deprecated. Please close FileHandle objects explicitly using FileHandle.prototype.close(). In the future, an error will be thrown if a file descriptor is closed during garbage collection.
```
**该文件单独跑即可复现 ⇒ stderr 归属到它。**（用途：文件级归因）

### run2（预算 2/4）—— 用例①单跑
```
npx --no-install vitest run packages/telemetry/src/turnEndWitness.test.ts -t '①'
EXIT=0      1 passed | 3 skipped
--- stderr（原样）---
（空）
```
**无告警。** 用途：把归因收敛到用例。

### run3（预算 3/4）—— 反向对照：②③④
```
npx --no-install vitest run packages/telemetry/src/turnEndWitness.test.ts -t '②|③|④'
EXIT=0      3 passed | 1 skipped
--- stderr（原样）---
（空）
```
**无告警。**

> run2/run3 的"空 stderr"**不能**当作"没有泄漏"的证据：DEP0137 只在 GC 恰好回收那个
> FileHandle 时才打印，而单用例跑的堆太小、GC 未必发生。**用例级二分被 GC 时机卡死**，
> 所以补了 §2 的 GC 无关判定器（不是 vitest run，见 §5 偏差）。

### run4（预算 4/4）—— 既有同形文件对照
```
npx --no-install vitest run packages/core/src/session/Session.test.ts
EXIT=0      ✓ 6 tests passed
--- stderr（原样）---
（空）
```
用途：看**既有**文件（`Session.test.ts:31-43` 与用例①同形）是否也单独吐这条告警 ——
单独跑没吐（GC 未发生），但 §2 证明它的形状**必然**泄漏同一个句柄。

## 2. 最小复现（GC 无关的判定器，确定性）

文件：`.dsh-mission/evidence/M2-dep0137-minrep.mts`（只读仓库源码；工作目录在 `os.tmpdir()` 下）
```
npx --no-install tsx .dsh-mission/evidence/M2-dep0137-minrep.mts     EXIT=0   （跑两次，逐字相同）
--- stdout（原样，两次一致）---
[meta] node v24.14.0 pid=18104
[A 复刻用例①（重开后立即 close，无 await）] first.fd after close = null
[A 复刻用例①（重开后立即 close，无 await）] fd right after open=null beforeClose=null afterClose=null settled=<open FileHandle> => LEAKED (fd 未关)
[A 复刻用例①（重开后立即 close，无 await）] 日志记录（证明合成收尾确实发生了）= turn/start,turn/end
[A 复刻用例①（重开后立即 close，无 await）] 已显式关闭泄漏句柄（仅为保持探针输出干净）
[B 对照（重开后等一个时间片再 close）] first.fd after close = null
[B 对照（重开后等一个时间片再 close）] fd right after open=null beforeClose=[object Object] afterClose=null settled=null => no leak
[B 对照（重开后等一个时间片再 close）] 日志记录（证明合成收尾确实发生了）= turn/start,turn/end
[done]
```
A 组 = 用例① 的调用序列（`Session.open` 重开含未收尾回合的日志 → 中间**无任何 await** → `close()`）：
`close()` 时 `fd` 仍是 `null`（空转），300ms 后 `fd` 被 fire-and-forget 的 `append` 赋成一个**开着的 FileHandle** ⇒ 泄漏。
B 组只多了一个时间片 ⇒ `close()` 真的把句柄关掉了。**A/B 只差这一个 await，泄漏与否如此翻转。**

最小复现（伪代码，无任何测试框架依赖）：
```ts
const first = await Session.open({ workspaceRoot: dir, sessionId: 'x' });
await first.appendSync({ type: 'turn/start', turnId: 't_open', surface: false }); // 留下未收尾回合
await first.close();
const reopened = await Session.open({ workspaceRoot: dir, sessionId: 'x' });     // loadExisting() 合成 turn/end（未 await 的 append）
await reopened.close();                                                          // fd 仍是 null ⇒ 句柄泄漏
```
建议的 core 侧最小修法（**本次未施加，超授权**）：`Session.ts:141` 的 `this.append({...})` 改成
`await this.append({...})`（或在 `close()` 里等 pending open 落地）。改完可用上面的 A/B 判定器验收。

## 3. 归因推理链 / 已排除清单

**为什么是它：**
1. run1：该文件**单独**跑就吐出这条告警（全仓只跑了它一个文件，进程内无别的测试）。
2. 三份全量日志里告警行与其 `✓ packages/telemetry/src/turnEndWitness.test.ts` 行**永远紧邻**
   （`M2-test-all.log` 264↔265、`-rerun` 283↔284、`-rerun2` 255↔256；3/3），而既有
   `Session.test.ts` 的 ✓ 行在三份日志里都在其后 ~400 行处、且那三份日志里它**没有**伴随告警。
3. 静态：全仓只有两处会在**重开含未收尾回合的会话**时触发 `loadExisting` 的合成 append
   ——`turnEndWitness.test.ts:183`（用例①）与 `packages/core/src/session/Session.test.ts:37`；
   该文件里只有用例① 是"重开后**零 await** 直接 close"的形状（`:183`→`:197` 中间全是同步断言）。
4. §2 判定器把这条链钉成确定性事实（与 GC 无关）。

**已排除（本轮证据范围内）：**

| 文件 | 排除依据 |
| --- | --- |
| `packages/telemetry/src/turnEndConditionGuard.test.ts` | 只用 `fs.readFileSync`（`:53`/`:136`）读文档与源码，**不开 FileHandle、不建 Session** ⇒ 不可能产出 DEP0137 |
| `packages/telemetry/src/telemetry.test.ts` | 只有 `openSession()` 单一入口（`:163`），**没有**"同一 id 重开"路径 ⇒ 无合成 append |
| `packages/telemetry/src/turnEndBoundary.test.ts` | 同上只有单一入口（`:87`）；但它**另有一处**失败路径泄漏，见 §4 |
| `packages/core/src/session/SessionLease.test.ts` | `:158` 的 `first` 没有未收尾回合、`second` 也不 append ⇒ `loadExisting` 无合成循环 ⇒ 无 fire-and-forget open |
| `packages/core/src/agent-loop/*.test.ts`、`AgentLoop.stream.test.ts` | 只有单次 `Session.open` + 显式 `close()`，无重开合成路径（静态核对 47 处 `Session.open` 调用点） |

**未排除 / 未验证：** 本轮只跑了 4 次定向 vitest（预算上限），没有对 `AgentLoop.*` /
`apps/**` 的每个文件做单独运行对照 —— 但"重开含未收尾回合"这一唯一泄漏入口已全仓枚举（见上表），
所以未跑的文件**不可能**经由本条机制泄漏。

## 4. 附带发现：这条告警**早于 M2**（不属于本卡修复面）

- `turnEndWitness.test.ts` 的创建时间是 **07:05:18**；而 `.dsh-mission/evidence/C5b-run1-mutationA.log`
  （**02:17**，副本 `%TEMP%\composable-mut-c5b`）里**已经有**同一条告警（第 10-12 行，pid 33212），
  那次只跑了 `telemetry.test.ts` / `turnEndBoundary.test.ts` / `auditRecordWiring.test.ts`（日志内 `turnEndWitness` 出现 0 次）。
- 那次泄漏的机制**不是**重开竞态，而是**失败路径的测试卫生**：该轮 `turnEndBoundary.test.ts` 的
  第 1 条用例在 `:176` 的 `expect(...).rejects` 红掉 ⇒ 后面的 `await session.close()`（`:213`）
  **根本没执行** ⇒ 该 Session 的 fd 泄漏 ⇒ GC 告警（告警行正落在该文件的 ✗/✓ 行之间）。
  同轮 `C5b-run2` 0 次、`C5-run1/2` 0 次、`C6`/`C8b` 全量 0 次 —— 与"只有失败路径才漏"一致。
- 结论：**DEP0137 这一族告警早于 M2**；M2 只是新增了**又一处**（而且这次是**绿色满跑也必然漏**）的触发点。
  既有文件那一处按任务卡"归因到既有文件 ⇒ 只登记不改"处理。

## 5. 预算 / 偏差 / 未完成项

- 定向 vitest：**4 次 / 上限 4 次**（run1 文件级、run2 用例①、run3 反向对照、run4 既有文件对照）。
  未跑 `tsc -b`、未跑 `test:all`、未跑全仓。
- **偏差（额外仪器，不计入 vitest 预算，已声明）**：为绕过 GC 时机对"用例级二分"的干扰，
  自建了 §2 的 tsx 判定器（2 次运行，两次逐字相同）。它不 import 测试框架、不改任何仓库文件；
  产物 `.dsh-mission/evidence/M2-dep0137-minrep.mts` 留在 evidence 下作为最小复现的存档
  （`.dsh-mission/` 在 `.gitignore:15` 内，不影响 `git status`）。
- **未完成**：core 侧那条一行修法（`await this.append(...)`）**未施加**（任务卡硬边界：`packages/core/**`
  运行时源码超授权，只登记）。零断言改动（本卡一个字都没改，见 §6）。
- **假设（未被本轮证据推翻）**：run2/run3/run4 的"空 stderr"全部由 GC 时机解释，而非"那些路径不泄漏"；
  依据是 §2 的确定性判定器 + `Session.test.ts:31-43` 与用例① 同形。

## 6. 工作树

```
$ git status --short
 M docs/product-evolution/PRODUCT-GAP-MAP.md        <- M1 已改（本卡未碰）
 M packages/telemetry/src/telemetry.test.ts         <- M1 已改（本卡未碰）
 M packages/telemetry/src/turnEndConditionGuard.test.ts <- M1 已改（本卡未碰）
 M tasks/121-doc-condition-guards.md                <- M1 已改（本卡未碰）
```
本卡**零文件改动** ⇒ 无 `git diff`；`packages/telemetry/src/turnEndWitness.test.ts`、
`packages/core/src/session/Session.ts` 均保持 HEAD 内容。
