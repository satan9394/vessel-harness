# External Review —— 外部评审 Handoff 流程（task 059）

> 实现卡：`tasks/059-external-review-handoff.md`；权威需求：
> `docs/Vessel_后续开发方向与产品化路线_v1.0.md` §9（L1082-1138：External Review Adapter
> **不是** ChatProvider —— AGY/Gemini 走 **artifact 交换**而非 API provider）。
> 前置：058（Internal Reviewer：`agents/src/reviewer` conclusion.ts 结论协议 +
> InternalReviewer 独立评审调用）。代码位置：
> - `packages/application/src/review/`（ExternalReviewHandoff.ts 载荷类型 /
>   ReviewHandoffStore.ts 目录存储 + handoff.md 渲染 + 结果导入）——存储层与既有
>   SessionRegistry/ProjectRegistry 同居 application；
> - `apps/cli/src/review/reviewCommands.ts` —— `vessel review <handoff|import|list>` seam。

## 1. 一句话

External Review Handoff：把待外部评审的任务打包成 **handoff artifact**
（`.vessel/reviews/<review-id>/handoff.md`，§9.1 八个 section）+ 结构化元数据
（`meta.json`：id/状态/时间戳/来源），交给用户在 AGY/Gemini 等外部工具跑评审；
跑完把结果**粘贴/导入**回本记录落库。外部结果经 058 同一解析器解析，与内部评审
结论**同型**（`verdict met/not_met/impossible/error + reason + unmet + suggestions +
evidence`），仅按结果条目 `source`（external / internal）区分来源。

## 2. 关键设计（059）

| 决策 | 选择 | 理由 |
|---|---|---|
| 是否当 ChatProvider | **不是**。无 Local CLI Adapter shell hack（§9.2 Wave 3 再说） | artifact 交换 + 人工粘贴/导入，稳定可靠 |
| handoff 落点 | `<reviewsRoot>/<review-id>/handoff.md`，缺省 `~/.vessel/reviews`（env `VESSEL_REVIEWS_ROOT` 可覆盖；测试注入 tmp） | 走既有用户级 `~/.vessel` 约定（session/registry 同款），UI Open Folder 路径清晰 |
| review-id | `review_<ts>_<hex>`（沿用 `sess_`/`team_`/`sub_`/`del_` 同款约定） | 与既有 id 风格一致、唯一 |
| 目录内容 | `handoff.md`（八 section artifact）+ `meta.json`（完整记录：载荷快照 + results[]） | md 供复制发送；meta 供 UI/CLI 读取与回读 |
| 结果导入 | 文本经 `agents` `parseReviewConclusion` 解析（与 058 同一解析器，绝不漂移）；解析失败 = verdict 'error'（如实暴露，不误判 met） | 058 Generator/Evaluator 分离 + 结论协议单点 |
| 来源区分 | 记录级 `source:'external'`（handoff 面向外部评审）+ `results[].source: 'external'\|'internal'` | 外部粘贴结果与 058 内部结论可并存、可按来源区分 |

## 3. §9.1 handoff.md 八个 section

渲染自记录（`renderHandoffMarkdown`；空字段给占位说明，八节结构永不塌）：

1. **Task** —— 任务目标
2. **Acceptance Criteria** —— 验收标准（逐条，评审判据来源）
3. **Changed Files** —— 改动文件
4. **Diff Summary** —— diff 摘要（通常来自 git diff --stat / 任务卡）
5. **Test Results** —— 测试结果摘要
6. **Architecture Constraints** —— 架构约束（分层/依赖/删除铁律等）
7. **Review Checklist** —— 检查清单（缺省 = `defaultReviewChecklist()`，可显式覆盖）
8. **Required Output Schema** —— `REVIEW_OUTPUT_SCHEMA`（058 结论 schema，要求外部
   评审者按此行 JSON 回复 → 导入即可同型解析）

## 4. 存储布局（application/src/review/ReviewHandoffStore.ts）

```text
<reviewsRoot>/
  <review-id>/            # 一条外部评审 = 一个目录（UI Open Folder 打开它）
    handoff.md            # §9.1 八 section artifact
    meta.json             # 结构化记录：id/status/createdAt/updatedAt/source +
                          #   task/acceptance/changedFiles/diffSummary/testResults/
                          #   constraints/checklist/outputSchema + results[]
```

- `createHandoff(input)` → 生成记录（status `pending`）+ 落盘两个文件；task 为空 fail loud；
- `get(id)` / `list()`（createdAt 倒序）—— registry 同款读 meta.json，损坏目录跳过；
- `importResult(id, { source?, text? | conclusion? })` → 解析/结构化结论追加进
  `results[]`，status → `imported`，updatedAt 刷新；未知 id fail loud；
- IO 同步（SessionRegistry/ProviderStore 同风格），meta.json 写走 tmp+rename 原子替换
  （task 113 起 rename 统一走 `@vessel/shared` 的 `renameWithRetry`，EPERM/EBUSY/EACCES 有界重试）。

## 5. CLI seam（apps/cli/src/review/reviewCommands.ts）

```text
vessel review handoff <request.json> [--root <dir>] [--workspace <dir>]
    # request.json: { task, acceptance?, changedFiles?, diffSummary?, testResults?,
    #                 constraints?, checklist? }  → 打印 review id + handoff.md 路径
vessel review import <review-id> <result 文件> [--source external|internal] [--root <dir>]
    # result 文件 = 外部评审者粘贴的回复（叙述 + 一行 review JSON 均可）
vessel review list [--root <dir>]
```

- 交互例子（用户级 root）：

```text
vessel review handoff 059-request.json
# [vessel review] handoff 已生成: review_1757..._a1b2c3d4
#   handoff.md: C:\Users\xxx\.vessel\reviews\review_...\handoff.md
# 复制 handoff.md 内容 → 在 AGY/Gemini 里请其按 Required Output Schema 评审
vessel review import review_..._a1b2c3d4 result.txt
# [vessel review] 结果已导入: review_...  source: external  verdict: not_met
```

- root 解析优先级：`--root` > env `VESSEL_REVIEWS_ROOT` > `~/.vessel/reviews`。

## 6. 结果导入与 058 结论同型（单一事实源）

导入解析委托 `agents/src/reviewer/conclusion.ts` 的 `parseReviewConclusion`（它委托
`evaluator/EvaluatorAgent.parseVerdict` —— 058 唯一实现）：外部模型输出前后可有叙述，
只要含一行合法 review JSON 即可解析；解析失败 → `verdict:'error'` 结论照常落库
（原始文本保留在 `raw`，可回读）。`unmet`/`suggestions`（not_met 时）即外部评审
回传给生成侧的反馈 —— 与内部 058 结论语义完全一致，仅供 source 字段区分出处。

## 7. 范围边界（059 不做）

- UI（Copy Handoff / Open Folder / Import Result 按钮）→ 060；
- Local CLI Adapter 自动调 AGY/Gemini（§9.2）→ Wave 3；
- 自动重试（not_met → 反馈 → 再产出）→ Wave 3（061-062）。
