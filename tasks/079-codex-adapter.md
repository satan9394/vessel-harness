# 079 — Codex Adapter（外部 harness 适配器）

- 状态：待验收
- 优先级：P0（Wave 5 / Milestone G）
- 创建日期：2026-09-08
- 关联：076（Harness Adapter Contract）；077/078（DSH/OpenCode adapters——同批模式范本）；080/081（Pi/Claude Code）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/HARNESS-ADAPTER-CONTRACT.md（076 指引）+ docs/DSH-ADAPTER.md / docs/OPENCODE-ADAPTER.md（同批范本）

## 目标

Codex Adapter：实现 076 契约，使同一 benchmark fixture 能在 Codex CLI 上运行并统一采集 §15 L3 指标。
与 077/078 同批模式：CLI 命令面驱动 + 可注入 command/入口 + 采集归一 + 环境探活（pending-environment 不 throw）
+ capabilities 诚实降级。clean-room：不读 Codex 源码、prompt 不引入。

## 验收标准（执行器逐条勾选）

- [ ] 读 076 契约（contracts/）与 077/078 范本（adapters/dsh.ts、opencode.ts + docs）——Codex adapter 对齐同模式
- [ ] Codex 驱动：CLI 命令面（codex exec 或等价——以 077/078 模式定）跑 fixture；command/runCommand 可注入
      mock；本机无 Codex 则驱动层 + "待环境"标注
- [ ] 采集归一：Codex 输出 → RunResult §15 L3 字段（能采集的映射，不能的缺省/注明）
- [ ] 测试 ≥4 例：契约校验/驱动层（mock CLI）/采集归一/异常；全量 vitest/tsc 绿（762+ 无回归）
- [ ] 文档同步（Codex adapter 用法与限制）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Codex adapter。Pi/Claude Code（080/081）各自成卡（同批模式）。clean-room。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners/src/adapters/（077/078 范本 + 本卡 codex.ts + 测试）
- benchmarks/runners/src/contracts/index.ts（挂出 adapter）
- docs/（Codex adapter 文档）

## 方法

- 照 077/078 模式：codexAdapter{id/version/run/capabilities} + runCodexFixture + 采集归一映射表

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已回填（2026-09-08，子代理）

### 改动文件

| 文件 | 动作 | 摘要 |
|---|---|---|
| `benchmarks/runners/src/adapters/codex.ts` | 新增 | 实现 076 契约的 `codexAdapter{id:'codex',version:'0.1.0',run,capabilities}` + `runCodexFixture`。驱动面：`codex exec -C <workspace> --skip-git-repo-check --json <task> [args...]`（Codex 官方文档化非交互面，clean-room）。可注入：`command`/`runCommand`/`_envResolve`/`probeCodexEnv`。环境探活缺失 → pending-environment 不 throw。采集归一 `normalizeCodexRun` → §15 L3。capabilities 诚实降级。样式与 077/078 完全同批。 |
| `benchmarks/runners/src/adapters/codex.test.ts` | 新增 | 12 例测试（契约校验/驱动层 mock CLI/采集归一/异常）。 |
| `benchmarks/runners/src/contracts/index.ts` | 修改 | 选择性 re-export codex 专属符号（`ResultStub`/`defaultRunCommand` 与 dsh 同源，走 `export *` 的 dsh，避免 TS2308 歧义——同 opencode 注释处理）。 |
| `docs/CODEX-ADAPTER.md` | 新增 | Codex adapter 用法 + 采集归一映射 + capabilities + 环境/限制（对齐 DSH/OPENCODE docs）。 |

### 测试与类型验证输出

- `npx tsc -b tsconfig.json` → **exit 0**（无类型错误）。
- `npx vitest run benchmarks/runners/src/adapters/codex.test.ts` → **12 passed**。
- `npx vitest run`（root 全量）→ **83 files / 775 passed / 1 skipped，exit 0**，无回归。
  （基线 root 762(+1 skipped) + 12 新增 codex + 无关 +1 → 775 passed；web 74 未涉及。）

### diff 摘要

- `codex.ts`：照 077/078 模板（spawnSync → ResultStub → probeCodexEnv → 归一化 → assertValidRunResult），
  命令面改为 `codex exec -C … --json`；capabilities：`tool_calls/file_edit/exec/memory/policy=true`，
  `mcp=false`（exec/--json 面不编排 MCP fixture），`subagent/skill/planner/evaluator/resume/compaction='tbd'`，
  `matrix=envAvailable`。
- `index.ts`：追加 codex 专属 `export {…} from '../adapters/codex.js'`（与 opencode 同法，避免 `export *` 歧义）。

### 设计选择与理由

- **命令面**：采用 076 契约 §6 声明的 `codex exec`（非交互），配 `-C`（工作根）、`--skip-git-repo-check`（允许
  非 git 临时目录）、`--json`（请求结构化输出）；`CodexRawRun` 是本 adapter 主动请求的 JSON 契约，只取 L3 子集，
  不窥探 Codex 内部。
- **注入 seam**：`runCommand` 替换 spawn 入口 + `_envResolve` 测试专用探针（077/078 已验证的 mock 模式，
  规避沙箱 spawn 捕获 EPERM）。
- **采集归一**：能把字段映射到 L3，不能的缺省 0/null 并标 `approx`（BENCHMARK-SPEC §4.4 诚实标注，禁止裸数字
  跨口径排名）；`resumeSuccess` 缺省 `null`（N/A）。
- **capabilities 诚实降级**：`matrix` 依赖真实 CLI 可用，本机无可用（`probeCodexEnv`=false 时）→ runner 在
  `run()` 前 skipped，不进结果集。
- **clean-room**：只按 CLI 文档化命令面驱动，prompt 不引入本项目，不读 Codex 源码。

### 踩坑记录

- vitest 过滤路径须从仓库根跑（vitest 配置在 root `vitest.config.ts`）；从 `benchmarks/runners` 子目录跑
  `src/adapters/codex.test.ts` 会 "No test files found"——改从 root 传 `benchmarks/runners/src/adapters/codex.test.ts`。
- `codex exec --help` 实测确认 `-C/--cd`、`--json`、`--skip-git-repo-check` 面存在（本机 `codex-cli 0.153.4`），
  但真实执行需要模型鉴权，测试不依赖真实 Codex 进程/凭据，驱动层以注入 mock 为主。
- `index.ts` 全量 `export *` 会因 `ResultStub`/`defaultRunCommand` 与 dsh.ts 同名产生 TS2308 歧义——照 opencode
  注释样板做选择性 re-export。

### 验收标准勾选

- [x] 读 076 契约（contracts/）与 077/078 范本（adapters/dsh.ts、opencode.ts + docs）——Codex adapter 对齐同模式
- [x] Codex 驱动：CLI 命令面（codex exec）跑 fixture；command/runCommand 可注入 mock；本机 Codex CLI 存在
      （codex-cli 0.153.4），驱动层 + pending-environment 标注就绪
- [x] 采集归一：Codex 输出 → RunResult §15 L3 字段（能采集的映射，不能的缺省/注明）
- [x] 测试 ≥4 例：契约校验/驱动层（mock CLI）/采集归一/异常（实际 12 例）；全量 vitest/tsc 绿（775 passed，无回归）
- [x] 文档同步（docs/CODEX-ADAPTER.md 用法与限制）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
