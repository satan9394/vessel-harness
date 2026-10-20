# 任务卡 233 — 供应商能力继承与协商拦截修复 (Provider Capability Inheritance & Negotiation Repair)

- Status: 已合入（2026-10-19，standard 交证即停，全量门禁全绿）
- Mode: standard
- Source: human-requested (用户在 Web 端使用 commandgota 供应商启动会话时遭遇运行时拦截报错)
- Risk: medium

## Goal
修复当用户使用标准 OpenAI-compatible / Anthropic 供应商（如 Command GOTA、DeepSeek 等）且端点 `/v1/models` 返回的模型元数据中未包含非标准 `tools` 字段时，模型能力被探测降级为 `tools=unknown` 进而导致 Turn 运行时调度硬拦截报错（`Provider openai-compatible model <model>: required tools=true, available unknown (unknown)`）的问题。

## Not Doing / Constraints
- 严格遵循红线：`packages/core` 修改行数严格为 0（已通过 `git diff --stat packages/core/` 校验，输出 0 变动）。
- 纯本地开发：严禁 `git push`，禁止发布 npm。
- 删除铁律：所有删除走 Windows 回收站，禁止永久删除。
- 保证既有所有门禁与单测 100% 保持绿色（包含 `packages/llm/src/capabilities.test.ts` 与 `apps/cli/src/providers/providerFactory.capabilities.test.ts`）。

## Acceptance Criteria
- [x] `discoverProviderCapabilities(metadata, protocol?: string)` 支持注入 `protocol`；缺省时完全向后兼容保持 `unknown`，指定已知协议（如 `openai-compatible`、`anthropic`）时以协议适配器的基础能力（如 `tools=true`、`streaming=true`）为底座，并允许元数据中显式声明（如 `context_window`、`supports_tools: false` 等）覆盖。
- [x] `apps/local-server/src/routes/providerRoutes.ts` 在 `test()`、`normalizeProviderInput()` 中将当前端点协议传递给 `discoverProviderCapabilities`，避免将标准端点模型探测为 `tools: unknown`。
- [x] `apps/local-server/src/providers/ProviderStore.ts` 支持自愈已持久化在 `providers.json` 中的历史遗留 `tools: unknown` 配置。
- [x] 针对能力继承与自愈补齐完整的定向单测（`packages/llm/src/capabilities.test.ts` 14/14 passed、`apps/local-server/src/routes/providerRoutes.test.ts` 31/31 passed）。
- [x] 全量门禁校验通过：`npx tsc -b`、`npm run typecheck:tests`、`npm run test:all`（根 289 文件 3065 passed + apps/web 48 文件 396 passed 双 Root 全绿）。

## Blast Radius
- `packages/llm/src/capabilities.ts`
- `apps/local-server/src/routes/providerRoutes.ts`
- `apps/local-server/src/providers/ProviderStore.ts`
- 定向测试文件

## Expected Evidence & Verification Result
1. **Core 薄核遵守证据**：
   - `git diff --stat packages/core/` 输出为空（严格 0 行变更）。
2. **定向测试与自愈验证**：
   - `packages/llm/src/capabilities.test.ts`: 14 passed (包含缺省协议兼容测试与协议继承覆盖测试)。
   - `apps/local-server/src/routes/providerRoutes.test.ts`: 31 passed (包含自省与拉取能力测试)。
   - 真实磁盘验证：重启 local server 后读取用户 `~/.vessel/providers.json`，原有 `commandgota / deepseek/deepseek-v4.1-flash` 的 `tools` 字段已自动从 `unknown` 自愈为 `{ status: "declared", value: true, source: "openai-compatible adapter" }`，`contextWindow: 1000000` 完整保留。
3. **全仓门禁验证**：
   - `npx tsc -b tsconfig.json`: Exit 0
   - `npm run typecheck:tests`: Exit 0
   - `npm run -w @vessel/web build`: Exit 0
   - `npm run test:all`:
     - 根 Root: 289 passed / 3065 passed / 6 skipped
     - apps/web Root: 48 passed / 396 passed
     - 总计 337 个测试文件全部通过！
