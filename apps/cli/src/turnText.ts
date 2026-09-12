/**
 * apps/cli/src/turnText.ts —— 「回合文本」的**跨面共用判据**（唯一实现，BRIEF：*声称共享、实际两份*）。
 *
 * 改前的事实（逐条可核；commit `dfe55b9` 的提交信息称 "the two faces share one criterion"，
 * 与代码不符）：
 *  - `cli.ts` 自带一份 `isModelReplyKind(kind)`（判据 = "只有 `success` 算模型回答"）
 *    —— `renderTurnFinalText` 用它决定 mock 标记（`（mock 离线冒烟）`）盖不盖；
 *  - `tui/chat.ts` 的 `renderTurnOutcome` **自己**在 `case 'success'` 里调 `renderTurnReply`
 *    —— 那是**第二份**判据（第二份实现，不是"调用同一份"）；
 *  - 而 `cli.ts` 里那段注释**自己承认**「（乙）本卡**未采用** …… 一处口径、两个面共用」——
 *    即：**当时并没有共用**。
 *
 * 为什么这不是"两处都对、只是重复"，而是**必然会分叉**：
 *  - TUI 的 `switch` 是**穷尽**的 —— 新增第五种 kind ⇒ 编译报错（逼实现者回答"新 kind 怎么呈现"）；
 *  - CLI 那份把入参与字面量 `'success'` 直接比对 —— 对第五种 kind **静默返回 false**
 *    （不报错、不提示，直接按"不是模型回答"走下去）。
 *  同一个新 kind，两个面一个编译期报错、一个静默走另一边 ⇒ 下一个人按"改一处即两处生效"
 *  去改动时，只会改到一处。
 *
 * 本模块把判据收敛成**一份**：`cli.ts` 与 `tui/chat.ts` **各自 import 同一份实现**
 * （`cli.ts` 另做 re-export，只为保持既有导出面 `cli.isModelReplyKind`）。
 *
 * **零 import**（本文件不依赖任何模块）是刻意的，也是本模块能存在的理由：
 * `tui/chat.ts` 反向 `import '../cli.js'` 会**成环**（`cli.ts` 已经 `import { runChat } from
 * './tui/chat.js'`，ESM 下表现为 TDZ/undefined）——那正是此前"在 TUI 里再内联一份"的理由。
 * 把共用物放进一个**谁都不依赖**的叶子模块，成环理由就不成立了：两个面都只依赖它。
 * 以后再有同类"两处必须逐字一致"的逻辑（标记文案、`windowsShimHint`……），可以照此办理。
 *
 * 本模块**只放判据**（kind → 是不是模型回答）。`MOCK_REPLY_MARK` / `TUI_MOCK_REPLY_MARK`
 * 与两面的渲染函数等仍是两份实现，见交付说明⑤（只报告，本卡不动）。
 */

/**
 * 回合 kind —— 与 `AgentLoop` 的 `TurnResult['kind']` **同形**（四个取值）。
 *
 * 就地声明而不 `import type { TurnResult } from '@vessel/core'`：apps/cli 不新增依赖边
 * （既有约定，`TurnOutcomeLike` / `UsageTotalsLike` 同法），且本模块要求零 import。
 *
 * 本卡之前，这个联合在 `cli.ts`（`CliTurnKind`）与 `tui/chat.ts`（`TurnOutcomeLike['kind']`）
 * **各写一份字面量**；现在两处都别名到本类型（`CliTurnKind = TurnKind`、
 * `TurnOutcomeLike['kind'] = TurnKind`），新增/删除取值只需改这一处。
 */
export type TurnKind = 'success' | 'error' | 'interrupted' | 'budget';

/**
 * 「这条回合文本是不是**模型回答**」—— CLI 与 TUI 共用的**唯一**判据。
 *
 * 四个 kind 里只有 `success` 是模型说了话；其余三种的 `finalText` 都是 **harness 自己的状态
 * 文案**或空串（`AgentLoop`：熔断 `DenialLimitError` / `BeforeTurn` 拒绝 ⇒ `error`；
 * 步数预算耗尽 ⇒ `budget`；被叫停 ⇒ `interrupted`）。
 *
 * 因此标记 `（mock 离线冒烟）`（语义 = "这条回复来自内置 mock 模型"）只盖 `success`：
 * 给状态文案盖模型标记，是另一种"说的和做的不一致"。
 *
 * 消费点（**改这一处即两个面同时变**；判别性用例见两面的「本卡」块）：
 *  - `cli.ts` 的 `renderTurnFinalText`（`cmdRun` 的**唯一**渲染出口）；
 *  - `tui/chat.ts` 的 `renderTurnOutcome`（TUI 的**唯一**呈现出口，模型回复出口
 *    `renderTurnReply` 现在也以此判据为前置闸门）。
 *
 * 负对照（**不得**放宽）：真实 provider（`usingMock=false`）下两个面都**逐字**返回原串；
 * `success` + mock 仍**必须**带标记（那是标记的正当用途）。
 */
export function isModelReplyKind(kind: TurnKind): boolean {
  return kind === 'success';
}
