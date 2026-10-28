# Codex 终局清扫单（2026-10-28）—— 剩下的全部一次做完

这是一张**一次性**的活单：仓库里还没闭合的项已全部收在这里，按 T1→T5 顺序做完即可收工。看完全文再动手，别按记忆行事。

**本单只有一个文件、一个会话、主线程。** 不要 spawn 子代理（可见 IAB 在子代理线程会被拒，这是前两次失败的直接原因）。

---

## 0. 现状：这些已经做完了，不要重做

- 分支 `main`，HEAD `50ce6f4`，工作树干净（`git status --porcelain` 应为空）。
- 全量门禁 17 步在 2026-10-28 `exit 0`（含 daemon 修复后的最新一次）：根 **335 文件 / 3,706 passed + 8 skipped**，web **59 文件 / 528 passed**，离线 conformance 25/25、$0；日志 `%TEMP%/vessel-gate-b569dca3/`。**不要重跑全量门禁**（`scripts/gate-batched.ps1` 跑一次要 10 分钟）。
- 已有证据，别重拍、别重跑：
  - 卡 260/275 的 W1/W2 视口：`evidence/sessions/2026-10-28-iab-run5/`（917×567 两张，已由协调者逐字看图签收）。
  - 卡 277 的几何：`node scripts/ui-geom-check.mjs` 已 exit 0、`geometry check passed (5 cases)`。
  - 卡 179 的双 Root 全量：`npm run test:all` 已 exit 0（根 333 / 3,694 + 8，web 59 / 528）。
  - 卡 359 / 176 的 daemon：`vessel daemon start` 已修好并真机五步验过（同一 pid 在启动进程退出后存活、uptime 增长、health 200、401/200、stop 后监听 0）。**daemon 现在能正常起来了，不需要再修。**
  - run 6 的停止报告：`evidence/sessions/2026-10-28-iab-run6/`（它是上一轮半途停下的记录，不是你的起点）。

## 1. 本轮只有 5 件事

| 编号 | 事 | 谁能做 | 本单要求 |
|---|---|---|---|
| T1 | 卡 277：1440×900 下 7 步键盘/焦点剧本 + 整屏图 | 你（可见 IAB） | 必须做 |
| T2 | 卡 175：StagedBanner、画布状态色、节点抽屉、Approve & Run | 你（可见 IAB） | 必须做，做不到的状态如实标 UNVERIFIED |
| T3 | 卡 179：引用 T1/T2 结果 | 你（只写引用） | 不做新工作 |
| T4 | tray/toast 桌面可见性：一次限定尝试 | 你（若你能看本地图片） | 尝试一次，10 分钟封顶 |
| T5 | 补两条「今天能跑」的离线证据（沙箱四件套 + 离线 conformance） | 你（终端） | 必须做，纯读不改 |

## 2. 纪律（违反即整批不算）

- **不改产品源码、测试、脚本、配置、`.pdw/`**；唯一允许写的仓库路径是本单第 8 节列的「新证据目录 + 指定卡末尾追加」。
- 不 `git add` / `commit` / `push` / 建分支；不新建任务卡；不动 `tasks/README.md`、不改任何卡的首行状态（签收归协调者）。
- 不调用本机其它 Agent CLI（`dsh` / `opencode` / `claude` / `pi`），也不跑 `--live`。
- 不用 DOM 观测、旧截图、组件测试顶替视口证据；拿不到就写「无法验证 + 原因 + 试过的手段 + 实测值」。
- 不做 150%/200% 缩放与原生输入法（IAB 做不了，属附录 A）。
- 日志与中间产物一律写 `%TEMP%`，不落仓库；删除一律进回收站，不做永久删除。
- 路由：`gpt-6.1-sol` / `medium`，Fast 关闭，不用 Ultra；首轮不预升档。

## 3. T1 · 卡 277：键盘与焦点（先做，边界最清楚）

前置：`node node_modules/typescript/bin/tsc -b tsconfig.json` 与 `npm run -w @vessel/web build`（**不要** `build:clean`），两条都要 exit 0；记下 `apps/web/dist/index.html` 新 mtime 与引用的 `assets/index-*.js`。

夹具：系统 TEMP 独立工作区 + 隔离 `HOME/USERPROFILE/APPDATA/LOCALAPPDATA` 与 `VESSEL_SESSION_ROOT/VESSEL_PROVIDER_ROOT/VESSEL_USAGE_ROOT/VESSEL_MCP_ROOT/VESSEL_SETTINGS_ROOT/VESSEL_DAEMON_ROOT`，`VESSEL_TRASH_TTL_DAYS=0`；`vessel serve` 先用 5678（占用则 5700–5799 空闲端口）。**至少两个会话**，第二个会话用于删除剧本。

剧本（`tasks/prompts/card277-browser-recheck.md` §3，逐字执行）：

1. Tab 到第二个会话的删除按钮；
2. Enter 打开确认；
3. Esc 取消，记录焦点是否回到触发按钮；
4. 再 Enter；
5. Shift+Tab 到「取消」；
6. Enter 确认删除；
7. 再截一张 1440×900 整屏。

> **事后更正（2026-10-28，协调者）**：上面第 5、6 步的措辞是错的，自相矛盾——实际行为是「打开确认条后焦点在**取消**，Shift+Tab 移到**确认**，再 Enter 才删除」。执行者照原文做了并如实记了「走到确认」，判定按权威判据（`tasks/277-ui-p2-fixes.md` 的 Browser recheck 一节）为准。后续再跑请以那份卡为准，不要照抄这两步。

每一步都要记 `document.activeElement.outerHTML.slice(0,120)`、焦点矩形（x/y/w/h 与是否可见）、以及 Console 错误列表。判据：焦点矩形可见、Esc 回到触发按钮、Shift+Tab 落点在「取消」、Console 无错误。任何一步不一致就写「不通过 + 实际落点」，**不要改代码**。

产出：`t1-1440x900.png` + `t1-keyboard.json`。

## 4. T2 · 卡 175：画布 / 抽屉 / 预审

同一夹具、同一 server。可写入口已存在：`POST /api/sessions/<id>/team-stages`，body `{"task":"…"}`（参照 `apps/local-server/src/teamStageApi.test.ts:27`）；列表 `GET /api/team/stages`；批准 `POST /api/team/stages/<id>/approve`。

步骤：

1. UI 新建会话 → 用**同源 HTTP** POST 造一个 staged 方案（报告里写明用了 POST，不许直接写 `.harness` 伪造任务树）→ 刷新 UI；
2. 截 StagedBanner：队员 roster、routeSnapshot、`Approve & Run` 与 `Reject` 同时可见 → `t2-staged-banner.png`；
3. 截画布：尽量覆盖 ≥3 种节点状态色（等待/就绪/运行/完成/失败）与连线 → `t2-canvas.png`，并把读到的节点数与状态分布写进 JSON；
4. 点节点开抽屉：前置依赖、输出摘要（300 字截断）、产物文件链接 → `t2-drawer.png`；
5. 点 `Approve & Run`：节点 ready → completed（或入队转 running）→ `t2-approved.png`，并记 Console 错误。

**诚实条款**：某种状态如果在「不起真实多 agent 运行」的前提下造不出来，就写「该状态 UNVERIFIED + 原因」，不要用假数据、DOM 拼图或旧图。宁可少一张图，也不要编。

产出：4 张图 + `t2-measurements.json`。

## 5. T3 · 卡 179：只写引用

不新建夹具、不做新操作。在卡 179 末尾追加一段：引用 T1/T2 的结论与文件名，并复述「双 Root 全量已由协调者跑过（334/3,704+8、web 59/528 同口径）」。若 T1/T2 有 UNVERIFIED 项，照实继承。

## 6. T4 · tray / toast：一次限定尝试（10 分钟封顶）

背景：卡 176 的 detached 存活已验收，只剩「原生托盘图标 / 系统通知是否真的出现」。这不是浏览器可见面，只能看桌面。

做法（最多两步，失败即停）：

1. 隔离根下 `node apps/cli/dist/cli.js daemon start --port <空闲端口> --json`（现在能起来了）；
2. 用 PowerShell 截一张全桌面：

```powershell
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height
$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size)
$bmp.Save("$env:TEMP\vessel-tray-$(Get-Date -f HHmmss).png")
```

**只有当你确实能看到这张图时**才判定：图标是否在通知区（含溢出面板）、右键是否有 Open/Stop。看不到图、或图标本来就被系统折叠，就记 **UNVERIFIED + 原因**，不要猜、不要用 `notifications.test.ts` 的 mock 冒充。判定完 `daemon stop`，确认端口监听 0。

产出：最多一张 `t4-desktop.png` + 结论一行（通过 / 不通过 / 无法验证）。

## 7. T5 · 补两条离线证据（纯读，不改仓库）

1. 沙箱四件套 + Shell 降权用例，五条命令都要 exit 0，记文件数/用例数：

```
node node_modules/vitest/vitest.mjs run packages/tools/src/execution/sandbox/windowsRestricted.test.ts
node node_modules/vitest/vitest.mjs run packages/tools/src/execution/sandbox/platformSandbox.test.ts
node node_modules/vitest/vitest.mjs run packages/runtime/src/process/Process.sandbox.test.ts
node node_modules/vitest/vitest.mjs run packages/application/src/nativeSandboxIntegration.test.ts
node node_modules/vitest/vitest.mjs run packages/tools/src/shell/shellTool.sandbox.test.ts
```

2. 离线跨 harness（不带 `--live`，不碰外部 CLI）：

```
npm run bench:conformance
```

记 25/25、0 failed、$0 与实际耗时。

**这两条只证明「离线契约仍绿」，不构成 Windows ACL / Low Integrity 真机执法证据**——那条在附录 A2，只有维护者能做。报告里必须写清这个边界。

## 8. 证据与落卡

- 新目录：`evidence/sessions/2026-10-28-final-sweep/`（`report.md` + 上述图片 + JSON + 收尾记录）。
- 截图存盘后核对魔数再命名（历史上出现过 `.png` 实为 JPEG）；优先 `tab.screenshot()`，raw CDP 的 `Page.captureScreenshot` 曾出现「尺寸对但画面被放大裁切」，raw 版本只作废图保留。
- 末尾追加（**只许追加，不改已有行**）：`tasks/175-visual-team-dag-canvas-and-staged-approval.md`、`tasks/179-epic-universal-team-workspace-and-daemon-mesh.md`、`tasks/277-ui-p2-fixes.md`、`tasks/176-headless-daemon-and-tray-resilience.md`（只写 T4 结论）、`tasks/180-os-native-sandboxing-and-restricted-tokens.md` 与 `tasks/183-epic-hardened-runtime-and-cognitive-memory.md`（只写 T5 结论与边界）。
- 报告骨架：① 每项 `通过 / 不通过（附现象）/ 无法验证（附原因）`——**不要写整卡「已验收」**；② 每条判据的实测值与文件名；③ dist 新鲜度凭据；④ 端口/进程收尾（监听数 0、无残留 daemon）；⑤ 逐条被拒或失败命令的原文；⑥ 改动文件清单（应只有新证据目录与上述卡的末尾追加）。

## 9. 停止条件

- `createBrowserTab('iab', url, {visible:true})` 被拒 → `js_reset` 重试**一次**；仍被拒即停，照录两次原文，T1/T2 记 UNVERIFIED，**不要**用替代证据。
- 任一操作连续两次失败就停手写清实测值，不要无限重试。
- T4 超过 10 分钟没有可判定的桌面图 → 直接记 UNVERIFIED 并进 T5。
- 全部做完后：停掉自建 `serve` 与 daemon，确认相关端口监听数为 0，夹具留在 `%TEMP%` 供核对。

---

# 附录 A —— 只能维护者本人做（你只需在报告里各写一行现状，不要尝试）

| 项 | 为什么你不行 | 维护者要做的事 |
|---|---|---|
| A1 卡 260/275 的 150%/200% 真实缩放 + 原生输入法 | IAB 里 `Ctrl+=` 不改变 `innerWidth/DPR`，CDP `deviceScaleFactor` 只改 DPR；输入法需要 OS 层 | 真机浏览器缩放到 150%/200% 各看一眼，切一次中文输入法 |
| A2 Windows ACL / Low Integrity 真机执法（卡 180/183） | 需要**管理员**改宿主 ACL，代码刻意不自动改 | `scripts/provision-sandbox.ps1 -Path <一次性目录>` → 同目录写成功 / 越界写被拒 → `-Revoke` |
| A3 macOS 脱离进程组生命周期（卡 180/183） | 本机是 Windows，没有 macOS 内核 | 需要一台 macOS 主机 |
| A4 卡 154 `release-report` 刷新 | 要 opencode-go 配额并真打网络，且刷完仍是 partial | 确认配额后再决定 |
| A5 卡 155 字面 3h 墙钟 soak | 要占机 3 小时且本人盯，`SOAK-068` 已论证等价压力 | 想跑就用附录 B 的命令，不跑就保持现状 |
| A6 ARCH-04 `--live` 跨 harness | 会启动你机器上的其它 agent，必须逐次授权；且 adapter 已脱节 | 明确同意后再谈，或先授权修 adapter |
| A7 U1–U5 对外事项（GitHub Support 清 `refs/pull/*`、npm 元数据、规则集 bypass、游离提交、PR 页面旧身份） | 只能以你本人名义对外 | 见 `evidence/sessions/2026-09-27-residual-exposure-audit.md` §A-1/§B/§F |
| A8 卡 175/277 的用户视觉签字 | 签字主体只能是你 | 看 T1/T2 的图，点头即可 |

# 附录 B —— 已判不做（不要执行，也不要在报告里重开）

1. **V5 报的 `.tmp/` 目录**：那是 2026-10-07 为验证锁文件而保留的 `node_modules` 备份，故意不删。**不要清理。**
2. **V5 报的 62 行绝对 TEMP 引用**：都是历史文档与证据里的原始记录，改掉等于伪造历史。**不要改。**
3. **卡 350 的 profileParity 偶发**：已加固并有守卫，根因未定位但非阻塞，不在本单范围。
4. **`apps/local-server` + `apps/cli` 合跑时 `teamStageApi.test.ts` 偶发失败**：单跑 2/2 绿、同命令重跑整组 1,101 全绿，判为合跑负载问题，不在本单范围。
5. **字面 3h soak**：见 A5。若维护者坚持要跑，命令是 `npx tsx benchmarks/runners/src/soak/run-soak.ts`（靠 `SOAK_TASKS` / `SOAK_ROUNDS` 放大规模，没有墙钟参数），但别在你这轮跑。
