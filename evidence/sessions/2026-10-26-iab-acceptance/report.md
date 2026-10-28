# 260 / 275 浏览器运行时验收（部分执行）

日期：2026-10-26（本地）。结论：**未完成，不可签收**。仅操作新建夹具会话，未打开既有用户会话。内置 Mock 一轮，真实供应商调用 0。服务 5678；夹具 `C:\work\AppData\Local\Temp\vessel-iab-63bcd748`。初始页面默认选择了旧工作区和真实模型，发送前已切换到夹具及 Mock。

构建：`npx tsc -b tsconfig.json` exit 0。PowerShell 直接运行给定 web 构建命令时 npm 报 EUNKNOWNCONFIG；`cmd /c "npm run -w @vessel/web build -- --emptyOutDir false"` exit 0。未修改产品代码或测试，未提交或推送。

## A. 视觉矩阵：无法验证

只采集首页工作台、浅色、英文五个宽度，未完成 conversation / activity / Provider Hub、双主题双语言全矩阵及文字截断和控件重叠判定；截图共 6 张，不满足至少 12 张。以下是 `document.documentElement.scrollWidth / window.innerWidth`：

| 宽度 | 实测 | 截图 |
|---|---|---|
| 360 | 360 / 360 | `02-workbench-360-light-en.png` |
| 768 | 768 / 768 | `03-workbench-768-light-en.png` |
| 1024 | 1024 / 1024 | `04-workbench-1024-light-en.png` |
| 1440 | 1440 / 1440 | `05-workbench-1440-light-en.png` |
| 1920 | 1920 / 1920 | `06-workbench-1920-light-en.png` |

另有会话截图 `01-conversation-918-default-en.png`，其 `scrollWidth / innerWidth = 918 / 918`。宽度覆盖仅是响应式视口测试，不是页面缩放。

缩放：初始 `(innerWidth, devicePixelRatio, visualViewport.scale) = (918, 2.1137499809265137, 1)`；`Ctrl+=` 后仍为 `(918, 2.1137499809265137, 1)`；CDP `Emulation.setDeviceMetricsOverride` 的 `deviceScaleFactor=1.5` 后为 `(918, 1.4999999537566566, 1)`，仅 DPR 改变，已清除覆盖。IAB 未找到可操作的浏览器菜单缩放控件，菜单手段未执行，无操作后实测值。150% / 200% 真页面缩放无法验证。

## B. 键盘与无障碍：无法验证

未完成只用键盘的全流程、焦点遮挡检查及十个名称抽查。局部观察：Inspector 打开后按 Esc，AX 焦点回到 `button[aria-label="Open Inspector"]`（AX 名称 Open Inspector）；完整焦点可见性未判断。

## C. UI-03：无法验证

初次加载 AX 的 focused element 为 `textarea#taskInput`（What should Vessel work on?）。跨工作区草稿隔离未执行，不能判整项通过。

## D. UI-07：无法验证

会话页面 AX 显示 `New session permission (current session unchanged): Workspace write`（见 `01-conversation-918-default-en.png`）；未定位完整生效 Policy、来源及修改入口，不能由该文字推断只读汇总存在或不存在。

## E. UI-09：无法验证

AX 中 Stop 为 disabled，观察发生在 Mock 请求完成后，不能证明请求中状态。Mock 未产生工具卡、错误或长消息，折叠、错误原因、失败及滚动未验证。截图 `01-conversation-918-default-en.png`。

## F. UI-01 / ARCH-02：无法验证

夹具会话 `Acceptance fixture: hello` 的 Delete 显示确认文本 `Move all 1 sessions in this group to the Recycle Bin?`；确认后列表中该按钮消失，刷新后 AX 的夹具分组仍在但该会话按钮未出现。未核对系统回收站实体，未制造占用导致回收失败，也未验证重试，因此整体未通过验收。

## G. UI-02 / ARCH-01：无法验证

Activity AX 观察到 `heading Failed · 2` 和 `heading Unknown · 9`；这些聚合记录包含既有项目，未打开其会话。未制造四种夹具状态或验证刷新分组，不能判断四态分离。

## H. BV-01：无法验证

刷新后从夹具列表重新打开会话，AX 的 message card 分别显示 `YOU: Acceptance fixture: hello` 和 `VESSEL: (mock) mock`；`01-conversation-918-default-en.png` 为刷新前证据。工具卡与终止提示未生成，因此整体未验证。

## I. E2E：无法验证

已新建、Mock 发送、刷新重开、确认删除。Inspector 的 Changes / Patch 显示 `No patch proposals observed in this session.`；没有产生工具调用或 Diff，也未核对回收站实体，完整链路未完成。

## 协调者注（2026-10-26，非执行者原文）

- 05-workbench-1440 与 06-workbench-1920 两张截图在 ≥1180px 时会把左侧项目列表（含本机真实项目名与历史临时夹具路径、当前供应商名）拍进去，按决策点 20 的个人信息边界已移入回收站、不入库；对应宽度数值仍保留在上表，视觉证据待第二轮用隔离 HOME 重拍。
- 补齐口径：本报告只覆盖工作台页与一次 Mock 会话，A–I 九项里六项停在「无法验证」；协调者按「未完成、不可签收」处理，卡 260 / 275 状态不变。
- 本轮顺带确认的两个真实缺陷已立卡：`tasks/341-web-build-command-npm12.md`、`tasks/342-status-bar-cold-load-flash.md`。
## 收尾与限制（执行者原文）

服务 PID 26816 已停止，`Get-NetTCPConnection -LocalPort 5678 -State Listen` 无结果。夹具路径位于系统临时目录，属于本次创建；目录保留，未删除。可在不再需要时按仓库规则送回收站；本报告未证明其内容已完全隔离于其他系统状态。服务实际枚举了已有项目及 Activity 记录，但未操作其会话。上述未完成项需要后续补测；无缺陷结论。
