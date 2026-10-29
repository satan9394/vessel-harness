# 任务卡 365: 团队抽屉展开的第二轮打磨（文案进 i18n / 收起控件可达）

- Status: 已验收（2026-10-29）：5 条文案进 `i18n.ts` 类型化字典（zh/en 各 5 键，既有键值未动）；展开/收起控件移到正文之上，570 与 4800 字展开后仍停在视口内（top 458.13 / bottom 490.12，innerHeight 900）；顺带修掉「加载中禁用按钮把焦点丢给 body」
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

## 执行交证（2026-10-29，Codex 主线程；待协调者验收）

- A1–A6 自验通过；报告与原始证据：`evidence/sessions/2026-10-30-drawer-polish/report.md`。目录日期沿用交接单要求。
- 仅改允许的三个源码/测试文件；5 个类型化 i18n 键，两种语言各新增五值，既有键值逐项与 HEAD 对比保持不变；控件移到正文上方，未加 CSS/内层滚动。初次加载禁用按钮造成的原生焦点丢失已在现有有状态抽屉中修复，并覆盖用户主动移焦不被抢回。
- 最后源码编辑后：web **61 文件 / 543 passed**，web tsc **exit 0**，生产构建 **exit 0**。原五项回归断言保留，新增真实 LanguageProvider 切换、精确双语原文断言和焦点测试。中途两条旧测试失败及修复见报告和 `web-tests-focus-repair-failed.json`。
- 可见 IAB 1440×900 深色：570 / 4800 字各自展开后按钮 **top 458.1313 / bottom 490.1242 / innerHeight 900**；收起均为 **301**，再次展开均走缓存（每样本 **1 GET**），首次异步展开与往返后 activeElement 均为该按钮；Console **[]**。截图与 `browser.json` 已落盘。
- 收尾：5700/5701 **监听数 0**，两轮夹具进程 **0 存活**，IAB 已关、视口已复原。未跑全量门禁、未提交/推送、未调用其它 Agent CLI/子代理。卡首部状态、既有内容及 README 未改；交由协调者收口。
- 源码 SHA-256：drawer `9ab34bdb3f6f2d1f29b51047d036df9f8d229b03542e21a6b78f1e1ebbb253c8`；test `0069161c3d55195103c622023bf1cfdc887128b136e5114cbbdde39188966d55`；i18n `44aaa551b4aef10dd08e48e75fd262d9fd52001e1aae0f51bf5fc64de9314d1c`。完整范围与构建哈希见 `scope-audit.json`。

## 协调者验收（2026-10-29）

采信，A1–A6 逐条自己复核过一遍：

- **A1**：`apps/web/src` 递归搜 `outputCopy` **0 命中**；5 个键在 `i18n.ts` 里各有一处声明、`zh`/`en` 各一处取值，抽屉只经 `t()` 取文案。
- **A2**：`i18n.ts` 的 diff 是 **15 行新增、0 行删除**，即只加键不动既有值；新增的参数化用例把 10 条字符串（含 `…` 与全角句号）逐字断言，我对照派单原文核过，一字不差。`i18n.test.ts` 的键集一致/非空断言仍在 543 里跑过。
- **A3**：卡 364 的 5 项断言原样保留（298/300 无控件、570 往返与缓存、失败保留摘要、超限提示）；新增用**真实** `LanguageProvider` 的切换用例（en → zh 同任务、展开长度不变、按钮是同一 DOM 节点），焦点两条分支（用户没动 / 用户主动移焦）都有。
- **A4**：我自己看了 `570-expanded.jpg` 与 `4800-expanded.jpg`——「收起」在正文之上、位于 458–490px，视口 900，文字全部在按钮下方；`browser.json` 的 8 个状态（两个样本 × 展开/收起/缓存展开/再收起）top/bottom 与 innerHeight 同值，`activeElement` 都是该按钮，`pre` 的 `max-height: none`、`overflow-y: visible`（没有内层滚动），每个样本 **1 次 GET**，Console `[]`。
- **A5**：我自己跑 `--root apps/web` **61 文件 / 543 passed**、web tsc **exit 0**、`tsc -b` 与 `tsconfig.test.json` 也 exit 0；全量门禁 **17/17 exit 0**（根 335 文件 / 3,713 passed + 8 skipped，web 61 / 543，conformance 25/25 $0，日志 `%TEMP%/vessel-gate-f9f7716f`）。
- **A6**：改动只有三个文件 + 卡末尾追加，只读端点、`getStage()` 截断、后端与 CLI 一行未动（`git status` 可核）。

**这轮最值得记的一件事**：派单里「展开/收起后焦点不得丢失」这条逼出了一个真缺陷——首次展开时按钮 `disabled`，原生焦点会掉到 `body`。他们的第一版把修复 hook 塞进了无状态的 `TeamNodeDetails`，结果撞坏 `TeamDagCanvas.test.tsx` 里两条**直接调用该展示组件**的测试（2 failed 记录在 `web-tests-focus-repair-failed.json`）；随后把焦点生命周期移回已有的有状态抽屉，没有改那两条测试来凑绿。这个处理我认——失败日志保留、修法没有绕过判据。

**一处不阻塞的小瑕疵**：`browser-focus-repair.json` 的 `measurements` 是空数组（那次中间态只留了 requests/console），焦点结论靠 `browser.json` 的最终态与新增单测支撑，不影响结论，但中间态没有可量测快照。下一轮若要复查焦点，直接看 `browser.json` 的 `activeElement` 字段。

`apps/web/dist` 是执行方在最后一次源码编辑后用 `npm run -w @vessel/web build` 重建的（`scope-audit.json` 记了入口资产哈希），我这边没有再改源码，dist 与源码一致。
