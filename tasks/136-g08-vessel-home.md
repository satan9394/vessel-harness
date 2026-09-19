# 136 — G-08 轻量收敛：`vesselHome()` 状态根唯一实现

- 编号：136
- 状态：已合入（2026-09-18）
- 优先级：P3（字面重复，无行为影响；按产品口径"只做轻量等价收敛，不批量重构"）
- 创建日期：2026-09-18
- 关联：`docs/product-evolution/PRODUCT-GAP-MAP.md` G-08、`tasks/124`（`VESSEL_*_ROOT` 空串语义已收敛到 `envRoot`）
- 执行器：指挥侧

## 1. 缺口

`path.join(home, '.vessel')` 这个字面在 `apps/cli`（migrate / mcp / providers / usage）与
`packages/{application,engine,memory}` 被复制约 **11 处**。关键语义（`VESSEL_*_ROOT` 空/纯空白 ⇒ 未设置）
早已收敛到 `envRoot` 唯一实现；剩下的是"缺省用户级根长什么样"散落多处，改口径时容易漏改。

## 2. 修复（不改任何解析语义）

- `packages/shared/src/vesselHome.ts`（新）：`export function vesselHome(home = os.homedir()): string`，返回 `path.join(home, '.vessel')`。经 `@vessel/shared` 导出。
- `apps/cli/src/envRoot.ts`（本地 re-export 垫片）同时再导出 `vesselHome`，CLI 侧沿用既有 `../envRoot.js` 导入风格。
- 逐处替换（**仅替换字面量**，`envRoot(...) ??` 与目录后缀逐字不变）：
  - `apps/cli/src/{migrate.ts, mcp/config.ts, providers/ProviderStore.ts, usage/UsageStore.ts}`
  - `packages/application/src/{credential/CredentialStore.ts, review/ReviewHandoffStore.ts, session/SessionRegistry.ts}`
  - `packages/engine/src/{iteration-store.ts, project-task-queue.ts, handoff/HandoffStore.ts}`
  - `packages/memory/src/persistent/ScopedMemoryStore.ts`

## 3. 验收与实测

- 新增 `packages/shared/src/vesselHome.test.ts`（2 例）：
  - **等价性**：`vesselHome()` === `path.join(os.homedir(), '.vessel')`；带参（POSIX/Windows 形态）逐字相同；
  - **静态守卫**：字面量 `path.join(home, '.vessel')` 在全部非测试 `.ts`（排除 `node_modules`/`dist`/`.git`/`.harness`）里**只出现在 `vesselHome.ts`**（防再次复制）。
- 既有各 store 的默认根断言（如 `ProviderStore.test.ts` 的 "default root is ~/.vessel"）在全量里照旧通过 ⇒ 行为等价。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **178 文件 / 2236 passed + 6 skipped** + web **11/120**、web `vite build` exit 0、CLI 冒烟 exit 0、CI 两腿绿。

## 4. 边界

- **不**做"单一 resolveStateRoots 工具 + migrate 清单动态化"的批量重构（那属独立卡；本次只消字面重复）。
- `migrate` 的 `KNOWN_STATE_ENTRIES` 硬编码清单未动（另一档规模）。
