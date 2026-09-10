# 107 — cache_creation 展示层（web UsageBar + local-server SSE）

- 编号：107
- 状态：待验收
- 优先级：P2
- 创建日期：2026-09-10
- 关联：099（69502c5：cacheCreationTokens 采集链路已打通）；089（cdf1374：cacheWrite 计价三档）；
      apps/web UsageBar + local-server usage SSE（目前只展示 cacheRead）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

把 089/099 的 cache_creation 能力接到展示层：`apps/web` 的 UsageBar 与 `apps/local-server` 的 usage SSE
（或等价 usage 展示）显示 **cacheWrite（cacheCreation）分项**，与 cacheRead 并列。

## 验收标准（执行器逐条勾选）

- [ ] 摸清展示链路：local-server 的 usage SSE 从哪读 UsageStore、web UsageBar 消费什么字段（grep cacheRead）
- [ ] 展示链路补齐 cacheWrite/cacheCreationTokens（含 estimated/derived 标记语义，沿用 085/089）
- [ ] 测试 ≥4 例：SSE 负载含 cacheWrite 分项/web UsageBar 渲染分项/缺字段回退/mock 数据；`tsc -b` exit 0 +
      全量 vitest（1152+ 无回归）+ web 74
- [ ] 文档同步（若涉 usage 展示说明）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做展示层消费 cacheWrite。不改采集链路（099 已通）、不改计价（089 已通）、不加依赖。
- web 套件运行：`npx vitest run --root apps/web`（独立 vite 配置）。

## 涉及文件（指针，执行器自行精化）

- `apps/local-server/`（usage SSE 端点）+ `apps/web/`（UsageBar 组件）
- `packages/shared/src/usage.ts` 或等价契约（若 SSE 负载类型需加字段）

## 方法

- 先 grep cacheRead 现状 → 加 cacheWrite 字段与渲染 → mock/测试 → 全量验证

## 工作证明（执行器回填：改动 diff/SSE 负载示例/渲染截图描述/测试输出，全部写进本文件，勿留对话里）

### 展示链路摸清（验收 1 ✓）
- grep `cacheRead` 定位消费方：
  - `apps/local-server/src/server.ts` `streamEvents`：`after_model` 事件 → `sse('usage', { inputTokens, outputTokens, cacheReadTokens, calls })`（改动前 708–719 行）——SSE 负载类型为内联类型，usage 增量字段（calls 为累计）。
  - `apps/web/src/sse.ts` `UsageDelta`：`{ inputTokens, outputTokens, cacheReadTokens, calls, ts }`——EventSource 解析后的 usage delta 形状。
  - `apps/web/src/components/UsageBar.tsx`：`UsageTotals` + `emptyUsage()` + `applyUsageDelta()`（增量累加 + 成本粗估）+ `UsageBar` 渲染（`(cache N)`）。
  - 消费链：`ConversationView.tsx` `onUsage` → `applyUsageDelta(prev, delta)` → `<UsageBar usage>`。
- 数据源头已含 cacheWrite：`after_model` payload.usage 的 `cacheCreationTokens` 在 `packages/application/src/compose.ts`（313 行）透传进 UsageStore，`UsageProjection.ts` 也累计（099 已通）；089 的 derived 语义 = 价目缺 `cacheWrite` 字段时按 `input×1.25` 推导。展示链路只差两跳：SSE 转发未带该字段 + web 消费未声明/未渲染。

### 改动 diff（验收 3 的载体；6 文件 = 5 改 + 1 新，stat: 5 files changed, 132 insertions(+), 7 deletions(-) —— 不含新增 UsageBar.test.tsx）

`apps/local-server/src/server.ts` —— usage SSE 转发补 `cacheCreationTokens`（`?? 0` 回退）：
```diff
-    // after_model usage → usage delta (incremental tokens from this call)
+    // after_model usage → usage delta (incremental tokens from this call).
+    // task 107: carry cacheWrite (cache_creation) tokens alongside cacheRead so
+    // the web UsageBar can show both cache 读/写分项 (099 upstream pipes
+    // cacheCreationTokens through after_model usage already).
     forward('usage', 'after_model', (payload) => {
-      const p = payload as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } };
+      const p = payload as {
+        usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number };
+      };
       const usage = p.usage;
       if (!usage) return;
       sse('usage', {
         inputTokens: usage.inputTokens ?? 0,
         outputTokens: usage.outputTokens ?? 0,
         cacheReadTokens: usage.cacheReadTokens ?? 0,
+        cacheCreationTokens: usage.cacheCreationTokens ?? 0,
         calls: ctl.projections.usage.usage().calls,
       });
     });
```

`apps/web/src/sse.ts` —— `UsageDelta` 声明 `cacheCreationTokens?`：
```diff
 export interface UsageDelta {
   inputTokens?: number;
   outputTokens?: number;
   cacheReadTokens?: number;
+  /** cache 写入（cache_creation）tokens，task 107；缺省未上报时为 undefined */
+  cacheCreationTokens?: number;
   calls?: number;
   ts: number;
 }
```

`apps/web/src/components/UsageBar.tsx` —— `UsageTotals`/`emptyUsage`/`applyUsageDelta`/渲染全部补齐 cacheWrite 分项，成本按 089 derived 语义用 `input×1.25`（0.625/1M）粗估，渲染 `cache 读 X / 写 Y` 并列 + title 推导提示：
```diff
 export interface UsageTotals {
   inputTokens: number;
   outputTokens: number;
   cacheReadTokens: number;
+  /** cache 写入（cache_creation）tokens，task 107（与 shared ChatUsage 同名单字段） */
+  cacheCreationTokens: number;
   calls: number;
   costUsd: number;
 }
 export function emptyUsage(): UsageTotals {
-  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, calls: 0, costUsd: 0 };
+  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, calls: 0, costUsd: 0 };
 }
 const PRICE_INPUT = 0.5;
 const PRICE_OUTPUT = 1.5;
 const PRICE_CACHE_READ = 0.1;
+/** cache 写入价按 input × 1.25 推导（089 cacheWrite 三档的 derived 档） */
+const PRICE_CACHE_WRITE = PRICE_INPUT * 1.25;
 export function applyUsageDelta(totals: UsageTotals, delta: {
   inputTokens?: number;
   outputTokens?: number;
   cacheReadTokens?: number;
+  cacheCreationTokens?: number;
   calls?: number;
 }): UsageTotals {
   ...
+  const cacheCreationTokens = totals.cacheCreationTokens + (delta.cacheCreationTokens ?? 0);
   const costUsd =
     ... +
-    (cacheReadTokens / 1_000_000) * PRICE_CACHE_READ;
+    (cacheReadTokens / 1_000_000) * PRICE_CACHE_READ +
+    (cacheCreationTokens / 1_000_000) * PRICE_CACHE_WRITE;
   ...
-  return { inputTokens, outputTokens, cacheReadTokens, calls, costUsd };
+  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, calls, costUsd };
 }
+  // cache 分项：读/写并列（task 107）。只显示实际发生的项，缺字段一律按 0 回退。
+  const cacheParts: string[] = [];
+  if (usage.cacheReadTokens > 0) cacheParts.push(`读 ${usage.cacheReadTokens}`);
+  if (usage.cacheCreationTokens > 0) cacheParts.push(`写 ${usage.cacheCreationTokens}`);
+  const cacheLabel = cacheParts.length > 0 ? ` (cache ${cacheParts.join(' / ')})` : '';
+  const derivedHint =
+    usage.cacheCreationTokens > 0
+      ? '；cache 写价按 input×1.25 估算（价目缺 cacheWrite 字段时，089 derived）'
+      : '';
-    <div className="usage-bar" title="累计模型用量（calls / tokens / 估算成本）">
+    <div className="usage-bar" title={`累计模型用量（calls / tokens / 估算成本）${derivedHint}`}>
 ...
-        {usage.inputTokens}+{usage.outputTokens} tok{usage.cacheReadTokens > 0 ? ` (cache ${usage.cacheReadTokens})` : ''}
+        {usage.inputTokens}+{usage.outputTokens} tok{cacheLabel}
```

测试文件（未含在 stat 的 `apps/web/src/UsageBar.test.tsx` 新增 + 2 个既有测试文件各 +1 用例）：
- `apps/local-server/src/server.test.ts`（+79 行）：新增「SSE usage delta carries cacheWrite (cacheCreation) tokens beside cacheRead (task 107)」——独立 server + MockProvider 注入 `usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 1024, cacheCreationTokens: 2095 }`，跑一轮 turn 后在 SSE 流断言 usage 帧 `delta.cacheCreationTokens === 2095 && cacheReadTokens === 1024`。
- `apps/web/src/sse.test.ts`（+19 行）：「usage delta passes cacheCreationTokens through to onUsage」——EventSource fake 帧 → `onUsage` 收到含 `cacheCreationTokens: 2095` 的 delta。
- `apps/web/src/UsageBar.test.tsx`（新建，7 例）：emptyUsage 全 0 / applyUsageDelta 累加 + 缺字段回退不 NaN / 成本 2.725(1M×四档) / 渲染 `cache 读 1024 / 写 2095` + derived title 提示 / 无写分项时不出现「写」/ mock 增量链累积渲染 / 全零不渲染。

### SSE 负载示例（改动后；验收 2 ✓）
`after_model` usage 帧（`GET /api/sessions/:id/events`，含 cacheWrite 分项）：
```
data: {"type":"usage","delta":{"inputTokens":10,"outputTokens":5,"cacheReadTokens":1024,"cacheCreationTokens":2095,"calls":1},"ts":1760000000000}
```
缺上报时后端 `?? 0` 回退为 `cacheCreationTokens: 0`；web 侧 `UsageDelta.cacheCreationTokens?: number` 为 undefined 时 applyUsageDelta 按 0 回退。derived 标记：UsageBar 渲染 `(cache 读 1024 / 写 2095)` 且 title 追加「cache 写价按 input×1.25 估算（价目缺 cacheWrite 字段时，089 derived）」——与 089 的 cacheWriteDerived 同语义（前端粗估恒为 derived 档，显式价格在服务端 UsageStore 已处理，展示层只消费 token 分项）。

### 命令输出（验收 3 ✓）
- `npx tsc -b tsconfig.json` → `EXIT=0`。
- `npx vitest run --root apps/web` → `Test Files 9 passed (9) / Tests 82 passed (82)`（基线 74 → 82，新增 8：UsageBar 7 + sse 1）。`EXIT=0`。
- 全量 `npx vitest run` → `Test Files 108 passed (108) / Tests 1153 passed | 1 skipped (1154)`（基线 root 1152 + 1 skipped → 1153，全量新增 1 = local-server SSE cacheWrite 用例；无回归）。`VITEST_EXIT=0`。

### 踩坑
- 沙箱受限会话 `npx vitest run` 可能 esbuild spawn EPERM（AGENTS.md 已知）；本会话全量跑在后台进程成功。
- SSE 帧是 `data: {...}\n\n` 分块 + 心跳 ping 帧，断言 usage 帧需 buffered 拼接解析（沿用仓库既有测试模式）。
- `MockProvider` 的 usage 注入在 `stream()` 里只带「实际上报字段」（099 设计，不补 0/undefined），SSE 转发层用 `?? 0` 归一 —— 展示层消费端缺字段一律 0 回退，不产生假成本。
- 改动未触碰 `packages/shared/src/usage.ts`（该文件不存在；SSE payload 类型为 local-server 内联 + web UsageDelta，契约由「SSE 帧 JSON」隐式衔接，未引入共享类型层改动）。
- 既有 `UsageBar` 无测试文件（新建）；渲染测试沿用 `react-dom/server` renderToStaticMarkup（node env，无需 jsdom，与 components.team.test.tsx 一致）。

### 验收标准勾选
- [x] 摸清展示链路：local-server 的 usage SSE 从哪读 UsageStore、web UsageBar 消费什么字段（grep cacheRead）——见「展示链路摸清」。
- [x] 展示链路补齐 cacheWrite/cacheCreationTokens（含 estimated/derived 标记语义，沿用 085/089）——SSE 转发 + UsageDelta + UsageTotals/渲染，derived= input×1.25 提示。
- [x] 测试 ≥4 例：SSE 负载含 cacheWrite 分项 / web UsageBar 渲染分项 / 缺字段回退 / mock 数据；`tsc -b` exit 0 + 全量 vitest（1152+ 无回归）+ web 74+。
- [x] 文档同步（若涉 usage 展示说明）——本卡工作证明即为展示说明；未新增独立文档（改动为纯展示层，usage 文档在 docs/PRICING.md §7 已有 cacheWrite 计价说明，未失真）。
- [x] 本卡"工作证明"节回填 + 状态改"待验收"。

## 状态：待验收

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：