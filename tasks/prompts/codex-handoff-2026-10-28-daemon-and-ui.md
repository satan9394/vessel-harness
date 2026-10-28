# Codex 单：修 daemon 启动 + 补 175/179/277 的浏览器验收（2026-10-28）

两部分，**按序执行**：A 是代码修复（会改源码和测试），B 是浏览器取证（只写证据与卡）。A 做完再开 B——B 里的 175/179 需要 `apps/web/dist` 与 serve 都是最新的，而 A 会动 `apps/local-server` 的 `dist`。

全程：**主线程执行，禁止 spawn_agent / 子代理**（浏览器部分上次就是死在这里）；不 `git add`/`commit`/`push`/建分支；不新建任务卡；不调用本机其它 Agent CLI（`dsh`/`opencode`/`claude`/`pi`）；不用 DOM 观测、旧截图、组件测试顶替真实视口证据。

路由：两部分都是 `gpt-6.1-sol` / `medium`，Fast 关闭，不用 Ultra。A 属「多文件 + 预期返工」，B 属「需要判读截图」；首轮不预升档，真红了才升 `xhigh`。

---

## Part A · 修 `vessel daemon start`（卡 359，先做）

读 `tasks/359-daemon-start-mesh-identity-crash.md`，里面有完整根因和验收。要点复述：

1. **主因**：`apps/local-server/src/server.ts:297` 在构造期比较 `opts.mesh.local.nodeId !== opts.daemon.status().instanceId`，而 `apps/cli/src/daemon/daemonCommands.ts:76` 的 `let info` 要到 `:102`（`server.listen()` 之后）才赋值，构造期恒为 `undefined` → 必抛 `mesh identity must match daemon`。修法是让构造期就能拿到身份（把身份字段提前确定，或让 `status()` 在未就绪时回落到 `{ instanceId }`）；**不许放宽 `server.ts:297` 的比较本身**。
2. **次因**：`apps/local-server/src/daemon/daemonLifecycle.ts:55-58` 用 `powershell.exe` 跑 `Set-Acl`，从 pwsh 7 启动时继承了 pwsh 7 的 `PSModulePath` → `CommandNotFoundException: Set-Acl`。修成不依赖调用方 `PSModulePath`（显式传干净值 / 改用 `pwsh -NoProfile` / 改用 `icacls`），报告写明选哪个和为什么。
3. **回归测试（重点）**：必须新增一条用**真实** `createVesselServer({ daemon, mesh, authToken, port: 0 })` 构造的用例，修复前应当**红**——请先把它跑红并把原文留下来，再修到绿。现有测试全 mock 了 `daemonRuntime.server`，所以这条 bug 一直没被抓到。
4. **真机五步**（隔离根，只写 `%TEMP%`）：
   ```
   VESSEL_DAEMON_ROOT / VESSEL_SESSION_ROOT / VESSEL_PROVIDER_ROOT / VESSEL_USAGE_ROOT /
   HOME / USERPROFILE / APPDATA / LOCALAPPDATA   →  %TEMP%\vessel-359-<random>\...
   ```
   - 空闲端口（5700–5799，先查监听）起 `node apps/cli/dist/cli.js daemon start --port <p> --json`，要求 ready 且 `daemon.json` 有 pid；
   - 杀掉启动它的 shell 进程 → 等 2–3 秒 → `daemon status --json` 同一 pid、uptime 增长；
   - `/api/health` 200；受保护端点不带 Bearer 401、带 Bearer 非 401；
   - `daemon stop` 后进程消失、端口监听数 0。
5. 自验：`node node_modules/vitest/vitest.mjs run apps/local-server apps/cli`、`node node_modules/typescript/bin/tsc -b tsconfig.json`、`node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit`，三条都要 exit 0。

允许改：`apps/cli/src/daemon/**`、`apps/local-server/src/server.ts`（仅该身份校验与 `daemon` 选项接法）、`apps/local-server/src/daemon/daemonLifecycle.ts`、对应测试、`tasks/359-daemon-start-mesh-identity-crash.md`（末尾追加）。

**A 完成后就地停**，在卡 359 追加：修复前后的回归输出、真机五步的 pid/uptime/HTTP 码/端口计数、日志路径、被拒命令原文。然后继续 B。

---

## Part B · 175 / 179 / 277 的浏览器验收

先重建（A 改过源码）：
```
node node_modules/typescript/bin/tsc -b tsconfig.json
npm run -w @vessel/web build        # 不要用 build:clean
```
两条都 exit 0，并把 `apps/web/dist/index.html` 新 mtime 与引用的 `assets/index-*.js` 记进报告（作为「拍的是新 UI」的凭据）。

夹具：系统 TEMP 下独立工作区 + 隔离 `HOME/USERPROFILE/APPDATA/LOCALAPPDATA/VESSEL_*`，`VESSEL_TRASH_TTL_DAYS=0`；`vessel serve` 用 5678（先查监听，占用则换 5700–5799）；如需模型，用无密钥的本地脚本桩 provider（OpenAI 兼容、`/v1`、通过正常 UI 配置）。**不要**用真实用户会话、真实项目名或真实凭据。

### B1 · 卡 277 键盘与焦点（优先级最高，验收边界最清楚）

按 `tasks/prompts/card277-browser-recheck.md` §3 的 7 步剧本，在**可见 IAB、1440×900** 下走一遍：Tab 到第二个会话的删除按钮 → Enter → Esc → 再 Enter → Shift+Tab → Enter，并记录 `document.activeElement.outerHTML.slice(0,120)`、焦点矩形是否可见、Esc 后焦点是否回到触发按钮。再截一张 1440×900 的整屏。

- 几何部分**已经由协调者验过**（`node scripts/ui-geom-check.mjs` exit 0、`geometry check passed (5 cases)`），不要再重跑、不要重建 dist。
- 判据：焦点矩形可见、Esc/Shift+Tab 的落点与卡内描述一致、Console 无错误。若某步落点不同，记「不通过 + 实际落点」，不要顺手改代码。

### B2 · 卡 175 画布 / 抽屉 / 预审

可写的入口已经存在：`POST /api/sessions/<id>/team-stages`，body `{ "task": "…" }`（见 `apps/local-server/src/teamStageApi.test.ts:27`），返回 stage，`GET /api/team/stages` 可列，`POST /api/team/stages/<id>/approve` 批准。

步骤：UI 新建会话 → 用同源 HTTP POST 造一个 staged 方案 → 刷新 UI →
1. 截 StagedBanner：队员 roster、routeSnapshot、`Approve & Run` / `Reject` 两个按钮同时可见；
2. 截画布：能截到 ≥3 种节点状态色（等待/就绪/运行/完成/失败里任三）与连线；**如果某种状态在不起真实多 agent 运行的前提下造不出来，就照实写「该状态 UNVERIFIED + 原因」，不要用假数据或旧图**；
3. 点节点开抽屉，截到前置依赖、输出摘要（300 字截断）、产物文件链接；
4. 点 `Approve & Run`，截到节点由 ready 变 completed（或 enqueue 后进入 running），并记 Console Errors（期望 `[]`）。

允许的辅助手段：仅用 UI 同源 HTTP 造 stage 数据，并在报告里写明用了 POST；不许直接写 `.harness` 文件伪造任务树。

### B3 · 卡 179（Epic）

不单独做新工作：B1/B2 通过即引用其结果；「双 Root 全量」这一条协调者已经跑过 `npm run test:all` **exit 0**（根 333 文件 / 3,694 passed + 8 skipped，web 59 / 528），你不要重跑，只在卡里引用。

### 证据与落卡

- 证据目录：`evidence/sessions/2026-10-28-iab-run6/`（`report.md` + 截图 + 测量 JSON + 端口/进程收尾记录）。
- 截图存盘后**核对魔数再命名**；raw CDP 的 `Page.captureScreenshot` 上次出现过「尺寸对但画面被放大裁切」，这次优先用 `tab.screenshot()`，raw 版本只作废图保留。
- 末尾追加（只许追加，不改已有行）：`tasks/175-…`、`tasks/179-…`、`tasks/277-ui-p2-fixes.md`。
- 报告骨架：① 每项结论 `通过/不通过（附现象）/无法验证（附原因）`——**不要写整卡「已验收」**，签收归协调者；② 每条判据的实测值与文件名；③ dist 新鲜度凭据；④ 端口与服务收尾（监听数 0）；⑤ 逐条被拒/失败命令原文；⑥ 改动文件清单（应只有 `dist/**`、新证据目录、三张卡的末尾追加）。

### 停止条件

- `createBrowserTab('iab', url, {visible:true})` 被拒 → `js_reset` 后重试一次；仍被拒就停，两次原文照录，结论记 UNVERIFIED。
- 任一操作连续两次失败就停手写清实测值，不要无限重试。
- 不做 150%/200% 缩放与原生输入法（IAB 做不了）；不做全量门禁（协调者已跑）；不做 commit。
