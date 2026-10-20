# VESSEL-UI-2026-02 · UI 落地交付证据（P1–P8 完成）

> 依据：`docs/design-prototypes/IMPLEMENTATION-PLAN.md`（P1–P8）、`docs/DESIGN.md`、`docs/UI-THEME.md`、`docs/design-prototypes/FEATURE-COVERAGE.md`。
> 执行：OpenCode goal 模式，2026-10-15。**纯本地：未 commit / 未 push / 无永久删除。**
> 状态：**P1–P8 全部完成并验证。**

## 0. 环境与复现

```powershell
npm ci                                   # 锁文件一致
npx tsc -b tsconfig.json
npm run typecheck:tests
npm run -w @vessel/web typecheck
npm run -w @vessel/web build -- --emptyOutDir false
npm run test:all                         # 根 + apps/web 双 root
git diff --stat packages/core/            # 必须为空
```

离线截图 fixture（真实 local-server + `apps/web/dist`，零 npm 依赖）：

```powershell
npx tsx evidence/sessions/2026-10-15-ui-landing/fixture.ts                       # 127.0.0.1:32830
$env:VESSEL_CHROME="$env:LOCALAPPDATA\ms-playwright\chromium-1243\chrome-win64\chrome.exe"
node evidence/sessions/2026-10-15-ui-landing/capture.mjs http://127.0.0.1:32830 evidence/sessions/2026-10-15-ui-landing p2|p3|p4|p5|p6   # 阶段图
node evidence/sessions/2026-10-15-ui-landing/capture.mjs http://127.0.0.1:32830 evidence/sessions/2026-10-15-ui-landing full           # 全矩阵 64 张
```

## 1. 门禁结果（最后一次源码编辑之后执行）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 类型构建 | `npx tsc -b tsconfig.json` | exit 0 |
| 测试类型 | `npm run typecheck:tests` | exit 0 |
| Web 类型 | `npm run -w @vessel/web typecheck` | exit 0 |
| Web 构建 | `npm run -w @vessel/web build -- --emptyOutDir false` | exit 0 |
| 全量测试（根） | `npx vitest run` | 289 文件 / **3037 passed + 6 skipped** |
| 全量测试（web） | `npx vitest run --root apps/web` | 40 文件 / **337 passed** |
| core 零改动 | `git diff --stat packages/core/` | 空 |

基线对照：card 222 为 root 3037 + web 319 = 3356 passed；本轮 web 增至 337（+18 项新增定向测试），**root 无回归**。

## 2. 逐阶段证据

### P1 · 令牌层（`apps/web/src/styles.css`）
`.tokens` 令牌层（浅色默认），深色走 `@media (prefers-color-scheme: dark)`；旧名全部保留为别名
（`--panel2/--border/--dim/--text-soft/--hover/--row-line/--green/--red/--yellow/--bubble-*`）。
`body::before` 三团固定光场；`prefers-reduced-motion` 全局兜底。

### P2 · 玻璃外壳
`.rail` / `.navigation-shell` / `.topbar`：`--glass` + `backdrop-filter: blur(26px) saturate(1.7)`；
`.app` `padding/gap: 12px` + 面板独立 `--r-3` 圆角与大范围低透明度阴影。
截图：`p2-workbench-{light,dark}.png`、`p2-activity-dark.png`。

### P3 · 四栏骨架 + 真实 8 Tab 检视器
新增 `apps/web/src/components/layout/Rail.tsx`（58px 图标轨）；`.app` 网格 `58px 232px minmax(0,1fr)`；
`layout.css` 把 `.dual-surface` 改为「中央过程流 + **300px 审阅栏**」两列；≤1180px 会话栏收为抽屉；
≤1023px 检视器 `role="dialog"` 模态（焦点陷阱 + Esc + 回焦）。
实拍 facts：`p3-session-{light,dark,en-dark}` tabs=8、width=300、gridCols=`788px 300px`、role=complementary；
`p3-session-1023-dark`/`800-dark` role=dialog、width=560。

### P4 · 中央过程流
新增 `apps/web/src/components/PlanChecklist.tsx`（`PlanStrip` 纯组件 + 数据挂载 + `planProgress`），
数据源 = 真实 `GET /api/goal/tasks`（与 `GoalModule` 同源），标题 `计划 · 1 / 3`，✓/●/· 三态 + 每步耗时。
就地 diff / 授权卡 / 工具行经核对已由既有 `WidgetDispatcher` 装配。
测试 `PlanChecklist.test.tsx` 7 项；截图 `p4-session-*.png`。

### P5 · 输入区与计量
新增 `apps/web/src/components/ComposerMeters.tsx`：
`ComposerCapsules`（项目/模型/审批档位/模式；模式 = `GET /sessions/:id/route`，含 B1 的
`确定模型` → `route/resolve`、`为本会话固定模型 / 已固定·取消固定` → `route/pin|unpin`）
与 `MetersRow`（上下文占用条 / 缓存命中 / 花费 / 计划 / 键位提示；上下文窗口取真实
`/api/models` 的 `capabilities.contextWindow`，未知显示 `—`）。
测试 `ComposerMeters.test.tsx` 6 项；截图 `p5-session-*.png`（facts `modePills` 5 控件、`meters` 五项）。

### P6 · 修丑点
- 1px 灰框 → `--ring` 发丝：`card222.css` 与 `styles.css` 中非令牌硬编码色（`#8883/#c0392b/#d08700/#85b5ff/#36a66c/#e56c6c/#e9ba66/#848b98/#278646/#d44d4d`、`--surface/--muted` 回退、`color:#ffffff`）全部改为令牌。
- 裸 slug / 长路径 / 时间：新增 `apps/web/src/utils/timeFormat.ts`（`formatClock`=`HH:mm`/`MM-DD`、`formatStamp`、`shortPathLabel`）+ 5 项测试；接入 `Sidebar.tsx` / `App.tsx`（活动列表）/ `SandboxAuditHistory.tsx`。
- 空/加载/错误态：`AgentStudioComposer` 新增 `composerLoadingLibrary` / `composerEmptyLibrary` 态；`.composer-empty` 样式。
- Agent Studio 卡片墙：`behavior-entry` / `behavior-layers > li` 去边框改发丝分隔。
截图 `p6-studio-{light,dark}`、`p6-studio-1366-dark`、`p6-activity-dark`、`p6-workbench-1366-light`。

### P7 · 功能覆盖对齐
`docs/design-prototypes/FEATURE-COVERAGE.md` 已重写为**回归结果**：B1–B18 逐条列出可达入口与证据；
C 项（Context/Logs/MCP/Policy）保持 `t('unimplemented')` 占位语义；F.3 细节项逐项对齐。
本轮补上的真实缺口：**B1 的 `resolve` 与 `pin/unpin`**（此前只有模式三态）。

### P8 · 门禁与证据
门禁六项全绿（见 §1）；截图矩阵 **64 张**（中英 2 × 浅深 2 × 宽 4 × 区域 4）+ 画廊 `gallery.html`；
`FEATURE-COVERAGE.md` 回填；任务卡与 `tasks/README.md` 收口。

## 3. 顺带修复的预存缺陷（与本次 UI 改动无关）

`apps/web/src/components/card222.test.tsx:89` 在锁定的 TypeScript 7.0.2 下报 `TS2345`（`priority` 为 `number | undefined`）。
该文件在工作树中与 HEAD 字节一致 ⇒ **HEAD 本身就会让 CI 的 `@vessel/web typecheck` 变红**。
按该文件既有 `!` 风格最小修复。

## 4. 截图矩阵清单（`browser-capture-meta.json`）

| 组 | 张数 | 说明 |
|---|---|---|
| `p2-*` | 3 | 玻璃外壳：工作台浅/深、活动深 |
| `p3-*` | 5 | 四栏 + 8 Tab 检视器：浅/深/英/1023/800 |
| `p4-*` | 5 | 常驻计划清单：浅/深/英/1023/800 |
| `p5-*` | 5 | 胶囊行 + 常驻计量：浅/深/英/1023/800 |
| `p6-*` | 5 | 修丑点：Studio 浅/深/1366、活动、工作台 1366 |
| `full-*` | 64 | **全矩阵**：zh/en × light/dark × 1440/1366/1023/800 × 工作台/活动/Studio/设置 |
| 视口忠实 | 1 | `p2-workbench-light-viewport.png`（未释放滚动，真实视口） |

所有 shot 的 `facts` 记录 DOM 派生证据（`inspectorTabs` / `planCount` / `capsules` / `meters` / `gridCols` 等）；
`events: []` —— 全程 0 console error / 0 uncaught exception。

## 5. 变更文件清单（本轮）

```
apps/web/index.html                                  class="tokens"
apps/web/src/styles.css                              .tokens 令牌层 + 玻璃外壳 + 四栏 grid + 光场 + 胶囊/计量/计划样式
apps/web/src/App.tsx                                 接入 <Rail>，移除旧 primary-nav，活动列表用 formatClock
apps/web/src/i18n.ts                                 新增 21 键（计划 7 + 胶囊/计量 7 + Studio 空态 2 + 其他）
apps/web/src/components/layout/Rail.tsx              【新增】58px 图标轨
apps/web/src/components/layout/layout.css            .dual-surface 两列（中央 + 300px 审阅栏）
apps/web/src/components/PlanChecklist.tsx            【新增】常驻计划清单
apps/web/src/components/PlanChecklist.test.tsx       【新增】7 项
apps/web/src/components/ComposerMeters.tsx           【新增】胶囊行 + 常驻计量
apps/web/src/components/ComposerMeters.test.tsx      【新增】6 项
apps/web/src/components/ConversationView.tsx         接入计划清单与 composer-shell
apps/web/src/components/Sidebar.tsx                  会话行时间 formatClock
apps/web/src/components/SandboxAuditHistory.tsx      审计时间 formatStamp
apps/web/src/components/studio/AgentStudioComposer.tsx  空/加载态
apps/web/src/components/card222.css                  残留硬编码色 → 令牌 + .composer-empty
apps/web/src/components/card222.test.tsx             预存缺陷最小修复（§3）
apps/web/src/utils/timeFormat.ts                     【新增】HH:mm/MM-DD + shortPathLabel
apps/web/src/utils/timeFormat.test.ts                【新增】5 项
docs/design-prototypes/FEATURE-COVERAGE.md           回归结果回填（B1–B18 + 证据）
tasks/223-*.md、tasks/README.md                      状态收口
evidence/sessions/2026-10-15-ui-landing/*             fixture / capture / 截图 / meta / PROOF / gallery
```

`packages/core/` **零改动**；`package.json` 与锁文件未变。
