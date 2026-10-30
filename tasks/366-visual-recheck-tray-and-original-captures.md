# 任务卡 366: 剩余视觉项——tray 图标可见性 + 175/277 原图复核

- Status: 部分完成（2026-10-30）：**B/C 已复核签收**（四态颜色/标签可分、产物入口是按钮且点击路径已走、277 最终态焦点轮廓与 JSON 矩形对得上；B2 那条判据在旧图上失效，由卡 364/365 覆盖）。**A（tray 图标）改派 Codex 应用**（已装 Computer Use + 浏览器插件），派单 `tasks/prompts/codex-handoff-2026-10-30-tray-a.md`；早前 `windows-inventory.json` 的 `taskbarExposed: false` 是未装插件时的结论。
- PDW task: none
- 来源：2026-10-29 收口时把 tray 图标与 175/277 原图复核都降级成「可选、不做也不影响结论」。现在改为由执行方的视觉能力一次性判掉：**A 是真的没验过（图标在 Windows 溢出面板里），B/C 是把已有原图交给第二双眼睛复核**。

## 1. 现状

1. **tray 图标**。功能已验（真 daemon 下子进程存活、假 pid 时自杀），`vessel daemon start` 也已在卡 359 修好并真机跑通五步。但 Windows 11 会把新出现的通知区图标默认放进溢出面板（点任务栏 `^` 才展开），我们现有的整桌面截图（`evidence/sessions/2026-10-29-deep-sweep/resume/tray.png`、`toast-after-completion.png`）只证明了「通知区可见范围内没有图标」，**没有证明溢出面板里有没有**。
2. **卡 175 的三项残余**。2026-10-28 final sweep 时它们因离线 mock 不可达而挂在 UNVERIFIED；2026-10-29 的 `evidence/sessions/2026-10-29-remaining/t3-*.jpg` 补了图，结论已由协调者按证据签字。现在要的是**逐图复核**：图里到底能不能看出四态颜色、能看出截断、能看出产物入口。
3. **卡 277 的键盘/焦点子集**。已签收，证据是 `evidence/sessions/2026-10-28-final-sweep/t1-1440x900.png` 与 `t1-keyboard.json`（六步、七处焦点框）。同样交给第二双眼睛看图。

## 2. Goal

三件都用**看**来判，不改产品代码：

1. **A**：真的把 Windows 通知区的溢出面板打开看一眼，给出「图标存在 / 不存在 / 无法验证」三态之一，并附能证明它的像素来源。
2. **B**：逐张复核卡 175 的四态、截断、产物入口截图，给出每一张「能看到什么、看不到什么」，与卡内既有结论对照是否一致。
3. **C**：复核卡 277 的整屏截图，确认七处焦点框（删除按钮 ×1、取消、确认、删除按钮回位、`#taskInput`）在 1440×900 下肉眼可辨，并与 `t1-keyboard.json` 的坐标对得上。

**明确不许做的事**：不要拿旧图去判新实现。`t3-*.jpg` 拍于卡 364/365 之前，那时的抽屉没有「展开全文」；**不要因为旧图里没有这个按钮就报缺陷**（该按钮由卡 364/365 的验收与 `evidence/sessions/2026-10-30-*` 覆盖）。

## 3. Acceptance

- **A1** 给出 tray 结论三态之一 + 截图文件；若为「无法验证」，必须写清试过哪几个动作（起 daemon、触发通知、点 `^`、抓屏方式与命令），以及卡在哪一步（例如桌面抓屏被拦、无法点击任务栏）。**不接受用浏览器截图冒充桌面截图**。
- **A2** 若图标可见：说明它在溢出面板内还是常驻通知区，并说明点击它发生什么（能点开/无反应）；若不可见：说明 daemon 确实在跑（贴 pid/health）而图标仍不出现，且至少换一次通知再试。
- **B1** 四态图（pending / running / completed / failed）各一句判定：颜色是否可按卡 175 的判据区分，是否有遮挡或裁切。
- **B2** 截断图（`t3-summary-300.jpg`）：判定是否看得出「显示长度到 300 就被截住」，并明确标注该图的拍摄时点早于卡 364/365（见 §2 的禁止项）。
- **B3** 产物图（`t3-artifact.jpg`）：判定产物入口（文件名按钮/链接）是否可见可辨。
- **C1** 277 整屏图：七处焦点框是否可见，坐标是否与 `t1-keyboard.json` 一致（逐条列出，不写「都正常」）。
- **C2** 每项结论只写「一致 / 不一致 / 看不清（附原因）」；「看不清」比推测更受欢迎。
- **D** 全程不改产品代码、不加测试、不动 `packages/**` 与 `apps/**`；发现真缺陷只登记（卡内追加 + 证据），不在本卡修。

## 4. Blast Radius

只读产品；只写 `evidence/sessions/2026-10-30-visual-recheck/` 与本卡末尾追加。允许为 A 起一个隔离 daemon（`VESSEL_*` 根落 `%TEMP%`）并抓桌面截图；不允许改任何源码、测试、样式、配置。

## 5. Result

待执行。

## 6. 第一次派发的执行记录与判据修正（2026-10-30）

**发生了什么**：rollout `01a18b99` 共 136 行、1 次工具调用（`cua.getState()`），在 07:02:33Z（本地 00:02）以「Task 366 was interrupted before completion」结束。卡未追加、报告未写、`evidence/sessions/2026-10-30-visual-recheck/` 只有两个文件：一份把全仓每个文件都做了 sha256 的 `baseline.json`（679 KB，对判据没有增量，已进回收站）与 `windows-inventory.json`。

**留下的真证据**：`windows-inventory.json` 是 Computer Use 的 `list_apps/list_windows` 输出——只有微信、ChatGPT、Bitz Net、CC Switch、Notepad 五个应用窗口，`taskbarExposed: false`，理由写着「没有返回任务栏/Explorer 桌面窗口，无法安全绑定 `^` 目标或用猜的句柄」。这条把 A 定性了：**执行方的视觉拿不到任务栏**，不是它偷懒。

**协调者侧同样够不到**：我试了宿主 PowerShell 的 UIA 路线（`Add-Type -AssemblyName UIAutomationClient`），被本机安全门禁直接拦（`POLICY: PERMANENT_DELETE_POWERSHELL` / fail-closed，不让运行时编译脚本块）；`ffmpeg -f gdigrab` 只能抓屏、不能点击。**所以「点 `^` 看一眼」这件事只有坐在机器前的人能做**，或者要开 LCU（会弹「允许」框，也只有人能答）。

**按实际能力收窄后的判据**（A/B2/C1 三条改动，其余不变）：

- **A（2026-10-30 二次改判：交给 Codex 应用执行，不再丢给维护者）**：Codex 应用现已装 **Computer Use + 浏览器** 两个插件，任务栏在它的能力范围内，所以这一项重新变成可派活（派单 `tasks/prompts/codex-handoff-2026-10-30-tray-a.md`）；`windows-inventory.json` 里 `taskbarExposed: false` 是**没装插件时**的结论，只作历史对照，不是能力上限。步骤：`node apps/cli/dist/cli.js daemon start --port 5715` → `daemon status --json` 确认 pid/instanceId → Computer Use 绑任务栏、点 `^` 开溢出面板 → 按下面四项取证 → `daemon stop`：
  1. 溢出面板里有没有 Vessel 图标（默认应用图标、提示 `Vessel daemon`）？
  2. 在溢出面板内，还是常驻通知区？
  3. 右键是否出现 `Open Vessel` / `Stop Vessel daemon`？
  4. 一张整桌面截图（落 `%TEMP%`）与时间戳。
- **B2**：原判据「看得出显示到 300 就被截住」无法由一张图证明（图里没有字符计数）。改为 **「截断是否可见」**：看出文字在某处中断且带省略号即算通过；「恰好 300」不再由本项主张（该数字由卡 361 的字符串断言与卡 364 的长度实测覆盖）。
- **C1**：原判据要「七处焦点框」逐一可见，但 `t1-1440x900.png` 只拍了**最终态**（焦点在 `#taskInput`），中间六步没有画面。改为 **「最终态可见 + 与 `t1-keyboard.json` 的最终坐标一致」**；六步过程只认 JSON，不再声称由图可证。

**下次派发**：只做 B/C，收尾单 `tasks/prompts/codex-handoff-2026-10-29-visual-recheck.md` 已改成 2026-10-30 修订版（A 移出本单）。判据按上面收窄后的口径；**被中断时先把已经看出来的结论落盘**，不要等全部做完再写。



## 2026-10-30 · B/C 原图复核

逐图报告：evidence/sessions/2026-10-30-visual-recheck/report.md。四态颜色和标签可区分，旧摘要图未见省略号，产物文件名呈按钮形；最终截图的输入卡片蓝框与 JSON 输入框位置一致，焦点身份及中间步骤仅由 JSON 记录支持。旧图缺省略号与卡 361 的历史记录一致，不据旧图判新按钮。未改代码、未跑测试；A 不在本次范围。

## 协调者验收（2026-10-30，B/C）

逐张自己看过原图，不采信它的自述：

- **B1 四态：通过**。pending 灰蓝边 + 「待处理」，running 亮蓝边 + 「运行中」，completed 青绿边 + 「已完成」，failed 红边 + 「失败」；四者边框色与标签一眼可分，节点无遮挡。它说的「连接线在画布边界截断」「completed 的抽屉下部超出截图底缘」我也看到了，属截图边界，不是缺陷。
- **B2 旧摘要图：判据失效，不算它的失败，是我的第三次同类错误**。`t3-summary-300.jpg` 里文字结束处确实没有 `…`，紧接着就是 `artifact.txt` / `查看差异` 两个按钮——但这张图拍在卡 364/365 **之前**，那时本来就没有省略号与展开控件，所以「截断是否可见」在这张图上必然为假、零信息量。它的表述是对的（不据此判新按钮、不判字符数）。**现状由卡 364/365 的验收覆盖**：`evidence/sessions/2026-10-30-closeout/t2-drawer-570.png` 与 `2026-10-30-drawer-polish/570-before.jpg` 里都是「300 + `…` + 展开全文」。教训记在这里：**别拿修复前的图去判修复后的行为**——这条线上我已经错了三次（前两次是「Shift+Tab 到取消」与「用一张图证明恰好 300 字」）。
- **B3 产物入口：通过，且比它自述的更强**。`artifact.txt` 与 `查看差异` 都是带边框的按钮形控件，而且图里面板**已经被打开**、显示「artifact.txt · Current workspace against Git HEAD / Git comparison unavailable for this workspace.」——这不只是「长得像按钮」，点击路径当场走过。它写「静态图不能证明实际点击或下载」偏保守：下载确实证不了，点击已证。
- **C（277 最终态）：通过，保留项正确**。`t1-1440x900.png` 里输入区外层有一圈蓝色焦点轮廓；`t1-keyboard.json` 的 `#taskInput` 矩形 (300.93,320.44,1098.23,150) 落在轮廓**内部**（轮廓罩住整个输入卡片，比 textarea 本身大），所以「位置一致」应读作「在框内」而非「等于框」。它主动声明「单凭像素不能证明 textarea 本身是 activeElement」——这个保留是对的，别改。六步过程只认 JSON、原始 FAIL 未被改写，符合 §6 的口径。
- **A 仍缺，但已改派**：这一轮的派单把 A 移出了，它没碰任务栏是对的。现在 Codex 应用装上了 Computer Use + 浏览器插件，A 重新变成可派活（`tasks/prompts/codex-handoff-2026-10-30-tray-a.md`），不再需要人工点 `^`。

两处小修（都在它自己那段里，其余一字未动）：路径写成了 `vidence/sessions/…` 且前面混进了一个 ESC 控制字符，已改回 `evidence/` 并清掉控制符。全量门禁与测试都没跑——本轮零源码改动（`git status` 只有卡与证据目录），不需要跑。
