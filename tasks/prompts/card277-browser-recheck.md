# 卡 277 浏览器复验（粘贴即用，一次跑完约 5 分钟）

> 工作目录 `E:\Code_file\Projects\Vessel_Harness`。你是**复验者**，只判定不修代码。
> 唯一权威：`tasks/277-ui-p2-fixes.md` 的「Browser recheck」一节。判据已修正，按本文件为准。

## 0. 硬约束

- 只用系统临时目录里的**一次性夹具**；不删、不改任何已有会话。
- 不 commit / 不 push / 不改产品代码；发现缺陷只记录（最小复现 + 期望 vs 实际）。
- 唯一可写：`evidence/sessions/2026-10-23-card277-recheck.md` 与同目录截图。
- 没有截图或 DOM 实测值的项目，判「无法验证」，不要用推断代替。

## 1. 起环境

```powershell
netstat -ano | findstr :5678        # 占用就换 5679，记下实际端口
$ws = Join-Path $env:TEMP ("vessel-277-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $ws | Out-Null
npm run -w @vessel/web build
npx tsx apps/cli/src/cli.ts serve --port 5678 --workspace $ws
```

浏览器打开 `http://127.0.0.1:5678/`，Provider Hub 加 **Mock（本地测试）** 预设（id `mock`，无需 key），
新建两个会话并各发一句话，让侧边栏出现**两个可删除分组**（复验焦点还原要靠第二个）。

浏览器窗口调到**正好 360×900**，语言切英文，主题先用浅色，**关闭 Inspector**。

## 2. 复验 1：KEY HINTS 与 Goals 不重叠（C-F1）

滚动到会话底部，让 footer 完整可见。在控制台执行：

```js
const hints = document.querySelector('.meter-keys').parentElement.getBoundingClientRect();
const goals = document.querySelector('.module-card-goal').getBoundingClientRect();
({ innerWidth, innerHeight, hints, goals,
   overlap: !(hints.bottom <= goals.top || hints.top >= goals.bottom),
   overlapPx: Math.max(0, Math.min(hints.bottom, goals.bottom) - Math.max(hints.top, goals.top)) })
```

判据是**不相交**（`overlap === false`，允许 1px 误差）。顺序不设限：hints 在 Goals 上方或下方都算通过。

再补两条事实：

```js
// 提示文字是否被截断（末项应完整可见）
[...document.querySelectorAll('.meter-keys kbd')].map(el => el.textContent)
// 是否出了横向滚动
({ docScrollW: document.documentElement.scrollWidth, innerWidth })
```

截图 `277-F1-360-en.png`（整窗，含 footer 与 Goals）。

## 3. 复验 2：删除确认的键盘行为（B-F1）

只用键盘：

1. Tab 到**第二个**会话分组的删除按钮 → Enter。
2. 记录此刻 `document.activeElement` 的文本（期望是 Cancel 按钮）。
3. 按 Esc → 确认条消失，`document.activeElement` 是**刚才那个**分组的删除按钮（不是第一个）。
4. 再 Tab / Shift+Tab 两次 → 焦点正常移动（没有被困住、没有跳到页首）。
5. 重新打开确认条，把焦点移到 Confirm 上再按 Esc → 同样关闭并还原焦点。
6. 鼠标路径各试一次：Cancel 关闭、Confirm 删除一个一次性会话。
7. 再单独确认 Inspector、命令面板、模型选择器各自已有的 Esc 行为没被影响。

记录每步的 `document.activeElement.outerHTML.slice(0,120)` 与截图 `277-B1-focus.png`。

## 4. 报告

写 `evidence/sessions/2026-10-23-card277-recheck.md`：

```
环境：端口 xxxx，夹具 <路径>，HEAD <git rev-parse --short HEAD>，视口 360x900，英文，浅色，Inspector 关闭

| 项 | 结论 | 实测 | 证据 |
|---|---|---|---|
| C-F1 不重叠 | 通过/不通过 | overlap=false, overlapPx=0 | 277-F1-360-en.png |
| B-F1 键盘 | 通过/不通过 | Esc 后焦点在同一个删除按钮 | 277-B1-focus.png |
```

「实测」列必须贴上面脚本的真实输出，不许写「看起来正常」。

## 5. 收尾

停服务并确认端口释放。明确写出哪些是浏览器实测、哪些无法验证。
