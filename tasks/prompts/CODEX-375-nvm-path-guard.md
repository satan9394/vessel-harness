# 给 Codex 的单：先审查两处代做的改动，再做 nvm 路径守卫（自包含）

> 直接整份粘贴给 Codex 应用（`gpt-6.1-sol` / medium）。不需要读其它文件；全部上下文与判据都在下面。
> 顺序：**第一步审查**（可能触发回退）→ **第二步实现守卫** → 按「验收」交报告。

## 0. 仓库与前提

- 仓库：`E:\Code_file\Projects\Vessel_Harness`，分支 `main`，工作树干净。
- 运行时：Node 26、npm 12、Windows + PowerShell 7。
- 本仓只在 PR/本地提交层面工作；你**不要 commit（除第一步明确要求的 revert）、不要 push、不要动 GitHub 告警**。
- 删除一律进回收站（`[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(<path>,'OnlyErrorDialogs','SendToRecycleBin')`）；
  只有「你自己在 `%TEMP%` 下刚建的临时目录」可以用 Node `fs.rm` 清理。
- 不要用 `Get-Content` / `Set-Content` 改源码（本仓有编码事故史）：改文件用编辑工具或 Node 读写。

## 1. 第一步：审查协调者代做的两处改动（结论只有 KEEP 或 REVERT）

背景：下面两件事原本按分工该走你，但协调者为了「验证用户手工改动」和「修自己推送触发的 CI 红」先做了并合入
`main`。现在要你独立审查一遍，判定是否保留。

### 1.1 提交 `7d92786a`：把 nvm 路径改成 `.nodejs` 指针

```powershell
git show 7d92786a --stat
git show 7d92786a
```

改动内容：`AGENTS.md` 新增一条规则（nvm 安装根在 2026-10-30 从 `D:\Technology_application\NVM_Windows` 搬到
`C:\Users\Satanchen\AppData\Local\Author Software\nvm`，旧目录已删）；`scripts/dispatch-codex.ps1` 的 `$codex` 与
`scripts/pdw-route.ps1` 的 `$opencodeExe` / `$codexExe` 改成
`C:\Users\Satanchen\AppData\Local\Author Software\nvm\.nodejs\{codex,opencode}.exe`。

审查要点（逐条给证据）：

1. 三个被改的文件是否只有这几处变化（`git show` 的 diff 应只含路径与规则文字，没有夹带别的改动）。
2. 新路径是否真的存在且可执行：`Test-Path` 三项；`pwsh -NoProfile -File pdw.ps1 doctor` 是否 exit 0 且五角色
   `ready: true`。
3. 旧的 `D:\Technology_application\NVM_Windows` 是否确实已不存在（`Test-Path` 应为 False）——若它其实还在，
   这次「修复」就是基于错误前提，要 REVERT。
4. `.nodejs` 是否是 nvm 的当前版本指针（换 node 版本自动跟随），而不是某个 `installs\vX.Y.Z` 死路径。
5. `scripts/pdw-route.ps1 -Kind general -All -DryRun` 是否 exit 0（证明没改坏路由脚本）。

### 1.2 提交 `d88883d3`：`authMiddleware.test.ts` 的轮询窗口 1s → 15s

```powershell
git show d88883d3
```

背景：`main` 的 `30972220`（纯文档 + 脚本提交）在 `build (windows-latest, 22)` 红了一次，唯一失败用例是
`apps/local-server/src/daemon/authMiddleware.test.ts > notifies for a staged approval gate and completed offline team
without an SSE subscriber`（`expected "vi.fn()" to be called with arguments: ['Vessel team completed', …]`），同 run
另外 333 个文件通过；本地复跑 8/8 绿。协调者判断是 `vi.waitFor` 默认 1000ms 太短（这条通知要跨 HTTP →
团队阶段执行 → 通知派发三跳），只把这一条的 `vi.waitFor` 显式写成 `{ timeout: 15_000 }`。

审查要点（逐条给证据）：

1. `git show d88883d3` 的 diff 是否只有那一个超时参数，断言、用例结构、被测代码是否零改动。
2. 这条用例是否**真的**是时间问题而非竞态/顺序问题——读 `authMiddleware.test.ts` 与该通知的产出路径：
   如果「团队完成」通知本身可能因为事件顺序而**永远不发出**（而不是发得慢），那么放宽超时只是把红推迟，
   必须判 REVERT 并改为查顺序。
3. 是否存在更合适的修法（例如等待某个可观测状态而不是轮询 mock），如果有，说明理由并给建议，但**不要**在
   本步实现它——只报告。
4. 15s 是否过头（`vi.waitFor` 的 interval 是 50ms，失败时不会拖满 15s 才报；只有当条件始终不满足才会等满）。

### 1.3 判定与动作

- 两处各自给 `KEEP` 或 `REVERT`，附一句话理由 + 证据（命令与输出）。
- 结论是 `REVERT` 时，执行 `git revert --no-edit <sha>`（只允许这一个 commit 动作，**不要 push**），然后跑一次
  `pwsh -NoProfile -File pdw.ps1 doctor`（针对 1.1）或
  `npx vitest run apps/local-server/src/daemon/authMiddleware.test.ts`（针对 1.2）确认回退后仍自洽。
- 两处都 `KEEP` → 直接进入第二步。
- **判 REVERT 但无法安全回退**（例如回退会让 main 红）：不要硬来，写清原因交回协调者。

## 2. 第二步：nvm 路径迁移的回归守卫（主要交付物）

迁移已完成，但仓库里没有任何东西阻止下一次有人再写死旧路径。这一次是靠人发现 `pwsh pdw.ps1 doctor` 变红才
发现的。

新增 `scripts/check-tool-paths.mjs`，扫「会真的被执行或被人照抄」的活文件，发现旧路径就报 `file:line` 并非零退出。

要命中的模式（大小写不敏感）：

1. `NVM_Windows`（旧 nvm 根）
2. `nvm\installs\v<数字>` 或 `nvm/installs/v<数字>`（换 node 版本即失效的绝对路径）
3. `@openai\codex\node_modules\@openai\codex-win32-x64\vendor\`（旧 codex 二进制布局）

扫描范围：`git ls-files` 里扩展名为 `.ps1 .psm1 .mjs .js .cjs .ts .md .json .toml .yml .yaml` 的文件，**排除**
`evidence/`、`tasks/`（历史记录）、`docs/diagrams/*.finalize.json`（生成物元数据）、`node_modules/`、`dist/`。
用 `git ls-files` 拿清单，不要自己 walk 全盘。

必须支持：

- `node scripts/check-tool-paths.mjs`：默认扫仓库根，打印 `scanned N file(s)`；命中逐条打印
  `path:line: <token>`；有命中 exit 1，无命中 exit 0。
- `node scripts/check-tool-paths.mjs --self-test`：在 `%TEMP%` 建临时 fixture（一个含违规行、一个干净），断言前者
  exit 1 且输出含 `path:line`、后者 exit 0；跑完清理自己建的临时目录，打印 `self-test ok` 并 exit 0。
- `--root <dir>`：可选，扫指定目录（给 self-test 与将来复用）。

不要做：改 `scripts/gate-batched.ps1`（现口径 17/17 被多张卡引用）、`.github/`、`package.json`、
`package-lock.json`；不要动 `evidence/`、`tasks/`、`docs/diagrams/`；不要改产品代码（`packages/`、`apps/`）；
不要跑 `npm install`。新文件写 UTF-8、LF、无 BOM，注释用中文，风格参照 `scripts/gate-batched.ps1` 与
`scripts/check-append-only.mjs`。

## 3. 验收（每条贴命令、退出码、关键输出）

1. 第一步两处审查：各自的 `KEEP`/`REVERT` 结论 + 支撑命令与输出；若 REVERT，贴 revert 后的复跑结果。
2. `node scripts/check-tool-paths.mjs` → exit 0，输出能看到 `scanned N file(s)`，当前树 0 命中。
3. `node scripts/check-tool-paths.mjs --self-test` → exit 0，输出含 `self-test ok`。
4. 造探针：在仓库根临时写 `zz-tool-path-probe.ps1`，内容
   `$x = 'D:\Technology_application\NVM_Windows\nodejs\node.exe'`，跑检查脚本 → **exit 1** 并指出该文件行号；
   然后把探针删掉（回收站），再跑一次恢复 exit 0。**两次输出都要贴**。
5. `pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind general -All -DryRun` → exit 0。
6. `git status --porcelain` 的最终结果：只应多出 `scripts/check-tool-paths.mjs`（探针已删；若按 1.3 做过 revert，
   会额外有 revert 相关状态，请如实说明）。

## 4. 报告格式

分成两节：`## 第一步：审查结论`（逐条 KEEP/REVERT + 证据）、`## 第二步：守卫脚本`（实现说明 + 验收输出）。
最后一行写：`NEXT: 无` 或 `NEXT: <需要协调者决定的事>`。实现过程中若发现某个「活文件」里确实还有旧路径
（不在排除范围内），**不要改它**，在报告里列出来。

不做的事再强调一次：不 push、不动 GitHub 告警、不改 CI 与门禁脚本、不改产品代码。
