# T314 — USAGE 命令列表双语化（i18n 第二批）

- Status: 已完成（2026-10-26；PDW 任务 `20261026105239-ebe35d` `accepted_local`；未提交、未推送）
- PDW task: none
- Mode: standard（把 USAGE 的命令清单抽进字典，中英各一份）
- Source: 卡 310 的遗留（只做了 header/footer）、HARNESS² 评估 P2-3
- Risk: medium（约 60 行文案，容易漏翻或改坏中文）

## Goal

把 `USAGE` 里那 60 多行命令说明抽进 `i18n.ts` 的字典，`--lang en --help` 输出**全英文**、`--lang zh --help` 与改动前**逐字一致**。

## Not Doing

- 不翻译 `vessel guide` 的分步引导内容（那是独立命令，走 `--locale`）。
- 不翻译错误信息、TUI、Web 文案。
- 不改任何命令的行为、参数或退出码。
- 不加依赖、不动 `packages/core`、不 commit/push、不跑 `--live`。

## 设计

1. `i18n.ts` 新增两个键 `usage.commands`（zh / en 各一份**多行字符串**）：
   - 占位符：`{syncTimeout}`（=`DEFAULT_SYNC_TIMEOUT_MS / 1000`）、`{syncRetries}`（=`MAX_SYNC_RETRIES`）。
   - zh 版必须与当前 `USAGE` 里那段**逐字相同**（包括对齐空格与续行缩进）；en 版按同一行序、同一对齐宽度翻译。
2. `cli.ts` 的 `USAGE` 改为：`${t('usage.commandsHint')}` 之后接 `${t('usage.commands', { syncTimeout, syncRetries })}`，再接现有 footer。其余结构不动。
3. 术语表（**必须统一**，en 侧照此）：供应商=provider、会话=session、价目=pricing、端点=endpoint、探针=probe、覆盖=override、墓碑=tombstone、小时=…、勾选=select、向导=wizard、回收站=Recycle Bin、术语表=glossary、评审=review、副作用=effect、解除阻断=unblock、留痕=record、只读=read-only。

## Acceptance

- AC1：`--lang en --help` 的完整输出**不含任何 CJK 字符**（`/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/` 不得命中），exit 0。
- AC2：`--lang zh --help` 与改动前逐字一致——用 5 条代表性命令行的完整字符串做断言（含对齐空格），例如 `vessel --help                      显示本帮助`、`vessel mcp path                    打印 MCP 配置文件路径`、`vessel diff [<id>|--last]           会话改动的只读提示（Write/Edit 文件 + shell + git status；不回滚）`。
- AC3：`{syncTimeout}` / `{syncRetries}` 两个占位在 zh 与 en 都被替换成数字（输出里不得出现字面 `{syncTimeout}`）。
- AC4：`vessel --help`（无 `--lang`）仍为中文，exit 0。
- AC5：定向 vitest（i18n + cli.test）、`tsc -b`、`typecheck:tests` exit 0。

## Blast Radius

`apps/cli/src/i18n.ts`、`apps/cli/src/cli.ts`、`apps/cli/src/cli.test.ts`、`apps/cli/src/i18n.test.ts`。回滚 `git checkout -- <上述文件>`。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、`--lang en --help` 与 `--lang zh --help` 的真实输出（各贴前 12 行）、CJK 扫描结果、PDW review 结论；协调者另跑全量。

## Result

已完成。`USAGE` 的 60 多行命令说明抽进 `i18n.ts` 的 `usage.commands`（zh / en 各一份多行字符串，含 `{syncTimeout}` / `{syncRetries}` 占位）；`cli.ts` 的 `USAGE` 改为 `${t('usage.commandsHint')}` 之后接 `${t('usage.commands', { syncTimeout, syncRetries })}`，其余结构未动。

真实 CLI 验收（`spawnSync` 读输出，避开控制台解码）：

- `--lang en --help`：exit 0，**零 CJK 字符**（`[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]` 无命中）。
- `--lang zh --help`：exit 0，四条代表性命令行（含对齐空格）逐字一致，例如 `  vessel --help                      显示本帮助` 与 `  vessel mcp path                    打印 MCP 配置文件路径`。
- 两条占位符在 zh / en 均被替换，输出无字面 `{syncTimeout}` / `{syncRetries}` 残留。
- 中英输出行数一致：**103 / 103**。

定向 **133 passed**；`tsc -b`、`typecheck:tests` exit 0；全量根 **319 文件 / 3413 passed + 6 skipped**、web **58 / 494**。

未做：`vessel guide` 的分步引导、错误信息、TUI、Web 文案未翻译（各自独立，不属本卡）。
