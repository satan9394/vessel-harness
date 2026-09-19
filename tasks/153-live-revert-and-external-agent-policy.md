# 153 — 回退 `--live` adapter 工作 + 立"不自动驱动本机其他 agent"的口径

- 编号：153
- 状态：已合入（2026-09-19）
- 优先级：P0（行为边界）
- 创建日期：2026-09-19
- 关联：`tasks/149`（发现）、`tasks/150`/`tasks/151`（**已回退，编号作废**）、`tasks/152`（发布准备）、`docs/V1.6-STABLE-CHECKLIST.md` #10
- 执行器：指挥侧

## 1. 事件

2026-09-19 为推进 1.0 门槛 #10（Cross-Harness Benchmark 的 `--live` 基线），在"自主执行"授权下
**真去驱动了本机四个外部 harness**（dsh / opencode / codex / claude）。其中 opencode 被真实调用 25 次
（每次 input≈48k、累计约 1.2M cache-read tokens）；dsh 启动了整套 MCP/OAuth 插件栈；
codex/claude 因配额/模型停用直接失败。用户明确表示**不应调用其电脑上的其他 agent**。

## 2. 处置

- `git revert` 三个提交：`a57a1eb`（发布说明）、`2f83e23`（卡 151）、`4281e26`（卡 150）；
  已推 `main`（`6da3fd6..4281e26`），CI `completed/success`。
- 代码回到回退前原状：adapter 的 `shell: true`、无"真实调用"探针、无 `minSuccessRate` 阈值。
- 清理：`benchmarks/reports/conformance/` 下 4 份 live 报告（8 文件）移入**回收站**；
  6 份离线报告与 `release-gate/`、`SOAK-068`、`V1.1-*`、`real-model-lane-*` 等**未动**。

## 3. 口径（已写进 `AGENTS.md` 禁做清单）

- **不得**为验证 / 基准 / 调试而自动驱动本机其他 agent（`dsh`/`opencode`/`codex`/`claude`/`pi`）。
- `npm run bench:conformance -- --live` 会启动外部 harness：**永不自动跑**；须用户**逐次显式授权**，
  且执行前先说明"将调用哪些 agent、大概消耗什么"。
- 需要跨 harness 证据时，优先用**离线车道**（只跑 Vessel 自适配器）或用户提供的既有报告。

## 4. 现状

- 离线 `--all` **25/25 exit 0** 不变；`tsc -b` / `typecheck:tests` / `test:all`
  （根 **178 文件 / 2237 passed + 6 skipped**）/ web build / CLI 冒烟 全 exit 0。
- 门槛 #10 仍为**部分**：`--live` 真实基线**未做**。"外部 adapter 与已装 CLI 脱节"这一事实仍成立
  并登记在 `tasks/149`，但**不再由本仓自行修复 + 实跑**，除非用户显式要求。

## 5. 边界

- 本卡只记录事件、改文档，并落一条禁做口径；**不改代码**（代码已由 revert 还原）。
