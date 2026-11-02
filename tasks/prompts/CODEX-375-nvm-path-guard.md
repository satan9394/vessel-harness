# 给 Codex 的单：nvm 路径迁移的回归守卫（自包含）

> 直接整份交给 Codex 应用（`gpt-6.1-sol` / medium）。不需要读其它文件；下面就是全部上下文与判据。

## 背景（已发生的事实，不要重新调查方向）

2026-10-30 nvm 把安装根从 `D:\Technology_application\NVM_Windows` 搬到了
`C:\Users\Satanchen\AppData\Local\Author Software\nvm`，旧目录已删。写死旧路径的配置会**静默失效**：PDW 五个角色
全部 `ready:false`、`doctor` 退出码 1、派活报 `process failed (1)` 且 `process.stderr.log` 是 0 字节。

迁移已在 2026-11-02 手工完成并提交：`AGENTS.md` 增加了一条规则，`scripts/dispatch-codex.ps1` 与
`scripts/pdw-route.ps1` 里的可执行文件已改成 `…\nvm\.nodejs\{codex,opencode}.exe`，`.pdw/config.json` 五个角色也
已指向 `.nodejs`（`pwsh pdw.ps1 doctor` 实测 exit 0、五角色 ready、codex-cli 0.166.0）。

**问题不在迁移本身，而在没有守卫**：仓库里没有任何东西会阻止下一次有人（或某个脚本）再写死
`installs\vX.Y.Z\…` 或 `NVM_Windows` 绝对路径。这一次是靠人发现 `doctor` 变红才发现的。

## 要你做的事（只做这一件）

在仓库根新增 `scripts/check-tool-paths.mjs`，扫「会真的被执行或被人照抄」的活文件，发现旧路径就报
`file:line` 并非零退出。

判定要命中的模式（大小写不敏感）：

1. `NVM_Windows`（旧 nvm 根）
2. `nvm\installs\v<数字>` 或 `nvm/installs/v<数字>`（换 node 版本即失效的绝对路径）
3. `@openai\codex\node_modules\@openai\codex-win32-x64\vendor\`（旧 codex 二进制布局）

**扫描范围**：`git ls-files` 结果里，扩展名为 `.ps1 .psm1 .mjs .js .cjs .ts .md .json .toml .yml .yaml` 的文件，且
**排除**以下路径（它们是历史记录或生成物，改了等于篡改证据）：

- `evidence/`
- `tasks/`（历史任务卡）
- `docs/diagrams/*.finalize.json`（Archify 生成物的采集元数据）
- `node_modules/`、`dist/`

**必须支持**：

- `node scripts/check-tool-paths.mjs` —— 默认扫描仓库根（用 `git ls-files` 拿清单，不要自己 walk 全盘，太慢），
  打印 `scanned N file(s)`、命中则逐条 `path:line: <matched token>`，有命中 exit 1，无命中 exit 0。
- `node scripts/check-tool-paths.mjs --self-test` —— 在 `%TEMP%` 下建临时目录，造一个含违规行的 fixture，
  断言能报出来（exit 1 且输出含 `path:line`），再造一个干净 fixture 断言 exit 0；跑完用 `fs.rm` 删掉自己建的
  临时目录（只允许删 `os.tmpdir()` 下自己刚建的东西），打印 `self-test ok` 并 exit 0。
- `--root <dir>`：可选，扫描指定目录（给 self-test 与将来复用）。

**不要做**：

- 不要改 `scripts/gate-batched.ps1`、CI 配置（`.github/`）、`package.json`、`package-lock.json`。加门禁步骤会改动
  全局口径（现在是 17/17），不在这张单的范围里。
- 不要动 `evidence/`、`tasks/`、`docs/diagrams/` 里的任何文件，也不要"顺手修好"它们。
- 不要改产品代码（`packages/`、`apps/`），不要跑 `npm install`。
- 不要用 `Get-Content`/`Set-Content` 改文件（本仓有编码事故史）；新文件请直接写 UTF-8、LF、无 BOM，注释用中文，
  风格照 `scripts/gate-batched.ps1` 与 `scripts/check-append-only.mjs`。
- 不要 commit、不要 push、不要动 GitHub 告警。

## 验收（每条都要给出原始命令与退出码）

1. `node scripts/check-tool-paths.mjs` → exit 0，输出里能看到 `scanned` 的文件数（当前树里活文件应当是 0 命中；
   历史目录已排除）。
2. `node scripts/check-tool-paths.mjs --self-test` → exit 0，输出含 `self-test ok`。
3. 在仓库根临时建一个 `zz-tool-path-probe.ps1`，内容写 `$x = 'D:\Technology_application\NVM_Windows\nodejs\node.exe'`，
   跑 `node scripts/check-tool-paths.mjs` → **exit 1** 并指出该文件行号；确认后把该探针文件删掉（进回收站，或用
   `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(<path>,'OnlyErrorDialogs','SendToRecycleBin')`），再跑一次
   恢复 exit 0。**报告里要贴这两次输出**。
4. `pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind general -All -DryRun` → exit 0（证明本次改动没碰坏路由脚本）。
5. 报告里列出 `git status --porcelain` 的最终结果：应当只有 `scripts/check-tool-paths.mjs` 一个新增文件
   （若你按第 3 条建过探针，必须已删除、且不留残留）。

## 交付物

- `scripts/check-tool-paths.mjs`（单文件，Node ≥ 26，只用 `node:` 内置模块，零依赖）。
- 一段报告：每条验收的命令、退出码、关键输出摘录；以及你在实现里做的范围裁剪（例如哪些目录被排除、
  为什么 `tasks/` 不扫）。

如果实现过程中发现某个「活文件」里确实还有旧路径（不在上面列的排除范围内），**不要自己改那个文件**，在报告里
列出来交回协调者决定。
