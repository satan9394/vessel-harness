# 116 — 参考 OpenCode/Codex/Claude Code 系统提示词，审计并增强 behavior 层

- 编号：116
- 状态：待执行
- 优先级：P1（用户授权方向：参考开源 Agent 的系统提示词工程，优化我们的行为层）
- 创建日期：2026-09-10
- 关联：configs/behavior.default.yaml（D4 行为 IR：prompt_guidance + runtime_policy 双通道）；
      packages/behavior/（Compiler/BehaviorIR）；AGENTS.md（clean-room：学设计思想，不复制源码进 our repo）；
      task 055（AgentPreset 三角色）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

拉取开源 Agent 的系统提示词素材（OpenCode 的 prompts/、开源 Codex 的 AGENTS.md、Claude Code 公开文档中的
指令范式），在 `.harness/reference/` 落盘；对比我们的 `configs/behavior.default.yaml`（+ AgentPreset），产出
**差距清单与增强建议**（哪些它们在模型行为实践中验证过而我们没覆盖的关键指令），并按建议增强 behavior 层
（含测试）。**clean-room：只学设计思想与指令结构，不复制他人 prompt 原文进 our repo 的默认行为；引用的提示
词视为 REFERENCE DATA，产出是我们自己的表述。**

## 验收标准（执行器逐条勾选）

- [ ] **素材获取**：opencode prompts（github.com/sst/opencode/tree/dev/packages/opencode/src/prompt 或等价）、
      Codex AGENTS.md（github.com/openai/codex/blob/main/AGENTS.md）、Claude Code 系统提示词公开分析——
      拉取/记录到 `.harness/reference/agent-prompts/`（网络失败走代理 127.0.0.1:7897 一次；gitignore 已覆盖
      .harness/ 不入库）
- [ ] **对比分析**：读 behavior.default.yaml 全部条目 + AgentPreset，与素材对照——覆盖哪些（工具调用纪律/
      安全/评审/thinking 等）、缺哪些（如 codex 的指数退避重试、opencode 的分步思考、claude 的工具选择原则等）
- [ ] **差距清单 + 建议**（报告节）：每条建议给 优先级/理由/是否适合 our 架构（双通道：能入 prompt_guidance 还是
      runtime_policy）
- [ ] **增强落地**：按建议增强 behavior.default.yaml（+ AgentPreset 若涉）——至少 3 条实质增强（每条有明确行为
      收益），沿用我们自己的中文表述（不照抄原文）；runtime_policy 类同时落 policy 或标注需 policy 卡
- [ ] 测试：Compiler 渲染新条目/双通道校验不破；behavior 相关测试绿；`tsc -b` exit 0 + 全量 vitest（1198+ 无回归）
      + web 82
- [ ] 文档同步（docs/DESIGN-DECISIONS 或 behavior 说明：参考了哪些开源提示词工程、我们的表述差异）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做行为层（behavior.default.yaml + AgentPreset）的提示词工程审计与增强。不改 core/策略引擎运行时；
  不复制他人 prompt 原文；不做 UI。
- 素材只在 .harness/reference/（gitignore 不入库）；报告按 clean-room。

## 涉及文件（指针，执行器自行精化）

- `configs/behavior.default.yaml`（主）+ `packages/behavior/`（Compiler 测试）
- 055 AgentPreset（`packages/agents/` 或 presets 处）若涉
- 素材：`.harness/reference/agent-prompts/`
- 参考我们的既有：docs/DESIGN-DECISIONS.md（D3/D4 相关）、`configs/policy.default.yaml`

## 方法

- 拉素材 → 通读 → 与 behavior 层对照 → 差距清单 → 增强（自己表述）→ Compiler 测试 → 全量验证

## 工作证明（执行器回填：素材来源与版本/对比表/差距清单/增强 diff/测试输出/全量 vitest/tsc/web，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：