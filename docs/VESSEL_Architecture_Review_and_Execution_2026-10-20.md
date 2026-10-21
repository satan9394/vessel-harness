# VESSEL 架构审查与 Agent 可执行整改规范

> 文档 ID：`VESSEL-ARCH-2026-02`  
> 版本：1.0（2026-10-20）  
> 项目：[satan9394/vessel-harness](https://github.com/satan9394/vessel-harness)  
> **唯一审查基线**：`feat/v2.8-taste-ui`，提交 `3a1bf2f257ad3d56a2fa343796bc5629354be2f8`  
> 状态：**只读源码审查完成；建议项尚未实现，尚未在本次审查环境运行测试**  
> 关联但独立的 UI 规范：`VESSEL_UI_UX_Review_and_Execution_2026-10-20.md`。

## 0. 结论与不可越过的设计边界

**不推倒重做，不复制 DSH/Codex/OpenCode 的内部架构，不新增第二套 Agent Loop。** VESSEL 当前真正值得保留并加强的差异化，是 `Behavior IR → Compiler → Policy Runtime → 可审计执行 → Cross-Harness Conformance`。下一轮以 **状态真实性、执行恢复、兼容边界、单一事实源及可证明的安全性** 为核心。模块化单体优先于微服务化，外部 Harness 适配优先于假设性“全能力兼容”。

### 0.1 审查证据等级

- **S：静态源码已确认**。GitHub 对应 SHA 的确切文件和逻辑能够直接指出；不等同于运行验证。
- **D：文档/任务卡自述**。可证明设计意图、已声称交付、测试命令；不等同于本次重新跑通。
- **H：风险假设**。需先写复现或探针，不得直接描述为已发生的生产故障。
- **R：拟议设计**。尚不存在于工程中，实施前须确定接口和迁移策略。

### 0.2 仓库事实

- `AGENTS.md`：Node ≥20、npm workspaces、Windows/PowerShell、npm lockfile 唯一事实源、回收站删除原则、模块化单体、薄 Core、无依赖环、全量门禁为 `npm run test:all`（包含根与 Web 双 root）。
- `packages/`：shared、core、llm、behavior、context、tools、policy、runtime、memory、skills、agents、telemetry、engine、application 共 14 包；`apps/` 有 cli、local-server、web。
- `packages/core/src/agent-loop/AgentLoop.ts`、`packages/application/src/session/SessionController.ts`、`packages/runtime/src/executor/Executor.ts`、`packages/agents/src/subagent/SubagentManager.ts`、`packages/agents/src/external/ExternalAgentRuntime.ts`、`packages/application/src/behavior/composeDraft.ts` 已存在，不可重复造轮子。
- `packages/runtime/src/executor/EffectJournal.ts` 已存在 fsync 的 `intent/outcome` 边界，对非只读未知结果明确禁止直接重放（S）。这不是从零建设 Journal 的项目。
- `docs/HARNESS-ADAPTER-CONTRACT.md` 及 `benchmarks/runners/src/adapters/` 已有 DSH、OpenCode、Codex、Pi、Claude Code benchmark adapter（D）。**Benchmark adapter ≠ 可交互、可审批、可恢复的外部 Agent Runtime adapter**。
- `AGENTS.md` 和 `HANDOFF.md` 声称 `packages/core` 零修改、Web 50 文件 / 404 测试通过及完整 Card 235 交付（D）；本次未实际执行 `npm ci`、build 或测试。
- GitHub 对比 `main...feat/v2.8-taste-ui` 返回 `diverged`、ahead 24、behind 9（查询时状态）。本地 `main` 的快进说法不能用来推断**远端** `main` 已同步；不得自动 rebase、merge 或 force push。

## 1. 主要问题清单（以证据强度排序）

| 编号 | 等级 | 优先级 | 现象与证据 | 风险 | 行动 |
|---|---|---|---|---|---|
| A-01 | S | P0 | `apps/local-server/src/routes/activityRoutes.ts`：`approval ? needs_attention : turnActive ? running : completed`，非活动会话被默认映射为完成。 | 失败/中断/未知可能被显示为成功。 | 设计可追溯的终态投影与未知状态。 |
| A-02 | S | P0 | `apps/web/src/App.tsx` 约 119–127 行：`Promise.all(ids.map(id => api.deleteSession(id).catch(() => {})))`，随后本地直接移除全部 ID。 | 部分删除失败会被前端掩盖；与“安全删除”原则冲突。 | 单项回执、按成功 ID 更新 UI，失败可恢复。 |
| A-03 | S/D | P0 | `packages/runtime/src/executor/EffectJournal.ts` 已对未知写拒绝重放；但恢复后由谁完成 side-effect reconciliation 需链路验证。 | 不能将“已有防重复逻辑”误判为端到端 exactly-once。 | 注入故障测试意图/执行/回执各断点。 |
| A-04 | S/D | P1 | `docs/HARNESS-ADAPTER-CONTRACT.md` 为 `run(fixture)` 的 benchmark 契约；现有外部 runtime 与 benchmark adapter 并非统一的交互式能力面。 | UI 可能把模拟或近似能力显示为真正支持。 | 区分 BenchmarkAdapter 与 InteractiveRuntimeAdapter。 |
| A-05 | S | P1 | `packages/application/src/providers/presets.data.ts` 与 `apps/web/src/components/providers/presetsData.ts` 两份预设目录；UI `ProviderSettingsModal.tsx` 又派生 `PROVIDER_PRESETS`。 | 默认模型、端点、分类容易随时间漂移。 | 定义一次性目录及自动校验。 |
| A-06 | S | P1 | `apps/web/src/workbench.ts` 将部分 wire types 维护为本地镜像；`apps/local-server/src/routes/activityRoutes.ts` 独立维护对应类型。 | UI、API、后端协议升级不同时失败。 | 共享协议/生成 schema 与兼容测试。 |
| A-07 | S | P1 | `packages/application/src/behavior/composeDraft.ts` 的候选组合调用 live compiler，但返回 advisory conformance；`AgentStudioComposer` 不激活候选。 | “已验证”易被误解为“已经对当前 Run 生效”。 | 明确 Preview、Activate、Snapshot 三个状态。 |
| A-08 | H | P1 | Web 客户端存在 SSE 与内存快照；刷新、断网、重复消息、Event replay 的全链路一致性尚未在本轮验证。 | UI 显示与持久事实源分叉。 | 运行实测及幂等收敛测试。 |
| A-09 | H | P1 | 沙箱宣称 Windows Job Object / process tree / filesystem 后端，但“进程受控”不自动代表所有 FS/网络副作用受控。 | 高估安全保证。 | 系统级逆向测试 + 降级态可见。 |
| A-10 | D | P2 | 任务交接记录仍含旧 HEAD、旧 main 描述及早期测试统计；README 也存在早期冻结基线。 | Agent 读取错误状态后重复或误开发。 | 将**当前事实**与**历史快照**分开维护。 |

**排序原则**：优先纠正错误成功、静默数据损失和无证据能力宣称，再做性能、抽象与平台扩展。禁止按技术名词新颖度排期。

## 2. 目标分层：保留唯一运行核心

```text
Web / CLI / SDK
    ↓   UI View Models / Commands
Application: Session / Run Controller / Approvals / Project
    ↓   canonical contracts + revisioned events
Execution Control: Behavior Compile / Policy / Context / Budget
    ↓
Native Vessel Agent Loop ───── External Runtime Host [独立能力面]
    ↓                                  ↓
Tools / EffectJournal / Sandbox       Versioned Adapters + Isolation
    └─────────── canonical Event / Artifact receipts ───────────┘
                         ↓
     Session Projection / Replay / Conformance / Diagnostics
```

分层必须避免两类错误：

1. 外部 `codex`、`opencode`、`dsh` 是**运行时**，不是一个 `ModelProvider`；Claude/DeepSeek/GPT 是模型，不等于 Claude Code/DSH/Codex。
2. 安全领域要分清 **prompt guidance（建议）**、**tool policy（工具边界）**、**OS sandbox（环境约束）** 和 **observed evidence（观测证据）**；不可互相替代。

> **执行决策**：`packages/core` 默认为 no-touch 区域。若证据证明必须修改核心契约，先提交 ADR、兼容迁移与回滚计划，获得明确批准后单独实施；避免“永远零行修改”成为阻碍正确修复的教条。

## 3. 工作包与精确实施合同

### ARCH-01 / P0 — 会话/Run 状态真实性

**现有定位**：`apps/local-server/src/routes/activityRoutes.ts`、`packages/application/src/projections/ConversationProjection.ts`、`packages/application/src/session/SessionController.ts`、`packages/shared/src/` 相关投影/事件类型、`apps/web/src/workbench.ts`。

**任务**：追溯事件源中的 Run end/failed/interrupt/unknown/approval 信息；定义 Run 与 Session 的不同生命周期。不将静止状态直接视为 completed。只有观测到权威成功终态事件/回执才标记 completed；缺失或无法确定时显示 unknown，不能伪造 failed。已有 status union 的修改先通过服务端与前端协商兼容，不要破坏历史数据。

**建议契约 R（名称仅示例，先查现有类型后映射）**：`RunState = queued | running | waiting_approval | completed | failed | interrupted | cancelled | unknown`。响应建议包含 `status`、`statusSource`、`observedAt`、`sessionId?`、`runId?`、`reasonCode?`、`revision`。

**验收**：8 类终态/非终态表驱动测试；失败运行结束后不会返回 completed；断电造成的未知结果不会返回 success；浏览器刷新结果一致；历史事件缺失返回 unknown 而非误报。禁止只在 UI 上改文案掩盖服务端语义。

### ARCH-02 / P0 — 会话安全删除的端到端一致性

**现有定位**：`apps/web/src/App.tsx` 的 `deleteSession`；`apps/web/src/api.ts`；`apps/local-server/src/server.ts` 的会话 DELETE 处理；底层回收站实现与 SessionRegistry（先定位实际调用链）。

**任务**：停止吞掉子请求错误；单次或批量删除返回逐项 `deleted / not_found / failed` 及可审计错误码；只有被服务端确认成功且投影已一致的 ID 才移出前端。批量部分失败时保留失败条目、显示重试提示；不得对用户数据永久删除、不得只做内存删除。

**建议 API R**：`{ results:[{sessionId,status:'deleted'|'not_found'|'failed',errorCode?}], requestId }`。若当前 endpoint 按单 ID 删除，则先在 UI 做分项回执收敛，不为此强制更改 API。

**验收**：mock 两成功一失败时仅移除两项；服务器 500/超时/回收站失败时不显示“已删除”；刷新后列表与磁盘/索引一致；同 ID 重试遵循幂等约定；备份或回收站语义符合 `AGENTS.md`。

### ARCH-03 / P0 — EffectJournal、ExecutionPermit 与未知副作用恢复证明

**现有定位**：`packages/runtime/src/executor/EffectJournal.ts`、`Executor.ts`、`packages/policy/src/engine/Engine.ts`、`packages/application/src/session/SessionController.ts`；对应测试及 `docs/POLICY-SPEC.md`。

**任务**：不重写现有 Journal；先绘制 `ToolCall → policy → permit → effect intent fsync → dispatch → outcome fsync → event projection` 的真实调用图并逐段标记“已实现/待核实”。检查崩溃发生在：intent 前、intent 后 dispatch 前、执行完 outcome 前、outcome 后 UI 回放前。对写工具未知结果默认**阻止自动重试**并引导人工或确定性 reconcile；只读工具在契约允许时重试。

**验收**：故障注入覆盖上述四点、重复 toolCallId、改写工具参数、permit 过期、乱序事件与重进；不重复执行有副作用动作；未知结果明确 `OUTCOME_UNKNOWN`；journal 永久记录在当前许可状态目录。任何“exactly once”宣称须有分布式边界说明，否则使用“at-most-once dispatch + reconcile”。

### ARCH-04 / P1 — 外部 Harness 合法的能力契约与版本适配

**现有定位**：`benchmarks/runners/src/contracts/`、`benchmarks/runners/src/adapters/{dsh,opencode,codex,pi,claude-code}.ts`，`packages/agents/src/external/ExternalAgentRuntime.ts`，`docs/HARNESS-ADAPTER-CONTRACT.md`。

**任务**：先分清旧 `BenchmarkHarnessAdapter`（跑 fixture）与新 `InteractiveRuntimeAdapter`（可选；持续任务）。不能把旧 `run(fixture)` 硬替换为交互生命周期接口。复用 `ExternalAgentRuntime` 的 worktree/process lease、安全回收与事件归一能力，新增薄适配层/能力探测，而不是第二个 Loop。

**拟议交互式接口 R（不要假设所有外部运行时都具备）**：

```ts
type FeatureSupport = 'supported' | 'unsupported' | 'unknown';
type RuntimeCapabilities = Record<
  'start' | 'events' | 'steer' | 'cancel' | 'resume' | 'approvals' | 'artifacts',
  FeatureSupport
>;
interface InteractiveRuntimeAdapter {
  id: string;
  version: string;
  probe(): Promise<{ installedVersion?: string; capabilities: RuntimeCapabilities }>;
  startRun(input: SafeRunInput): Promise<{ runId: string }>;
  subscribeEvents?(runId: string, cursor?: string): AsyncIterable<NormalizedEvent>;
  steerRun?(runId: string, text: string): Promise<void>;
  cancelRun?(runId: string): Promise<void>;
  resumeRun?(runId: string): Promise<void>;
  getArtifacts?(runId: string): Promise<ArtifactReceipt[]>;
}
```

本示例为产品契约草案，不是已存在的 TypeScript 类型。编译前先在 `@vessel/shared` 中确定接口/导入方向；不能让 shared 反向 import 应用层。

**版本策略**：记录 `adapterVersion`、实际 `externalVersion`、平台、能力探针时间、字段转换版本；旧协议单独兼容解码。OpenCode **v2.1.0** 于 2026-10-20 修改 SDK/HTTP/event 中 replay 数据及 compaction 命名（`native`），但只在直接消费这些接口时需要映射；仅 CLI 运行的适配器不应凭空修改不接触的事件字段。OpenCode V2 与 V1 Server API 本身也不兼容。外部 CLI 参数必须通过实际 `--help` / 文档 / mock 适配与受控实跑确认，禁止假设 `--task` 一定可用。

**验收**：每个 runtime 的能力矩阵有来源+测试；版本不支持时显式 degraded；缺数据标 unknown，不填 0 假装测过；取消后子进程不会遗留；断线恢复可恢复则测试成功，不支持则禁用入口；禁止标记“全部兼容”。

### ARCH-05 / P1 — Provider/Model 单一目录与能力协商

**现有定位**：`packages/application/src/providers/presets.data.ts`、`apps/web/src/components/providers/presetsData.ts`、`ProviderSettingsModal.tsx`、`apps/local-server/src/routes/providerRoutes.ts`、`packages/llm/src/capabilities.ts`。

**任务**：以服务端或共享纯数据包作为预设目录 SSOT，Web 使用稳定且版本化的 DTO/静态共享数据；不让前端单独维护一份 72+ 卡片清单。保持 `model id`、Provider、Protocol、capability 的身份区分；区分“供应商宣称”“探针观测”“用户覆盖”与“最后一次验证”及过期状态。

**验收**：同一预设的 endpoint、默认模型和分类在 CLI/Web/API 一致；升级目录不覆盖已有用户凭据与自定义 endpoints；模型列表拉取失败时保留已验证旧配置并清楚标记陈旧；模型切换前完成 capability negotiation；凭据不回传明文给 Web。

### ARCH-06 / P1 — Event/SSE/Session Projection 一致性

**现有定位**：`apps/web/src/sse.ts`、`apps/web/src/components/ConversationView.tsx`、`packages/application/src/projections/*`、`apps/local-server/src/server.ts`、`docs/EVENT-SPEC.md`。

**任务**：检查 Web 首屏 snapshot + SSE 的事件 cursor、重复/乱序/丢帧、断线重连、会话切换竞态及刷新恢复。服务端投影必须为最终事实；浏览器内存缓存只作加速。归一事件类型应该带 version、run/session identity、event identity、monotonic cursor（使用现有实现的等价字段，不必重复发明）。保证增量与全量重建得到相同可观察状态。

**验收**：丢 1 帧、重复 2 帧、乱序、断线 30s、页面刷新、快速切换三个会话；最终内容、工具结果、计费、审批不会串会话或重复；UI 没有无限转圈及假成功。若数据一致性不足，先修协议再动动画。

### ARCH-07 / P1 — 安全授权边界与 Subagent 权限单调收窄

**现有定位**：`packages/agents/src/subagent/SubagentManager.ts`、`IsolatedRuntime.ts`、`packages/agents/src/external/ExternalAgentRuntime.ts`、`packages/policy/src/engine/Engine.ts`、`packages/runtime/src/sandbox/backend/*`。

**任务**：复核子代理的工具 allowlist、文件路径、审批策略、权限层级和外部工作树是否都只能继承/收窄父级授权；检查 symlink/junction/相对路径、PowerShell 子进程、网络出口、Windows Job Object 失效模式。**不要把进程树收敛描述为 OS 文件系统隔离已验证**。在运行态展示 `enforced / degraded / unavailable` 及可观测原因。

**验收**：子代理请求更宽权限被拒绝；危险 Shell/受保护目录无越权路径；禁用/故障 sandbox 不会默许写入；各平台单独给出验证矩阵。严禁借新 UI 规则编辑器绕过 system policy。

### ARCH-08 / P2 — Context / Compaction 守恒与能力归因

**现有定位**：`packages/context/src/compaction/*`、`packages/context/src/cache/LayeredContextCache.ts`、`packages/context/src/builder/Builder.ts`、`docs/EVENT-SPEC.md`。

**任务**：为长对话构造事件黄金样本，比较压缩前后 policy/source refs、未完成工具调用、用户约束、待审批与重要文件引用是否守恒；提供压缩结果 hash/provenance；不要把摘要当成能替代原始硬约束的安全事实源。对跨 Provider 的 cache 命中率/成本进行计费口径对账。

**验收**：多轮长会话、模型切换、合成大量工具事件、compact 后恢复，policy 不丢、未决 effect 不丢、引用可追溯；压缩失败回退安全。

### ARCH-09 / P2 — 可复现实验与工程门禁

**现有定位**：`benchmarks/scenarios/`、`benchmarks/runners/`、`docs/BENCHMARK-SPEC.md`、`package.json`、`.github/workflows/ci.yml`。

**任务**：建立 10–20 个针对“失败后还声称成功”、部分删除、真实 adapter 降级、未知副作用、事件重放、不同模型能力协商的最小黄金 fixture。区分 mock / live / CI；live 会有第三方消费与副作用，必须单独显式授权。保存匿名化记录、Git SHA、工具版本、环境指纹、成功/失败判据；历史 benchmark 报告不可当当前 HEAD 的绿灯。

**验证命令（仓库约定；在用户隔离环境运行）**：

```powershell
npm ci
npm run build
npm run typecheck:tests
npm run -w @vessel/web typecheck
npm run -w @vessel/web build -- --emptyOutDir false
npm run test:all
```

此处提供命令，不表示本文已运行。验证要在**最后一次代码编辑之后**执行。对 Web 50 文件/404 项的数字只使用任务卡历史陈述，不作为未跑测试的本轮结论。

## 4. 分批执行顺序与跨文档依赖

| 批次 | 先决条件 | 本文卡片 | 产出 | UI 文档依赖 |
|---|---|---|---|---|
| B0 | 固定 SHA，审计现有测试及调用链 | ARCH-01、ARCH-02 | Run 真状态、删除真实回执 | UI-01、UI-02、UI-04 |
| B1 | B0 通过 | ARCH-03、ARCH-06 | effect 重试约束 + replay 一致性 | UI-03（会话）、UI-05（执行） |
| B2 | B1 通过 | ARCH-04、ARCH-05、ARCH-07 | 适配能力矩阵、Provider SSOT、安全边界 | UI-06、UI-07、UI-08 |
| B3 | B2 通过 | ARCH-08、ARCH-09 | golden traces、可靠性与兼容性报告 | UI-09、UI-10 |

**冲突解决规则**：架构文档负责协议、事件语义、授权、生命周期；UI 文档负责导航、呈现、交互。遇到同名状态字段与兼容等级矛盾，以通过版本迁移与测试的 server/shared 契约为准；不能先改 UI mock 成“正确结果”。

## 5. Agent 开发协议：每张卡必须执行

1. **对齐基线**：读取 `AGENTS.md`、`HANDOFF.md`、`docs/DESIGN-DECISIONS.md`，记录 `git status`、`git rev-parse HEAD`、目标分支。用户给定的 SHA 是审查输入，不代表允许重置本地工作区；若当前已前进，执行差量复核。
2. **标注发现状态**：`confirmed-in-code / reproduced / already-fixed / blocked / proposed`；先检查现有实现与单测，严禁复刻已有模块。
3. **测试先行**：对每个 P0 先写可重复的失败测试；外部副作用用注入适配器/临时隔离目录；对未知结果不能用空值伪成功。
4. **最小变更**：优先应用层、共享契约和既有工具；不额外创建微服务、不重写 Core、不更换 npm，不迁移已有持久化数据而没有回滚设计。
5. **独立核验**：实现 Agent 与 Reviewer 分工；Reviewer 读取完整差异、核对调用链、负向测试与产品文案，不得仅接受 Implementer 自报。
6. **交付凭据**：每张卡提交 `ChangedFiles / Rationale / Tests / Before-After Behavior / Compatibility / Rollback / Residual Risk / Evidence Paths`；更新 `tasks/` 与 `HANDOFF.md` 的**当前状态段**，历史记录保留历史标识。
7. **权限纪律**：绝不运行真实用户数据永久删除；不用 force push；不自动 merge；`--live` 外部 Agent 必须显式授权和有成本预算。不给出实际凭据或未经脱敏的用户 Trace。
8. **停止条件**：无法复现、权限不明、测试指向旧状态、会破坏已实现的安全/回收站/事件语义时，先输出阻塞证据，不进行投机性“大扫除”。

## 6. 每项整改统一验收模板

```markdown
### [ARCH-XX] 验收记录
- Baseline HEAD / Final HEAD:
- Bug reproduced? [yes/no/not-applicable] + test:
- Existing mechanism reused:
- Changed files / contract version:
- Success path:
- Failure, cancellation, unknown-outcome path:
- Permissions / data-loss regression:
- npm run build:
- npm run typecheck:tests:
- npm run -w @vessel/web typecheck:
- npm run -w @vessel/web build -- --emptyOutDir false:
- npm run test:all (root + Web):
- Golden fixture / browser trace:
- Reviewer verdict + evidence:
- Rollback instructions:
- Known limitations:
```

## 7. 需要用户另行补充、而 GitHub 无法证明的信息

**非开始静态整改的前置条件**。为了关闭最终产品可靠性验收，建议补充：

- 一段**真实编码会话**的录屏：建任务→Agent 工具调用→中途 steer→Stop/失败→恢复→Diff 审查。优先包含 Activity、Studio、Inspector 的切换。
- 该会话的**脱敏 Event/SSE Trace、Server 日志和失败前后 Session 快照**；严格去掉 API keys、私有代码、文件绝对路径中的敏感信息。
- 本机 OS/Node 版本、实际安装的 opencode/codex/dsh/claude/PI CLI 版本，以及本地 Server 对外暴露方式（loopback/远程）。
- 一份明确的非目标清单：是否优先 Windows-only、是否允许外部 runtime 真正写工作区、是否打算支持多用户。若未提供，按**单用户、本地优先、Windows 是重点、不新增云服务**的既有设计继续。

## 8. 与上游项目的对应证据（截至 2026-10-20）

- OpenCode 2.1.0 官方 Changelog：<https://opencode.ai/changelog>。关注 Windows PTY、可靠长命令、`native` Replay 和 Compaction 破坏性契约；是否影响 VESSEL，取决于使用的实际适配层。
- OpenCode V2 migration：<https://opencode.ai/v2/docs/migrate-v1/>。V1/V2 插件及服务端 API 不可默认视为兼容。
- DeepSeek Harness release 0.2.1-rc.2：<https://github.com/deepseek-ai/deepseek-harness/releases>。关注插件生命周期、模型适配和 worktree；Claude Code Mods 兼容仍需独立验证。
- Codex 0.163.0 release：<https://github.com/openai/codex/releases>。关注 run steering、重连、权限恢复与沙箱行为。
- Claude Code agents 与 teams：<https://code.claude.com/docs/en/agents>、<https://code.claude.com/docs/en/agent-teams>。Subagent 与 Team 的协作和隔离语义不同，不应以统一“多 Agent”按钮抽象掉差别。

## 9. 最终 DoD（任何一项失败都不得宣布架构整改完成）

- [ ] Run 失败、未知、取消、审批与完成状态均有来源及可重建证据，绝无静止即成功。
- [ ] 删除成功/失败逐项确认，回收站与索引状态一致，无静默假删除。
- [ ] 已有 EffectJournal/Permit 在四个故障注入点通过，不重复未知副作用。
- [ ] 外部 Harness 的 BenchmarkAdapter 与 InteractiveRuntimeAdapter 区分明确，兼容能力按版本和证据声明。
- [ ] Provider 目录与 Web/API 能力来源单一或受自动一致性测试约束。
- [ ] policy/permissions/subagent 权限不被 UI 配置扩大；sandbox degraded 诚实呈现。
- [ ] SSE 重连、刷新、重放与会话切换后数据一致。
- [ ] root + web 类型、构建、完整测试全部在最终改动后执行并留存输出。
- [ ] Reviewer 独立复核并留痕；不存在“仅因测试数增加而被判定更好”的交付。

**禁止事项**：改写历史任务自证、把“文档已有”当“运行已验证”、复制上游源码或 Prompt、未授权真实外部 Agent 执行、添加平行 Loop、未征得许可发布/tag/push、永久删除用户数据。
