# 仓库健康修复记录 · 2026-10-10

由 satan9394 自有仓库健康体检产生的修复（PR #38，已合并）：

- **CodeQL `js/polynomial-redos`（code scanning alert #12）**：`packages/engine/src/session/topic.ts` 的代码围栏剥离由回溯正则改为线性扫描函数 `stripCodeFences()`，消除多项式回溯风险；对已闭合围栏行为不变。
- **Dependabot GHSA-68fv-2mgg-jv7q（high，alert #13）**：传递依赖 `source-map-js` 经根 `package.json` 的 `overrides` 提升到 `>=1.2.2`。
- **可合并性**：ruleset `protect-default-branch` 要求 `build (ubuntu-latest, 22)` / `build (windows-latest, 22)` / `identity-guard` 三个检查；仓库级 Actions 曾处于禁用状态，导致 PR 无法满足必需检查。本次已恢复 Actions 与 CI 工作流。

证据：`npx vitest run packages/engine/src/session/topic.test.ts` → 5 passed；`npm install` → 0 vulnerabilities。