# TEST-REPORT-V07 — 全量测试 + 功能测试验证报告

- 日期：2026-09-07 17:2x
- 执行人：验证子代理（只验证与报告，**未修改任何代码**）
- 环境：Windows / PowerShell；Node v24.14.0；npm 11.9.0；Vitest v2.1.9
- 工作区：`C:\work\Vessel_Harness`
- 命令入口：`npx tsc -b` 构建后统一用 `node apps/cli/dist/cli.js`（等价 `cah`）。
  注：`Get-Command cah` 命中全局链接 `D:\tools\NVM_Windows\nodejs\cah.ps1`
  （指向全局安装的 `@cah/cli`，非本次刚构建产物），故证据统一取自本地 dist。
- 隔离：`$env:CAH_PROVIDER_ROOT` 指向临时目录（不触碰 `~/.dsh`），用后置 `$null`；
  临时目录与冒烟会话日志按回收站纪律清理（`FileSystem.DeleteDirectory 'OnlyErrorDialogs' 'SendToRecycleBin'`）。

## A. 全量自动化测试

### A1. `npx vitest run` —— PASS ✅（期望 ≥276，实际 276，全绿）

真实输出节选（`VITEST_EXIT=0`，进程 exit code 0）：

```
 RUN  v2.1.9 C:/work/Vessel_Harness
 Test Files  35 passed (35)
      Tests  276 passed (276)
   Start at  17:27:06
   Duration  9.46s (transform 7.02s, setup 0ms, collect 16.04s, tests 10.07s, environment 12ms, prepare 13.53s)
```

覆盖样例：ProviderStore(21) / cli(15) / chat(7) / setup(8) / presets.data(8) / modelFetcher(6) /
runner(14，含 B001–B005 离线 mock 基准) / AgentLoop(5) / policy(11) / evaluator / subagent / planner /
mcp / parallel / worktree / skill-loader / telemetry 等。无失败、无跳过。

### A2. `npx tsc -b tsconfig.json` —— PASS ✅（期望 exit 0）

真实输出：`TSC_EXIT=0`，进程 exit code 0（无诊断输出）。

## B. CLI 功能冒烟（全部对隔离配置 + 刚构建的 dist 执行）

| # | 命令 | 结果 | 证据（真实输出节选） |
|---|------|------|------|
| B1 | `--help` / `--version` | PASS | `cah v0.1.0`（exit 0）；`--help` 打印完整 USAGE（含 run/bench/models/setup/provider 子命令与协议说明，exit 0） |
| B2 | `provider list`（隔离空目录） | PASS | `  mock *  mock (model: mock)`（exit 0；mock 为内置默认，带 `*`，永不落盘） |
| B3 | add + switch + current 往返 | PASS | ① `provider add deepseek --protocol openai-compatible --base-url https://api.deepseek.com/v1 --api-key sk-v07-test --model deepseek-chat --name DeepSeek` → `已添加 provider "deepseek"（protocol=openai-compatible, model=deepseek-chat）` exit 0；② `switch deepseek` → `已切换到 provider "deepseek"`，`current` → `deepseek`；③ 往返 `switch mock` → current `mock`。均 exit 0 |
| B4 | `models --provider anthropic` | PASS | 内置 Claude 清单 7 条（exit 0）：`claude-opus-4-1 / claude-opus-4-5 / claude-sonnet-4 / claude-sonnet-4-5 / claude-haiku-4-5 / claude-3-7-sonnet-latest / claude-3-5-haiku-latest`（先 `provider add anthropic --protocol anthropic …` 使供应商存在；实现上 `models` 只查已配置供应商，Anthropic 协议走内置清单、不发网络请求） |
| B5 | `run --prompt "你好"`（mock 冒烟） | PASS | 完整跑完一轮：`=== 最终回复 ===` / `(mock: no script entry matched)` / `=== turn … kind=success steps=1 toolCalls=0 ===`（exit 0）。说明：mock 默认无脚本匹配文本，仅回确定性占位文本，回合成功即冒烟通过；会话日志写入 `<workspace>/.harness/sessions/…`（事后已回收） |
| B6 | bare `cah`（非 TTY） | PASS | 不崩溃，明确提示：`[cah] 交互模式需要终端。一次性任务请用：cah run --prompt "..."；配置供应商用 cah setup。`（exit 2，为代码内预期的引导退出码） |
| B7 | `run --bench B001 --out <临时目录>`（可选） | PASS | `=== benchmark B001 PASS (54ms) ===`，判据 5 条全 PASS，JSONL 报告落盘 temp（exit 0；报告目录已随临时目录回收） |

复检（往返后）：`provider list` 输出 3 行，符合预期——`mock *`（当前默认）+ `deepseek [openai-compatible] DeepSeek` + `anthropic [anthropic] Anthropic 测试`。

## C. 供应商目录与 TUI 逻辑验证（只读源码）

### C1. `apps/cli/src/providers/presets.data.ts` 供应商条目数 —— PASS ✅（52 条，期望 ≥52）

`PROVIDER_CATALOG` 数组逐条清点共 **52** 条（按注释分区：official 国际官方 15 / intl 3 / cn 国产官方 16 /
aggregator 聚合网关 12 / local 本地 5 / 末尾内置 mock 1，`category: 'local'`）。
交叉验证：全文件 `category:` 出现 53 次，其中 1 次为接口字段定义（L33 `category: ProviderCategory`），
余 52 次即 52 个目录条目。mock 定义 `auth:'none'`，注释明确「内置离线 provider，keep last，永不落盘」。

### C2. `apps/cli/src/tui/chat.ts` 的 dispatchSlash 斜杠命令 —— PASS ✅

`dispatchSlash`（L152–205）switch 分支清单（/help 文案 + 代码别名）：

- `/help`、`/provider`（别名 `/connect`）、`/setup`、`/models`、`/model <id>`、`/permission <mode>`、
  `/quit`（别名 `/exit`）；未知命令 → `未知命令 /xxx（/help 查看）`。
- 帮助文案自述 7 条：`/provider /models /model /permission /setup /help /quit`。
- `chat.test.ts` 已覆盖 `/help`、`/quit`、未知 `/nope`、`/models` 的 dispatch 测试。

### C3. `apps/cli/src/providers/setup.ts` 向导步数 —— PASS ✅

代码头注释 flow：`pick → key (idempotent) → fetch models with error ladder → pick models (search+space) → summary confirm → write → default`。
实现（`runSetupWizard` L159–303）为 7 步，与任务描述「选供应商→key→拉模型→勾选→确认」一致：

1. 选供应商：clack autocomplete（输入即搜索，含「自定义端点」项）
2. base-url：仅自定义供应商需填（preset 自带端点）
3. API Key：masked 回显脱敏；已存 key → 幂等复用确认
4. 拉模型：openai-compatible 实时 `/v1/models`；anthropic 内置 Claude 清单；401/403 重试 ≤3，其余转手动输入
5. 勾选模型：autocompleteMultiselect（输入搜索 / 空格勾选，至少 1 个）
6. 摘要确认：写入前展示 供应商/协议/端点/key 尾/模型/作用域
7. 写入 `providers.json` +（可选）设当前默认；任意点取消（isCancel）不落盘

## 清理与卫生

- `$env:CAH_PROVIDER_ROOT` 临时目录 `%TEMP%\cahv07-*` 已按回收站删除；环境变量已置 `$null`。
- B5 冒烟产生的仓库内会话日志 `.harness/sessions/sess_1788827302173_6c22121c` 已按回收站删除
  （目录现存 2 条为 2026-09-07 11:0x 历史遗留，未动）。
- 未改动任何源码；`tsc -b` 产物（dist / tsbuildinfo）为正常构建输出，保留。

## 结论

A/B/C 全部 PASS：全量测试 276/276 全绿且 `tsc -b` exit 0；
CLI 冒烟（help/version/provider list、deepseek add+switch+current 往返、anthropic 内置模型清单、
mock run 一轮、非 TTY 提示、B001 基准）逐项通过；源码侧供应商目录 52 条、slash 命令 7+2 别名、向导 7 步均已核实。
未发现需要修复的回归。
