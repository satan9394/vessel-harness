# Codex 单：卡 366 的 B/C 原图复核（2026-10-30 修订版）

> 与 2026-10-29 版的差别：**A（tray 图标）已不在本单**。上一次派发已证明执行方的 Computer Use 枚举不到任务栏（`evidence/sessions/2026-10-30-visual-recheck/windows-inventory.json`，`taskbarExposed: false`），那一项改由人在机器前点 `^` 取结论（卡 366 §6 的四问）。本单只做 B、C 两件纯读图的事。

现状：**HEAD 以 `git log -1` 为准**，工作树干净；全量门禁最近一次 17 步 exit 0（根 335 文件 / 3,713 passed + 8 skipped，web 61 / 543）。**不要跑任何测试或门禁**，本单不改一行代码。

先读 `tasks/366-visual-recheck-tray-and-original-captures.md`（尤其 §6）与 `tasks/361-card175-fixture-residuals.md`、`tasks/277-ui-p2-fixes.md` 的相关段。

纪律：主线程执行、禁止子代理；不 commit / 不 push、不新建卡、不改任何卡的首行状态与既有行（只在卡 366 末尾追加）；不调其它 Agent CLI；只读仓库，只写 `evidence/sessions/2026-10-30-visual-recheck/`；不碰产品代码、测试、样式、配置。

**边看边写**：每看完一张图，就把那一行判定写进 `report.md`。上一轮派发跑了三秒就断了，攒到最后的结论全丢了。

---

## B · 卡 175 的原图复核（6 张，全在 `evidence/sessions/2026-10-29-remaining/`）

逐张一句判定，不要合并成「都正常」：

| 图 | 判什么 |
|---|---|
| `t3-pending.jpg` | 待执行态的颜色/标签是否与其余三态可区分；有无遮挡、裁切 |
| `t3-running.jpg` | 运行中态，同上 |
| `t3-completed.jpg` | 完成态，同上 |
| `t3-failed.jpg` | 失败态，同上；与 completed 是否一眼可分 |
| `t3-summary-300.jpg` | **截断是否可见**：文字是否在某处中断并带 `…` |
| `t3-artifact.jpg` | 产物入口（文件名按钮/链接）是否可见、可辨、不像纯文本 |

两条硬约束，别越界：

1. **不要判「恰好 300 字」**。一张图没有字符计数；300 这个数字由卡 361 的字符串断言与卡 364 的长度实测负责。你只判「截断看得出来」。
2. **不要因为图里没有「展开全文 / 收起」按钮就报缺陷**。这些图拍于卡 364/365 之前，那时按钮还不存在；它由 `evidence/sessions/2026-10-30-closeout/` 与 `2026-10-30-drawer-polish/` 覆盖。

## C · 卡 277 的键盘/焦点原图复核（只判最终态）

证据：`evidence/sessions/2026-10-28-final-sweep/t1-1440x900.png`（整屏 1440×900）与 `t1-keyboard.json`。

- **由图可判**：最终态里 `#taskInput` 的焦点框是否可见、位置是否与 JSON 的最终坐标（约 301,320）一致；删除按钮、确认条是否已不存在（无残留）。
- **只认 JSON**：六步过程（删除按钮 217,352 → 取消 57,437 → Esc 回同一坐标 → 再 Enter → Shift+Tab 到 12,437 → Enter 回 301,320）。你可以核 JSON 内部是否自洽（坐标是否回位、步骤与描述是否吻合），但**不要**写成「图中可见七处焦点框」——那张图只拍了最终态，这是上一轮已经指出、并且是对的事实。

口径：每处只写「可见 / 不可见 / 看不清（附原因）/ 仅 JSON 可证」。

---

## 交付

- `evidence/sessions/2026-10-30-visual-recheck/report.md`：B 六行 + C 两段（图可判 / 仅 JSON 可证），每行一句结论 + 依据（哪个像素位置、哪条 JSON 字段）。看不清就说看不清，比推测有用。
- 可选：一张从 `t3-artifact.jpg` 或 `t1-1440x900.png` 裁出来的局部放大图，方便复核；**不要**缩放或二次压缩原图。
- 只追加到 `tasks/366-visual-recheck-tray-and-original-captures.md` 末尾（不碰首行状态、不碰 `tasks/README.md`）。
- 报告末尾注明：改动文件清单（应为空，除证据目录与卡追加）、是否调用过测试（应为否）。

## 停止条件

纯读图，做完为止。若某张图确实看不清（分辨率/JPEG 伪影），写「看不清 + 原因 + 你看到的实际像素特征」，不要为凑结论去猜。任何需要改代码的念头一律视为越界，直接报 blocked。
