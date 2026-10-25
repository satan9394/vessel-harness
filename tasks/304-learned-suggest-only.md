# T304 — 经验库接线（suggest-only，HARNESS² P1-3）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 目标：把反思（reflection）的结论送进 `LearnedStore.suggest()`，由用户 approve 后才可能进入后续 prompt。**绝不自动采纳**。

## 0. 先读这些（只读）

1. `packages/memory/src/learned/LearnedStore.ts` — `suggest` / `approve` / `reject` 的签名与数据结构。
2. `packages/application/src/compose.ts` 约 580–640 行 — `after_turn` 与 `memory:evaluator-reflection` 两个回调，以及 `reflectionQueue` 的串行化方式。
3. `packages/memory/src/reflection/autonomousReflection.ts` — 反思产出的字段（cue / lesson / evidence 是否有等价物）。
4. `packages/application/src/compose.test.ts`（若存在）— 注入 fake store 的现有写法。

## 1. 三要素质量门

Harness² 的 `has_experience` 要求 cue / lesson / evidence 三项全非空。Vessel 落点：

- 反思结论必须能映射出 **cue**（触发场景）、**lesson**（教训）、**evidence**（证据引用：会话事件或文件路径）。
- 三者任一为空 / 空白 / 只有占位词 → **不提交**，并 `console.warn` 一条说明缺哪一项（不抛错、不阻断 turn）。
- 不做词表扫描、不审措辞、不自动 approve/reject。

## 2. 接线

在 `compose.ts` 的反思回调里（`after_turn` 与 `evaluator-reflection` 两处，找实际调用 `reflect()` 的位置）：

- 通过依赖注入拿 `LearnedStore`（可选）。**不传就完全保持现状**（零行为变化）。
- 反思结果满足三要素 → 调一次 `store.suggest(entry)`；不满足 → 跳过 + warn。
- 同一 turn 不得重复 suggest 同一条（用 cue+lesson 的哈希去重即可，无需持久化）。
- **不得**调用 `approve` / `reject`，不得把 suggest 结果注入 prompt。

## 3. 测试

新增或扩展 `packages/application/src/compose.test.ts`（若无则新建）：

1. 注入 fake `LearnedStore`，喂一条三要素齐全的反思结论 → `suggest` 被调用一次，参数含 cue/lesson/evidence。
2. 缺 evidence → `suggest` **不被调用**，`console.warn` 被调用一次（spy）。
3. 不注入 store → 行为与改动前一致（`suggest` 不存在的路径不报错）。
4. 同一 turn 重复触发 → 只 suggest 一次。

## 4. 不许做

- 不自动 approve、不把 learnings 注入 system prompt、不改 `LearnedStore` 的存储格式。
- 不改 `autonomousReflection` 的产出结构（除非为了补齐 evidence 字段，且必须保持向后兼容）。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`；不跑 `--live`。

## 5. 允许修改

```
packages/application/src/compose.ts
packages/application/src/compose.test.ts        (新增或修改)
packages/memory/src/reflection/autonomousReflection.ts   (仅在需要补 evidence 字段时)
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run packages/application/src/compose.test.ts packages/memory/src/reflection/autonomousReflection.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 7. 回报

```
三要素映射：<cue/lesson/evidence 各取自哪个字段>
接线点：<两个回调的实际位置>
去重：<键的构造>
测试：<四条用例结果>
检查：<三条命令退出码>
未做：<如实写>
```
