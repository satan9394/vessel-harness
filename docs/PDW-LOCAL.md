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
| PDW `implement` | `opencode run`（DeepSeek `#high`，串行单代理） | 一次一个任务 | 有契约、要独立 review 与证据的任务 |
| Codex 旁路 | 用户 Codex 应用，或协调者按道起的 `codex exec` | 可多道并行 | 段多、文件集互不重叠、要压低交付时间 |

**运行期间冻结工作树（2026-10-27 实测，两次 blocked 都是它）**：PDW 1.3.3 的
`snapshot()` 用 `git ls-files -c -o --exclude-standard` 把**整个工作树**算进指纹
（`scope` 只用于校验 ignore 覆盖），所以 `new` 之后**任何**已跟踪或未忽略的新文件
发生写入都会在模型调用前判 `Source drift detected`（`calls_used: 0`）。
⇒ 建任务前把卡、README、文档全部写完；**不要把 `PDW task: <id>` 回填进卡**再跑，
跑完再补。这期间的只读命令（读文件、`netstat`、`git status`）不受影响。

旁路硬约束：

- **同一文件同一时刻只有一个写者**；并行道之间必须文件集互不重叠（冲突表写进卡）。
- 并行只用于只读探索与跑测试；写文件按道串行。
- 段与段之间用该段的 Verify 命令做闸门，上一段没绿不进下一段。
- 全量门禁**只由协调者跑一次**，不让各道各自跑全量。

## 3. 模型与档位

派活前对照 `AGENTS.md` 的「模型与档位选型表」（Codex 通道）或本节的 PDW 角色表，
并在卡或任务日志写清：**模型 ID + 档位 + 依据**。首次使用某 ID 前先跑一次
`opencode run --model <id> "print OK"` 或 `codex exec -m <id> "print OK"` 探测。

**PDW 五角色（2026-10-28 起，`pwsh pdw.ps1 doctor` 为准）**：

| 角色 | 后端 | 模型 / 档位 |
|---|---|---|
| `scan` / `test-plan` | codex | `gpt-6.1-terra` / medium（只读、高频、按材料核事实） |
| `implement` / `repair` | codex | `gpt-6.1-sol` / medium（唯一写者；重活按 `-Kind code-heavy` 改 high） |
| `review` | codex | `gpt-6.1-sol` / high（独立判断，安全属性不降档） |
| `planner` | codex | `gpt-6.1-sol` / high（默认关） |

- 额度用尽时整体回退：`scripts/pdw-route.ps1 -Kind deepseek -All`（scan/test-plan `#high`，review/planner `#max`）。
- 只改写者不改其余角色：`scripts/pdw-route.ps1 -Kind code-heavy|general|small`（不加 `-All`）。
- 升级阶梯：`medium` → `high`（同模型）→ 换 `gpt-6-astra`，每步都要有失败证据。
  PDW 侧 DeepSeek 的档位是 `low/high/max`，写 `medium` 不会变成中等思考。
- **Fast（`service_tier`）默认关**；开关都记进卡。

### 3.1 配额策略：Codex 先用满，再转 DeepSeek（2026-10-27 维护者定）

1. 能交 Codex 的一律先交 Codex，档位偏上取（不为省额度压到 `low`）。
2. 出现 `usage limit` 时先排环境（今天踩过：opencode 被升级成占位脚本、`spawn UNKNOWN`），确认不是环境再判额度用尽。
3. 切换：`pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind deepseek`，再 `pwsh -NoProfile -File scripts/pdw-batch.ps1 -Contract <契约> -Kind deepseek`；
   只读四角色本来就是 DeepSeek，不用动。
4. 切回：额度恢复后 `-Kind general`（或 `code-heavy`）；每次切换都有 `.pdw/skill-upgrade-<日期>/config.json.bak-route-*` 备份。
5. 转 PDW 前必须确认该任务有契约文件，且卡与文档已写完（跑期间不能写仓库）。
6. **不再新增任务卡**：本轮清完未解决项就收口，新想法另立批次。

### 3.2 按任务性质切写者：`scripts/pdw-route.ps1`

PDW 1.3.3 只有一张 roles 表，不支持按任务改路由。用这个脚本按「任务性质」切换写者，
它会先备份 `.pdw/config.json`、打印改前改后、写盘后跑 `doctor`：

| `-Kind` | implement | 适用任务性质 |
|---|---|---|
| `code-heavy` | codex `gpt-6.1-sol` / **high** | 跨包签名、core 安全语义、并发竞态、删除主链路 |
| `general` | codex `gpt-6.1-sol` / medium | 多文件协调、常规功能、预计会返工 |
| `small` | codex `gpt-6.1-terra` / low | 单文件、纯测试、文档对账、机械改动 |
| `deepseek` | opencode `deepseek-v4.1-flash` / high | Codex 不可用或额度受限时的兜底写者 |

只读四角色始终 DeepSeek（`scan`/`test-plan` `#high`，`review`/`planner` `#max`）。

```powershell
pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind code-heavy -DryRun   # 只看 diff
pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind code-heavy            # 落盘 + doctor
```

### 3.3 一次跑完一整批：`scripts/pdw-batch.ps1`

```powershell
pwsh -NoProfile -File scripts/pdw-batch.ps1 -Contract .pdw/contracts/353-*.json,.pdw/contracts/345c-*.json -Kind code-heavy
```

- 逐个 `new --from <契约>` → `run <id>`，一轮结束才进下一个；默认遇到非 `accepted_local` 就停
  （要串跑加 `-ContinueOnFailure`），汇总写 `.pdw/batches/<时间戳>.json`。
- **开跑前把卡与文档全部写完**：批次运行期间不能碰仓库（见 §2 的冻结规则）。
- 批次跑完不等于验收：协调者仍要逐项复跑定向测试与门禁，运行器的 `accepted_local` 只是它的自述。

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
