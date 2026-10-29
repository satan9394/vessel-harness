# 任务卡 364: 团队抽屉的 300 字摘要缺省略号与展开入口

- Status: 已验收（2026-10-29，closeout T2，含经批准的一次扩围）：298/300 原样不动，570 走「300 + `…` → 展开 570 → 收起」；全文经一个新增只读端点取回并缓存，失败保留摘要、只给一句安全提示
- PDW task: none
- 来源：卡 361 Result——桩 provider 产出 570 字符，抽屉显示恰好 300 字符，但**文字戛然而止**，既没有 `…` 也没有展开控件。

## 1. 现象与根因

- 运行时先在末尾补了省略号，抽屉再按 300 字切片，切掉的正好是那个省略号，于是「被截断」这件事在界面上不可见。
- 用户无法判断这是「原文就这么长」还是「被截了」，也没有办法看全文（只能靠产物链接或日志）。

## 2. Goal

让截断**可见、可展开**，且不改变 300 字的展示上限：

1. 文本 ≤ 300 字符：原样显示，**不**出现省略号、**不**出现展开按钮。
2. 文本 > 300 字符：显示 300 字符并以 `…` 结尾；提供「展开全文 / 收起」控件，展开显示完整输出，收起回到 300 字。
3. 别把省略号本身算进 300 字（先切片再补 `…`），也不要在展开态里重复渲染省略号。

## 3. Acceptance

- A1 三种输入各一张截图 + 测量：298 字符（无省略号无按钮）、300 字符（同）、570 字符（300 + `…` + 展开按钮）；展开后文本长度等于原文长度。
- A2 折叠/展开可往返，Console 无错误。
- A3 组件测试覆盖：短文本不渲染控件；长文本渲染 `…` 与控件；点击后长度变化；再点回退。
- A4 `node node_modules/vitest/vitest.mjs run --root apps/web` 与 `tsc -p apps/web/tsconfig.json --noEmit` exit 0；不跑全量门禁。
- A5 若省略号是由运行时（`packages/agents` 或 `apps/local-server`）补的，请一并说明位置：避免「运行时补、前端切」这种两处各自为政。

## 4. Blast Radius

`apps/web/src/components/team/TeamNodeDrawer*`（抽屉）、其测试；若确认省略号来自运行时，可只读引用其位置、不要求改动运行时（除非切片逻辑本身在运行时）。

## 5. Result

待执行。

## 2026-10-29 closeout — approved scope extension (before coding)

The user approved expanding T2 after the real fixture measured runtime outputs 298 → 298, 300 → 300, 570 → 301 characters. `TeamRuntime.getStage()` must keep its existing trimming.

- Add exactly one read-only endpoint: `GET /api/sessions/:sessionId/team-stages/:stageId/tasks/:taskId/result`. Read only the stored result through `TeamRuntime.getTaskResult()`, returning status, output and recorded artifact references. No new write route, auth scheme or file-content access. Existing artifact-content guards remain authoritative. Unknown/mismatched stage/task/session returns 404; reuse origin/daemon-token enforcement. Output is capped at 64 KiB with an explicit truncation flag.
- Add the ApiClient method and drawer expand/collapse. Collapsed: 300 characters plus `…` when truncated. Expanded: one fetch, cached in component state; collapse/re-expand does not fetch again. Failure keeps the summary and shows one short inline message without raw error text.
- Tests: full runtime result and mismatched pairs; server full result/404/origin 403; web short/exactly-300/570, round trip/cache and failed fetch. Only focused gates; no full gate.
- Authorized files beyond the original drawer scope: `packages/agents/src/team/teamApproveAndRun.test.ts`, `apps/local-server/src/teamRoutes.ts`, `apps/local-server/src/server.ts`, `apps/local-server/src/teamStageApi.test.ts`, `apps/web/src/api.ts`, `apps/web/src/components/team/TeamStagesPanel.tsx`, plus the drawer and its tests. Main thread only; requested route gpt-6.1-sol / medium, Fast off.

## 2026-10-29 closeout — final measured result

通过 / PASS under the scope extension approved above. The original ellipsis is added by packages/agents/src/team/TeamRuntime.ts:getStage()/trim(), not local-server; that preview remains unchanged. Added one session-bound read-only stored-result endpoint with origin/token handling, 404 bounds and a UTF-8-safe 64 KiB cap. Drawer now shows 300 + …, fetches/caches full text once, toggles both ways, and shows a short safe inline failure. Visible IAB lengths: 298, 300, 301 → 570 → 301 → 570; one GET, console []. Final web 61 files / 535 passed; focused runtime/server 19 passed; web typecheck, runtime build and TEMP web build exit 0. Evidence: evidence/sessions/2026-10-30-closeout/report.md, t2-drawer.json, screenshots and gate records. Full gate not run.

Cleanup: owned ports 5694–5698, processes and children all 0; cleanup.json. No downloads, subagents, external Agent CLI or commit/push. Existing card status and lines preserved.

## 协调者验收（2026-10-29，closeout T2）

采信，扩围按对话里的口头批准执行。我要把「为什么改了四个产品文件」记清楚，否则下一个人会以为是抽屉组件的局部改动：**截断发生在 `TeamRuntime.getStage()/trim()`**（300 字符 + `…`，到浏览器就是 301），抽屉只是又切了一刀，所以只在抽屉里加 `…` 与展开按钮拿不到全文。为拿到全文新增了**一个**只读端点，而不是放宽 getStage 的截断——这一点很重要：`getStage()` 的裁剪继续作为列表/画布的成本边界，全文只能按需单取。

实现审阅（我自己看的 diff，逐条）：
- 端点 `GET /api/sessions/:sessionId/team-stages/:stageId/tasks/:taskId/result`，`segs.length === 8` 的形状与既有 `team-stages/*` 路由一致；先 `sameOrigin` 再 `405` 再 `ctl`（`ctl` 不存在 404），token 校验由 `handleApi` 上游的 `authMiddleware` 统一负责，没有新开鉴权通道。
- `TeamStageRoutes.result()` 三重边界：`entry.sessionId === sessionId`、`stageId` 存在、`taskId` 在该 stage 的投影里；读的是 `getTaskResult()` 已持有的结果，**没有任何 `readFileSync`/`openSync`**（测试用 spy 断言过），产物字节仍只走 `artifact()` 的路径与描述符守卫。
- 64 KiB 上限按 UTF-8 字节切，落到续字节就回退一格，末尾不会出现 `�`；`truncated` 是独立字段，不靠客户端猜。
- 抽屉：只发一次 GET、结果缓存在组件 state，收起后再展开走缓存；`outputRevision` + `loading` 双守卫挡掉切换任务/重复点击的竞态；失败保留摘要、只显示一句本地化文案，不带原始错误体。

独立复跑：`apps/local-server` **28 / 320**、`packages/agents/src/team` **9 / 49**、`--root apps/web` **61 / 535**（新增的 `TeamNodeDrawer.test.tsx` 5 项）、三处 tsc exit 0、全量门禁 **17/17 exit 0**（根 335 / 3,713 + 8，web 61 / 535，conformance 25/25 $0，日志 `%TEMP%/vessel-gate-384557f6`）。

两处不阻塞的小偏离，留给下一轮 UI 批次：
1. 新增的 5 条文案写成 `TeamNodeDrawer.tsx` 内的 `outputCopy` 字面量，没进 `apps/web/src/i18n.ts` 的类型化字典——这个文件以前是全仓唯一的 i18n 真源，`team/` 下也没有第二处这么写。
2. 展开后「收起」按钮位于整段正文之下，570 字的样本已把它推到视口外，需要滚动才能收起（长输出同理）。可用性上不难，但属于另一次交互决定，不在本卡。
