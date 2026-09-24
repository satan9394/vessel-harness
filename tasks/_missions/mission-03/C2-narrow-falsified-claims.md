# C2 三处被证伪断言的收窄 + costEstimate 措辞更正

> **说明**：本卡当时以"指令 + 工作区卡面未落盘"的形式下发执行；此处为**事后补记的卡面与验收结论**（内容与当时指令一致），以免 Workset 里出现无档可查的卡。

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：P0
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：**blocker**（独立对抗验收 FAIL 的三处依据）

## 目标
把三处被反例证伪的断言改为"条件 + 显式反例与机制"的如实表述；`costEstimate` 措辞降为实质成立的弱化版。**不得为了让测试变绿而放宽/删除既有断言**。

## 验收结论（Evaluator / 指挥会话回填）
- **PASS** → 自动合入
- 指挥侧独立复验：
  - `git status --short` 仍 **8 项**、暂存区 0、HEAD `ba173d4` 未动
  - **numstat 只增不删**：`Telemetry.ts` 90/12 → **122/12**；`telemetry.test.ts` 151/6 → **166/6**（删除数不变 ⇒ 无既有断言被删）；`packages/shared/src/unwiredRecords.test.ts` **一字未动**（仍 5/1）
  - 无条件旧表述 grep：`有记录就必有等式` **0**、`事件数逐字相等` **0**、`本仓无任何 provider 上报` **0**；`记录条数 = 回合数` 1 命中但**同行即带条件**（实读确认）
  - 抽读 `Telemetry.ts` 收窄段：条件总述 + 每条的反例与机制（`AgentLoop.ts:136` 单实例 state / `State.ts:20-26` 归零 / `SessionController.ts:159-167` 承认 abort 旧回合 / `AgentLoop.ts:462-463` throw ⇒ `:528` 不可达）+ "改这里的人**不得**把条件去掉"
  - 唯一 1 次定向 `npx vitest run packages/telemetry` → **2 files / 25 tests passed / exit 0**
  - 仓库外补丁未被改动：`turn-end-slice.patch` = `AA7ABC38925DD52F…`
- 未做（按卡留待后续）：两条反例的**判别性用例与突变实测**（C4/C5）；`docs/ARCHITECTURE.md:176` 的规格级不变式（已由 C3 承接）
- 执行器：子代理 38bc7132