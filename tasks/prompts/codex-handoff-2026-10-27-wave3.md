# Codex 任务书（第三波）· 2026-10-27 · 只剩未闭合项

> 用法：等 Codex 额度恢复后，把本文件路径交给它，说明跑哪一项（或「按顺序全跑」）。
> 前两波（T1–T4 / T7、T6、T13、T14 / T5b、T12、T8、T11、T9、T10 第一轮）均已完成并验收，
> **不要重做**；本文件只包含至今仍未闭合的四项。
> 相关底稿：`tasks/prompts/codex-handoff-2026-10-27-wave2.md`（全局约定与交付格式沿用其 §0/§10）；
> 中止记录：`evidence/sessions/2026-10-27-pdw-halt.md`。

## 0. 沿用不变

- 仓库根 `E:\Code_file\Projects\Vessel_Harness`；只改「允许改的文件」；不 commit/push/建分支、不改 `.pdw/`、不驱动本机其他 Agent CLI。
- 不跑全量门禁（协调者统一跑）；只跑本任务的定向自验；命令失败贴原始报错与 exit。
- 报告四段：改动文件、命令 + exit + 计数、未做与原因、被拒命令原文；复核子代理只读且独立。
- **不再新增任务卡**：本波只许改下列已存在的卡/文件，缺卡就写进已有卡的 Result 段，不要新建 `tasks/NNN-*.md`（唯一例外见 W3 允许清单）。

## 1. 模型与思考档位

| 编号 | 事项 | 顺序 | 实现 | 复核 | 依据 |
|---|---|---|---|---|---|
| W1 | Stop 失败提示在视口内被裁切（卡 275 遗留 ①） | 1 | `gpt-6.1-sol` / **medium** | `gpt-6.1-terra` / medium（看截图） | 前端布局 + 可能牵动组件与 CSS，属多文件协调 |
| W2 | `Write` 之后 Inspector 没有真实 Diff（卡 275 遗留 ②） | 2（等 W1，二者都可能动 `apps/web`） | `gpt-6.1-sol` / **high** | `gpt-6.1-sol` / medium | 要跨「引擎产出 widget → 前端渲染」定位；根因不清，先给 high，定位后若只是缺一条渲染分支可回落 medium |
| W3 | 卡 346 收口（跨平台矩阵 / 六条逃逸对抗 / 文档一致性 / 三档回滚） | 可并行 | `gpt-6.1-sol` / **medium** | `gpt-6.1-terra` / medium | 六条对抗属安全边界，文档部分机械但覆盖面大 |
| W4 | 卡 351 遗留：`npm pack` 探针 exit 1 与 dist 新鲜度（可选） | 可并行 | `gpt-6.1-terra` / **medium** | 不需要 | 单点排查，不碰判据 |

升级阶梯：先按表跑；红了才升（同模型 `medium → high`），每次升级在报告里写「哪条命令红了」。不用 Ultra。
`service_tier`（Fast）默认关。

## 2. 顺序与冲突

- **W1 → W2 必须串行**：两者都可能改 `apps/web` 的样式/组件，同一文件同一时刻只能一个写者。
- **W3 与 W1/W2 文件集不重叠**（W3 改 `benchmarks/`、`docs/`、`tasks/346`），可并行。
- **W4 独立**，只读排查 + 写卡 351 的 Result，可随时并行。

---

## W1 · Stop 失败提示被消息区底边裁切

**实现** `gpt-6.1-sol` / medium；**复核** `gpt-6.1-terra` / medium。

### 问题与证据

第二轮浏览器取证（`evidence/sessions/2026-10-27-iab-acceptance-run2/report.md` §E、`coordinator-stop-failure.json`）：
受控 503 之后，完整文案「停止请求失败，尚未确认中断。请重试；运行状态与未发送草稿已保留。」**确实进了 DOM**，
但在 917×567 视口里被消息区底边垂直裁切，只露出字形上半部分（`coordinator-stop-failure.jpg`）。
按「看得见才算通过」的判据，E 项因此不通过。在途禁用（`正在请求停止…` + `disabled`）已验证，不是这条的问题。

### 要做

1. 先定位：是 `.message-list-scroll` 的高度/内边距把新插入的 alert 顶出可视区，还是 alert 自身定位/`max-height` 造成裁切；给出 `path:line`。
2. 修到「提示完整可读」：最小改动优先（内边距、滚动到底、或 alert 不被裁切），不要为此重做消息区布局。
3. 补一条能抓住它的测试（组件层或几何断言二选一）：断言在给定视口高度下提示完整可见，或在 insert 后滚动位置使提示进入可视区。
4. 不改 Stop 请求/中断的业务语义，不改按钮禁用逻辑。

### 允许改的文件

`apps/web/src/components/**`（只限与消息区/提示渲染相关的那一个组件）、`apps/web/src/styles.css`、
对应测试文件（如 `apps/web/src/components/*.test.tsx`）、`tasks/275-ui-final-acceptance.md`（只在末尾追加，不改正文）。

### 自验

```
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run --root apps/web
node node_modules/typescript/bin/tsc -b tsconfig.json
```

### 验收

- 917×567 视口下，失败提示完整可读（截图或几何断言二选一，必须给证据）。
- 既有 Web 测试全绿，没有放宽断言；`styles.css` 不引入与主题无关的硬编码颜色（用现有 token）。

---

## W2 · `Write` 之后 Inspector 没有真实 Diff

**实现** `gpt-6.1-sol` / high；**复核** `gpt-6.1-sol` / medium。

### 问题与证据

第二轮 E2E：脚本桩请求真实 `Write` 到 `fixture.txt`，UI 显示 `Write · 已完成`，但 Inspector 的
Changes → Patch 面板显示「本会话暂无补丁提案。」（`DualSurfaceLayout.tsx:132-140` 的 `PatchCanvasPanel`，
数据来源是 `DiffInspectorWidget[]`）。整条链路因此断在「Diff」这一步，I 项不通过。

### 要做（先定位，再决定修谁）

1. 查清 `DiffInspectorWidget` 是谁产出的：是引擎在工具结果里生成（`packages/engine`/`packages/tools` 的 widget IR 路径），
   还是只对 `Edit`/`patch` 类工具生成、`Write` 不生成。给出 `path:line`。
2. 分三种情况处理，报告里必须写明落在哪一种：
   - **产品缺口**：`Write` 应产出 diff widget 却没有 → 在产出侧补，补一条单测（新建文件 = 全新增 hunk）。
   - **渲染缺口**：widget 有了但 Inspector 没显示 → 修前端映射，补组件测试。
   - **验收口径问题**：`Write` 本就不产 diff、只有 `Edit` 产 → **不要改产品**，改为在第三轮验收里用 `Edit` 复验，
     并在 `tasks/275` 末尾写清「I 的 Diff 验收改用 Edit，Write 不产 patch 属设计」。
3. 无论哪种，都要给出「怎么在真实浏览器里看到一次 Diff」的可复现步骤（供协调者第三轮复验）。

### 允许改的文件

定位阶段只读；确认需要改时（按上面三种情况之一）：
`packages/engine/src/**`（仅 widget 产出相关文件）、`packages/tools/src/**`（仅同名测试或 widget 相关）、
`apps/web/src/components/**`（仅 Patch/Inspector 相关）、对应测试文件、
`tasks/275-ui-final-acceptance.md`（只在末尾追加）。

### 自验

```
node node_modules/vitest/vitest.mjs run packages/engine
node node_modules/vitest/vitest.mjs run --root apps/web
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

### 验收

- 根因有 `path:line`；结论落在「产品缺口 / 渲染缺口 / 验收口径」三者之一，不许含糊。
- 若改产品：有能失败的单测（新增文件产生全新增 hunk，或 Inspector 显示该 widget）。
- 若判为验收口径问题：**零产品改动**，只改卡 275 末尾与复验步骤，并在报告里明确「不改代码」。

---

## W3 · 卡 346 收口

**实现** `gpt-6.1-sol` / medium；**复核** `gpt-6.1-terra` / medium。

### 背景

`tasks/346-deletion-retention-closeout.md` 定义了收口范围。前置 343/344/345a/345b/345c 已全部验收
（2026-10-27），文档 `docs/DELETION-AND-RETENTION.md` 已同步到实现现状。本项只做四件还没做的事。

### 要做

1. **跨平台矩阵**：Windows 真跑（回收站 + trash + purge，已有 345c/358 的测试证据，可引用）；Linux 按 `gio` 存在/不存在两种分支写单测；
   macOS 的 `osascript` 只做命令形态单测。**未实测的平台必须写「未实测」并注明需要什么环境**，不许写成已验证。
2. **六条逃逸对抗**：对 trash 根做一次对抗检查——`..`、目录符号链接、junction 指向外部、手工伪造 `entry.json`、
   把 `expiresAt` 改成过去但 `origin` 在 trash 外、条目缺 `entry.json`。逐条确认「拒绝且不删任何东西」，每条留断言。
3. **文档一致性**：`docs/DELETION-AND-RETENTION.md`、`AGENTS.md` 删除铁律第二处例外、`HANDOFF.md` 的 TTL 键名/CLI 子命令/错误码三者在文档与实现中各只有一种写法；有出入就改文档（不改实现，除非确证实现错了——那就先报 blocker）。
4. **三档回滚说明**：① 关掉自动清理（`VESSEL_TRASH_TTL_DAYS=0`）；② 会话删除退回系统回收站（单点开关或 revert 345c 的改道）；
   ③ 整批回退（`git revert` 的卡号范围）。写进 `docs/DELETION-AND-RETENTION.md` 新一节，可照做。

### 允许改的文件

`docs/DELETION-AND-RETENTION.md`、`AGENTS.md`（只改删除铁律那段与实现对齐的措辞）、`HANDOFF.md`（只改相关行）、
`packages/application/src/deletion/trash.test.ts` 或新建 `packages/application/src/deletion/trash.escape.test.ts`（六条对抗测试），
`apps/local-server/src/daemon/daemonRecycle.windows.test.ts`（如需补 Linux/macOS 分支，则新建同名 `.posix.test.ts`）、
`tasks/346-deletion-retention-closeout.md`（只填 Result）。

> 这是本波唯一允许新建测试文件的例外；**仍然不允许新建任务卡**。

### 自验

```
node node_modules/vitest/vitest.mjs run packages/application
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

### 验收

- 六条对抗各有一个断言，且「拒绝后磁盘状态不变」也有断言（不是只看返回值）。
- 跨平台矩阵表里，写 Windows 的地方能指到具体测试名；Linux/macOS 明确标「未实测」或给出单测结果。
- 三档回滚可照做（每档给出具体命令与预期结果）。
- 文档里 TTL 键名、CLI 子命令、错误码各只有一种写法。

---

## W4 · 卡 351 遗留（可选，默认不做）

**实现** `gpt-6.1-terra` / medium；无独立复核。

### 问题与证据

packaging gate 返回 `pass`，但判据只探「dist + 入口」存在性（`judgePackagingProbe`：`probeFailed || !rootHasDist → pending`，
否则按 `entryExists` 给 pass/fail）；真正的 `npm pack --dry-run --json` 返回 **exit 1、stdout/stderr 均 0 字节**。
另外根 `dist/index.js` 的时间戳是 2026-09-10，存在性无法证明新鲜度。

### 要做

1. 查清 `npm pack --dry-run --json` 在 Windows 下 exit 1 且无输出的原因（npm 版本？`package.json` 字段？被忽略的 `files`？）。
   只诊断与记录，**不改 gate 判据**。
2. 判断根 `dist` 是否需要重建（若只是陈旧的构建产物，跑一次 `tsc -b` 后记录时间戳变化）。
3. 结论写进 `tasks/351-packaging-gate-run.md` 末尾：原因、是否阻塞发布、若要修应该改哪一层（gate 判据 vs 构建流程）。

### 允许改的文件

`tasks/351-packaging-gate-run.md`（只在末尾追加）。允许运行只读诊断命令与 `tsc -b`（产物已 gitignore）。

### 验收

- 给出 exit 1 的可复现原因或「无法确定（已排除 A/B/C）」，不许猜。
- 明确写「本次仍不构成打包成功证据」。

---

## 3. 谁做什么（别越界）

| 事项 | Codex | 协调者 |
|---|---|---|
| W1/W2/W3/W4 的实现与定向自验 | ✅ | — |
| 真实浏览器复验（W1/W2 的第三轮） | — | ✅（IAB，按 W2 给出的步骤） |
| 全量门禁 `scripts/gate-batched.ps1` | — | ✅ |
| 卡 346 的最终验收与看板收口 | — | ✅ |
| commit / 是否保留某批改动 | — | 维护者决定 |

## 4. 额度与切换

1. **先等 Codex 额度恢复**（今天已在 T5b 期间出现过 `usage limit`，`retry at 5:50 AM`）。有额度时优先 Codex。
2. 额度仍不可用又要推进时：`pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind deepseek`，再按需建契约。
   **注意**：W3 要改被 git 跟踪的文档与卡，现有 `scripts/check-append-only.mjs` 用 `git diff HEAD` 比对，
   会把历史存量改动误判成删除；换 PDW 前要么给脚本加「按任务起点基线」模式，要么 W3 不走 append-only 判据。
3. 切回：`scripts/pdw-route.ps1 -Kind general`（或 `code-heavy`）。
4. **本轮之后不再新增任务卡**；有新想法另立批次。

## 5. 交回来时给什么

沿用第二波 §10：每个编号贴改动文件清单、每条命令 + exit + 计数、未做与原因、被拒命令原文、
以及 `git diff --stat` 的范围证据。协调者逐项复跑定向测试 + 全量门禁后再落卡。
