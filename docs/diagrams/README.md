# docs/diagrams — 架构可视化图（Archify 产物）

本目录是用 [Archify](https://github.com/tt-a1i/archify)（`tt-a1i/archify`，MIT）把本仓整体逻辑架构
可视化的定稿产物。每张图是一个**自包含、可交互的独立 HTML**：双击即可在浏览器打开，
支持节点详情、路径探索、深/浅主题与导出；不依赖任何服务器。

图表事实源为 `docs/ARCHITECTURE.md`（模块边界与事件流）+ 各包真实源码
（节点带 `SRC n` 证据，钉在 commit `9c764b811d737c1f3ba40649f4c3f3e4ec4f1bd2`）。

## 五张图

| 图 | 类型 | 内容 |
|---|---|---|
| `vessel-architecture-overview.html` | architecture | 全仓总览：入口/组合根、薄核 core、机制层（llm/context/behavior/policy/tools/runtime）、子系统层（agents/skills/memory/engine/telemetry）、shared 类型契约，含依赖方向与边界 |
| `vessel-turn-sequence.html` | sequence | 一轮 turn 运行时序：A03 before_turn → A07 before_model → A08/A09 模型流 → A10 after_model → A12 before_tool → Runtime 执行 → A04 before_stop → A06 after_turn |
| `vessel-policy-workflow.html` | workflow | Policy 六步裁决与硬执法：denied_tools → deny → hook override → ask → allow → profile，guard 单调 + fail-closed + 审计落点 |
| `vessel-behavior-pipeline.html` | dataflow | Behavior IR 编译管线 L0→L4（IR → Resolver → Model Profile → Harness Profile → Prompt Compiler）与双通道强制 |
| `vessel-context-lifecycle.html` | lifecycle | Context 组装与 Compaction 事务：稳定层缓存、三入口触发、compaction/start 锁 → 平衡区域替换 → 载重，同一会话内原地替换 |

`.json` 为对应的可编辑 Archify 源（typed JSON IR）；改图时改 JSON 后用
`node .agents/skills/archify/bin/archify.mjs finalize <type> <json> <html> --repo-root . --quality showcase` 重新生成。
`*.finalize.json` / `*.finalize-summary.json` / `*.browser-check.json` / `*.delivery.json`
是生成时四条门禁（validate / deliver / check / browser-check）的验证回执。

## 已知文档漂移（可视化暴露，已于 2026-10-12 修复）

- 漂移：`docs/ARCHITECTURE.md` §6.1 的目录树只列了 13 个 package，缺 `engine`（`AGENTS.md` 与真实代码均为 14 个）。
- 已修复：`docs/ARCHITECTURE.md` §6.1 补齐 `engine`，并一并补上 `apps/local-server`、`apps/web`，
  修正已不存在的 `vitest.workspace.ts` → 真实的 `vitest.config.ts`（双 root 说明）。
- 同批修正的计数漂移：`docs/product-audit/ARCHITECTURE-REPORT.md`（13→14）、
  `docs/Vessel_后续开发方向与产品化路线_v1.0.md`（13 个包清单补 `application`）。
- 本目录的 architecture 图始终按**真实代码**绘制，与上述修正后一致。
