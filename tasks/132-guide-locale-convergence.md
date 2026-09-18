# 132 — guide 命令的 locale 解析收敛为唯一实现（并修 cmdGuide 的损坏设置崩溃）

- 编号：132
- 状态：已合入（2026-09-18）
- 优先级：P2（PRODUCT-STATE Round 122 点名的同族「两份实现且无测试绑定」；且是"声明与实现不符"）
- 创建日期：2026-09-18
- 关联：`apps/cli/src/guide/settings.ts` 的 `loadLocaleOrDefault` 注释（声称"两处都调本函数"）、`tasks/130/131`（同族收敛）
- 执行器：指挥侧

## 1. 缺陷：同一句声明，两种行为（且注释谎称已统一）

`guideCommands.ts` 里 `cmdExplain` 与 `cmdGuide` **各写一份** locale 解析，优先级相同但**回退不同**：

| 命令 | 缺省分支 | 设置损坏（JSON 坏/值非法）时 |
|---|---|---|
| `cmdExplain` | `loadLocaleOrDefault(settingsStoreFor(opts))` | 回退 `'zh'`（不抛） |
| `cmdGuide` | `settingsStoreFor(opts).load().locale` | **抛错**（`SettingsStore.load()` fail loud） |

而 `settings.ts:168-171` 的注释明确写"TUI 的 `resolveChatLocale` 与 guide 命令（`cmdGuide`/`cmdExplain`）
此前**各写一份**……现在两处都调本函数" —— 与实现不符（`cmdGuide` 并未调）。于是：
**同一句"locale 缺省跟随 settings"，`vessel explain` 在损坏设置下给 zh，`vessel guide` 却崩。**
两份实现无测试绑定（改前没有任何用例在它们分叉时变红）。

## 2. 修复

`guideCommands.ts` 新增 **`resolveGuideLocale(flags, opts)`**（唯一实现）：
`--locale` 显式（非法值 ⇒ 报错 + 返回 `{ok:false}`）> `loadLocaleOrDefault(settingsStoreFor(opts))`。
`cmdExplain` 与 `cmdGuide` 都改调它，`--locale` 校验与回退口径只剩一份。

## 3. 验收与实测

- 新增回归用例（`guide.test.ts`）：
  - **行为**：`settings.json` 损坏时 `cmdGuide` 与 `cmdExplain` **都 exit 0 且回退 zh**（改前 `cmdGuide` 抛错 ⇒ 本用例红）；
  - **静态守卫**：`guideCommands.ts` 有 `resolveGuideLocale` 且被两处调用、**不再出现直读 settings locale 的写法**（改回内联 ⇒ 红）。
- 既有 guide/explain/settings 用例（含"损坏 ⇒ `store.load()` fail loud"）全部照旧通过。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **176 文件 / 2232 passed + 6 skipped** + web **11/120**、CI 两腿绿。

## 4. 边界（未做，如实）

- `SettingsStore.load()` 本身**保持 fail loud**（那是被 `settings list/set` 依赖的契约）；只有**展示路径**（guide/explain/TUI）回退 zh。
- TUI 的 `resolveChatLocale` 未改（它已正确走 `loadLocaleOrDefault`，且无 `--locale` flag，差异是有意的）。
- 同族剩余：mock 冒烟脚本 CLI/TUI 分叉、`PUBLISH_ARTIFACT_CRITERION` 等（PRODUCT-STATE Round 122/124）。
