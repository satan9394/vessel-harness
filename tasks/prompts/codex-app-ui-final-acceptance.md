# Codex 应用任务：Vessel UI 最终验收（粘贴即用）

> 工作目录 `E:\Code_file\Projects\Vessel_Harness`。这是新对话，上下文自带，不需要读旧会话。
> 唯一权威范围：`tasks/275-ui-final-acceptance.md`。

你是**验收者**。目标是判定真实浏览器里的 UI 是否达标，不是改代码。

## 0. 硬约束

- 只在系统临时目录的夹具里新建会话；**不删、不改任何已有会话**。
- 不接触真实供应商密钥；真实模型调用最多 3 次，只用于「模型产出后 UI 是否正确显示」。
- 不 commit / 不 push / 不改产品代码。发现缺陷只记录，给最小复现步骤与期望 vs 实际。
- 唯一可写：`evidence/sessions/2026-10-23-ui-final-report.md` 与同目录截图。
- IAB 不可用就立刻停并如实报告，不要用 curl 冒充浏览器验收。

## 1. 起环境

```powershell
netstat -ano | findstr :5678          # 被占用就换 5679，记下实际端口
$ws = Join-Path $env:TEMP ("vessel-ui-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $ws | Out-Null
npm run -w @vessel/web build
npx tsx apps/cli/src/cli.ts serve --port 5678 --workspace $ws
```

`curl.exe -I http://127.0.0.1:5678/` 必须 200 且 text/html，然后浏览器打开。

模型：Provider Hub 里加 **Mock（本地测试）** 预设即可（id `mock`、协议 `mock`、模型 `mock`、无需 key）。
只有第 4 条 E2E 需要真实模型时，才用 `commandgota-real`（凭据从项目根 `.env.local` 读，`. .\scripts\use-env.ps1`，任何输出不得含明文）。

## 2. 逐条执行

### A. 缩放（UI-10 的核心遗留）
分别尝试：浏览器缩放菜单、`Ctrl+plus`、CDP `Emulation.setDeviceMetricsOverride` 的 `deviceScaleFactor=1.5/2`。
每试一种都记录 `window.innerWidth`、`devicePixelRatio`、`visualViewport.scale` 的**实测值**。
三种都无效就写「无法验证」并列出三种手段的实际返回值——**不许用 960px 视口或截图放大冒充 150%**。

### B. 键盘与无障碍
只用键盘走：导航 → 新建会话 → 输入并发送 → 打开 Inspector → 删除确认 → Esc 返回。
记录：焦点环是否可见、是否被浮层遮挡、Esc 是否能退出、Tab 是否会被困死。
再抽查 10 个关键控件（主按钮、图标按钮、输入框、开关）是否有可读名称。

### C. 视觉矩阵抽查
沿用 120 格口径（宽度 360/768/1024/1440/1920 × 浅/深 × 中/英），**抽查 12 格**重截并按编号命名。
每格记录：横向溢出、文字截断、控件重叠。

### D. 一次完整会话（真实模型，≤3 次调用）
新建 → 发一句让它执行 `echo ui-e2e`（会走 Shell）→ 看工具活动与 Diff 视图 → F5 刷新看历史是否还在 →
删除该会话并确认进入回收站。

### E. 四条回归（当前代码上重验）
1. 删除：成功时列表立刻移除、刷新不回来；失败时显示具体原因且会话仍在。
2. 输入：Shift+Enter 换行、粘贴多行原样保留、Enter 发送一次。
3. 终止提示：`finishReason=length` 后提示出现，刷新后**仍然**显示。
4. Activity：Stop 之后该会话显示为取消/中断，不是「失败」，也不是「已完成」。

## 3. 报告

写 `evidence/sessions/2026-10-23-ui-final-report.md`：

```
# Vessel UI 最终验收 — 2026-10-23
环境：端口 xxxx，夹具 <路径>，HEAD <git rev-parse --short HEAD>

| 项 | 结论 | 现象 | 证据 |
|---|---|---|---|
| A 缩放 | 通过 / 无法验证 | dpr=1 scale=1（三种手段均无效） | A1-zoom.png |

## 逐条细节
### E1 删除
- 期望：…
- 实际：…
- 截图：E1-before.png / E1-after-refresh.png
- 结论：通过 / 不通过（最小复现 → 期望 vs 实际）
```

截图命名 `A1-zoom.png`、`B1-focus.png`、`C-1440-dark-zh.png`、`D-e2e-01.png`…。

## 4. 收尾

停服务、确认端口释放；报告里写明哪些结论是浏览器实测、哪些仍无法验证。
**没有截图或 DOM 观测的，不算结论。** 发现缺陷只记录，不修。
