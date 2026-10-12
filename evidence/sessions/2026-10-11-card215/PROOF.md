# PROOF — Card 215 交付证据

- **卡片**：`tasks/215-provider-hub-model-pull-and-schema-repair.md`
- **执行者**：OpenCode（搭载 DeepSeek-v4.1-Flash）
- **日期**：2026-10-11
- **基线**：HEAD `dd8e72c`（V2.6 本地验收）、工作区保留 V2.5/V2.6 未提交改动
- **状态**：本地已验证，待维护者验收

## 1. 交付范围（改动文件）

| 文件 | 改动 |
|---|---|
| `apps/local-server/src/routes/providerRoutes.ts` | 新增并导出 `normalizeProviderInput`；`save()` 改走归一化；`remove()` 增加凭据自愈；新增 `pullModels()` 与 `PullModelsResult` |
| `apps/local-server/src/providers/ProviderStore.ts` | 新增 `forgetCredential(id)`（删除供应商时清理 `secretRef` 指向的凭据） |
| `apps/local-server/src/server.ts` | 新增 `POST /api/providers/pull-models` 路由；`providerErrorCode()` 具体错误码透传 + 损坏/非法条目归类为 `provider_store_corrupted`（白名单分类，不泄露路径或 id） |
| `apps/local-server/src/routes/providerRoutes.test.ts` | +4 用例：workbuddy 嵌套/字典型 Schema、拉取模型端点、secretRef 删除与错误码透传、既有/孤儿 secretRef 供应商删除 |
| `apps/web/src/api.ts` | 新增 `PullModelsResult` 与 `pullProviderModels()` |
| `apps/web/src/components/providers/ProviderSettingsModal.tsx` | 「Pull models」按钮；`providerFailure()` 错误码 → 本地化文案映射（含列表加载/重试路径）；协议/密钥术语 |
| `apps/web/src/components/providers/ProviderSettingsModal.test.tsx` | +5 用例：拉取回填、拉取失败本地化、删除错误具体化、损坏库可操作原因、术语断言 |
| `apps/web/src/i18n.ts` | 新增 9 个词条；协议与密钥术语规范化 |
| `tasks/README.md`、`HANDOFF.md`、本卡 | 状态与交付回填 |

## 2. 核心行为

1. **灵活的 Schema 兼容**：`normalizeProviderInput` 支持
   - `models` 为**对象字典**（取 `Object.keys`）、字符串数组、中英逗号分隔字符串三种形态；
   - `options.baseURL` / `options.apiKey` 嵌套，兜底根级 `baseUrl` / `apiKey`；
   - 从 `npm`（如 `@ai-sdk/openai-compatible`）或 `options.protocol` 推断协议；显式非法 `protocol` 仍 fail loud（`invalid_protocol`）；
   - 用户真实 workbuddy 载荷 → 提取 4 个模型、`baseUrl` 取自 `options.baseURL`、`apiKey` 取自 `options.apiKey`，落盘不含明文。
2. **一键拉取模型**：`POST /api/providers/pull-models` 真实探测 `GET /v1/models`，返回 `{ ok, models, latencyMs }`；前端按钮回填模型输入框并提示拉取数量。
3. **删除自愈与错误透明**：
   - 删除 `secretRef` 供应商时清理对应凭据（`forgetCredential`，尽力而为不阻断）；**既有/孤儿 secretRef 条目均可删除**（含凭据已不可解析的情况）；
   - 后端透传**具体码**：`invalid_models` / `invalid_base_url` / `invalid_api_key` / `invalid_protocol` / `invalid_provider_name` / `builtin_provider` / `secure_store_required` / `unknown_provider`；
   - 文件损坏或条目非法 → `provider_store_corrupted`（**可操作但仍不泄露**绝对路径、id 或密钥）；其余自由文本回落 `provider_request_failed`；
   - 前端按码本地化展示，列表加载失败与重试同样按码映射，不再千篇一律「操作失败」。
4. **术语规范化**：`OpenAI 兼容 (OpenAI Compatible)` / `Anthropic (Claude)` / `API Key`（含 `providerKeyRequired` 文案对齐为「API Key」）。

## 3. 门禁实测（均在最后一次编辑之后）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 定向测试（后端） | `npx vitest run apps/local-server/src/routes/providerRoutes.test.ts` | **27 passed** |
| 定向测试（前端 + i18n） | `npx vitest run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx src/i18n.test.ts` | **35 passed** |
| 全量双 Root | `npm run test:all` | root **2873 passed / 6 skipped**（268 文件）；web **282 passed**（33 文件）⇒ 合计 **3155 passed / 6 skipped** |
| 类型构建 | `npx tsc -b tsconfig.json` | exit 0 |
| 测试类型 | `npm run typecheck:tests` | exit 0 |
| Web 类型 | `npm run -w @vessel/web typecheck` | exit 0 |
| Web 生产构建 | `npm run -w @vessel/web build -- --emptyOutDir false` | exit 0（877 modules transformed） |

> **DoD 第 1 条的字面命令需要注意**：在仓库根同时传两个文件路径时**只会命中 `apps/local-server` 那个**（根 `vitest` 的 `include` 不含 `apps/web`，见 `AGENTS.md` 纪律 26），web 侧必须用 `--root apps/web`。本卡两条都单独跑过，上表已分别列出。

**薄核与红线**：`git diff --numstat -- packages/core` = **0 行**；无任何文件删除；无 `git push`、无 npm 发布；未驱动任何外部 Agent；未引入非 npm 锁文件；Web 构建带 `--emptyOutDir false`。

## 4. 已知边界 / 不声称项

- 「拉取模型」为**单次真实探测**，不缓存结果、不做定时刷新；上游不支持 `/v1/models` 时返回 `invalid_models_response` / `http_4xx`。
- 删除时的凭据清理为**尽力而为**：凭据后端不可用时静默跳过，不阻断配置删除。
- `provider_store_corrupted` 只告知「配置坏了」，**不自动修复**；恢复手段仍是人工检查 `~/.vessel` 或用 `~/.vessel/backups/` 回滚（沿用 ProviderStore 既有备份机制）。
- 未做真实浏览器端到端验证与真实供应商账号的账单/端点验证（沿用 V2.6 的离线车道口径）。
- 本轮经 OpenCode 目标模式（`/goal`）推进，**未经** `scripts/runstate.js` 状态控制器登记：`.agent-state/run-state.json` 仍停在 Epic 214（completed）。如需机器账本一致，请由维护者用 runstate 指令开启新一轮 mission 再回填。
