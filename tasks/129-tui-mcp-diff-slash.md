# 129 — TUI 一致性：`/mcp` 与 `/diff` 斜杠命令

- 编号：129
- 状态：已合入（2026-09-18）
- 优先级：P3（G-13 的 TUI/CLI 一致性项；非 1.0 门槛）
- 创建日期：2026-09-18
- 关联：`docs/product-evolution/PRODUCT-GAP-MAP.md` G-13、`tasks/127`（`vessel mcp`）、`tasks/128`（`vessel diff`）
- 执行器：指挥侧

## 1. 缺口

G-13 登记"TUI/CLI 命令面不一致"。`vessel mcp`（task 127）与 `vessel diff`（task 128）落在 CLI 后，
TUI 侧没有对应斜杠命令——用户在会话里无法查 MCP 配置、也看不到本会话改了什么。

## 2. 交付

- **抽出共享模块** `apps/cli/src/sessions/diffReport.ts`：`parseSessionRecords` / `collectSessionChanges` /
  `renderSessionChanges`。CLI 的 `cmdDiff` 与 TUI 的 `/diff` 复用同一实现（避免第二份逻辑分叉）。
- `apps/cli/src/tui/chat.ts`：
  - `dispatchSlash` 新增 `case 'mcp'`：只读列出 `~/.vessel/mcp.json` 的 server（不建 transport、不改配置）；空配置给提示；损坏文件返回错误文本不崩。
  - `dispatchSlash` 新增 `case 'diff'`：用 `ctx.sessionLogPath` + `ctx.sessionWorkspace` 渲染本会话改动；会话尚未懒建（无日志）时如实提示。
  - `SlashContext` 增 `sessionLogPath?` / `sessionId?`；`runChat` 在调用点从 `harness?.session` 注入。
  - `/help` 补 `/mcp` 与 `/diff` 两行。

## 3. 验收与实测

- 单测 `apps/cli/src/tui/slashMcpDiff.test.ts`（4 例，`VESSEL_MCP_ROOT` 注入临时目录）：
  - `/mcp` 空配置给提示；有配置列出 `name command args`；
  - `/mcp` 损坏文件返回 `[mcp] …` 不崩；
  - `/diff` 无会话日志 ⇒ 提示"尚无日志"；
  - `/diff` 有日志 ⇒ 列出 `a.ts` 与 shell、含"只读提示"。
  ⇒ **4 passed**。
- 回归：`apps/cli/src/sessions/diffCommand.test.ts`（3 例）在抽模块后仍 **3 passed**（行为未变）。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 + web 全绿、CI 两腿绿。

## 4. 边界（未做，如实）

- TUI `/mcp` 是**只读**镜像：增删仍走 CLI `vessel mcp add/remove`（TUI 内不做交互式编辑，避免把配置写入混进对话流程）。
- TUI `/diff` 只看**当前会话**；跨会话/指定 id 仍用 CLI `vessel diff <id>`。
- 其余 TUI/CLI 分叉（如 `vessel policy status`、`bench-report`）未纳入本卡。
