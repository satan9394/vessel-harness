# Behavior 默认集说明与提示词工程审计记录（task 116）

- 本文档 = `configs/behavior.default.yaml`（D4 行为 IR 默认集）的说明 + task 116 审计记录。
- 关联：`docs/BEHAVIOR-IR-SPEC.md`（v0.1 规范本体，12 类 49 条建议集）；`configs/policy.default.yaml`
  （runtime_policy 双通道的执法侧）；`docs/DESIGN-DECISIONS.md` 决策点 14（行为 IR + 双通道 + 编译管线）。

## 1. 默认集契约（简述）

`behavior.default.yaml` 是 Behavior IR 的**默认渲染集**（v0.1 minimal subset → v0.2 审计增强），
每条目三要素：

- `channel: prompt_guidance` —— 软引导：渲染进 stable prompt 段；
- `channel: runtime_policy` —— 硬执法：必须带 `policy_ref` 指向 `policy.default.yaml` 的声明域，
  Compiler 在 rule 级校验执法规则存在（无执法 = 编译告警，绝不静默丢弃）。

## 2. task 116 审计记录（2026-09-11）

### 2.1 参考素材（REFERENCE DATA，仅存 `.harness/reference/agent-prompts/`，不入 git）

| 素材 | 来源 | 版本 |
| --- | --- | --- |
| opencode 主 agent 提示（default.txt） | github.com/anomalyco/opencode `dev` | 2026-09-11 |
| opencode plan mode / compaction / generate | 同上仓库 `src/session/prompt/*.txt`、`src/agent/*.txt` | 2026-09-11 |
| Codex 开源仓库 AGENTS.md | github.com/openai/codex `main` | 2026-09-11 |
| Claude Code 公开文档/README | github.com/anthropics/claude-code；code.claude.com/docs（best-practices/memory 等） | 2026-09-11 |

素材仅作设计思想/指令结构参考；**任何他人 prompt 原文未进入本仓库 committed 产出**（clean-room，见 §3）。

### 2.2 对照结论（behavior.default.yaml v0.2 vs 素材）

**已覆盖（v0.1 起）**：纯文本即停（loop）、破坏性命令硬拦（shell.deny）、受保护路径硬拦
（filesystem.protected）、独立评估不自证（verification/vessel）、可替换交接（vessel.replaceable）、
最小复杂度、人上环（升级决策）。

**缺口（v0.2 补齐）**：

| # | 缺口 | 素材出处（行为意图） | 落点 | 优先级 |
| --- | --- | --- | --- | --- |
| 1 | 重试退避/不原样重发 | opencode retry（指数退避+抖动），doom-loop 上限 | prompt_guidance | 高 |
| 2 | 复杂任务先计划再行动 | opencode plan mode；claude best practices | prompt_guidance | 高 |
| 3 | 诚实上报失败（不伪造验证结果） | opencode 简洁真实性；claude 诚实性条款 | prompt_guidance | 高 |
| 4 | 长期规则落指令文件 | claude CLAUDE.md 体系；codex AGENTS.md | prompt_guidance | 中 |
| 5 | 压缩/交接后续作不重做 | opencode compaction auto-continue；claude /compact | prompt_guidance | 中 |
| 6 | 上下文预算意识 | opencode 输出截断；claude trimming | prompt_guidance | 中 |
| 7 | 凭据不落文件/日志/外发 | opencode secrets 纪律；claude credentials 立场 | **runtime_policy**（filesystem.deny_read） | 高 |
| 8 | 简洁直给、控制篇幅 | opencode 结论优先/篇幅克制；claude concise | prompt_guidance | 中 |

### 2.3 增强 diff（v0.1 → v0.2，8 条新增；均为 our repo 自己的中文表述）

```yaml
- id: retry.exponential_backoff        # loop      / prompt_guidance
  render: "重试要有退避：同一操作连续失败时先读报错改方式；确需重试则加大间隔或改变参数，不原样反复重发；达到上限带证据上报或换方案。"
- id: planning.plan_before_execute     # planning  / prompt_guidance
  render: "复杂、多步或有破坏性的任务先给出计划（目标→步骤→验证方式）再动手；执行中发现与计划冲突的新证据时先更新计划再继续。"
- id: safety.secret_handling           # safety    / runtime_policy (policy_ref: filesystem.deny_read)
  render: "凭据与密钥不写入文件、不落日志、不外发；凭据类文件读取由策略引擎硬拦截，需要密文时走环境注入。"
- id: verification.honest_failure      # verification / prompt_guidance
  render: "拿不到真实验证结果（测试跑不了、环境不可用、数据取不到）就如实上报并说明阻塞，不用假输出或推测冒充结论。"
- id: context.rules_in_files           # context   / prompt_guidance
  render: "需要长期成立的规则与项目事实写入项目指令文件（AGENTS.md），不依赖对话记忆——对话会被压缩或交接，文件不会丢。"
- id: context.resume_after_compaction  # context   / prompt_guidance
  render: "上下文被压缩或交接后，基于摘要与最新请求继续，不重做已完成的工作；收尾说明要足以让下一个执行者直接续作。"
- id: context.budget_awareness         # context   / prompt_guidance
  render: "注意上下文占用：长输出与大批量调用会挤占窗口；优先按需读取与精简输出，接近窗口上限时先压缩再继续。"
- id: communication.concise_direct     # communication / prompt_guidance
  render: "回复简洁直给：先结论后细节，控制篇幅；CLI/日志类场景尤其要短，不写客套开场与无关展开。"
```

版本号 `0.1 → 0.2`。

### 2.4 关于双通道

- 8 条中 7 条走 `prompt_guidance`（软引导）：重试/计划/诚实/上下文/沟通类在本架构下无既有硬执法
  声明域，且这些行为属「模型应如何工作」而非「引擎必须拦什么」——按 D4 边界判据归 prompt 侧。
- `safety.secret_handling` 走 `runtime_policy`：硬通道复用既有 `filesystem.deny_read` 声明
  （Compiler 按 `fs-deny-read:*` 规则判定执法存在）。读取侧已硬拦（`.env`/`.ssh` 等）；
  **写出侧（回落文件）尚无独立 deny 规则**——如需「写入凭据文件也硬拦」，需另开 policy 卡
  （在 filesystem 域加 `secret_paths` 声明），本卡不在运行时动策略引擎。
- 重试上限/退避时长的**引擎侧**执法由既有机制承担（`llm/retry` 事件 + task 115 有界重试），
  本卡只补行为侧措辞。

## 3. clean-room 表述差异说明

参考素材与 our 条目的差异（避免照抄的三条原则）：

1. **意图 vs 措辞**：借鉴的是「重试要退避」「先规划再行动」「拿不到真结果就上报」这类行为意图，
   不引用素材中的句式/条款文本。
2. **载体不同**：opencode/claude 把行为写死在闭源或产品系提示里；我们把行为写成显式的、可校验的
   IR 条目，配 class/channel/policy_ref，由 Compiler 渲染（架构决策点 14）。
3. **架构腔调不同**：our 条目带「策略引擎硬执法」「四层执行」「独立评估」等 harness 语义，
   是素材没有的本仓术语——表述属于自己的体系。

## 4. 测试与验证证据

- `packages/behavior/src/compiler/Compiler.test.ts` 新增：`filesystem.deny_read` rule 级校验、
  真实 configs 双通道零告警、v0.2 新增条目渲染断言。
- `npx tsc -b tsconfig.json` exit 0；全量 vitest 无回归；web 82 未受影响（behavior 层改动）。
- 详见 tasks/116-prompt-engineering-audit.md「工作证明」。

## 5. 后续建议（不在本卡范围）

- policy 卡：`filesystem.secret_paths` 写入侧硬拦；重试预算（max_retries/backoff 上限）入
  runtime_policy（若需要引擎强制而非仅提示）。
- 素材刷新：opencode prompt 随版本变化，`.harness/reference/agent-prompts/` 可按需重抓
  （不入 git，需重新拉取时看 SOURCES.md）。