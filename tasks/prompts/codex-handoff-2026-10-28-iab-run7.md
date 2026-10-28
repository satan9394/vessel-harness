# Codex 单（run 7）：只做浏览器验收 —— 175 / 179 / 277

上一轮（run 6）Part A 已经由协调者收口：`vessel daemon start` 的构造期崩溃与 `Set-Acl` 幂等性问题都修好并真机验过（卡 359），**本轮不要改任何源码或测试**，只做浏览器取证。

全程：**主线程执行，禁止 spawn_agent / 子代理**（visible IAB 在子代理线程会被拒）；不 `git add`/`commit`/`push`/建分支；不新建任务卡；不调用本机其它 Agent CLI；不用 DOM 观测、旧截图、组件测试顶替视口证据。

路由：`gpt-6.1-sol` / `medium`，Fast 关闭，不用 Ultra。首轮不预升档。

## 0. 开工前置

```
node node_modules/typescript/bin/tsc -b tsconfig.json
npm run -w @vessel/web build        # 只能用这个；不要 build:clean
```

两条都要 exit 0。把 `apps/web/dist/index.html` 的新 mtime 和它引用的 `assets/index-*.js` 记进报告（证明拍的是当前源码构建出来的 UI）。

## 1. 夹具

系统 TEMP 下独立工作区 + 隔离 `HOME/USERPROFILE/APPDATA/LOCALAPPDATA` 与 `VESSEL_SESSION_ROOT/VESSEL_PROVIDER_ROOT/VESSEL_USAGE_ROOT/VESSEL_MCP_ROOT/VESSEL_SETTINGS_ROOT/VESSEL_DAEMON_ROOT`，`VESSEL_TRASH_TTL_DAYS=0`。`vessel serve` 先试 5678，占用则用 5700–5799 的空闲端口。需要模型时用无密钥的本地脚本桩 provider（OpenAI 兼容、`/v1`、通过正常 UI 配置）。不使用真实用户会话、真实项目名或任何凭据。

## 2. B1 · 卡 277 键盘与焦点（先做，边界最清楚）

按 `tasks/prompts/card277-browser-recheck.md` §3 的 7 步剧本，在**可见 IAB、1440×900** 下走一遍：Tab 到第二个会话的删除按钮 → Enter → Esc → 再 Enter → Shift+Tab → Enter。记录每步的 `document.activeElement.outerHTML.slice(0,120)`、焦点矩形是否可见、Esc 后焦点是否回到触发按钮；最后截一张 1440×900 整屏并记录 Console 错误（期望无）。

几何部分**已由协调者验过**（`node scripts/ui-geom-check.mjs` exit 0、5 cases），不要重跑。任一步落点与卡内描述不一致，写「不通过 + 实际落点」，不要顺手改代码。

## 3. B2 · 卡 175 画布 / 抽屉 / 预审

可写入口：`POST /api/sessions/<id>/team-stages`，body `{ "task": "…" }`（见 `apps/local-server/src/teamStageApi.test.ts:27`）；列表 `GET /api/team/stages`；批准 `POST /api/team/stages/<id>/approve`。

步骤：UI 新建会话 → 用同源 HTTP POST 造一个 staged 方案 → 刷新 UI →
1. 截 StagedBanner：队员 roster、routeSnapshot、`Approve & Run` / `Reject` 同时可见；
2. 截画布：尽量截到 ≥3 种节点状态色与连线；**在不起真实多 agent 运行的前提下造不出来的状态，照实写「该状态 UNVERIFIED + 原因」**，不要用假数据或旧图；
3. 点节点开抽屉，截到前置依赖、输出摘要（300 字截断）、产物文件链接；
4. 点 `Approve & Run`，截到节点 ready → completed（或入队转 running），记录 Console 错误。

辅助手段只允许 UI 同源 HTTP 造 stage 数据，并在报告写明用了 POST；不许直接写 `.harness` 文件伪造任务树。

## 4. B3 · 卡 179

不做新工作：引用 B1/B2 的结果。双 Root 全量已由协调者跑过 `npm run test:all` exit 0（根 333 文件 / 3,694 passed + 8 skipped，web 59 / 528），不要重跑。

## 5. 证据与落卡

- 目录：`evidence/sessions/2026-10-28-iab-run7/`（`report.md` + 截图 + 测量 JSON + 收尾记录）。
- 截图存盘后核对魔数再命名；优先 `tab.screenshot()`，raw CDP 的 `Page.captureScreenshot` 曾出现「尺寸对但画面被放大裁切」，raw 版本只作废图保留。
- 末尾追加（只许追加，不改已有行）：`tasks/175-…`、`tasks/179-…`、`tasks/277-ui-p2-fixes.md`。
- 报告骨架：① 每项 `通过 / 不通过（附现象）/ 无法验证（附原因）`，**不要写整卡「已验收」**（签收归协调者）；② 每条判据的实测值与文件名；③ dist 新鲜度凭据；④ 端口与服务收尾（监听数 0）；⑤ 逐条被拒/失败命令原文；⑥ 改动文件清单（应只有 `dist/**`、新证据目录、三张卡的末尾追加）。

## 6. 停止条件

`createBrowserTab('iab', url, {visible:true})` 被拒就 `js_reset` 重试一次；仍被拒即停并照录两次原文，结论记 UNVERIFIED。任一操作连续两次失败即停手写清实测值。不做 150%/200% 缩放与原生输入法；不做全量门禁；不做 commit。
