# Codex 单：剩余视觉项（tray 图标 + 175/277 原图复核），2026-10-29

现状：**HEAD 以 `git log -1` 为准**，工作树干净；全量门禁最近一次 **17 步 exit 0**（根 335 文件 / 3,713 passed + 8 skipped，web 61 / 543，离线 conformance 25/25 $0）。**不要重跑全量门禁**。

这一单只有一件（卡 366），三小块，全部用**看**来判，**不改产品代码**。先读 `tasks/366-visual-recheck-tray-and-original-captures.md`，验收以卡里的 A1–A2 / B1–B3 / C1–C2 / D 为准。

纪律：主线程执行、禁止子代理；不 commit / 不 push、不新建卡、不改任何卡的首行状态与既有行（只在卡 366 末尾追加）；不调其它 Agent CLI；只读产品源码，只写 `evidence/sessions/2026-10-30-visual-recheck/`；浏览器下载与临时夹具落 `%TEMP%`；端口先探再用（建议 5710–5719），收尾停干净并报监听数 0。路由 `gpt-6.1-sol` / `medium`，Fast 关。

**这一单允许「无法验证」**，而且它比猜测更受欢迎。任何一项拿不到画面就如实写「无法验证 + 试过什么 + 卡在哪」，不要用浏览器截图冒充桌面截图，也不要从旧图推断当前实现的缺陷。

---

## A · tray 图标到底在不在

背景：`vessel daemon start` 会在 Windows 上起一个 resident tray 进程（`apps/local-server/src/daemon/tray.ts`，PowerShell STA + `System.Windows.Forms.NotifyIcon`，`Text='Vessel daemon'`，菜单 `Open Vessel` / `Stop Vessel daemon`）。Windows 11 默认把**新出现的**通知区图标丢进溢出面板，所以现有整桌面截图（`evidence/sessions/2026-10-29-deep-sweep/resume/tray.png`）里「通知区没图标」不能算结论——图标可能在 `^` 后面。

做法建议：

1. 隔离起 daemon：`node apps/cli/dist/cli.js daemon start --port 5710`（`apps/cli/dist` 已是最新 `tsc -b` 产物；若 CLI 需要额外的工作区/根参数，以 `--help` 为准，并在报告里写你实际用的命令与所有 `VESSEL_*` 环境变量）。
2. 确认它真在跑：`daemon status --json` 给 pid 与 instanceId，`/api/health` 200（带 token）。
3. 抓通知区：先抓一张整桌面（例如 `ffmpeg -f gdigrab -i desktop -frames:v 1 shot.jpg`，或你手上任何能抓桌面的方式）；再**尝试打开溢出面板**（任务栏 `^`；若能用 UIA，找按钮名如「显示隐藏的图标 / Show hidden icons」），打开后再抓一张。
4. 判三态：**图标存在**（常驻还是溢出面板内？写明）/ **图标不存在**（daemon 确定在跑、至少换一次通知再试）/ **无法验证**（写清哪一步被拦：抓不到桌面、点不到任务栏、拿不到 UIA）。
5. 若图标可见，追加一句「能不能点」：右键菜单是否出现 `Open Vessel` / `Stop Vessel daemon`（能看到就说明是真图标，不是任务栏残留）。**点了要能恢复原状**；收尾用 `daemon stop`。

禁止：把窗口截图/浏览器截图当作「桌面通知区」证据；不要把「ffmpeg 抓不到」直接判成「图标不存在」。

## B · 卡 175 的原图复核（只读已有图）

逐张看，逐张一句判定。文件都在 `evidence/sessions/2026-10-29-remaining/`：

| 图 | 要判什么 |
|---|---|
| `t3-pending.jpg` | 待执行的态色与其他三态可区分？有无遮挡/裁切 |
| `t3-running.jpg` | 运行中的态色，同上 |
| `t3-completed.jpg` | 完成的态色，同上 |
| `t3-failed.jpg` | 失败的态色，同上（与 completed 是否一眼可分） |
| `t3-summary-300.jpg` | 是否看得出「长度到 300 就被截住」 |
| `t3-artifact.jpg` | 产物入口（文件名按钮/链接）是否可见、可辨、不像纯文本 |

配套 JSON：`evidence/sessions/2026-10-29-remaining/` 下的记录可作对照。

**硬约束**：这些图拍于卡 364/365 之前，那时抽屉**没有**「展开全文 / 收起」按钮。**不要因为图里没有该按钮就报缺陷**——那个按钮由卡 364/365 的验收覆盖（`evidence/sessions/2026-10-30-closeout/`、`2026-10-30-drawer-polish/`）。本项只判「当时能验证的那几件事」。

## C · 卡 277 的键盘/焦点原图复核

看 `evidence/sessions/2026-10-28-final-sweep/t1-1440x900.png`（整屏，1440×900），对照 `evidence/sessions/2026-10-28-final-sweep/t1-keyboard.json` 里六步、七处焦点框的坐标，逐条写：

1. 第二个会话的删除按钮（约 217,352，28×28）；
2. 确认条里的「取消」（约 57,437）；
3. Esc 后回到**同一坐标**的删除按钮；
4. 再 Enter 又落到「取消」；
5. Shift+Tab 到「确认」（约 12,437）；
6. Enter 后焦点回到 `#taskInput`（约 301,320）。

每处只写「可见 / 不可见 / 看不清（附原因）」，并说明是否与 JSON 坐标一致。**不要**写「都正常」这种合并结论。

---

## 自验与交付

- 本单没有产品代码改动，所以没有 `vitest` / `tsc` 要跑；**不要**为了让某项「看起来通过」而改源码。若你在过程中真的发现了产品缺陷：只登记（卡 366 末尾 + 证据），**不在本卡修**。
- 产出目录 `evidence/sessions/2026-10-30-visual-recheck/`：`report.md`、A 的桌面截图（原图，不要缩放或二次压缩）、B/C 的判定表（可用 `json`）、收尾进程与端口记录、失败或被拒命令原文。
- 报告格式：A/B/C 三节，每项一句「存在 / 不存在 / 可见 / 不可见 / 看不清（原因）/ 无法验证（原因）」，加实测命令与文件名。
- 只追加到 `tasks/366-visual-recheck-tray-and-original-captures.md` 末尾；不改首行状态、不改 `tasks/README.md`（协调者收口时改）。

## 停止条件

A 连续两次拿不到桌面就停，写「无法验证」并附两次的命令与报错；B/C 是纯看图，做完为止。任何一步需要改源码、加测试、动配置，视为越界，直接报 blocked。收尾必须 `daemon stop`，并贴「监听 0 / 进程 0」。
