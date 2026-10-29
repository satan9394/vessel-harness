# 验收交接 · 2026-10-29（下一会话从这里开始）

> 上一会话上下文用到 60%，交接到这里。新会话**先读 `HANDOFF.md` §0，再读本文件**；不需要上一轮对话的任何内容。
> 本文件只写「现在是什么状态」和「报告到了以后照什么顺序验」。

## 1. 当前状态（2026-10-29，HEAD `4ffce9a`）

- 分支 `main`，**工作树干净**；本机全量门禁最近一次 **17/17 exit 0**：根 **335 文件 / 3,712 passed + 8 skipped**，web **60 文件 / 530 passed**，离线 conformance **25/25、$0**（日志 `%TEMP%/vessel-gate-bebb650d/`）。
- 已验收并提交：卡 360（沙箱拒绝信息加 `[hint]`）、卡 363（artifact 身份比较改 bigint，**安全相关**）、卡 362 的 DAG 溢出提示、卡 361 主链（300 字截断、产物下载、四态颜色）。
- 已判定不做：154、155 字面 3h、ARCH-04 `--live`、V5 卫生项（`.tmp/` 与 62 行 TEMP 引用）、macOS Seatbelt 三件、原生输入法。

## 2. 正在等：Codex 收尾单的报告

单在 `tasks/prompts/codex-handoff-2026-10-29-closeout.md`，三件：

| 编号 | 内容 | 对应卡 |
|---|---|---|
| T1 | 卡 362 的**头部观感复核**（唯一真正的未闭合项）：960 下量 `.usage-bar` 各 span 是否还逐字换行，并补 720/1440/1920 回归图 | `tasks/362-narrow-width-layout-squeeze.md` |
| T2 | 卡 364：抽屉 300 字摘要补 `…` 与「展开全文/收起」 | `tasks/364-team-drawer-truncation-affordance.md` |
| T3 | 卡 361 遗留断言：内联 widget 只发一次 | `tasks/361-card175-fixture-residuals.md` |

**T2 有一次经批准的扩围**（协调者在对话中批准，交付后要写进卡 364）：现有 `getStage()` 只发 300 字符 + `…`，客户端拿不到全文，因此允许新增**一个只读端点**（形如 `GET /api/team/stages/:stageId/tasks/:taskId/result`，走已有 `getTaskResult()`，沿用同源/daemon token 处理），配套 ApiClient 方法与 runtime/server/UI 三组测试；约束是「只返回运行时已持有的结果、不按路径读文件、未知或跨会话 id 一律 404、输出上限 64 KiB 并标注截断」。

## 3. 报告到达后的验收顺序（只认自己跑出来的数字）

1. **解析 rollout**：`last_agent_message` 是汇总，数字以它引用的卡/报告为准。解析脚本可临时重建（读 jsonl 逐行 `JSON.parse`，取 `payload.type === 'task_complete'` 的 `last_agent_message` 与 `payload.type === 'message' && payload.role === 'assistant'` 的文本）。
2. **逐项对卡**：T1 → 卡 362；T2 → 卡 364；T3 → 卡 361。看结论是否与截图/JSON 对得上，**不接受 `accepted_local` 与子代理 PASS**。
3. **自己看图**：T1 的四张头部截图必须能看出 span 单行、无逐字竖排；T2 的短/300/570 三态截图必须看得出省略号与展开前后差异；T3 的 widget 计数 JSON 要和截图对得上。
4. **自己复跑**（受影响面）：
   ```
   node node_modules/vitest/vitest.mjs run --root apps/web
   node node_modules/vitest/vitest.mjs run apps/local-server
   node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
   node node_modules/typescript/bin/tsc -b tsconfig.json
   node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
   ```
   若 T2 动了 server/runtime，把 `packages/application` 与 `apps/cli` 也带上。
5. **最后自己跑一次全量**：`pwsh -NoProfile -File scripts/gate-batched.ps1`（约 12–14 分钟，17 步）。**先 `npx tsc -b`**，因为真实进程与 `vite build` 读 `dist`。
6. **落卡与同步**：卡 362/364/361 末尾追加验收段 + 首行状态；`tasks/README.md` 对应行与「未闭合」段；`HANDOFF.md` §0 的「最近交付 / 待执行 / 全量门禁」。**未 commit 之前先看 `git status`**，再按组提交（安全类与外观类分开）。

## 4. 已知坑（别重复踩）

- **别在 Codex 任务 running 时改仓库**：它的 scope audit 会判 source drift。要改先等报告。
- **`dist` 会落后于 `src`**：真实进程与 `vite build` 读 `dist`；任何真实复验前先 `tsc -b`。
- **全量门禁必须分段脚本**（`scripts/gate-batched.ps1`），单跑根 `vitest` 会漏 `apps/web`。
- **浏览器下载要落 `%TEMP%`**：上一轮有一次落到 TEMP 外再手工移回。
- **无头浏览器没有会话深链**：应用用 React state 选会话，`/session/<id>` 不生效、CDP 点侧边栏也没命中——这正是卡 362 至今没闭合的原因，必须用**可见 IAB** 补。
- **本机已知 flake**：`apps/local-server` 与 `apps/cli` 合在一次 vitest 调用时，`teamStageApi.test.ts` 偶发 `expected [Function] to throw`；单跑与重跑均绿，且 363 已修掉真正的成因（bigint），若再遇到先看是不是同一断言。
- **`.tmp/` 与 62 行绝对 TEMP 引用是历史记录**，不许清理或改写。

## 5. 剩下的人手项（不阻塞）

- 点击任务栏 `^` 看一眼 tray 图标（Windows 11 新图标默认进溢出面板；功能已验：真 daemon 下子进程存活、假 pid 时自杀）。
- 175/277 的视觉复核（签字口径已改为「协调者按证据签字，原图可复核」）。

## 6. 文件指针

- 交接总表：`HANDOFF.md` §0；本文件：`evidence/sessions/2026-10-29-acceptance-handoff.md`
- 收尾单：`tasks/prompts/codex-handoff-2026-10-29-closeout.md`
- 三张卡：`tasks/362-narrow-width-layout-squeeze.md`、`tasks/364-team-drawer-truncation-affordance.md`、`tasks/361-card175-fixture-residuals.md`
- 最近证据：`evidence/sessions/2026-10-29-remaining/`（T1–T4）、`2026-10-29-zoom-render/`（150%/200% 栅格）、`2026-10-29-linux-sandbox/`（WSL2 写隔离与 setsid）
