# 116 — 参考 OpenCode/Codex/Claude Code 系统提示词，审计并增强 behavior 层

- 编号：116
- 状态：待验收
- 优先级：P1（用户授权方向：参考开源 Agent 的系统提示词工程，优化我们的行为层）
- 创建日期：2026-09-10
- 完成日期：2026-09-11（执行器回填）
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

- [x] **素材获取**：opencode prompts（github.com/anomalyco/opencode dev `src/session/prompt/*.txt` + `src/agent/*.txt`）、
      Codex AGENTS.md（github.com/openai/codex main）、Claude Code 公开指令范式（github README + code.claude.com 文档）——
      已记录到 `.harness/reference/agent-prompts/`（来源+版本+URL 见 SOURCES.md；gitignore 已覆盖 .harness/ 不入库；
      直连/代理各试 1 次失败后走 web_fetch，Claude 文档正文截断部分标注「公开知识」）
- [x] **对比分析**：读 behavior.default.yaml 全部条目 + AgentPreset，与素材对照——已覆盖（工具调用纪律/
      安全/评审/thinking 等）与缺口 8 条（重试退避/先计划/诚实失败/规则落文件/压缩续作/上下文预算/
      凭据处理/简洁直给）见工作证明 §2
- [x] **差距清单 + 建议**（报告节）：每条建议已给 优先级/理由/适合通道（prompt_guidance 7 条 +
      runtime_policy 1 条复用 filesystem.deny_read）见工作证明 §2/§3
- [x] **增强落地**：behavior.default.yaml v0.1→v0.2 新增 8 条（>3 条实质增强，每条有明确行为收益），
      全部为自有中文表述（不照抄原文）；runtime_policy 类 1 条已落既有 policy 域（写入侧需新 policy 卡，
      已在 docs/BEHAVIOR-DEFAULTS.md §5 注明）；AgentPreset 未涉
- [x] 测试：Compiler 新增 3 用例（rule 级 deny_read 校验 + 真实 configs 双通道零告警 + 新条目渲染）；
      behavior 相关测试绿（30/30）；`tsc -b` exit 0；全量 vitest + web 见工作证明 §5
- [x] 文档同步（docs/BEHAVIOR-DEFAULTS.md：参考素材表、对照结论、clean-room 表述差异三原则）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

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

### 0. 环境备注（踩坑记录）

- **网络**：直连 curl 失败 1 次、代理 `http://127.0.0.1:7897` 失败 1 次（均超时，按环境铁律即停不再重试）；
  `web_search` 工具不可用（搜索端点 401，不改配置）；改用 harness `web_fetch` 成功拉取 raw.githubusercontent /
  api.github.com / code.claude.com。sst/opencode 已移交 anomalyco/opencode（默认分支 dev，prompt 目录
  已从 `packages/opencode/src/prompt/` 迁至 `src/session/prompt/*.txt` + `src/agent/*.txt`）。
  Claude Code 官网文档页正文被站点导航截断（仅 URL 可达）→ 该部分要点标注「公开知识」，
  结合本仓库 docs/research/harness-matrix/claude-code.md（D1 公开面归纳）补全。
- **clean-room 合规说明**：素材原文只落 `.harness/reference/agent-prompts/`（gitignore 覆盖，不入 git）；
  本仓库 committed 产出（behavior.default.yaml / 测试 / 文档 / 本任务卡）全部为自有中文表述，
  不含任何他人 prompt 原文。git 提交清单已核对（见下）。
- **删除铁律**：全程仅 write/edit，无任何删除操作（未触发回收站）。
- **vitest 直跑**：本会话非受限环境，`npx vitest run` 可直跑（无 EPERM）。

### 1. 素材来源与版本（→ `.harness/reference/agent-prompts/`，不入 git）

| 素材 | 来源 URL | 版本 | 落盘文件 |
| --- | --- | --- | --- |
| opencode 主 agent 提示 | github.com/anomalyco/opencode `dev` `packages/opencode/src/session/prompt/default.txt` | 2026-09-11 抓取（repo updated_at 同日） | opencode-default.txt |
| opencode plan mode | 同上 `src/session/prompt/plan.txt`（+plan-mode.txt 记录于 SOURCES.md） | branch dev | opencode-plan.txt |
| opencode 子代理生成 | 同上 `src/agent/generate.txt` | branch dev | opencode-generate.txt |
| opencode 上下文压缩 | 同上 `src/agent/prompt/compaction.txt` | branch dev | opencode-compaction.txt |
| Codex AGENTS.md | github.com/openai/codex `main` AGENTS.md | 2026-09-11 抓取 | codex-AGENTS.md（摘要化留档，URL 已注） |
| Claude Code 公开指令范式 | github.com/anthropics/claude-code README（全文抓取）；code.claude.com/docs best-practices/memory（URL 可达、正文部分截断） | 线上文档 | claude-code-public-docs.md |
| 素材索引 | — | — | SOURCES.md |

### 2. 对比表（behavior.default.yaml v0.2 vs 素材）

**已覆盖（v0.1 起）**：纯文本即停（loop.turn_ends_without_tool_call）；受保护路径/破坏性命令双通道硬拦
（filesystem.protected、shell.deny）；独立评估/不自证（verification.independent_evaluator +
vessel.no_self_certification）；可替换可交接（vessel.replaceable）；最低复杂度；人上环升级决策。

**缺口 → v0.2 补齐（8 条）**：

| # | 差距 | 参考意图来源 | 通道 | 优先级 | 理由 |
| --- | --- | --- | --- | --- | --- |
| 1 | 重试退避/不原样重发 | opencode retry.ts（指数退避+抖动+Retry-After）、doom-loop 上限 | prompt_guidance | 高 | 原样重发是常见死循环/浪费；改方式或退避是各家验证过的模型行为实践 |
| 2 | 复杂任务先计划再行动 | opencode plan mode（只读调研→计划）、claude best practices | prompt_guidance | 高 | 多步/破坏性任务直接零散推进是质量事故主因 |
| 3 | 诚实上报失败（不伪造验证） | opencode 真实性纪律、claude 诚实性条款 | prompt_guidance | 高 | 假结果冒充完成破坏整个独立评估链条（IR E30/E48） |
| 4 | 长期规则落指令文件 | claude CLAUDE.md 体系、codex AGENTS.md | prompt_guidance | 中 | 对话记忆会丢，文件持久（IR E41） |
| 5 | 压缩/交接后续作不重做 | opencode compaction auto-continue、claude /compact | prompt_guidance | 中 | 重做已完成工作是压缩后最常见返工（IR E40+交接完整性） |
| 6 | 上下文预算意识 | opencode 输出截断、claude trimming | prompt_guidance | 中 | 长输出/大批量调用挤占窗口，是本仓 context 类行为缺口 |
| 7 | 凭据不落文件/日志/外发 | opencode secrets 纪律、claude credentials 立场 | **runtime_policy**（filesystem.deny_read） | 高 | 读取侧已硬拦；补行为侧措辞 + rule 级校验（IR E44） |
| 8 | 简洁直给、控制篇幅 | opencode 结论优先/篇幅克制、claude concise | prompt_guidance | 中 | CLI/日志场景篇幅过长伤害可用性（IR E34/E36） |

### 3. 增强落地 diff（自己表述；version 0.1 → 0.2；8 条新增）

```yaml
- id: retry.exponential_backoff        # loop / prompt_guidance
  render: "重试要有退避：同一操作连续失败时先读报错改方式；确需重试则加大间隔或改变参数，不原样反复重发；达到上限带证据上报或换方案。"
- id: planning.plan_before_execute     # planning / prompt_guidance
  render: "复杂、多步或有破坏性的任务先给出计划（目标→步骤→验证方式）再动手；执行中发现与计划冲突的新证据时先更新计划再继续。"
- id: safety.secret_handling           # safety / runtime_policy / policy_ref: filesystem.deny_read
  render: "凭据与密钥不写入文件、不落日志、不外发；凭据类文件读取由策略引擎硬拦截，需要密文时走环境注入。"
- id: verification.honest_failure      # verification / prompt_guidance
  render: "拿不到真实验证结果（测试跑不了、环境不可用、数据取不到）就如实上报并说明阻塞，不用假输出或推测冒充结论。"
- id: context.rules_in_files           # context / prompt_guidance
  render: "需要长期成立的规则与项目事实写入项目指令文件（AGENTS.md），不依赖对话记忆——对话会被压缩或交接，文件不会丢。"
- id: context.resume_after_compaction  # context / prompt_guidance
  render: "上下文被压缩或交接后，基于摘要与最新请求继续，不重做已完成的工作；收尾说明要足以让下一个执行者直接续作。"
- id: context.budget_awareness         # context / prompt_guidance
  render: "注意上下文占用：长输出与大批量调用会挤占窗口；优先按需读取与精简输出，接近窗口上限时先压缩再继续。"
- id: communication.concise_direct     # communication / prompt_guidance
  render: "回复简洁直给：先结论后细节，控制篇幅；CLI/日志类场景尤其要短，不写客套开场与无关展开。"
```

**双通道说明**：7 条 prompt_guidance（无既有硬执法声明域，按 D4 边界判据归 prompt 侧）；1 条
runtime_policy 复用 `filesystem.deny_read` 既有执法（Compiler rule 级 `fs-deny-read:*` 校验通过）。
No 写入侧凭据 deny 规则（需新 policy 卡，见 docs/BEHAVIOR-DEFAULTS.md §5）。引擎侧重试退避由既有
`llm/retry` 事件 + task 115 有界重试承担，本卡只补行为侧措辞。

### 4. 测试

`packages/behavior/src/compiler/Compiler.test.ts` 新增 3 用例（3 → 6）：
1. `filesystem.deny_read` claim 必须由 `fs-deny-read:*` rule 满足（rule 级，防仅 domain 误判）；
2. 真实 `configs/behavior.default.yaml` + `configs/policy.default.yaml` 编译零告警、全部 runtime_policy
   条目 `policyRuleFound=true`；
3. v0.2 新增条目渲染进 promptSections（8 条各自的关键表述断言）。

定向验证通过：
```
RUN  v2.1.9 C:/work/Vessel_Harness
 ✓ packages/agents/src/presets/presets.test.ts (11 tests)
 ✓ packages/behavior/src/compiler/Compiler.test.ts (6 tests)
 ✓ packages/agents/src/presets/role-presets.test.ts (13 tests)
 Test Files  3 passed (3) / Tests  30 passed (30)  EXIT=0
```

### 5. 全量验证（最终数字）

- `npx tsc -b tsconfig.json` → **exit 0**
- 全量 `npx vitest run` → **111 files passed / 1201 passed + 1 skipped（根基线 1198+1 → +3 新用例，无回归）EXIT=0**
- web 82（`npx vitest run --root apps/web`）→ **9 files / 82 passed（与基线一致）EXIT=0**

### 6. 文档同步

- 新增 `docs/BEHAVIOR-DEFAULTS.md`：默认集契约 + task 116 审计记录（参考素材表、对照结论、增强 diff、
  clean-room 表述差异三原则、后续 policy 卡建议）。
- 未改 docs/DESIGN-DECISIONS.md（D3 为冻结决策记录，审计属行为层说明，按任务卡「DESIGN-DECISIONS 或
  behavior 说明」取后者）。

### 7. 提交清单（含 clean-room 核对）

- 含：`configs/behavior.default.yaml`、`packages/behavior/src/compiler/Compiler.test.ts`、
  `docs/BEHAVIOR-DEFAULTS.md`、`tasks/116-prompt-engineering-audit.md`。
- **不含**：`.harness/`（素材，gitignore 已覆盖）、指挥侧文档（docs/V1.0-CHECKPOINT.md、
  docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md）、任何他人 prompt 原文。
- 提交前缀 `feat(behavior)` 或 `docs(...)`；无 force push。

- [x] 待执行器回填（已回填 2026-09-11）

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：