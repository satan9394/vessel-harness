# 151 — 探针加严 + 首次 `--live` 部分基线（vessel 25/25、opencode 25/25）

- 编号：151
- 状态：已合入（2026-09-19）
- 优先级：P1（`--live` 基线的落地）
- 创建日期：2026-09-19
- 关联：`tasks/149`（发现）、`tasks/150`（opencode 修复）、`docs/V1.6-STABLE-CHECKLIST.md` #10、`README.md`
- 执行器：指挥侧

## 1. 目标

把 `--live` 探针从"`--version` 可执行"升级为"**能跑一次最小 headless 调用**"，使不可用 harness
以 `skip`（带原因）出现而非误导性的 `fail`；随后跑首次 `--live` 基线并据此定回归阈值。

## 2. 改动

- 四个 adapter（dsh/opencode/codex/claude）的 `defaultRunCommand` 增 `timeoutMs`；新增
  `probe{Dsh,Opencode,Codex,Claude}EnvLive` —— 一次最小真实调用（45s 上界）。
  dsh 的 headless 会启动整套插件（分钟级）⇒ 45s 超时即判不可用（**诚实跳过**，不冒充 `fail`）。
- `run-conformance.ts` 的 `selectAdapters` 在 `--live` 改用 live 探针；`THRESHOLDS` 由基线定：
  `maxInvalidCalls {'*': 0}` + `minSuccessRate {'*': 0.9}`。

## 3. 验收与实测

- 定向：`opencode/codex/claude` adapter 测试 **37 passed**；`tsc -b` exit 0。
- **live 探针判别证据**（`--scenarios B001 --live`）：
  ```
  [conformance] skip external harness "dsh": CLI not usable on this machine
  [conformance] skip external harness "codex": CLI not usable on this machine
  [conformance] skip external harness "claude-code": CLI not usable on this machine
  [conformance] skip external harness "pi": CLI not usable on this machine
  [conformance] 1 fixtures × 2 adapters (vessel, opencode) [live]
  ```
  ⇒ 2/2 run，100%（改前是 4 个 `fail` 行 + 误导性 20%）。
- **首次 `--live` 部分基线**（`--all --live`，exit 0）：
  ```
  harness    runs pass fail success avgWall(ms)
  opencode     25   25    0    100%       69544
  vessel       25   25    0    100%          97
  ```
  **0 非法调用、0 threshold 违规**。慢点：opencode 的 B018 543s / B022 241s / B023 127s（模型自主多步，非 harness 缺陷）。
  报告落 `benchmarks/reports/conformance/`（生成物，gitignore）。

## 4. 未闭合（登记）

- **codex**（配额耗尽）、**claude**（配置模型已停用）：adapter 的 flag 已正确、拆词已修，但仍需在各自环境可用时
  补 `--json` JSONL / 单对象解析并 live 验证。
- **dsh**：adapter 仍驱动旧 `dsh run` 面；其 headless 启动成本过高，不适合 live lane。
- 阈值仅 **2 harness** 样本，待更多 harness 可用后再收紧（当前 `minSuccessRate≥0.9` 允许 25 场景中 1 个回归）。

## 5. 边界

- 不改离线车道（`--all` 仍 **25/25 exit 0**）；live 探针会消耗**一次**真实调用配额（每 harness）。
