# V0.1 Implementation Notes — Composable Agent Harness 第二阶段交付说明

> 阶段：第二阶段（MISSION-V0.1.md）· 验收状态：见文末 · 日期：2026-09-05
> 总指挥签发任务：按 docs/ARCHITECTURE.md 的 V0.1 模块边界，用 TypeScript 实现可运行的最小 Harness V0.1（模块化单体）。

---

## 1. 模块地图（模块化单体，依赖方向零环）

仓库按 ARCHITECTURE §6.1 的单仓多包布局，npm workspaces 管理：

```text
composable-agent-harness/
├── apps/cli/                  # 进程入口（自建轻量 CLI）：--help / --version / run / run --bench
│   └── src/{cli,compose}.ts   # compose.ts = 组合根（唯一组装点）
├── packages/
│   ├── shared/                # 类型契约 + 事件词汇（B01–B21 子集）+ 常量（无依赖）
│   ├── core/                  # 薄内核：events(EventBus)/ session(JSONL 真源)/ state / agent-loop
│   ├── llm/                   # provider：OpenAICompatibleProvider + MockProvider；router
│   ├── behavior/              # ir（装载+校验 fail loud）+ compiler（L2/L3 渲染 + 双通道 policy_ref 检查）
│   ├── context/               # builder（stable→project→volatile 三层组装）/ instructions / compaction
│   ├── tools/                 # registry + 6 工具（Read/Write/Edit/Glob/Grep/Shell）+ 文件守卫
│   ├── policy/                # risk（Policy YAML → 四件套编译）/ engine（①–⑥ 裁决序）/ hooks（seam）
│   ├── runtime/               # executor（pre/post-execute 包裹）/ sandbox（confine seam）/ process
│   ├── memory/                # session 目录绑定（最小骨架）
│   ├── skills/                # SKILL.md frontmatter + 目录索引（最小骨架）
│   ├── agents/                # evaluator 契约 + Deterministic/LLM 实现
│   └── telemetry/             # 事件订阅 → M02–M14 指标 + JSONL 报告
├── benchmarks/
│   ├── fixtures/B001..B005/   # 首批场景 fixture（含 task.md / 隐藏测试 / verify 命令）
│   ├── scenarios/B001..B005.yaml  # 场景判据唯一事实源（pass 断言机器化）
│   ├── runners/               # runner：prepare → run → collect → assert → report
│   └── reports/B00X/run_*/    # 每 run 的 JSONL + summary.json
├── configs/                   # policy.default.yaml / behavior.default.yaml / pricing.json
├── scripts/demo-policy-deny.ts  # Policy DENY 演示（验收 3）
└── vitest.config.ts           # @vessel/* → src 别名，测试直跑源码
```

依赖方向铁律（ARCHITECTURE §1.2/§4）：core/ 只依赖 shared 的类型契约；机制包（llm/behavior/context/tools/policy/runtime/agents/telemetry）只依赖 core 的公开接口与 shared；policy/ 不反向依赖 tools（glob 匹配器包内自备）；无环。Provider seam 接口（ChatProvider）放 shared，实现放 llm/——core/agent-loop 不 import 任何机制实现。

## 2. 如何运行

```bash
npm install                      # 装依赖（Node ≥20）
npm run build                    # tsc -b 全仓构建（apps/cli/dist/cli.js 可执行）
npm test                         # Vitest 全量（59 用例，offline，无网络）

# CLI 单发模式（默认 mock provider，离线可跑）
node apps/cli/dist/cli.js --help
node apps/cli/dist/cli.js --version
node apps/cli/dist/cli.js run --workspace <dir> --prompt "请阅读 README.md 并总结"

# 真实模型（OpenAI-compatible，覆盖 DeepSeek/Qwen/本地端点）
node apps/cli/dist/cli.js run --workspace <dir> --prompt "..." \
  --provider openai-compatible --base-url <endpoint> --api-key <key> --model <model>

# 基准（B001–B005，offline mock lane，产出 JSONL 报告）
node apps/cli/dist/cli.js run --bench B001 --workspace <repoRoot> --out benchmarks/reports

# Policy DENY 演示（验收 3）
npx tsx scripts/demo-policy-deny.ts
```

## 3. 测试命令与覆盖（验收 1）

`npm test` → **11 个测试文件 / 59 用例全绿**（Vitest，全离线）：

| 包 | 覆盖 |
|---|---|
| core/events | emit 错误隔离 / waterfall 短路 / guard 单调收窄 / serial veto |
| core/session | JSONL append+seq 连续 / resume 合成 interrupted / surface 投影 / 单写者租约 / replaceRegion 重编号 |
| core/agent-loop | read→tool→answer 一轮闭环 / 纯文本即停 / 拒绝回灌 / max_steps 硬顶（budget） |
| tools | 6 工具注册/可见集 / 读写往返 / Edit / Glob / Grep / Shell 真执行 / 受保护路径 DENY / ../ 逃逸拒绝 / denied 工具移出上下文 |
| policy | 四件套编译 / 未知 key fail loud / ①denied_tools ②deny ③profile ⑥比较 / approval:never 服务内强制 / guard 不翻转 |
| context | 压缩压力阈值 / 平衡区域替换+尾部逐字+配对不拆 / 注入 summarizer / 三层组装+指令注入 / 可见工具裁剪 |
| llm | Mock 脚本状态机（ifNoToolResult/min/maxToolResults）/ OpenAI-compatible 线上格式（本地 HTTP server：tool_calls 解析、usage、role:tool 往返） |
| agents | Evaluator 契约：deterministic met/not_met / LLM goal-eval |
| telemetry | M02/M03/M06/M07/M12/M04 计数 + JSONL 报告行 |
| cli | --help / --version / run 冒烟（真实读文件→回答）/ Policy DENY 演示（审计+破坏未发生） |
| benchmarks/runners | B001–B005 offline 全 PASS + 报告文件断言 |

## 4. 验收对照（MISSION-V0.1 第六节 6 条）

1. **可运行代码 + Vitest 通过**：✔ 59/59（见 §3）
2. **CLI 端到端冒烟**：✔ `run --workspace <tmp> --prompt "请阅读 README.md"` → steps=2 toolCalls=1，最终回复含真实文件内容（SMOKE-DEMO-GOLDEN）
3. **Policy DENY 演示**：✔ `rm -rf ./node_modules` → 引擎 DENY（ref=shell-deny:destructive-delete, never_auto）+ `audit/denial` 落日志 + 目标文件未被删除（脚本 scripts/demo-policy-deny.ts）
4. **benchmarks 首批 5 场景可跑**：✔ B001–B005 全部 PASS，`benchmarks/reports/B00X/run_*/run_*.jsonl`（meta/metric/event/assert 行，BENCHMARK-SPEC §4.2 格式）+ summary.json
5. **本交付说明**：✔（本文档）
6. **独立复审**：✔ 由独立 Evaluator 子代理按 6 条逐条核验（见 docs/REVIEW-REPORT-V01.md）

## 5. 实现要点（与 ARCHITECTURE/DESIGN-DECISIONS 的对应）

- **薄核 Agent Loop**（D3 决策点 2）：core/agent-loop 只做 Model Call → Tool Call → Result → State Update → Continue/Stop；终止判据「纯文本/无未决 tool_call 即停」+ `max_steps_per_turn: 64` 机械硬顶；预算属扩展不内建。
- **事件两域**（D3 决策点 3/10）：持久记录（B01–B21 v0.1 子集，append-only JSONL）为唯一真源；扩展事件（A03/A07/A12/A13/A14/A04/A06）waterfall 决策点。waterfall 改「将要发生」，日志记「已经发生」。
- **Policy 四件套**（D3 决策点 8 / POLICY-SPEC）：一份 `configs/policy.default.yaml` 编译出 Prompt Guidance（软，BeforeModel 注入，不产审计事实）+ Tool Interceptor（deny 工具移出上下文）+ Runtime Deny（PolicyEngine 挂 BeforeTool 链，①denied_tools→②deny→④ask→⑤allow→⑥profile）+ Audit Event（audit/decision、audit/denial）。`approval: never` 服务内强制（fail-closed）；guard 单调只收窄。
- **软/硬分离**：行为 IR（configs/behavior.default.yaml）channel=runtime_policy 条目经编译器校验 policy_ref 存在执法规则（双通道强制，缺执法即告警）——安全规则绝不只写 prompt。
- **Context 组装**（D3 决策点 5）：stable 层每会话组装一次缓存（prefix cache 纪律）；指令（AGENTS.md 链）以带 source 的 user/message 注入（可回放可压缩）；历史由 session.surface() 投影派生（模型可见 ⟺ 已记录）；volatile（技能索引/环境）。
- **Compaction**（D3 决策点 6 / ARCHITECTURE §2.4）：三入口触发（pressure 0.8×window / overflow / manual）；事务化 compaction/start→summary→replace→end 恰好一次；最旧平衡区域替换（tool call/result 配对不拆）；尾部逐字保留（retainRatio 0.16）；摘要默认启发式，可注入 LLM summarizer；同会话日志内原地替换（not_new_session）。
- **Evaluator 契约**（D3 决策点 12）：verdict met/not_met/impossible/error；独立 LLM 调用形态（requestKind=goal-eval）+ 确定性实现；Generator 不自证完成。
- **Shell 只读识别**：字符串解析仅作只读识别与 deny 判定，主防线是 Policy 规则 + sandbox seam（POLICY-SPEC §2.4）。
- **Sandbox**（D3 决策点 9）：v0.1 提供 confine seam + 透明状态上报（Windows ACL partial，enforcement 上报 partial），OS 级后端（bwrap/Seatbelt/ACL 受限令牌）留 v0.2+；危险调用已在策略层 fail-closed 拒绝。

## 6. 已知限制与后续（V0.2 建议）

- **Sandbox OS 级后端未实现**：v0.1 的沙箱是 seam + 状态上报（partial），真正 bwrap/Seatbelt/Windows ACL 受限令牌执行隔离属 v0.2（ARCHITECTURE §4.7 已声明）。当前硬防线 = Policy 规则 + 工具层文件守卫。
- **ApprovalPolicy 固定 never**：无交互审批流（ask 交互随 UI 后置，ARCHITECTURE §5 克制项）；任何需审批的调用 fail-closed 拒绝。
- **hooks.json 兼容桥未实装**：policy/hooks 仅 seam（install 接口），外部 command hooks 子进程协议 v0.2。
- **Basic Compaction 摘要默认启发式**：LLM summarizer 可注入但未默认装配（避免离线测试依赖网络）；压缩压力检查在 compose 的 buildContext 钩子中生效。
- **benchmark live 车道未验证**：B001–B005 offline lane 全绿；live 车道需真实模型端点（`--provider openai-compatible`），本环境未配置密钥故未跑。
- **内存指标为估算**：M06/M07 token 计数来自 provider usage（mock 为固定值）或估算（context 组装）；跨 harness 对比时需按口径分组（BENCHMARK-SPEC §4.4）。
- **M01 成功率为 runner 判定**（asserts 全过=1），M08/M11 未采集（需要 usage 明细 + pricing.json 单价表，pricing.json 已就位）。
- **B004 的重构判据**：git_diff_scope 用快照 diff（fixture 工作区非 git 仓库时）归一化实现；外部 harness 对比时以 git 口径为准。
- **工作区未初始化 git 仓库**：本阶段未 git init（任务书禁止 force push，但未要求建仓）；如需版本管理可 `git init` 后提交，无需改动代码。
- **V0.2 建议**：MCP 客户端装载、Subagent/Evaluator Agent 化、sandbox 真实后端、hooks.json 桥、live 车道 + A/B 归因（BENCHMARK-SPEC §5 A–E 五组）、SQLite Storage 后端。
