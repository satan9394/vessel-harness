# Codex 单（2026-10-29）：把「只能人做」的四项尽量做完

上一张单（`codex-handoff-2026-10-28-final-sweep.md`）已经收口。这张只做四件事，全部**可以自动化**——我上一轮把它们判成「只能维护者」是错的，至少三项错得明显。看完再动手。

先纠正三个前提，都是我实测过的：

1. **`scripts/provision-sandbox.ps1` 不需要管理员**。我在 `%TEMP%` 里非提权跑通：`granted=True`、`low label=True`，ACL 里出现 `S-1-5-21-…-183:(OI)(CI)(M)` 与 `Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)`。
2. **但它只能在 Windows PowerShell 5.1 下跑**。用 pwsh 7 会报 `[System.IO.DirectoryInfo] 不包含名为 'GetAccessControl' 的方法`——那是 .NET Framework 的实例方法，.NET Core 移到了静态扩展类。正确调用是 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/provision-sandbox.ps1 -Path <dir>`；修复方案见 S1（`[System.IO.FileSystemAclExtensions]::GetAccessControl/SetAccessControl` 在 pwsh 7 下可用，我已验证类型存在）。
3. **桌面截图不用 `Add-Type` 也能做**。上一轮被安全钩子拦的是 `Add-Type`，不是截屏本身：`ffmpeg -f gdigrab -i desktop -frames:v 1 -y <png>` 可用（本机 ffmpeg 在 `D:\Technology_application\ffmpeg_all\ffmpeg\bin\ffmpeg.exe`），我据此截到 2560×1600 的整桌面。Chrome 与 Edge 都在本机，`HKCU:\Control Panel\NotifyIconSettings` 也存在（84 个子键，含 `powershell.exe`）。

纪律：不改产品源码/测试，唯一例外是 S1 允许改 `scripts/provision-sandbox.ps1`；不 `git add`/`commit`/`push`/建分支；不新建卡；不改卡首行状态；不调用其它 Agent CLI；日志与夹具只写 `%TEMP%`；删除一律进回收站。主线程执行，不派子代理。路由 `gpt-6.1-sol` / `medium`，Fast 关，不用 Ultra。

---

## S1 · 让 `provision-sandbox.ps1` 在 pwsh 7 下也能跑

现状：脚本用 `$di.GetAccessControl()` / `$di.SetAccessControl($acl)`（两处：`-Revoke` 分支与主分支）。pwsh 7 报方法不存在。

要做的：
1. 把这两处换成静态扩展调用：
   `$acl = [System.IO.FileSystemAclExtensions]::GetAccessControl($di)` 与 `[System.IO.FileSystemAclExtensions]::SetAccessControl($di, $acl)`。
2. **不要**把 `icacls /grant *<sid>` 当替代：我实测它对「不在本地账户库里的 SID」返回 1332（和脚本注释里 `/remove:g` 的原因同一个）。`icacls /setintegritylevel` 本身没问题，保留。
3. 在两个 shell 下各跑一遍「配置 → 撤销」，都要 exit 0 且自校验通过（`granted` / `low label` 先 True 后 False）：
   ```
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/provision-sandbox.ps1 -Path <TEMP>\ps5
   powershell.exe ... -Path <TEMP>\ps5 -Revoke
   pwsh -NoProfile -File scripts/provision-sandbox.ps1 -Path <TEMP>\ps7
   pwsh -NoProfile -File scripts/provision-sandbox.ps1 -Path <TEMP>\ps7 -Revoke
   ```
4. 在 `docs/SANDBOX-WINDOWS.md` 的「离线可执行门禁」段后补一句：provision 脚本两个 shell 都支持（若你改了脚本）。只追加，不改已有行。

验收：pwsh 7 与 5.1 各一轮双向 exit 0；撤销后 `icacls` 里既无该 SID 也无 `Low Mandatory Level`。

## S2 · Windows 受限沙箱的**真机执法**证据（卡 180/183 的那条空白）

前置：S1 通过。用法（我已确认接口）：`PlatformSandboxRunner`（`packages/tools/src/execution/sandbox/platformSandbox.ts`）实现了 `NativeSandboxRunner`，方法签名 `execute(command, args, { cwd, allowedWritePaths, cpuTimeoutMs })` → `{ stdout, stderr, exitCode, sandboxed, isolationTier }`。

步骤：
1. `$ws = %TEMP%\vessel-sandbox-proof-<rand>`；`powershell.exe ... provision-sandbox.ps1 -Path $ws`。
2. 写一个 `%TEMP%` 下的 tsx 脚本（不落仓库），通过 `node --import tsx` 跑：
   - `const r = new PlatformSandboxRunner(); await r.isAvailable()` → 记布尔；
   - **允许写**：`execute(process.execPath, ['-e','require("fs").writeFileSync(process.argv[1], "x")', <$ws>\in.txt], { cwd: $ws, allowedWritePaths: [$ws] })` → 期望 `exitCode 0`、`sandboxed true`、`isolationTier 'windows-job-restricted'`，并断言 `in.txt` 真的存在；
   - **越界写**：同样调用，但目标写 `C:\Users\<你>\vessel-escape-<rand>.txt`（既不在 `$ws` 也不在 `%TEMP%`）→ 期望非零退出 / 写入失败，且该文件**不存在**；同时记 `isolationTier` 与 `sandboxed` 的真实值。
   - **未配置的目录**：另建一个**不** provision 的 `%TEMP%` 子目录，把 `allowedWritePaths` 指向它 → 期望结构化 `denied`（ACL/标签校验失败），不是直跑成功。
3. `-Revoke` 撤销，确认 ACL 里 SID 与 Low 标签都没了。

验收：三条各自的 `exitCode` / `sandboxed` / `isolationTier` 与「文件是否存在」都要贴原文；若 helper 编译、token 或 Job Object 那一步失败，**停在那里如实记录卡在哪一步**，不要用 mock 结果冒充真机执法。这条做成之后，卡 180/183 的「Windows ACL/Low Integrity 真机」才算有本次证据。

## S3 · tray / toast 的自动化证据（卡 176）

上一轮两次都停在「看不见图标」。这次换三条可自动化的路子，能拿到几条算几条：

1. **注册表前后对比**：`HKCU:\Control Panel\NotifyIconSettings` 存着通知区图标的登记。`daemon start` 前后各导出一次子键列表与 `ExecutablePath`（含 `powershell.exe` 那几条的 `IsPromoted`/`IconSnapshot` 等值），做 diff。能证明「tray 进程确实登记了图标」——但**不能**证明图标画对了。
2. **整桌面截图**：`ffmpeg -f gdigrab -i desktop -frames:v 1 -y %TEMP%\tray.png`，再裁右下角放大：
   `ffmpeg -i tray.png -vf "crop=340:52:iw-340:ih-52,scale=1020:156:flags=neighbor" -frames:v 1 corner.png`。
   我上一轮这样截过：可见通知区只有电量/日期/通知铃，**没有 Vessel 图标**（tray 用的是 `SystemIcons.Application` 通用图标，默认进溢出面板）。你可以再截一次确认；**不要**去点 `^` 展开面板（那会动维护者的鼠标和焦点），也不要改注册表把它提升成常驻。
3. **toast**：只有真的完成/失败/审批门禁事件才会弹。可以起一个隔离会话、让桩 provider 返回一次 HTTP 503 触发失败通知，然后截图与查注册表/通知中心 API；做不到就记 UNVERIFIED，别用 `notifications.test.ts` 的 mock 冒充。

结论写法：`已登记` / `可见区未见图标` / `toast 未触发` 分开写，不要合成一个「通过」或「不通过」。收尾必须 `daemon stop` 并确认端口监听 0。

## S4 · 150% / 200% 缩放的**布局等价**证据（卡 260/275）

浏览器菜单缩放 IAB 做不了（`Ctrl+=` 不改变 `innerWidth/DPR`，CDP `deviceScaleFactor` 只改 DPR）。但缩放对页面真正的作用是**布局视口变小**，这一点可以精确复现：

- 1440×900 窗口在 150% 下，布局视口是 **960×600**；200% 下是 **720×450**。
- 在可见 IAB 里把 viewport 依次设成 960×600、720×450，各自：
  - 记 `({innerWidth, innerHeight, dpr, docScrollW: document.documentElement.scrollWidth})`，判据 `docScrollW === innerWidth`（无横向溢出）；
  - 抽查两类文本是否截断：侧边栏会话标题、消息区模型名（`scrollWidth > clientWidth` 即为截断），把命中项列出来；
  - 截整屏 `s260-zoom150-960x600.png`、`s260-zoom200-720x450.png`。
- 再补一个物理放大对照（可选，如果时间够）：`chrome.exe --headless=new --disable-gpu --force-device-scale-factor=1.5 --window-size=960,600 --screenshot=%TEMP%\zoom150-dsf.png http://127.0.0.1:5678/`，同样记图上文字是否可读。

报告里必须写死这句边界：**这是布局等价，不是浏览器菜单缩放**；菜单缩放与 150%/200% 下的真实字形渲染仍属真机。**原生中文输入法不做**——需要 OS 层输入法，任何脚本都替代不了，这一条留给维护者。

## S5 · 不在本单范围（不要做）

- 原生中文输入法（IME）验证：见 S4 末句。
- 175/277 的用户视觉签字：那是维护者的判断，不是证据。
- `--live` 跨 harness、154 `release-report`、155 字面 3h soak：仍按原决定不做。

---

## 交付

- 证据目录：`evidence/sessions/2026-10-29-deep-sweep/`（`report.md` + 截图 + JSON + 收尾记录）。
- 末尾追加（只许追加）：`tasks/180-os-native-sandboxing-and-restricted-tokens.md`、`tasks/183-epic-hardened-runtime-and-cognitive-memory.md`、`tasks/176-headless-daemon-and-tray-resilience.md`、`tasks/260-browser-runtime-acceptance.md`、`tasks/275-ui-final-acceptance.md`。
- 报告骨架：① 每项 `通过 / 不通过（附现象）/ 无法验证（附原因）`，不要写整卡「已验收」；② 每条实测值 + 文件名；③ 端口/进程收尾（监听 0、无残留 daemon、ACL 已撤销）；④ 被拒/失败命令原文；⑤ 改动文件清单（应只有 `scripts/provision-sandbox.ps1`、`docs/SANDBOX-WINDOWS.md` 的一行、新证据目录、上述卡的追加）。

**停止条件**：任一项连续两次失败即停，写清实测值与被卡的那一步；沙箱 helper 起不来也一样。不要为了凑「通过」放宽判据或换 mock。
