# T331 — 把「模型/档位选型」固化进项目规则（不再每次问用户）

- Status: 已完成（2026-10-26）
- PDW task: none（协调者文档动作）

## 背景

用户多次要求「按官方文档选模型与思考深度」，并指出 PDW 技能里其实已有选型来源与链接。
核对结果：`.agents/skills/personal-dev-workflow/references/runtime.md` 第 92/98/102 行确实有
档位词表、effort 非采用证明、以及四条官方链接；**缺的是「任务性质 → 模型 ID → 档位」的映射表**。

## 决策：写进 AGENTS.md，不fork技能

- 技能目录是上游 `satan9394/personal-dev-workflow` 的逐字节下游副本，`update.mjs` 会覆盖；
  项目内分叉改不动，且违反「9 个技能文件永不在项目内分叉」。
- 映射表属于**项目级使用口径**，按「单一最佳位置」放 `AGENTS.md` 的 PDW 模型路由段。

## 落地内容（AGENTS.md）

1. `### 模型与档位选型表（派活前必须查，不等用户提醒）`：六行映射（Luna low / Terra low-medium /
   Sol medium / Sol xhigh / Astra medium / Sol ultra），每行带官方原文关键词。
2. 四条执行细则：新模型先 `codex exec -m <id> "print OK"` 探测；每条派活记录「模型+档位+依据」；
   升级阶梯 medium → xhigh → Astra 且必须有失败证据；Fast 默认关、开关都记卡。
3. 四条官方来源链接（模型选择、Sol 提示指导、减少过度提示、Codex 运行配置）。

## 未做（如实）

- **没有改 PDW 技能正文**：那属于上游仓库变更，需要走 `satan9394/personal-dev-workflow`；
  若要固化成「运行器自动建议档位」，是上游功能，不是本项目能改的。
- `~/.agents_four_skills/personal-dev-workflow` 镜像同样未动（它是技能的另一份副本）。

## Result

`AGENTS.md` 已增选型表与四条细则；本次提交后，后续派活一律先对照该表并在卡里记录依据。
