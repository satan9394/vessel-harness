# 任务卡 365: 团队抽屉展开的第二轮打磨（文案进 i18n / 收起控件可达）

- Status: 待执行（2026-10-29 由卡 364 的协调者验收发现的两处非阻塞偏离）
- PDW task: none
- 来源：卡 364 的「协调者验收（2026-10-29，closeout T2）」段末两条；当时判定「不阻塞、留给下一轮 UI 批次」，本轮即这一批。

## 1. 现象与根因

1. **文案绕开了全仓唯一的 i18n 字典。** 新增的 5 条文案（展开 / 收起 / 加载中 / 加载失败 / 超限提示）写成 `apps/web/src/components/team/TeamNodeDrawer.tsx` 里的 `outputCopy` 字面量，靠 `lang === 'zh'` 三元取用。而 `apps/web/src/i18n.ts` 是带类型接口（`Messages extends …`）、按功能分组、`zh`/`en` 同键同义的字典，`i18n.test.ts` 还会断言两侧键集一致且非空；`apps/web/src/components/team/` 下没有第二处内联双语。后果：新键不进键集校验、翻译者看不到、语言切换路径与其他组件不同。
2. **收起控件会被正文挤到视口外。** `TeamNodeDetails` 把「展开全文 / 收起」按钮排在 `<pre>` **之后**。570 字展开时按钮已经在首屏之外，需要滚动才能收起；更长的输出（端点上限 64 KiB）会更糟——唯一的回退控件正好被推走。

## 2. Goal

1. 5 条文案搬进 `apps/web/src/i18n.ts` 的类型化字典（`zh` 与 `en` 各一份，键名同义），抽屉改用 `t(key)`。**可见文案逐字不变**（沿用卡 364 已定的中文串，英文串同样照抄），不新增第二份字典、不改既有键的取值。
2. 展开/收起控件在**收起与展开两种状态下位置一致**，且不位于长正文之后——展开长输出后不需要滚动就能收起。
3. 优先**不**给 `<pre>` 增加内层滚动容器（`max-height + overflow`）：抽屉本身就在页面滚动流里，再套一层会产生双滚动条。若实测证明另有更稳的做法，先写清理由再改。

## 3. Acceptance

- A1 `outputCopy` 在 `apps/web/src` 内不再存在（全仓 grep 无命中）；5 条文案只出现在 `i18n.ts`。
- A2 `apps/web/src/i18n.test.ts` 通过（zh/en 键集一致、值非空），且新增 5 个键在两侧都取得到值；中文串与卡 364 的原文逐字一致（在所引用测试里能看到断言，不是口头声明）。
- A3 抽屉组件测试：原有 5 项断言不回归（298/300 无控件、570 展开/收起/cache、失败保留摘要、超限提示）；新增一条**语言切换**用例——同一任务在 `en` 下按钮文案为英文、在 `zh` 下为中文，且展开后长度不变。
- A4 可见 IAB 实测两张（1440×900，深色）：570 字样本与一条 ≥4000 字样本各一，**展开后「收起」按钮仍在视口内**（贴 `getBoundingClientRect()` 的 top/bottom 与 `innerHeight`），并给收起后回到 301 的长度；Console 无错误。
- A5 `node node_modules/vitest/vitest.mjs run --root apps/web` exit 0（基线 61 文件 / 535 passed 起）、`node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` exit 0。**不跑全量门禁**（协调者收口时跑）。
- A6 卡 364 的既有行为不变：只读端点与 `getStage()` 的 300 字截断一行不动；298/300 不出现控件；展开只发一次 GET、收起再展开走缓存。以 A3 的回归用例为准。

## 4. Blast Radius

- `apps/web/src/components/team/TeamNodeDrawer.tsx`
- `apps/web/src/components/team/TeamNodeDrawer.test.tsx`
- `apps/web/src/i18n.ts`（只新增键，不改既有键与分组结构）
- 若确需样式：`apps/web/src/styles.css` 内 `.team-node-drawer` 作用域的新规则

禁止碰：`packages/**`、`apps/local-server/**`、`apps/cli/**`、`i18n.ts` 里已有键的取值、卡 364 新增的只读端点与其测试、`TeamRuntime.getStage()`。

## 5. Result

待执行。
