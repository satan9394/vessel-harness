# T307 — 候选匿名选优（HARNESS² P1-2 的算法层）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 目标：先只做**纯算法 + 类型**，回答「同一任务的多个候选，哪个更好、为什么」。**不接运行入口**（跑 N 份的入口成本另计）。

## 0. 先读这些（只读）

1. `packages/engine/src/selection.ts` — 注意：这是 `selectTaskFor`（任务→类别→preset 路由），**与候选选优无关**。新文件必须叫别的名字，避免同名不同义。
2. `packages/engine/src/index.ts` — 导出面与命名风格。
3. `packages/engine/src/real-generator-adapter.ts` — `GeneratorRunRecord` 里"产物"的表示（output / artifactPaths）。
4. `packages/engine/src/real-evaluator-adapter.ts` — `EvaluatorRunRecord.conclusion` 的 verdict 取值。
5. `docs/DESIGN-DECISIONS.md` 里关于 Generator/Evaluator 分离的条目 — 选优不得由 Generator 自证。

## 1. 新增 `packages/engine/src/candidate-selection.ts`

```ts
export interface CandidateInput {
  id: string;                  // 稳定 id（如 run id）
  output?: string;             // final text
  artifactPaths?: string[];    // 产物路径（可为空数组）
}

export interface CandidateReview {
  candidateId: string;
  verdict: 'met' | 'not_met' | 'impossible';
  reason: string;
}

export interface SelectionResult {
  chosen: string | null;                          // candidate id；无可选时 null
  why: string;                                    // 人类可读理由，含计数
  discarded: Array<{ id: string; reason: string }>;
  /** 匿名别名与实际 id 的映射（审计用；顺序 = 评审时看到的顺序） */
  aliases: Array<{ alias: string; candidateId: string }>;
}

/** 稳定匿名化：别名只由 seed + id 决定，同一输入永远同一别名。 */
export function anonymizeCandidates(candidates: CandidateInput[], seed: string): Array<{ alias: string; candidate: CandidateInput }>;

export function selectCandidate(input: {
  candidates: CandidateInput[];
  reviews: CandidateReview[];
  seed: string;
}): SelectionResult;
```

规则（写死，不要自选）：

1. **先丢弃无产物**：`output` 为空白 **且** `artifactPaths` 为空 → 进 `discarded`，原因 `no artifact`。
2. **匿名化**：`alias = sha256(seed + '\0' + id)` 取前 6 位 hex；按 `alias` 字典序排序（与输入顺序无关）。
3. **基线不进池**：若某个候选被标为基线（本卡没有显式基线字段，所以不实现——在注释里写明"基线概念留给调用方，通过不传该候选实现"）。
4. **选优**：只统计 `met` 的票数（`not_met` / `impossible` 计 0，但写进 why）；票数最高者胜；平票按 `alias` 字典序取最小（确定性）。
5. **没有任何候选有 `met`** → `chosen: null`，`why` 说明「0 met votes across n candidate(s)」。
6. 未知 `candidateId` 的 review 忽略（不抛错），在 `why` 里注明忽略条数。
7. 纯函数：不读文件、不读环境变量、不打印。

## 2. 文档

`docs/ARCHITECTURE.md` 或 `docs/V1.0-CHECKPOINT.md` 的 engine 段落里加 3–5 行，说明该模块的存在与边界（纯算法、未接运行入口、不得由 Generator 自证）。**不要**写成"已支持多候选自动选优"。

## 3. 测试（新增 `packages/engine/src/candidate-selection.test.ts`）

1. 三个候选（两个有产物、一个空的）→ 空的那个进 `discarded`；别名稳定（同 seed 两次调用一致）。
2. 两个有 `met` 票、一个 0 票 → 选 met 票高者；平票时选 alias 字典序小的，重复跑结果一致。
3. 全部 `not_met` → `chosen: null`，`why` 含 `0 met`。
4. review 里有未知名 id → 被忽略且计入 why，不抛。
5. 输入顺序打乱 → `aliases` 顺序不变（证明按 alias 排序，不按输入序）。

## 4. 不许做

- 不接 `LoopEngine` / evaluator / runner / CLI（本卡无调用方）。
- 不复制 `selection.ts` 的命名或语义。
- 不做提示词模板、不做正则解析模型输出的兜底。
- 不 commit / push / 删文件；不加依赖；不动 `packages/core`。

## 5. 允许修改

```
packages/engine/src/candidate-selection.ts         (新增)
packages/engine/src/candidate-selection.test.ts    (新增)
packages/engine/src/index.ts
docs/ARCHITECTURE.md 或 docs/V1.0-CHECKPOINT.md    (二选一，加 3-5 行)
```

## 6. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run packages/engine/src/candidate-selection.test.ts packages/engine/src/selection.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 7. 回报

```
别名：<sha256 输入的构造 + 长度>
丢弃：<规则>
平票：<为何确定>
测试：<五条结果>
检查：<三条命令退出码 + selection.test.ts 是否仍绿>
未做：<如实写"未接运行入口">
```
