# PDW 在本项目的本地口径

> 只适用于本项目（VESSEL）。技能正文在 `.agents/skills/personal-dev-workflow/`，**本项目允许本地改动**；
> 改动登记在 `.pdw/skill-local-changes.md`，`update.mjs` 覆盖后按该文件重放。
> 总规则仍在 `AGENTS.md`；本文件只写「本项目怎么跑」，不重复规则正文。

## 1. 门禁：分批跑，不跑单进程全量

```powershell
pwsh -NoProfile -File scripts/gate-batched.ps1                 # 12 段测试 + web + 三处 tsc + conformance
pwsh -NoProfile -File scripts/gate-batched.ps1 -SkipConformance # 跳过离线 conformance
pwsh -NoProfile -File scripts/gate-batched.ps1 -Only cli        # 只跑名字含 cli 的那批
```

- 本机单进程 `vitest run` 会在文件切换处挂起，**不是代码缺陷**；分批是唯一稳定口径。
- 脚本只打印每步 `exit` 与耗时，日志落 `%TEMP%`，不写仓库。
- 任一红即 exit 1 并列出失败步骤名；PDW 契约的 `checks` 优先直接调它。

## 2. 双通道：PDW 串行 vs Codex 旁路并行

| 通道 | 谁执行 | 并发 | 适用 |
|---|---|---|---|
| PDW `implement` | `codex exec`（串行单代理） | 一次一个任务 | 有契约、要独立 review 与证据的任务 |
| Codex 旁路 | 用户 Codex 应用，或协调者按道起的 `codex exec` | 可多道并行 | 段多、文件集互不重叠、要压低交付时间 |

旁路硬约束：

- **同一文件同一时刻只有一个写者**；并行道之间必须文件集互不重叠（冲突表写进卡）。
- 并行只用于只读探索与跑测试；写文件按道串行。
- 段与段之间用该段的 Verify 命令做闸门，上一段没绿不进下一段。
- 全量门禁**只由协调者跑一次**，不让各道各自跑全量。

## 3. 模型与档位

派活前对照 `AGENTS.md` 的「模型与档位选型表」，并在卡或任务日志写清：
**模型 ID + 档位 + 依据（表里哪一行）**。首次使用某 ID 前先 `codex exec -m <id> "print OK"` 探测。

- 本批分工：`gpt-6.1-sol`/`medium`（多文件协调）、`gpt-6.1-terra`/`low`（纯测试）、
  `gpt-6.1-terra`/`medium`（文档）。
- 升级阶梯：`medium` → `xhigh`（同模型）→ `gpt-6-astra`，每步都要有失败证据。
- **Fast（`service_tier`）默认关**；开关都记进卡。

## 4. 卡与契约最小字段

- 卡首行：`Status` + （若走 PDW）`PDW task: <id>`；正文包含 Goal / Not Doing / Acceptance /
  Blast Radius / Expected Evidence。
- 契约：`goal`（一句可验收）、`mode`（`develop` / `audit`）、`scope`（正斜杠相对路径）、
  `acceptance`（每条一句话 + 可观察判据）、`checks`（真实命令，优先调 `gate-batched.ps1` 或单测文件）。
- 草稿放 `.pdw/contracts/`，不要放 `.pdw/tasks/`（无参 `status` 会把草稿目录当任务读 `state.json`）。

## 5. 证据与收口

- `checks` 只写 `%TEMP%`；验收后在卡里写摘要 + accepted artifact 哈希，不把生成物复制进仓库。
- 提交前：`gate-batched.ps1` 全绿 → 按卡拆分提交 → 同步 `tasks/README.md` 与 `HANDOFF.md` 门禁数字。
- 需要独立复核时用 PDW `audit`（`review` 角色只读），复核范围=本轮 diff，不沿用旧证据。
