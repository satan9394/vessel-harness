# Codex 单（应用内）：卡 366 的 A 项——tray 图标到底在不在（2026-10-30）

**在 Codex 应用里跑，不要用 CLI**：这一单要用 Computer Use 操作 Windows 桌面 + 浏览器插件看页面，CLI 形态调不到。模型 `gpt-6.1-sol` / `medium`（桌面多步操作，允许一次返工），Fast 关，不用 Ultra。

现状：HEAD 以 `git log -1` 为准，工作树干净。**不改代码、不跑测试、不跑门禁**，这一单只产出「图标在不在」的证据。

## 背景（别被通用图标骗了）

`vessel daemon start` 会在 Windows 上起一个 resident tray 进程（`apps/local-server/src/daemon/tray.ts`）：PowerShell STA + `System.Windows.Forms.NotifyIcon`，`Text = 'Vessel daemon'`，图标用的是 `SystemIcons.Application`——**通用应用图标，不是 Vessel 的品牌图标**，所以不要指望认图形，认**悬停 tooltip 的文字**或 UIA 的可访问名。菜单只有两项：`Open Vessel`、`Stop Vessel daemon`。

Windows 11 默认把新出现的通知区图标塞进**溢出面板**（任务栏右侧的 `^` / 「显示隐藏的图标」）。所以只看常驻通知区就判「没有」是错的——上一轮就是这么误判的。

## 步骤

1. 端口先探（5715–5719，被占就换）：`node apps/cli/dist/cli.js daemon start --port 5715`。
2. 确认它真在跑：`node apps/cli/dist/cli.js daemon status --json` → pid 与 instanceId；`/api/health` 200（带 token）。失败就停下报 blocked，附完整报错。
3. 等 2–3 秒，让 tray 子进程把图标挂上。
4. **Computer Use 先枚举窗口**，确认这一轮能不能拿到任务栏 / Explorer 桌面窗口（上一轮没装插件时是 `taskbarExposed: false`，那已经是历史结论）。拿到就按可访问名或真实坐标绑定，**不许猜句柄、不许点未知坐标**。
5. 取证三步，每步一张**整桌面**截图：
   - ① 只截常驻通知区（看是不是直接被提升了）；
   - ② 点任务栏 `^` 打开溢出面板，在面板里找通用应用图标，悬停看 tooltip 是否 `Vessel daemon`；若 UIA 能读出名字，优先用名字匹配，别靠肉眼；
   - ③ 找到后**右键一次**，确认菜单是 `Open Vessel` / `Stop Vessel daemon`，截图。**只读菜单，按 Esc 关掉，不要点这两项**（停 daemon 用 CLI）。
6. 收尾：`daemon stop`，贴「监听 0 / 进程 0」，并确认 tray 进程已消失。

界面会有点动静（溢出面板会弹出、可能出现一个通用应用图标），属预期，不用在意。

## 判据（对应卡 366 的 A1–A5）

- **A1** 三态结论，只选一个：**存在**（写清在溢出面板内还是常驻通知区）/ **不存在**（daemon 确定在跑、间隔 5 秒至少重试两次、两张截图都在）/ **无法验证**（写清卡在哪一步：拿不到任务栏、点不到 `^`、读不到 tooltip，附窗口清单）。
- **A2** 若存在：面板内还是常驻 + 截图里的大致坐标 + 你用来认定它的依据（tooltip 文字 / UIA 名字）。
- **A3** 右键菜单两项的证据（截图或 UIA 文本）；拿不到就明确写拿不到，别推测。
- **A4** 收尾干净：`daemon stop` 后无残留端口与进程，tray 进程也没了。
- **A5** 全程零代码改动；发现真缺陷只登记，不在本单修。

禁止：拿浏览器/应用窗口截图冒充桌面通知区；点 `^` 之前就先下结论；把「溢出面板里没找到」直接写成「功能不存在」（先确认 daemon 在跑、重试两次）。

## 产出

- `evidence/sessions/2026-10-30-tray-check/`：`report.md`（A1–A5 逐条）、整桌面截图（原图，别缩放）、窗口清单 json、收尾进程/端口记录、失败命令原文。
- 只追加到 `tasks/366-visual-recheck-tray-and-original-captures.md` 末尾；不改首行状态与既有行、不改 `tasks/README.md`。
- **边做边写**：每完成一步就把那一行写进 report.md，别攒到最后（上一次派发跑了三秒就断，结论全丢）。
