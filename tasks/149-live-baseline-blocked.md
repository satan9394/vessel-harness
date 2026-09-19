# 149 — `--live` 跨 harness 基线：**尝试后 blocked**（外部 adapter 与真实 CLI 不匹配）

- 编号：149
- 状态：blocked（外部 adapter 需先修复；离线车道不受影响）
- 优先级：P1（1.0 门槛「Cross-Harness Benchmark」唯一未达成的部分项）
- 创建日期：2026-09-19
- 关联：`tasks/125`（驱动与入口）、`docs/V1.6-STABLE-CHECKLIST.md` #10、`docs/{DSH,OPENCODE,CODEX,CLAUDE-CODE}-ADAPTER.md`、`tasks/150`（修复队列）
- 执行器：指挥侧

## 1. 尝试（已授权的真实跑）

本机四个目标 CLI 均在（`pi` 缺失，符合预期）：

```
OK  dsh      -> ...\dsh.ps1
OK  opencode -> ...\opencode.exe
OK  codex    -> ...\codex.exe
OK  claude   -> ...\.local\bin\claude.exe
MISS pi
```

小样（1 场景 × 5 adapter）实测 `--scenarios B001 --live`：`vessel` ok，**四个外部 harness 全 fail 且 in=0/out=0**（没真跑模型）：

```
dsh         × B001: fail (run raised: Error: dsh exited 1: error: --profile <name> is required)
opencode    × B001: fail (run raised: Error: opencode exited 1: opencode run [message..]  <usage>)
codex       × B001: fail (run raised: Error: codex exited 2: unexpected argument 'a/facts.txt' found)
claude-code × B001: fail (run raised: Error: claude exited 1: no stderr)
```

## 2. 根因（两条，均已对真实 `--help` 核实）

**① adapter 驱动的是一个"本适配器主动请求的 JSON 契约"，而非真实 CLI 面。**
`docs/DSH-ADAPTER.md:22` 等文档写明子命令面是 `<cli> run --workspace <dir> --task <taskFile> --json`
—— 真实 CLI 并不实现它：

| harness | adapter 现在发的 | 真实 CLI（实测 `--help`） |
|---|---|---|
| dsh | `dsh run --workspace … --task … --json` | **无 `run` 子命令**；headless = `dsh --profile headless [task...]`（stdout 出最终回复，stderr 出推理；**无 `--json`**） |
| opencode | `opencode run --workspace … --task … --json` | `opencode run [message..]`，模型用 `--format json`、目录用 `--dir`；**无 `--workspace/--task`** |
| codex | `codex exec -C <ws> --skip-git-repo-check --json <task>` | **这些 flag 真实存在**（`-C/--cd`、`--skip-git-repo-check`、`--json`）⇒ 本条不是 flag 问题（见 ②） |
| claude-code | `claude -p --output-format json <task>` | **形状正确**（`-p/--print` + `--output-format json`）⇒ 本条不是 flag 问题（见 ②） |

**② `defaultRunCommand` 在 Windows 用 `shell: true`**（`adapters/*.ts` 的 spawn 层），
把 argv 交给 `cmd.exe` 时**按空格重新分词** —— 多词的 `task` 文本被拆成多个位置参数。
这正是 codex 报 `unexpected argument 'a/facts.txt'`（B001 任务正文里的片段）的原因，
claude 的 `exited 1: no stderr` 也高度疑似同因（外加可能的鉴权）。
Node 也在现场打了 `DEP0190`（"Passing args to a child process with shell option true…"）。

**为什么此前没被发现**：离线 `--all` 只跑 Vessel 自适配器（`run-conformance.ts:75-76`），
`selectAdapters` 的 live 探针只探 `<cli> --version` 是否可执行（**不探 run 面**），
故"驱动/契约/报告"全绿，而外部 adapter 的**真实驱动面从未被跑过**。

## 3. 判定与处置

- **离线 conformance 不受影响**：`npm run bench:conformance -- --all` 仍 **25/25 exit 0**（自适配器）。
- **`--live` 基线 blocked**：需先修复四个 adapter（`tasks/150`），修完再重跑（`tasks/151`）。
- 这不是"外部配额"型阻塞，而是**本仓缺陷**（adapter 与 CLI 版本脱节 + Windows 分词 bug），**可自主修复**。

## 4. 修复方向（供 `tasks/150` 用，已核实到 CLI 面）

1. **spawn 层**：Windows 下不要 `shell:true` 传数组（改用 `shell:false` + 可执行全路径，或显式引号化每个 argv 元素）——这是 ② 的通用修法。
2. **dsh**：改为 `dsh --profile headless <task>`（cwd = workspace），stdout 取最终回复；**无 JSON ⇒ 指标多为 approx**（如实标注，或新增"文本车道"归一口径）。
3. **opencode**：改为 `opencode run <task> --format json`（`--dir`/cwd = workspace），解析其 JSON 事件流。
4. **codex**：保留现有 flag（已正确），仅修 ② 的分词；解析 `--json` 的 JSONL 事件。
5. **claude**：保留现有 flag，修 ②；并单独确认本机鉴权（`claude -p "hi"` 能否 exit 0）。
6. **探针加严**：live 探针从"`--version` 可执行"升级为"**能跑一次最小 headless 调用**"，
   否则同类"驱动面脱节"仍会以"全 fail 基线"的形式溜过。

## 5. 边界

- 本卡**只记录与判定**，不改代码；修复落在 `tasks/150`，重跑基线落在 `tasks/151`。
- 真实 provider 调用：本卡仅 1 场景 × 4 harness 的**失败**调用（in=0/out=0，未产生模型 token）。
