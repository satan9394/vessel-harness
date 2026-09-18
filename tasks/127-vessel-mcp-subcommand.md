# 127 — `vessel mcp` 配置子命令（闭合能力矩阵 §14 的 CLI 出口缺口）

- 编号：127
- 状态：已合入（2026-09-18）
- 优先级：P2（能力矩阵登记的 CLI 出口缺口；非 1.0 门槛项）
- 创建日期：2026-09-18
- 关联：`docs/product-audit/CAPABILITY-MATRIX.md` §14/§4.4 项 2、`tasks/076-081`（MCP 库级）、`apps/cli/src/mcp/config.ts`
- 执行器：指挥侧

## 1. 缺口

MCP 的库级管道早已完整（`McpClient` / `StdioTransport` / `mcp__<server>__<tool>` / policy 按工具名 deny），
`~/.vessel/mcp.json` 也已被 `vessel run` 读取并逐 server 降级——**但没有任何配置子命令**，用户只能手写 JSON。
能力矩阵 §14 与 §4.4 项 2 都登记了这条"管道已通、缺 CLI 出口"。

## 2. 交付

`apps/cli/src/cli.ts` 新增 `cmdMcp`（`vessel mcp`），只做**文件读写**，不建 transport、不拉起 server
（`apps/cli` 不依赖 `@vessel/tools`，AGENTS 约束 5 的边界不破）：

| 子命令 | 行为 |
|---|---|
| `mcp list`（默认） | 列出已配置 server；空配置给"未配置 + 路径"提示；`--json` → `{ configFile, servers }` |
| `mcp add <name> --command <cmd> [--args a,b] [--cwd <dir>] [--env K=V,K2=V2]` | 校验并追加；重名 fail loud（exit 2） |
| `mcp remove <name>` | 移除；不存在 fail loud（exit 2） |
| `mcp path` | 打印 `mcp.json` 路径（`--json` → `{ configFile }`） |

- 复用 `McpConfigStore`（`load`/`save`）：损坏 JSON / 结构非法 / 重复 name 由它 fail loud，本命令**不吞**（exit 1 + 路径）。
- `--json` 时 stdout 只出一段可解析 JSON（与 `output.ts` 的既有约定一致）。
- 未知子命令 exit 2；缺 `--command` exit 2；`--env` 非 `K=V` exit 2。
- CLI 用法（`--help`）与 README 命令表同步登记。

## 3. 验收与实测

- 单测 `apps/cli/src/mcp/mcpCommands.test.ts`（5 例，全部经真实 `main()` 进程内调用，`VESSEL_MCP_ROOT` 注入临时目录）：
  - list 空配置 exit 0 + `--json` 空数组；
  - add → list → path → remove 往返，落盘内容逐字正确（args/env 解析）；
  - 重名 / remove 不存在 / 未知子命令 / 缺 `--command` 均 exit 2；
  - 损坏 mcp.json ⇒ exit 1 且提示路径；
  - **不写真实 `~/.vessel`**（注入 root 后文件落临时目录）。
  ⇒ **5 passed**。
- 手动冒烟（临时 root）：`mcp path` / `add demo --command npx --args …` / `list` / `list --json` / `remove demo` 全部 exit 0，JSON 可解析。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 + web 全绿、CI 两腿绿。

## 4. 边界（未做，如实）

- 不建 transport / 不探测 server 可用性：`mcp list` 只列配置，不验证 server 能起来（属 `@vessel/tools` 的运行期职责）。
- 不支持 `--enable/--disable` 开关：`McpServerConfig` 目前无 enabled 字段，加字段属契约变更，未在本卡。
- TUI 斜杠命令（`/mcp`）未加：CLI 面已闭合缺口，TUI 面按需另立。
