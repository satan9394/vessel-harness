# 本地复现 CodeQL 告警

`scripts/codeql-local.ps1` 用**与 GitHub Code Scanning 相同版本的 CodeQL** 在本机建库并跑指定查询，用来回答
「这条告警到底被哪条 taint 路径触发、汇点在哪个 spawn」。2026-10-31 的卡 371/372 就是靠它纠正了一个错误方案
（详见 `evidence/sessions/2026-10-31-codeql-seven/codeql-rescan-2026-10-31.md`）。

## 为什么必须对齐版本

查询的判定逻辑会随版本变。`js/shell-command-constructed-from-input` 在 2.4.x 里对 `spawn` 只走
`isIndirectCommandArgument`（看可执行文件是不是 `cmd.exe /c`），与 `shell` 选项无关；换一个版本可能又不同。
拿旧版 CLI 得出的「修好了」不可信。

对齐方法：打开该告警对应的分析结果（PR 的 Code Scanning 页 → 具体告警 → 右下角 "Analysis" 或直接看
`GET /repos/{owner}/{repo}/code-scanning/analyses/{id}` 的 SARIF），读两个字段：

- `runs[0].tool.driver.semanticVersion` —— CodeQL CLI 版本（2026-10-31 实测 `2.27.3`）
- `runs[0].tool.extensions[].semanticVersion` —— `codeql/javascript-queries` 版本（实测 `2.4.8`，随包带 `javascript-all 2.10.4`）

## 准备 CLI（一次性，约 700 MB）

```powershell
curl.exe -L -o "$env:TEMP\codeql-bundle.tar.gz" `
  https://github.com/github/codeql-action/releases/download/codeql-bundle-v2.27.3/codeql-bundle-win64.tar.gz
New-Item -ItemType Directory -Force "$env:TEMP\codeql371" | Out-Null
tar -xzf "$env:TEMP\codeql-bundle.tar.gz" -C "$env:TEMP\codeql371"
```

脚本按顺序查找 CLI：`-CodeQlHome` → `$env:CODEQL_HOME` → PATH 上的 `codeql.cmd` →
`%TEMP%\codeql\codeql` → `%TEMP%\codeql371\codeql` → `C:\tools\codeql\codeql` → `D:\tools\codeql\codeql`。
找不到就打印下载命令并以 exit 2 结束。

## 用法

```powershell
pwsh -NoProfile -File scripts/codeql-local.ps1                      # 三条查询：两个 CWE-078 + ReDoS
pwsh -NoProfile -File scripts/codeql-local.ps1 -Query shell         # 只跑 shell 相关两条
pwsh -NoProfile -File scripts/codeql-local.ps1 -Query redos         # 只跑 js/polynomial-redos
pwsh -NoProfile -File scripts/codeql-local.ps1 -Ref 9f61c457        # 跑某个历史提交（对比修复前后）
pwsh -NoProfile -File scripts/codeql-local.ps1 -WorkingTree         # HEAD 快照 + 未提交改动
pwsh -NoProfile -File scripts/codeql-local.ps1 -FailOnResults       # 有结果就 exit 1（想当闸门用时）
```

产物全部落在 `%TEMP%\vessel-codeql-<id>\`（`db/`、每条查询的 `.bqrs` / `.csv` / `.log`），**不写仓库**——
写进仓库会撞 PDW 运行器的 source drift 判定（见 `AGENTS.md` 的 `pdw-entry` 段）。

耗时参考（本机、仓库全量快照 5.3k 文件、冷缓存）：建库约 3.5–4.5 分钟；`UnsafeShellCommandConstruction` 约 4.5 分钟；
`ShellCommandInjectionFromEnvironment` 约 1.5 分钟；`PolynomialReDoS` 约 5 分钟。`-Query all` 合计 15 分钟左右。

## 怎么读结果

CSV 的列就是该查询的 `select` 列表：

| 查询 | 列 |
|---|---|
| `Security/CWE-078/UnsafeShellCommandConstruction.ql` | 告警位置 / 源 / 汇 / 说明 / 源类型 / 汇类型 |
| `Security/CWE-078/ShellCommandInjectionFromEnvironment.ql` | 高亮位置 / 源 / 汇 / 说明 / 源类型 |
| `Performance/PolynomialReDoS.ql` | 告警位置 / 说明 |

**先读 flow 再动手**：卡 371 的教训是按「`shell` 键」这种字面猜测定方案，重扫才发现判据根本不看它。
要定位真正的判据，可以临时写一条诊断查询（把 `UnsafeShellCommandConstructionCustomizations.qll` 里
`private DataFlow::Node isExecutedAsShellCommand` 的 `private` 去掉即可直接引用），做法见
`evidence/sessions/2026-10-31-codeql-seven/codeql-rescan-2026-10-31.md` 的「How this was verified locally」。

## 已知差异与坑

- **`database analyze` 在本机会崩**：`%TEMP%` 路径含 8.3 短名（`SATANC~1`）时，结果解释阶段报
  `Expected downward-relative query path`。所以脚本改用 `query run` + `bqrs decode`，不依赖那一步。
- **行数 ≠ 告警条数**：GitHub 的 PR 视图只显示「代码流触及本次 diff」的告警，并会按提交去重。本地跑出的
  行数通常更多（2026-10-31 实测：env 规则本地 26 行 vs PR 页 1 条告警）。
- **快照不含 `node_modules` / `dist`**：`git archive` 只取跟踪文件；跨包 import 解析不到不影响这两类查询。
  `-WorkingTree` 只叠加新增/修改的文件，工作树里**删掉**的文件不会从快照里移除（已知简化）。
- **tar 的非 ASCII 文件名告警**：三份历史证据文档会报 `Invalid empty pathname`，非致命，脚本按
  「快照里有没有 `package.json`」判断成功。
- **临时目录会堆积**：每次跑留下一个几百 MB 的库，`%TEMP%\vessel-codeql-*` 由人自行清理（项目纪律：不在脚本里删东西）。

## 2026-10-31 的基线（`34bfda83` 的 HEAD 快照）

| 查询 | 结果 | 定性 |
|---|---|---|
| `UnsafeShellCommandConstruction` | 3 行，全在 `McpClient.ts` / 一个打包出来的 `cli.js` | 未改动的既有代码；GitHub 侧不显示（不在 diff 内） |
| `ShellCommandInjectionFromEnvironment` | 26 行，高亮 `runDirectedCommand` / `runShellCommand` 的 spawn | shell 工具自身的 workspace cwd，按有意边界 dismiss |
| `PolynomialReDoS` | 0 行 | 卡 371 修完 |
