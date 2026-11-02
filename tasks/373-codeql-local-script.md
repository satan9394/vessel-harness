# 任务卡 373: 把 CodeQL 本地复现固化成脚本

- Status: 已验收（2026-11-01；脚本三条查询均实跑通过）
- PDW task: none
- 来源：卡 371/372 期间临时搭的那套本地复现（下载 bundle、建库、跑查询、写诊断查询）全在 `%TEMP%`，
  一次会话之后就只剩文字记录。下次来新告警要重新摸索一遍，而且「用错版本的 CodeQL 得出结论」正是卡 371
  翻车的成因之一。把流程固化成仓库内的脚本 + 文档，让下次先读 flow 再动手。

## 1. 决定

- 新增 `scripts/codeql-local.ps1`：按 `-Query shell|redos|all` 在 `git archive` 快照（可选叠加工作树改动）上
  建库并跑**本仓关心的三条查询**，结果出 CSV + 控制台摘要；产物只落 `%TEMP%`，不写仓库（写仓库会撞 PDW 的
  source drift）。
- 新增 `docs/CODEQL-LOCAL.md`：版本对齐方法（从告警 SARIF 读 `tool.driver.semanticVersion` 与
  `javascript-queries` 版本）、获取 bundle 的命令、列含义、`database analyze` 在 8.3 短名路径下崩的绕法、
  「本地行数多于 PR 页条数」的原因、以及 2026-10-31 的基线结果。
- **不做**：不把 700 MB 的 bundle 塞进仓库；不改 CI；不在脚本里删除任何东西（临时库留给人清）。

## 2. Goal

下次出现 CodeQL 告警时，一条命令拿到「同一版本 + 同一查询」的本地结果与 taint 路径，不必重新摸索工具链。

## 3. Acceptance

- A1 `pwsh -NoProfile -File scripts/codeql-local.ps1 -Query shell` 在本机能跑通，输出查询版本、结果行数与 CSV 路径。
- A2 `-Query redos` 与 `-Query all` 的查询路径映射正确（`Performance/PolynomialReDoS.ql`，不是想当然的 `CWE-1333`）。
- A3 CLI 缺失时打印下载命令并 exit 2；某个查询跑失败时 verdict 明说失败条数并 exit 1（不谎报「无结果」）。
- A4 脚本不向仓库写任何文件；`-WorkingTree` 能叠加未提交改动。
- A5 文档写清版本对齐与已知差异，且基线数字与 2026-10-31 的实测一致。

## 4. Blast Radius

`scripts/codeql-local.ps1`（新）、`docs/CODEQL-LOCAL.md`（新）、`HANDOFF.md`（验收辅助一行）、
`tasks/README.md`（路线表一行）。**禁止**改 `scripts/gate-batched.ps1`、CI 配置、`package.json`。

## 5. Result

**已完成（2026-11-01）。** `scripts/codeql-local.ps1` + `docs/CODEQL-LOCAL.md`。实跑（Node 26 环境外的独立进程，
命令行与文档一致）：

- `-Query shell`：建库 260s；`UnsafeShellCommandConstruction` 3 行、`ShellCommandInjectionFromEnvironment` 26 行，
  CSV 落 `%TEMP%\vessel-codeql-<id>\`，与 2026-10-31 的基线一致（都是未改动文件 / 有意边界的既有结果）。
- `-Query redos`：建库 210s；`PolynomialReDoS` **0 行**（卡 371 修复的确认），冷跑 326s。
- 查询映射纠正过一次：ReDoS 在 pack 里是 `Performance/PolynomialReDoS.ql`，不是想当然的 `Security/CWE-1333/`；
  第一次跑因此 exit=2，脚本已改成「查询失败时 verdict 明说失败条数并 exit 1」，不再谎报「无结果」。
- 产物只写 `%TEMP%`；`git status` 在跑完后仍干净（A4）。
- A3 前半（CLI 缺失）实测：把 bundle 临时改名后运行，脚本打印下载命令并 **exit 2**（随后已改回，bundle 完好）。
  A3 后半（查询失败 → verdict 明说并 exit 1）只做了代码核对：改 mapping 前那次运行确实以 exit=2 结束，但当时
  verdict 文案还是旧的「no results」，未再制造一次失败去验证新文案。
- 坑都写进文档：`database analyze` 在 8.3 短名路径下崩（改用 `query run` + `bqrs decode`）、本地行数多于 PR 页条数、
  快照不含 `node_modules`/`dist`、`-WorkingTree` 不处理删除、临时库留给人清。
