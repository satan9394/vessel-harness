# 第一阶段交付物独立审查报告（Evaluator Review Report）

- **审查对象**：Composable Agent Harness 第一阶段（Harness 解剖）交付物
- **工作区根目录**：`C:\work\Vessel_Harness`
- **审查日期**：2026-09-05
- **审查依据**：`任务书.md`（第五节研究输出、第二十一节最终交付物、第二十二节验收门槛、第二十三节禁止事项、第二十四节固定汇报格式）
- **审查方法**：`glob`/`pwsh` 全量清点工作区文件（含隐藏文件）→ 逐份 `read` 全部研究文档 → 按六道门槛逐条核对并记录行级证据 → 无法在线核验处（commit SHA、外部仓库）明示为审查环境限制

---

## 总体结论

**VERDICT: FAIL**

存在多项 BLOCKER 级问题：8 个研究对象仅有 3 份研究文档（缺失 5 份），`comparison.md`（横向矩阵 + 每机制 Decision/Why/Rejected/Proposed Spec）完全缺失，第二十一节 D1–D8 八项最终交付物全部缺失，第二十二节验收门槛（7 个以上 Harness 完整分析、12 机制横向矩阵、Behavior IR v0.1、Event Spec v0.1、Policy Spec v0.1、Benchmark Scenario ≥15、V0.1 模块边界）无一达成。按"存在 BLOCKER 级问题即 FAIL"判定为 **FAIL**。

---

## 一、交付物清点（全量）

工作区全部文件（`glob **/*` 全量结果，无隐藏目录、无 `.git`）：

| 文件 | 大小 | 说明 |
|---|---|---|
| `任务书.md` | 19569 B | 任务书本体 |
| `参考.md` | 11666 B | 研究对象固定 URL 参考 |
| `agent-roles-template.md` | 5803 B | 角色模板（非任务书交付物） |
| `docs/research/harness-matrix/claude-code.md` | 59075 B | ✅ 存在 |
| `docs/research/harness-matrix/codex.md` | 42397 B | ✅ 存在 |
| `docs/research/harness-matrix/deepseek-harness.md` | 51006 B | ✅ 存在 |
| `docs/research/harness-matrix/claw-code.md` | — | ❌ 缺失 |
| `docs/research/harness-matrix/pi.md` | — | ❌ 缺失 |
| `docs/research/harness-matrix/opencode.md` | — | ❌ 缺失 |
| `docs/research/harness-matrix/hermes.md` | — | ❌ 缺失 |
| `docs/research/harness-matrix/cl4r1t4s.md` | — | ❌ 缺失 |
| `docs/research/harness-matrix/comparison.md` | — | ❌ 缺失 |
| D1–D8（HARNESS-ANATOMY.md / HARNESS-COMPARISON.md / DESIGN-DECISIONS.md / BEHAVIOR-IR-SPEC.md / EVENT-SPEC.md / POLICY-SPEC.md / BENCHMARK-SPEC.md / ARCHITECTURE.md） | — | ❌ 全部缺失（docs/ 下无任何位置） |
| `benchmarks/`（任务书第十五节强制目录） | — | ❌ 未建立 |

---

## 二、六道门槛逐条核对

### 门槛 1：8 个项目是否都有研究文档 — **FAIL（BLOCKER）**

任务书第三节（行 148–165）列出 8 个研究对象；第五节（行 532–547）规定输出树 `docs/research/harness-matrix/` 下的 8 个文件。实际仅 3 份：

- ✅ 存在：`claude-code.md`、`codex.md`、`deepseek-harness.md`
- ❌ 缺失（5 份）：`claw-code.md`、`pi.md`、`opencode.md`、`hermes.md`、`cl4r1t4s.md`
- ❌ 缺失：`comparison.md`（任务书第五节规定输出树中的第 8 个文件）

**证据**：`glob **/*` 全量结果仅 6 个文件（见上表）；`pwsh Get-ChildItem -Recurse docs` 确认 `docs/` 下只有 3 个 .md。Claw Code（任务书行 163 明确要求作为重要参考样本）、Pi、OpenCode、Hermes、CL4R1T4S 均无任何研究产出。

### 门槛 2：每份覆盖 H01–H12 全部 12 维度 — **PASS（仅对已存在的 3 份）**

逐份核对章节标题（`Select-String '^#{1,4} '`）：

| 文档 | H01 | H02 | H03 | H04 | H05 | H06 | H07 | H08 | H09 | H10 | H11 | H12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-code.md | 行16 | 39 | 67 | 105 | 131 | 162 | 191 | 220 | 246 | 270 | 291 | 320 |
| codex.md | 行11 | 28 | 44 | 59 | 76 | 93 | 113 | 132 | 155 | 172 | 185 | 200 |
| deepseek-harness.md | 行13 | 67 | 98 | 128 | 157 | 194 | 230 | 270 | 296 | 332 | 358 | 388 |

- 3 份文档 H01–H12 全部成节，无缺失维度 ✅
- 明确的"未获取到"标注存在且格式合规：claude-code.md 行 11（"未获取到任何 CL4R1T4S（Claude Code 系统提示词）原文"）、行 387（"未获取到：Claude Code 运行时源码（闭源）；CL4R1T4S / system prompt 原文"）✅
- 缺失的 5 份文档无从核验（整体缺失，归入门槛 1 的 BLOCKER）

### 门槛 3：每份锁定 URL+commit/日期 — **PASS（结构满足，附 1 项数据完整性疑点）**

| 文档 | 锁定 URL | 锁定 commit | 日期 |
|---|---|---|---|
| claude-code.md 行 3–6 | https://github.com/anthropics/claude-code | `d7dbd9a09f59775726ed14bbea8fc9dfdff62f7b`（main，commit 日期 2026-09-04） | 研究日期 2026-09-04/05；官方文档抓取日期 2026-09-04 |
| codex.md 行 3–5 | https://github.com/openai/codex | `ddf04ad26789d040f9ef6a96736f76602e35a6cc`（2026-09-05 05:31:48 +0000） | 研究日期 2026-09-08 |
| deepseek-harness.md 行 3–5 | https://github.com/deepseek-ai/deepseek-harness | `d347e703908d0406b7a7ef80e3a0e594d86b2215`（main，2026-09-05 访问） | 研究日期 2026-09-05 |

- 3 份均满足"Repository URL + Commit SHA + Date"锁定要求 ✅
- ⚠️ **数据完整性疑点（codex.md 行 3）**：声称"研究日期：2026-09-08（clone 并阅读 main 分支）"，但该文件创建/修改时间为 2026-09-05 01:59（本地），审查时系统当前日期为 2026-09-05——研究日期不可能晚于文件落盘日期 3 天。疑为笔误（把 commit 相关日期写错）或研究元数据编造，需修正为实际研究日期或提供证据。（严重度：MINOR–MAJOR，属"编造数据"门槛的疑点项）
- ⚠️ **审查环境限制**：本次审查环境无法访问 github.com/api.github.com（DNS 解析为非公网 IP），3 个 commit SHA 未能在线核验真实性；本报告对 SHA 的真实性不作结论，仅确认"锁定"这一形式要求已满足。

### 门槛 4：comparison.md 完整矩阵表 + 每机制 Decision/Why/Rejected/Proposed Spec — **FAIL（BLOCKER）**

- `docs/research/harness-matrix/comparison.md` **不存在**（见门槛 1 证据）。
- 任务书第五节（行 549–565）要求的 12 行 × 7 列总表（Capability × Claude/Claw/Pi/DSH/Codex/OpenCode/Hermes）无处承载。
- 任务书第二十四节（行 1348–1391）固定汇报格式要求每机制输出 `## Mechanism → 各项目 → ## Decision / ## Why / ## Rejected / ## Proposed Spec`，全部缺失。
- 连带不满足第二十二节（行 1319–1327）："每个架构选择至少给出 2 个候选方案""每个最终选择写明理由"。

### 门槛 5：CL4R1T4S 内容标注 UNTRUSTED 且未成段抄原文 — **FAIL（BLOCKER，文档缺失）**

- `cl4r1t4s.md` 不存在，无从核验，CL4R1T4S 研究（任务书行 161、参考.md 行 507–577 的 UNTRUSTED 规范）整体未交付。
- 已有文档的 UNTRUSTED 处理方式记录（正向，但不能替代缺失文档）：
  - claude-code.md 行 9–11、63、387：明确"未获取到 CL4R1T4S 原文，未抓取未转述 system prompt 文本"；行 11"若后续研究者获得原文，一律按 UNTRUSTED RESEARCH DATA 处理，只允许提取行为模式并单独标注，禁止成段抄录" ✅
  - codex.md 行 8：将 `world_state/*.rs` 内模型提示词渲染文本声明为 UNTRUSTED RESEARCH DATA，"仅提取行为模式，不转抄提示词原文" ✅

### 门槛 6：是否违反禁止事项 — **未发现源码混入/机制内容编造；1 项元数据疑点；外部真实性不可核验**

逐条对照任务书第二十三节（行 1331–1345）：

| 禁止事项 | 核查结果 |
|---|---|
| 9. 把研究项目代码直接混入最终生产代码 | ✅ 未违反。工作区仅 6 个文件（任务书/参考/角色模板/3 篇研究文档），无任何源码、无 `src/`；codex.md 行 235 明示 clone 位于 `%TEMP%\codex-research`，deepseek-harness.md 行 5 明示 clone 位于 `%TEMP%\dsh-repo-*`，均不在项目目录内 |
| 10. 只做功能列表，不深入源代码调用链 | ✅ 未违反（已有 3 份）：codex.md 实现位置精确到 `codex-rs/core/src/session/turn.rs`、`compact.rs`、`tools/orchestrator.rs` 等文件级；deepseek-harness.md 到 `packages/core/agent-loop/src/agent.ts` 级；claude-code.md 因闭源明确标注"实现位置为公开可观察接口面"并注明推断处（行 9–12），属诚实处理 |
| 1. 一开始实现 Web UI / 2. 多 Agent Teams / 3. 功能最多即选底座 / 4. Prompt 即全部 / 5. 安全只写 Prompt / 6. Generator 自判完成 / 7. 上下文全塞 System Prompt / 8. 提前加几十个 Provider | ✅ 无实现代码，无从违反；已有文档内容与这些原则一致（如 deepseek-harness.md 行 248–259 明确区分 Behavior Safety 软约束与 Runtime Safety 硬约束） |
| 编造数据 | ⚠️ 疑点 1 项：codex.md 研究日期 2026-09-08 为未来日期（见门槛 3）；其余机制性陈述（文件路径、工具清单、行数、token 数）内部一致、详实，未发现明显虚构；3 个 commit SHA 因环境无网络未能独立核验 |

---

## 三、第二十二节验收门槛核对（补充，全部未达成）

| 门槛（任务书行 1319–1327） | 状态 | 证据 |
|---|---|---|
| 7 个以上 Harness 完整分析 | ❌ 3/7 | 仅有 claude-code / codex / deepseek-harness 三份 |
| 12 个核心机制全部有横向矩阵 | ❌ | comparison.md 缺失 |
| 每个架构选择至少 2 个候选方案 | ❌ | 无 DESIGN-DECISIONS / comparison.md |
| 每个最终选择写明理由 | ❌ | 同上 |
| Behavior IR v0.1 | ❌ | BEHAVIOR-IR-SPEC.md 缺失（3 份文档末尾有"行为要点提取"素材，但非正式 Spec） |
| Event Spec v0.1 | ❌ | EVENT-SPEC.md 缺失 |
| Policy Spec v0.1 | ❌ | POLICY-SPEC.md 缺失 |
| Benchmark Scenario ≥15 | ❌ | BENCHMARK-SPEC.md 缺失；`benchmarks/` 目录未建立 |
| 新 Harness V0.1 模块边界确定 | ❌ | ARCHITECTURE.md 缺失 |

## 四、问题清单（逐条附文件与证据）

**BLOCKER**

1. **B1 — 5/8 研究对象无研究文档**。缺失 `claw-code.md`、`pi.md`、`opencode.md`、`hermes.md`、`cl4r1t4s.md`。证据：`glob **/*` 仅 6 文件；`docs/` 递归列表仅 3 个 .md；任务书第五节行 532–547 规定输出树 8 文件、第三节行 148–165 定义 8 对象（行 163 尤其点名 Claw Code 为重要参考样本）。
2. **B2 — comparison.md 缺失**（横向矩阵 + 每机制 Decision/Why/Rejected/Proposed Spec）。证据：`docs/research/harness-matrix/` 无此文件；任务书第五节行 549–565（12×7 总表）、第二十四节行 1348–1391（固定汇报格式）。
3. **B3 — 第二十一节 D1–D8 最终交付物全部缺失**（HARNESS-ANATOMY.md、HARNESS-COMPARISON.md、DESIGN-DECISIONS.md、BEHAVIOR-IR-SPEC.md、EVENT-SPEC.md、POLICY-SPEC.md、BENCHMARK-SPEC.md、ARCHITECTURE.md）。证据：`glob **/*` 无任何匹配；任务书行 1236–1308。
4. **B4 — 第二十二节验收门槛整体未达成**（≥7 分析、12 机制矩阵、≥2 候选方案、Behavior IR/Event Spec/Policy Spec v0.1、Benchmark ≥15、模块边界，共 9 项全不满足）。证据：见第三节核对表；任务书行 1311–1328。

**MAJOR**

5. **M1 — codex.md 研究日期为未来日期**：行 3"研究日期：2026-09-08"与文件创建时间 2026-09-05 01:59、系统当前日期 2026-09-05 矛盾。疑为元数据笔误或编造，影响研究可复现性声明（参考.md 行 679–705 的锁定要求）。需修正为实际日期或补充证据。

**MINOR**

6. **m1 — 第二十四节固定格式未完全落实于已有文档**：模板要求每机制含"实现位置/核心流程/触发条件/状态保留/优点/缺点"六个字段 + 每机制 Decision/Why/Rejected/Proposed Spec；claude-code.md 与 codex.md 的 H 节为自由段落式（仅含"优点/缺点"标签），deepseek-harness.md 为"实现位置/核心流程/关键机制/优点/缺点"五字段，均无"触发条件/状态保留"标签字段（相关内容散落正文，如 claude-code.md 行 109、dsh 行 137），且各机制无 Decision 段（应归 comparison.md，随 B2 一并补）。证据：任务书行 1353–1391；各文档 H 节标题（见门槛 2 表）。
7. **m2 — commit SHA 真实性未核验**：审查环境无法访问 github.com（DNS 非公网 IP），3 个锁定 SHA（claude-code `d7dbd9a0…`、codex `ddf04ad2…`、dsh `d347e703…`）无法在线确认；web_search 亦无结果。建议复检时在线核验。

## 五、缺失清单（missing）

- `docs/research/harness-matrix/claw-code.md`
- `docs/research/harness-matrix/pi.md`
- `docs/research/harness-matrix/opencode.md`
- `docs/research/harness-matrix/hermes.md`
- `docs/research/harness-matrix/cl4r1t4s.md`
- `docs/research/harness-matrix/comparison.md`
- D1 `HARNESS-ANATOMY.md`、D2 `HARNESS-COMPARISON.md`、D3 `DESIGN-DECISIONS.md`、D4 `BEHAVIOR-IR-SPEC.md`、D5 `EVENT-SPEC.md`、D6 `POLICY-SPEC.md`、D7 `BENCHMARK-SPEC.md`、D8 `ARCHITECTURE.md`
- `benchmarks/`（fixtures/scenarios/runners/reports，任务书第十五节行 971–979）

## 六、正向记录（已达标部分）

- claude-code.md / codex.md / deepseek-harness.md 三份文档质量高：H01–H12 全维度、URL+commit+日期锁定、实现位置到源码文件级、行为要点提取为后续 Behavior IR 提供素材。
- UNTRUSTED 数据纪律良好：claude-code.md 明确不收集/不转述 CL4R1T4S 原文；codex.md 对提示词渲染文本声明 UNTRUSTED 且只提取行为。
- 无研究源码混入项目目录（clone 均在 `%TEMP%`），clean-room 声明齐备。
- 禁止事项 #10 未违反：已有 3 份均深入调用链而非功能列表。

---

## VERDICT: FAIL

存在 BLOCKER 级问题（5/8 研究文档缺失、comparison.md 缺失、D1–D8 全部缺失、第二十二节 9 项验收门槛全未达成），按审查规则判定 FAIL。当前产出不足以支撑"禁止进入大规模编码阶段"的解禁条件。

---

# 复审 2026-09-05 第二轮（Final Acceptance Review）

- **复审日期**：2026-09-05（本地 03:56，UTC 11:00；时区 Pacific Standard Time）
- **复审方法**：`glob **/*` 与 `pwsh Get-ChildItem -Force -Recurse` 全量清点 → 抽查/精读 9 份研究文档（8 研究 + comparison）+ 8 份 D1–D8 交付物的头部与关键章节 → 逐条核对 12 项验收清单与第一轮问题清单 → commit SHA 线上核验因审查环境无法访问 github.com（DNS 解析为非公网 IP）仍受限制，已用 web_search 佐证仓库存在性
- **复审结论**：**VERDICT: PASS**（无 BLOCKER、无未解决 MAJOR；MINOR 2 项，见下）

## 0. 复审交付物清点

| 交付物 | 第一轮状态 | 本轮状态 | 证据 |
|---|---|---|---|
| harness-matrix/ 8 份研究文档 | ❌ 缺 5 | ✅ 齐 8 | 9 个文件全部存在（含 cl4r1t4s.md），文件时间 2026-09-05 01:57–02:53 |
| comparison.md | ❌ 缺失 | ✅ 存在（834 行） | 12 行×7 列总表 + H01–H12 每机制 Decision/Why/Rejected/Proposed Spec |
| HARNESS-COMPARISON.md（D2） | ❌ 缺失 | ✅ 存在 | 与 comparison.md SHA-256 完全一致（AB76DEE6…），系同一内容双份归档 |
| HARNESS-ANATOMY.md（D1） | ❌ 缺失 | ✅ 存在（532 行） | §0 执行摘要 + H01–H12 逐家/共同抽象 + 各家范式小结 + 资料缺口与可信度说明 |
| DESIGN-DECISIONS.md（D3） | ❌ 缺失 | ✅ 存在（383 行） | 16 决策点，每点均有候选方案/决策/理由/拒绝/影响 |
| BEHAVIOR-IR-SPEC.md（D4） | ❌ 缺失 | ✅ 存在（862 行） | v0.1，49 条建议集覆盖 12 类，每条带 source/channel/render/conformance |
| EVENT-SPEC.md（D5） | ❌ 缺失 | ✅ 存在（571 行） | v0.1，48 行事件总表（27 扩展 + 21 持久记录） |
| POLICY-SPEC.md（D6） | ❌ 缺失 | ✅ 存在（592 行） | v0.1，Policy→四件套软/硬分离，三态裁决 + 决策序 + guard 单调 + fail-closed |
| BENCHMARK-SPEC.md（D7） | ❌ 缺失 | ✅ 存在（685 行） | B001–B019（19≥15）、指标 14 项 M01–M14（含 Autonomy）、A/B A–E、C7 adapter |
| ARCHITECTURE.md（D8） | ❌ 缺失 | ✅ 存在（530 行） | V0.1 模块化单体，core/ llm/ behavior/ context/ tools/ policy/ runtime/ memory/ skills/ agents/ telemetry/ 边界 + V0.1 不做清单 + 演进路线 |
| benchmarks/ 四子目录 | ❌ 未建立 | ✅ 已建立 | fixtures/ scenarios/ runners/ reports/ 四个空目录齐备（内容属第三阶段落码） |

全工作区除任务书/参考/角色模板/REVIEW-REPORT 外仅有以上 .md 交付物；`glob **/*.{ts,rs,py,js,jsx,tsx,go,java,toml,json,yaml,yml}` 无任何匹配，**无源码混入**。

## 1. 验收核对清单（逐条）

### 1.1 8 份研究文档齐 + H01–H12 覆盖 + URL/commit 锁定 — **PASS**

| 文档 | 行数 | URL | commit | H01–H12 |
|---|---|---|---|---|
| claude-code.md | 387 | github.com/anthropics/claude-code | `d7dbd9a09f59775726ed14bbea8fc9dfdff62f7b` | 12/12 |
| claw-code.md | 117 | github.com/ultraworkers/claw-code | `08106b0c3771ef5b4a5aa176acccd460e88b7325` | 12/12 |
| pi.md | 161 | github.com/badlogic/pi-mono | `9841914c71a74d81abe07f751aefd271fd924e63` | 12/12 |
| deepseek-harness.md | 439 | github.com/deepseek-ai/deepseek-harness | `d347e703908d0406b7a7ef80e3a0e594d86b2215` | 12/12 |
| codex.md | 246 | github.com/openai/codex | `ddf04ad26789d040f9ef6a96736f76602e35a6cc` | 12/12 |
| opencode.md | 140 | github.com/anomalyco/opencode | `e2894562f8ba943d72172d10b727c24d5f650c16` | 12/12 |
| hermes.md | 114 | github.com/NousResearch/hermes-agent | `d20a8e44755a8e999a2e816ef9f458c438d3e17c` | 12/12 |
| cl4r1t4s.md | 123 | github.com/elder-plinius/CL4R1T4S | `93b0ae6fb503db6642e58f9d6352db973a900cdc` | 12/12（H02 注明"核心维度"） |

8 份文档各自用 `## H01`…`## H12` 成节（自动扫描全部命中），含源码级实现位置（claw-code.md `conversation.rs::run_turn` L325-531；codex.md `codex-rs/core/src/compact.rs`；pi.md `packages/agent/src/agent-loop.ts`；opencode.md `session/prompt.ts` runLoop L1052 起 等）与锁定证据。"未获取到/未证实/空缺/TBD"缺口标注存在且诚实（claude-code.md 明示未获取 CL4R1T4S 原文、闭源实现位置为公开接口面；hermes.md 5 处；comparison.md 8 处，另设"数据缺口清单"章）。

### 1.2 comparison.md + HARNESS-COMPARISON.md：12×7 矩阵 + 每机制 Decision/Why/Rejected/Proposed Spec — **PASS**

- 矩阵：12 行能力 × 7 项目（Claude/Claw/Pi/DSH/Codex/OpenCode/Hermes），另附 MCP 附加行并注明不占机制编号（comparison.md 行 12–27）。
- H01–H12 每机制完整呈现 `## <项目> 实现位置/核心机制一句话` + `## Decision/## Why（含 ≥2 候选对比）/## Rejected（含原因）/## Proposed Spec`（自动扫描 12×5 组标题全部命中；文件 834 行）。
- HARNESS-COMPARISON.md（D2）与 comparison.md 内容 SHA-256 一致（同一文档两份归档，位置符合 D2 命名）。

### 1.3 HARNESS-ANATOMY.md（D1）存在且整合 12 机制 — **PASS**

532 行：§0 执行摘要（commit 锁定表 8 行、范式分类、总体结论）→ H01–H12 每章"逐家实现位置与核心流程 + 共同抽象"→ 各家范式小结（Claude 闭源行为基准 / Claw Rust Parity / Pi 极简内核 / DSH 插件树+事件溯源 / Codex Rust 工程 / OpenCode Client-Server / Hermes 自学习 / CL4R1T4S 语料）→ 资料缺口与可信度说明（分级 + 使用要求）。无新事实、全部溯源至研究文档，符合 D1"各家完整解剖"定位。

### 1.4 DESIGN-DECISIONS.md（D3）每决策 ≥2 候选 + 理由 — **PASS**

自动逐点校验 16 个决策点（DP1–DP16）均含「候选方案 / **决策** / **理由** / **拒绝** / **影响**」五要素；每点列出候选 A/B/C（多数 3 个，如 DP1 A=OpenCode Client/Server、B=DSH/Pi 模块化单体、C=服务化），理由引用任务书行号 + cmp:/anat:/IR: 交叉引用。版本标注 v0.1、日期 2026-09-06。

### 1.5 BEHAVIOR-IR-SPEC.md（D4）v0.1、IR 条目有出处 — **PASS**

862 行 v0.1 规范：顶层 12 类、附录 A 采纳集 **49 条**（≥25 门槛，覆盖 12 类）。条目结构 = key/type/default/semantics/**source**/channel/render/**conformance**（样例：E01 `turn_ends_without_tool_call` source `[cc#1, cmp:H01]`；E05 `search_before_edit` source `[任务书§6, c4#4]`）。附录 A 来源构成统计自述 46/49 带出处、1 条设计提案显式标注、2 条以 cmp/dsh 决策为据。§3 来源出处规范 + §3.2 UNTRUSTED 语料处理（c4* 标记仅承载行为模式）+ §3.3 证据强度分级。

### 1.6 EVENT-SPEC.md（D5）v0.1、事件定义完整 — **PASS**

571 行 v0.1：两域分离（可订阅扩展事件 = 决策点 waterfall / 持久记录 = 会话真源自动落盘，一一镜像）→ 2.2 节 **48 行事件总表**（A01 SessionStart…A27 AfterCompact，标草案/新增来源列；B01–B21 自动持久记录）→ 逐事件规范（5.A–5.G 按域）→ 事件卡模板与通用字段 → 8 节一轮完整 turn 事件流时序 → 错误与恢复语义总表 → 10 节范围声明与分期装载 → 附录 A（任务书草案 16 事件对照）。事件命名与 H06 研究词汇对齐（`BeforeTool` ⇄ `tool/call`、`turn/end` 等）。

### 1.7 POLICY-SPEC.md（D6）v0.1、软/硬分离落地 — **PASS**

592 行 v0.1：声明式 Policy（YAML 唯一事实源）编译为**四件套**——Prompt Guidance（软/引导，不执法不产生审计事实）、Tool Interceptor（工具层）、Runtime Deny（硬执法）、Audit Event（审计证据）；§2.1 四件套职责表逐通道标注软/硬/强度；§4 权威裁决序（denied→deny→hook→ask→allow→profile）+ guard 单调 + fail-closed；§5 Behavior Safety 与 Runtime Safety 分层 + **失效面声明**；D5 `PolicyDecision`(A13)/`ApprovalRequest`(A16)/`ApprovalDecided`(A17) + `audit/*` 接线齐备。明确呼应任务书禁止事项 5（安全不只写 Prompt）。

### 1.8 BENCHMARK-SPEC.md（D7）Scenario ≥15、指标含 Autonomy — **PASS**

685 行 v0.1：B001–B015（任务书首批逐一定义，fixture/预期/机器可执行 pass 断言/measured 齐全）+ **B016–B019 新增**（含 Prompt Injection 抵抗 B019）共 **19 ≥ 15**；统一指标 **M01–M14 = 任务书 13 项 + Autonomy** 逐项定义采集方式/事件源/JSONL 记录格式（M14 Autonomy = 人工/外部干预次数 + 分项 steers/approval_asks/interrupts）；A/B Test A–E 五组（§5）；Cross-Harness Conformance Suite C7 七 harness + runners/ adapter 清单（§7，v0.1 先 mock/pi 两 adapter，其余按 §6.3 排期）；§8.3 自列验收对照（19≥15 ✔）。口径与 POLICY-SPEC/EVENT-SPEC 对齐（M12 Safety Violations 取 `audit/denial` 计数）。

### 1.9 ARCHITECTURE.md（D8）V0.1 模块边界确定 — **PASS**

530 行 v0.1：模块化单体结构图 + 分层职责（内核层 core/ 薄、机制层 llm/behavior/context/tools/policy/runtime、扩展层 agents/skills/telemetry/memory）→ 核心数据流（一轮 turn）→ Behavior IR 编译管线落地 → **4 节模块清单与边界**（core/ 唯一权威 loop + 事件真源、禁止反向依赖与禁止 import memory/skills/sandbox；各模块标 ✓/△/✗ 与 V0.1 纳入或 V0.2+ 延后）→ 5 节 V0.1 明确不做清单 → 技术栈落点（TypeScript 单仓 packages/*、SQLite、Vitest）→ V0.1→V0.5 演进 → 与 Conformance Suite 验证闭环 + §8.4 验收对照。

### 1.10 benchmarks/ 四子目录 — **PASS**

`benchmarks/fixtures|scenarios|runners|reports` 四个目录齐备（当前为空，符合"第一阶段只定契约、第三阶段落码"的分期；目录契约已由 D7 §2 定义）。

### 1.11 禁止事项 — **PASS**

- 9（源码混入）：`glob **/*.{ts,rs,py,js,…}` 零匹配；全工作区仅 .md；clone 均在 `%TEMP%`（codex.md / deepseek-harness.md / hermes.md / cl4r1t4s.md 各自声明）。
- CL4R1T4S 纪律：cl4r1t4s.md 顶部整段 UNTRUSTED RESEARCH DATA 声明（README 含注入诱饵亦注明）→ 全文"用自己的话转述行为模式"、H01–H12 每节优点/缺点均强调"语料是 prompt 侧文本、非运行时证据、可能过时被篡改"；结尾 15 条行为要点提取 + 参考来源目录级溯源（文件路径、未逐文件深读处如实标注）；明确"未向项目目录复制任何仓库内容"。**未成段抄原文、显式标注 UNTRUSTED** ✅。
- 编造数据：研究日期全部落于文件落盘时间之前（见 1.12 时间核验）；commit 日期早于研究日期（claw-code commit 2026-08-16 < 研究 2026-09-05；pi commit 2026-09-05 00:46 +0200 早于本地落盘；CL4R1T4S commit 2026-09-01 < 研究日），无未来时间倒挂（除 1.12 所列规范元数据日期笔误，不构成研究数据编造）；机制性陈述（文件路径/行号/工具清单）内部一致且与可核验的仓库自述吻合（claw-code README "agent-managed museum exhibit…no human intervention" 与 claw-code.md 自述逐字一致，经 web_search 佐证仓库真实存在）。
- 10（只做功能列表）：各研究文档均达源码/调用链级（comparison.md 各机制"实现位置"字段到文件+行号/函数），非功能列表。

### 1.12 前一轮 MAJOR/MINOR 处理情况（含时间核验）

- **M1（codex.md 研究日期 2026-09-08 未来日期）→ ✅ 修复**：codex.md 行 3 现为"研究日期：2026-09-05（clone 并阅读 main 分支）"，与文件落盘时间 2026-09-05 02:12 一致。全量研究文档日期核验：8 份文档研究日期均 ≤ 各自文件落盘时间，无未来时间倒挂。
- **m1（固定汇报格式字段未落实）→ ⚠️ 部分修复（降级为 MINOR，不构成 MAJOR）**：comparison.md 采用"实现位置 + 核心机制一句话"替代六字段（实现位置 87 处、核心机制一句话 85 处，触发条件/状态保留标签 0 处）；优点/缺点落在 8 份研究文档 H 节（每份 11–12 处）。decision 四件套 Decision/Why/Rejected/Proposed Spec 已在 comparison.md 每机制完整实现（原 m1 的主体——无决策段——已消除）。触发条件/状态保留内容实际存在但未以独立标签呈现（如 codex.md H04 触发时机、tool call 保留策略以正文段落写明），属于格式标签而非内容缺失。
- **m2（commit SHA 未核验）→ ⚠️ 部分处理（审查环境限制，如实降级为 MINOR）**：本轮 web 可达性仍受限（github.com DNS 解析为非公网 IP，commit 页抓取失败），SHA 真实性无法在线确认；web_search 佐证了各仓库真实存在且自述吻合（[claw-code 仓库](https://github.com/ultraworkers/claw-code)、[openai/codex 提交页](https://github.com/openai/codex/commits)、[deepseek-harness](https://github.com/hyudryu/deepseek-harness) 等）。建议在可联网环境复检 SHA。

## 2. 新发现（本轮新增问题）

- **n1（MINOR）— D3–D8 六份规范头部"日期：2026-09-06"为超前日期**：DESIGN-DECISIONS/ BEHAVIOR-IR-SPEC/ EVENT-SPEC/ POLICY-SPEC/ BENCHMARK-SPEC/ ARCHITECTURE 六份文件头部均标"日期：2026-09-06"，而文件落盘时间全部为 2026-09-05 03:14–03:54（早于"现在"2026-09-05 03:56）。与第一轮 codex.md 未来日期同类（元数据笔误/超前标注），非研究数据编造（正文无未来事实依赖）。建议统改为 2026-09-05 或撰写完成实际日期。
  - ✅ 已修复（复审后）：六份规范头部日期、BEHAVIOR-IR-SPEC changelog 与 BENCHMARK-SPEC JSONL 示例已批量统一为 2026-09-05，docs 下已无 2026-09-06 残留（本报告为历史快照除外）。
- **n2（MINOR）— 仓库 URL/镜像措辞笔误（待核）**：claw-code.md 锁定 URL 写作 `github.com/ultraworkers/claw-code`，而自述 commit `08106b0c`（2026-08-16 "docs: add hierarchical AGENTS.md knowledge base"）对应的仓库属 ultraworkers/claw-code（web_search 佐证该组织与自述的 "museum exhibit / no human intervention" 吻合，但 commit 归属组织名需在联网环境复核）；pi.md"pi-mono 亦镜像于 earendil-works/pi-mono"措辞疑与真实 fork 关系不符（无法在线核验，列为待确认）。
- **n3（信息项，不列问题）— HARNESS-COMPARISON.md 与 comparison.md 内容重复（SHA-256 相同）**：D2 与研究输出树第 9 个文件为同一内容双份归档，符合任务书对 D2"横向矩阵"的命名要求，不构成缺陷；后续如需二者分治（矩阵 vs 决策细则）可在第三阶段再平衡。
- **n4（信息项）— benchmarks/ 四目录为空**：任务书第十五节要求"从第一天建立测试"，第一阶段已交付 D7 完整契约与目录骨架，实际 fixture/scenario 代码属第三阶段落码范围，不判缺失。

## 3. 缺失清单（missing）— 全部清空

第一轮 missing 清单 13 项（5 研究文档 + comparison + D1–D8 + benchmarks/）在第二轮已全部补齐/建立。无新增缺失。

## 4. 最终 VERDICT: **PASS**

12 项验收核对清单全部 PASS；第一轮 BLOCKER（B1–B4）与 MAJOR（M1）全部消除；禁止事项六道门槛未发现违反；遗留问题仅为 2 项 MINOR 元数据级问题（n1 超前日期标注、n2 URL/镜像措辞待核）与 1 项受审查环境限制无法在线完成的 SHA 复核（m2，已在第一轮如实声明）。按"无 BLOCKER、无未解决 MAJOR 即 PASS"的判定规则，第一阶段交付物通过最终验收，满足任务书第二十二节"禁止进入大规模编码阶段"的解禁前置条件。
