# T329 — 用量行补「最近调用时间」并在 Web 展示

- Status: 已完成（2026-10-26；L1 执行）
- 依赖：T325/C 段的 Web 改动之后（同一个 `ProviderSettingsModal.tsx`，必须串行）

> 用户要求「token 消耗可见」，现在只有累计数字，没有「最近一次调用是什么时候」。
> `UsageEntry` 已有 `lastTs`，只是 `byProvider()` 没带出来。

## 1. 要做的

1. `apps/cli/src/usage/UsageStore.ts` 的 `byProvider()` 每行增加 `lastTs: string`：
   - 取该 provider 所有条目里**最大的** `lastTs`（ISO 字符串，字典序即时间序；非法/缺失则跳过）；
   - 没有可用时间时**不写该字段**（不要塞空串或 `new Date(0)`）。
2. `apps/local-server/src/server.ts` 的 `usageByProvider` 行类型补可选 `lastTs?: string`（只透传，不改形状语义）。
3. `apps/web/src/api.ts` 的 `listProviderUsage` 行类型补 `lastTs?: string`。
4. `ProviderSettingsModal.tsx`：卡片用量行追加「最近：<相对时间>」（如 `最近：3 小时前`）；
   没有 `lastTs` 时**不显示这一段**（不是显示「从未」）。
5. `i18n.ts` 中英都加（英文不含 CJK）。

## 2. 不许做

- 不在 Web 里重算时间语义（只做相对时间展示，用 `Intl.RelativeTimeFormat` 或既有工具，别引新依赖）。
- 不给 `byProvider` 加除 `lastTs` 以外的字段；不改 `--json` 既有键名。
- 不动 `packages/core`；不 commit。

## 3. 允许修改

```
apps/cli/src/usage/UsageStore.ts
apps/cli/src/usage/usage-store.test.ts
apps/local-server/src/server.ts
apps/web/src/api.ts
apps/web/src/components/providers/ProviderSettingsModal.tsx
apps/web/src/components/providers/ProviderSettingsModal.test.tsx
apps/web/src/i18n.ts
```

## 4. 验收

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/usage
node node_modules/vitest/vitest.mjs run apps/local-server/src/server.test.ts
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

测试覆盖：多条记录取最大 `lastTs`；无可用时间时不带该字段；Web 有值时显示相对时间、无值时不显示；
中英文案。

## Result

`byProvider` 增 lastTs / models(Top3) / inputTokenSemantics；Web 相对时间与口径展示；usage 11 + 37、web 12/19/43 等断言通过。
