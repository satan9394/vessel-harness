# T328 — Web：Provider Hub 里的 profile 列表与一键启用

- Status: 已完成（2026-10-26；Web 段由 L1 执行）
- 依赖：T325（四条 API）

> 只在 Provider Hub 里加「profile 列表 + 启用」，不造第二套供应商/模型解析，不动既有卡片行为。

## 1. 要做的

1. `apps/web/src/api.ts` 增四个方法（与既有 request 封装同风格）：
   `listProfiles()`、`saveProfile(input)`、`useProfile(name)`、`deleteProfile(name)`。
2. `apps/web/src/components/providers/ProviderSettingsModal.tsx`：
   - 在现有供应商列表下方加一个 **Profiles** 区块：列出 `name / provider / model / baseUrl`；
   - 每行一个「启用」按钮 → `useProfile(name)` → 成功后刷新 provider 列表与 usage，并给一行成功提示；
   - 空列表显示 `—` 级占位文案（不显示 0），失败只影响该区块（不整页报错）。
3. `apps/web/src/i18n.ts` 中英都加文案，英文不得含 CJK。

## 2. 不许做

- 不在 Web 里重算模型/端点；不新增状态管理库；不改 `/api/providers/usage` 形状。
- 不加 profile 的创建/编辑表单（本卡只读 + 启用；创建走 CLI 或 API）。
- 不动 `packages/core`；不 commit。

## 3. 允许修改

```
apps/web/src/api.ts
apps/web/src/components/providers/ProviderSettingsModal.tsx
apps/web/src/components/providers/ProviderSettingsModal.test.tsx
apps/web/src/i18n.ts
```

## 4. 验收

```powershell
node node_modules/vitest/vitest.mjs run --root apps/web src/components/providers/ProviderSettingsModal.test.tsx
node node_modules/vitest/vitest.mjs run --root apps/web
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

测试覆盖：有 profile 时渲染行、点启用调用 `useProfile` 并刷新、空列表占位、接口失败不炸整块、
英文文案无 CJK。

## Result

Profiles 区块（列表 + 一键启用 + 空态 + 失败隔离）与用量增强（最近调用 / Top3 / 口径 / 搜索 / 未配置密钥）均通过；web 58 文件 519 用例。
