# Vessel 1.0.0 — Release Notes（草稿 / DRAFT）

> **状态：草稿，尚未打 tag。** 1.0 Stable 门槛 13 项中 **达成 10 / 部分 3 / 阻塞 0**；
> 三项"部分"与两项待刷新产物见 §4。**打 tag 与发布是不可逆动作，留待人工确认**（本文件只准备到执行前一步）。
> 权威现状：`docs/V1.6-STABLE-CHECKLIST.md`；版本历史：`CHANGELOG.md`。

---

## 1. 这是什么（中文）

Vessel（器）是一个**本地优先、模型无关、可组合、可观察、带硬策略边界**的 Agent Harness。
名字取自「大器免成 / 无器之器」：系统本身不是任何一个组件——Model、Prompt、Agent、工具都是可替换的"器"。

三项核心差异点：**Agent Behavior IR + Behavior Compiler**（行为经版本化 IR 编译进每个 agent 的 stable system）、
**Policy Runtime 硬执法**（Prompt Guidance + Tool Interceptor + Runtime Deny + Audit 四件套，安全规则不只写在 prompt 里）、
**Generator/Evaluator 分离**（产出必须经独立评估，Generator 不得自证完成）。

## 2. What this is (English)

Vessel is a local-first, model-agnostic, composable agent harness: a thin core loop, behaviour compiled
from a versioned IR, hard policy enforcement instead of prompt-only rules, and CLI + local-Web surfaces —
every component replaceable without the system failing. Its three differentiators are the Behavior IR /
Compiler, the Policy Runtime (four-artifact hard enforcement), and strict Generator/Evaluator separation.

## 3. 安装与运行 / Install & run

```bash
npm ci                     # 干净安装（CI 硬门禁，锁文件必须一致）
npm run build              # tsc -b
npm run test:all           # 两个 root：根 + apps/web
npm run vessel -- run --prompt "你好"     # 零配置即用内置 mock（离线确定性）
```

接真实模型：`vessel setup`（交互向导）或 `vessel provider add …`（凭据经 Windows DPAPI 落 `~/.vessel/`，不落明文）。

## 4. 1.0 Stable 门槛状态 / Gate status（13 项）

| 结果 | 项 |
|---|---|
| **达成（10）** | 双 Surface（CLI + Web）、Streaming、Interrupt/Steering、Resume、Model Routing、3-Agent Profile、External Review Handoff、Secret Store、安全基准全绿（S001–S008）、clean install 可复现 |
| **部分（3）** | **#8 OS 级沙箱**：Windows 已交付 Job Object + process-tree；受限令牌降权与非 Windows 未做。**#10 Cross-Harness Benchmark**：驱动与入口已交付、离线 `--all` **25/25 exit 0**；**`--live` 基线 blocked** —— 实测发现四个外部 adapter 驱动的是"请求式 JSON 契约"而真实 CLI 不实现，且 Windows `shell:true` 会拆坏多词 prompt（`tasks/149`；修复 `tasks/150`，重跑 `tasks/151`）。**#11 Long-run soak**：确定性 1h-equivalent 已跑通（`handoffs=40/resume=true/零残留`）；字面 3h 墙钟未跑。 |
| **阻塞（0）** | — |

**待刷新的被跟踪产物**：`benchmarks/reports/release-report.{md,json}` 仍是 2026-09-12 旧判据快照
（刷新会经 CredentialStore 打真实模型，需有意执行；见 `docs/RELEASE-GATES.md` 末节）。

## 5. 本版本实测门禁（当前 HEAD）/ Verified gates

- `tsc -b` exit 0、`typecheck:tests` exit 0
- `test:all` exit 0：根 **178 文件 / 2237 passed + 6 skipped**、`apps/web` **11 文件 / 120 passed**
- web `vite build` exit 0、CLI 冒烟 exit 0
- `npm run bench:conformance -- --all`（离线）**25/25 exit 0**
- CI（Windows + Linux）绿；CodeQL / Dependabot / Secret scanning 告警 **0**

## 6. 亮点 / Highlights（详见 `CHANGELOG.md`）

- 薄核 Agent Loop + 事件词汇（EVENT-SPEC）+ 会话全量落盘；Behavior IR/Compiler；Policy 四件套硬执法。
- 双表面：`vessel` CLI + 本地 `vessel serve`/`vessel web`（React UI）。
- 供应商/成本纵深：71 预填端点、`vessel usage`/`pricing`/`models`、模型目录与价目、TUI `/cost`。
- 3-Agent Profile（Lead/Developer/Reviewer）、TaskRouter、Loop Engine、Generator/Evaluator 分离、External Review Handoff。
- 安全：Windows Job Object + process-tree、CredentialStore（DPAPI）、S001–S008 安全基准全绿。
- 跨 harness conformance 驱动与可运行入口（离线 25 场景）。

## 7. 明确不在 1.0 内 / Not in 1.0（路线排除）

Remote/Cloud/多设备/团队协作/插件市场/skills registry/后台调度（V2.x）；非 Windows OS 沙箱；
受限令牌降权；npm 对外分发（自用形态）；i18n 全量重构；IDE/桌面 App。

---

*Bilingual note: this document is intentionally one file with both languages inline; the gate numbers are
the current-HEAD measurements above and must be re-verified immediately before tagging.*
