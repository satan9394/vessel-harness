# 124 — 追溯卡：`Session.loadExisting` 的浮动写（fd 泄漏 / DEP0137）已在 CI 修复中提前落地

- 编号：124
- 状态：待验收（等独立对抗评审回填 §5；本卡只记录与收口，**代码已在 `aa5ea99` 合入**）
- 优先级：P1（本仓头号病史「声明与实现不一致」的流程收口）
- 创建日期：2026-09-18
- 关联：`tasks/122-residuals-and-dep0137.md` §2/§4（原归因与处置）、`RUN_STATE.md` Deferred 第 1 条（原写"须独立成卡 + 独立评审"）、`tasks/123-ci-tsc-build-repair.md`（修复发生时的上下文）
- 执行器：指挥侧（修复在 CI 修复中一并完成）；独立对抗评审由全新上下文子代理承担

## 1. 为什么有这张卡

`tasks/122` 把 `DEP0137` 归因到 `packages/core/src/session/Session.ts` 的 `loadExisting()`，并以「属运行时语义变更」为由**只登记不改**，明确要求：

> **最小修法（留给有授权的卡）**：`Session.ts:141` 改 `await this.append({ … })` … **属运行时语义变更 ⇒ 须独立成卡 + 独立评审。**

2026-09-18 修 CI 时，这条浮动写是 Linux 腿 `Unhandled Rejection` 的直接原因（`Session.append` 的 `fs.promises.open` 落在被删目录上），**已在 `aa5ea99` 一并修复**（连同其余三个平台缺陷）。修复本身正确且更保守（`loadExisting` 本就是 `async`、其唯一调用方 `Session.open()` 已 `await` 它），但**越过了 `tasks/122` 写下的流程边界**：它没有独立成卡、没有独立评审。本卡就是补上这一步——把"已发生的修复"登记清楚，并交独立对抗评审复核，而不是让边界被静默绕过。

## 2. 改动（已合入 `aa5ea99`）

文件：`packages/core/src/session/Session.ts`

```diff
-    // resume semantics: if the last turn lacks turn/end, synthesize interrupted closer
+    // resume semantics: if the last turn lacks turn/end, synthesize interrupted closer.
+    // AWAITED on purpose: an un-awaited append here is a floating write — `open()`
+    // resolves before the synthesized record reaches disk, so a session reopened and
+    // immediately closed (or whose directory is removed) leaves `append`'s pending
+    // `fs.promises.open` to land on a closed handle / a deleted path, surfacing as an
+    // unhandled rejection. Awaiting makes `open()` resolve only once the closer is on disk.
     const openTurns = this.openTurns();
     for (const turnId of openTurns) {
-      this.append({
+      await this.append({
         type: 'turn/end',
         turnId,
         kind: 'interrupted',
         stats: { steps: 0, toolCalls: 0, durationMs: 0 },
       });
     }
```

**语义变化（唯一）**：`Session.open()`（经 `await loadExisting()`）现在只在合成收尾记录**落盘之后**才 resolve。此前该写是 fire-and-forget。

**为什么不破坏任何东西**：`loadExisting` 本来就是 `private async`；唯一调用点是 `Session.open()` 里的 `await session.loadExisting()`（`:61`）。`append` 内部对 `this.fd` 的赋值/写入与 `close()` 的顺序因此确定，不再有"close 空转 + 待定 open 赋 fd 到已关闭会话"的窗口。其余 `appendSync`/`append` 调用点本就 `await`。

## 3. 回归测试（已随 `aa5ea99` 合入）

`packages/core/src/session/Session.test.ts` 新增：

```
it('resume writes the synthesized closer before open() resolves (no floating append)', …)
```

做法：写入一个含未收尾 `turn/start` 的会话 → `close()` → 重开（触发 `loadExisting` 合成）→ **在 `open()` resolve 的那一刻同步读原始 JSONL**，断言已含 `"kind":"interrupted"`，并紧接着 `close()`。

**阴性对照（已实测）**：临时撤掉 `await` 后该用例必红（日志只有 `turn/start`，无 interrupted 收尾），恢复后转绿——证明该断言真的钉住了这条不变量，而非宽松通过。

## 4. 影响面（如实）

- **修复方**：所有"重开含未收尾回合的日志后立刻关闭"的调用方——不再泄漏 FileHandle，合成的 `interrupted` 收尾记录保证在 `open()` 返回前落盘。
- **未覆盖**：`tasks/122` §4.2 登记的**同族更早实例**（`turnEndBoundary.test.ts:213` 用例失败后跳过 `close()` 的**测试卫生**问题）不在本卡范围，仍只登记不改。
- **性能**：`open()` 在需合成收尾的记录上多一次 await（一次 append 写盘）——仅在"上一回合未正常收尾"时发生，正常收尾的日志不触发合成循环。

## 5. 独立对抗评审（已回填）

- 结果：**PASS-WITH-CAVEATS**（独立对抗评审，全新上下文、只读、约 20 次工具调用）
- 四个评审要点（评审原文结论）：
  1. **`await` 是否消除泄漏窗口**：成立，且比本卡描述更强——`openTurns()` 可返回多个 id（回合重叠是受支持路径），旧代码的 fire-and-forget 循环会**并发打开多个 FileHandle**，只有最后一个赋进 `this.fd`，其余全部泄漏；`await` 还把循环串行化、复用同一 handle。
  2. **是否有调用方依赖旧的浮动写语义**：**未发现**。`loadExisting` 是 `private`，唯一调用点 `Session.open()`；内存侧无差异（`append` 在 await 前已同步 `records.push`，`replay()`/`surface()` 前后一致）。已逐个检查 `Session.open` 的生产调用点（`compose.ts:178`、`IsolatedRuntime.ts:76`、cli resume）与全部 `append`/`appendSync` 调用点，无依赖。
  3. **回归测试判别性**：成立——撤掉 `await` 时 `open()` 的 continuation 是 **microtask**，浮动 append 卡在 libuv I/O 回调上**不可能**抢先，`readFileSync` 只读到 `turn/start`，断言必红；依赖的是 Node 确定性语义而非竞态。（评审附口径修正：`append` 只 `write` 未 `fsync`，严格说是"写入 OS 页缓存"，本卡 §2/§3 用"落盘"不精确。）
  4. **是否超出最小面**：未超出；该文件 diff 仅"注释 1 行 → 5 行" + `this.append(` → `await this.append(`，无签名/控制流/其它语义漂移。
- **评审发现的新问题（本卡原文未提，已修）**：`await` 把 `loadExisting` 的失败从"晚到的 unhandled rejection"变成了**从 `open()` 同步抛出**，而 `open()` 在 `acquireLease` 之后、没有 try/finally ⇒ 失败时 `Session` 实例从未交给调用方、**无法 `close()`** ⇒ `.lease` 残留（若 `fs.promises.open` 已成功而 `write` 失败，fd 也泄漏）。后果：**同进程**用同一 `sessionDir` 重试会被自己的租约判为 `already open by process <pid>`（`isProcessAlive` 对本进程 pid 为真），要等进程退出（stale reclaim）或手删 `.lease`。评审判定这是**真实的行为变更**，调用方不应默认 `open()` 失败后环境干净。
- **修法（本次，评审驱动）**：`Session.open()` 包 try/catch，失败时 `await session.close()`（释放租约 + 关掉失败的 append 可能已打开的 fd）后 rethrow；清理本身 best-effort（`try/catch` 包裹），**原始异常优先**不被掩盖。
- **新回归测试**：`Session.test.ts` 新增 `open() releases the lease when the resume write fails (no same-process lockout)`——spy `fs.promises.open` 抛 ENOSPC → 断言 `open()` reject、`.lease` 不存在、同会话可重试成功。**阴性对照已实测**：临时禁用清理后该用例必红（`existsSync(leasePath)` 为 true），恢复后 8 passed。

## 5.1 评审未能独立验证的项（如实登记，均不构成 FAIL）

1. 本卡 §3 声称的"阴性对照已实测"（撤 `await` 观察红灯）——评审受只读约束**无法亲手复现**，只能从 microtask/I/O 顺序论证（高置信但非实测）。**对照状态**：该阴性对照在 CI 修复当轮已由指挥侧实测（日志只有 `turn/start`），本卡保留原始结论。
2. 本卡 §6 的全量门禁数字——评审未重跑，只跑了目标文件（7 passed）；数字对其所见代码无矛盾，但未经其独立证实。
   > 补充（2026-09-18，本卡新增用例后）：`test:all` 根 **171 文件 / 2198 passed + 6 skipped**（较上批 +1，即本卡新增用例）、web 11/120；`tsc -b`、`typecheck:tests` 各 exit 0。

## 6. 门禁实测

- `npx tsc -b tsconfig.json` ⇒ exit 0
- `npm run typecheck:tests` ⇒ exit 0
- `npm run test:all` ⇒ 根 171 文件 / 2197 passed + 6 skipped；`apps/web` 11 文件 / 120 passed
- （以上均在 2026-09-18 文档对账批次执行，见 `tasks/123` §0 与本次提交说明）

## 7. 流程复盘（本卡存在的意义）

**教训**：修 CI 时"顺手"修一个被前一张卡显式划为"须独立成卡 + 独立评审"的运行时改动，即使改动本身正确，也会**再次制造"声明与实现不一致"**——`tasks/122` 说"只登记不改"，实现却改了。正确做法是：要么停下另立卡，要么像本卡这样**事后补齐卡 + 独立评审**，让记录追上事实。这与本仓头号病史同源。
