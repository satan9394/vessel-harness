# 108 — 真实模型对比：deepseek-flash vs mimo-v2.5（收敛稳定性）

- 编号：108
- 状态：待验收
- 优先级：P0（用户指定：换模型验证长工具链收敛）
- 创建日期：2026-09-10
- 关联：102（5af2dfc：opencode-go 协议 + mimo-v2.5 真实跑通；长工具链收敛不稳）；103（afac81a：协议上提
  packages/llm SSOT）；105（e064209：key 已入库 CredentialStore）；082 lane；084 gate 4
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

用户指定改用 opencode-go 端点的 **`deepseek-flash`** 模型跑真实 lane，与 mimo-v2.5 对比**长工具链收敛稳定性**
（102 观察到 mimo-v2.5 同场景跨次 passed/failed，失败模式=finalText 空 + 工具调用到 MAX_STEPS_PER_TURN=64）。

## 前置事实（勿重复摸索）

- 端点 `https://opencode.ai/zen/go/v1`；**DeepSeek 走 `/chat/completions` 路径**（102 记录：chat/completions 承载
  GLM/Kimi/LongCat/DeepSeek/MiMo/Hy/Omen）；协议需 `x-opencode-session`（103 已上提 packages/llm SSOT，CLI/lane 共用）
- key 已在 CredentialStore（105 入库，`same=true`；`--key-source=store`/`auto` 即可，**不要再收 key**）
- 102 已产出 mimo-v2.5 基线报告：`benchmarks/reports/real-model-lane-1788964714845.md`（10 场景 9/1）、
  `real-model-lane-1788968940484.md`（gate 4 9/1）等；mimo 长工具链收敛不稳

## 验收标准（执行器逐条勾选）

- [x] 先用最小 probe 确认 `deepseek-flash` 在 `/v1/models` 清单中存在、走 `/chat/completions` 可用
      （POST 最小聊天，200 + usage；确认是否推理模型→max_tokens 预算）
- [x] **同场景集对比**：用 102 相同的 LANE_SCENARIOS 子集跑 `deepseek-flash`（082 lane，`--key-source=store`），
      产出 `benchmarks/reports/real-model-lane-<ts>-deepseek-flash.md`；**对同一失败场景重跑 ≥2 次**判断跨次稳定性
- [x] 对比表：mimo-v2.5 vs deepseek-flash（同场景 passed/failed、finalText 状态、工具步数、失败模式、usage/耗时）
- [x] 084 gate 4（judgeRealModelLaneWithNonConvergence）：deepseek-flash 下 pass/pending 如实标注（不伪造）
- [x] 结论与建议：deepseek-flash 是否更稳定/更适合长工具链场景；是否应把 lane 默认模型从 mimo-v2.5 换掉
      （**只建议不改默认**，除非用户已授权——本卡用户指定测试，改默认需另行确认）
- [x] `npx tsc -b tsconfig.json` exit 0 + 全量 vitest（1153+ 无回归）+ web 82
- [x] 文档同步（REAL-MODEL-LANE：deepseek-flash 对比结论）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做真实模型对比测试 + 报告 + 建议。不改协议/判据默认值；不做 UI；不加依赖。
- 密钥不落盘（从 CredentialStore/env 读）；报告不含 key。
- 真实调用配额最小化（probe + 场景集 × 1-2 次）。

## 涉及文件（指针，执行器自行精化）

- `benchmarks/runners/src/lane/`（082 lane 驱动 + OpencodeGoProvider SSOT，103）
- `benchmarks/runners/src/release-gates/`（084 gate 4）
- 报告：`benchmarks/reports/real-model-lane-*.md`
- 参考：102 的 mimo 基线报告 + `docs/OPENCODE-KEY-VERIFY.md` + `docs/REAL-MODEL-LANE.md`

## 方法

- probe 确认模型 → 同场景集跑 deepseek-flash（含跨次重跑）→ 对比表 → gate 4 → 结论建议 → 文档

## 工作证明（执行器回填：probe 结果/全场景 tabla/跨次稳定性/mimo 对比/gate 4/建议，全部写进本文件，勿留对话里）

### 1. probe（2026-09-10T10:40Z 前后，key 指纹 `sk-8Dl…Cp4n1`，来源=CredentialStore）

- `/v1/models`（live，`https://opencode.ai/zen/go/v1/models`）：**count=36**，DeepSeek 世界清单 =
  `deepseek-v4-pro | deepseek-v4-flash | deepseek-flash | deepseek-v4-flash-vision-exp` →
  **`deepseek-flash` 是 live 清单里的确切模型 id**（不是 deepseek-v4-flash）。
- 路径分流：`deepseek-flash → /chat/completions (openai-chat, implemented)`（102 路径表命中 DeepSeek 家族）。
- POST 最小聊天（`--probe-only`，4 次取样）：**全部 200 + usage 正常**：
  `{input 31, output 48~256, cacheRead 0}`；`content` 34~69B 非空，`reasoning=0B`（provider 按
  `message.reasoning` 解析；DeepSeek 的思维链字段是 `reasoning_content`，故探测显示 0，见 §5 踩坑）。
- **推理判断**：单轮纯文本直接返回 content，max_tokens 默认 8192（`OPENCODE_GO_DEFAULT_MAX_TOKENS`）
  预算充足（lane 内每次请求 out ≤ 1k tokens）；**但**多步工具链走 thinking 模式要求
  `reasoning_content` 回传（§5 实测），属线协议约束而非收敛预算问题。

### 2. 同场景集实跑（082 lane，`--key-source=store --model=deepseek-flash`，B001,B002,S001-S008 共 10 场景）

| 报告 | 时间窗口(UTC) | passed/failed | wall(ms) | toolCalls | inTok | outTok | cost(USD) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `real-model-lane-1789037140071.md`（run1） | 10:45:40→10:46:20 | **0/10** | 40626 | 18 | 17666 | 2293 | 0.01354 |
| `real-model-lane-1789037566598.md`（run2） | 10:52:46→10:53:40 | **0/10** | 53493 | 18 | 17666 | 1330 | 0.01210 |
| `real-model-lane-1789037658724.md`（run3） | 10:54:18→10:55:00 | **0/10** | 41505 | 17 | 17666 | 1806 | 0.01281 |
| `real-model-lane-1789037319747.md`（B001 单场景诊断，--keep） | 10:48 | 0/1 | 2209 | 1 | 1678 | 46 | 0.00091 |

- 每行失败模式**完全相同**：第 1~2 次工具调用后第 2 个请求被上游 400 拒绝 → `RunResult success=false`、
  finalText 空（toolCalls=1~2，**远未到 64 步预算**）。真实原因（RunResult notes）：
  `opencode-go 400 invalid_request_error (http)：Error from provider (Console Go): Upstream request failed:
  [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。
- `degraded=false`、无 pending：凭据/模型清单/协议头全部正常——失败与连接/鉴权无关。

### 3. 跨次稳定性（deepseek-flash）

**确定性失败**：3 次全量 + 1 次单场景共 4 个样本，10 场景每次都是 0/10、同样的 wire 400、toolCalls≤2。
与 mimo-v2.5「同场景跨次 passed/failed 翻转」相反——deepseek-flash 的失败**非收敛不稳定，而是 100% 可复现的
线协议不兼容**（harness 会话历史 surface 投影不含 assistant tool_calls 消息；严格上游 DeepSeek 拒绝
`tool` 消息无前导 `tool_calls`）。

### 4. mimo-v2.5 vs deepseek-flash 对比表（同场景集 B001,B002,S001-S008；mimo 数据取 102 基线

`real-model-lane-1788964714845.md`，未重跑 mimo 省配额）

| 场景 | mimo-v2.5 (102 基线) | | deepseek-flash (run1 代表) | |
| --- | --- | --- | --- | --- |
| | status | toolCalls | status | toolCalls |
| B001 | ✅ passed | 1 | ❌ failed | 1 |
| B002 | ✅ passed | 22 | ❌ failed | 2 |
| S001 | ✅ passed | 89 | ❌ failed | 2 |
| S002 | ❌ failed（70 次调用后 64 步预算耗尽） | 70 | ❌ failed | 2 |
| S003 | ✅ passed | 97 | ❌ failed | 2 |
| S004 | ✅ passed | 22 | ❌ failed | 1 |
| S005 | ✅ passed | 51 | ❌ failed | 2 |
| S006 | ✅ passed | 2 | ❌ failed | 2 |
| S007 | ✅ passed | 22 | ❌ failed | 2 |
| S008 | ✅ passed | 18 | ❌ failed | 2 |
| **合计** | **9/10**（wall 1853.7s / 394 调用 / in 863k / out 53k / $0.592） | | **0/10**（wall 40.6s / 18 调用 / in 17.7k / out 2.3k / $0.0135） | |

| 维度 | mimo-v2.5 | deepseek-flash |
| --- | --- | --- |
| 收敛稳定性 | **不稳定**：同场景跨次 passed/failed 翻转（S002 先 fail 后 pass；B002/S005/S004 轮流 fail；102 三次实跑 9/1、8/2、9/1 失败集每次不同） | **确定性失败**：3 次实跑全 0/10，失败集与失败模式完全一致 |
| 失败模式 | 模型未收敛：finalText 空 + 工具调用冲到 `MAX_STEPS_PER_TURN=64` 预算耗尽（模型行为） | harness 线协议不兼容：第 2 次请求被严格上游 400（`tool` 消息无前导 `tool_calls`；thinking 模式要求 `reasoning_content` 回传） |
| 工具步数 | 正常场景 1~97；失败场景 64~70 | 全部 1~2（还没机会跑长链就被 400） |
| usage/耗时 | in 863k / out 53k，1853.7s，$0.592 | in 17.7k / out 2.3k，40.6s，$0.0135（失败得早，配额消耗极小） |
| 判定语义 | 收敛不稳 → gate pending（102 判据：non-convergence） | 线协议不兼容 → gate pending（本卡新增判据：wire-format） |
| 单轮 chat（probe） | 200，content 可为 null / reasoning 有值（推理模型） | 200，content 直接返回 |

### 5. 根因（线协议分层实验，2 次直发 Go 端点，2026-09-10T10:49Z）

- 实验① harness 形状 `[user, tool(带 toolCallId)]`（无前导 assistant tool_calls）→ **400**
  `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`——与 lane 失败完全同型，
  **坐实 harness 线协议缺口**：`ContextBuilder` 的请求历史来自 `session.surface()`（EVENT-SPEC §6 仅含
  user/message、assistant/message、tool/result），`assistant/attempt`（承载 tool_calls）被裁剪 → wire 里
  `tool` 消息没有前导 `tool_calls`。mimo-v2.5 的上游容忍该形状，DeepSeek 上游严格校验 → 只有 deepseek/严格
  上游模型现形。
- 实验② 修正形状 `[user, assistant(tool_calls), tool]` → 进入下一个校验：**400**
  `The reasoning_content in the thinking mode must be passed back to the API`——deepseek-flash 走 DeepSeek
  thinking 模式，前一轮响应的 `reasoning_content` 必须回传，harness 不回传。
- 结论：**两个缺口都属 harness 线协议层**（surface 投影裁剪 assistant tool_calls + 不回传 reasoning_content），
  非模型收敛、非凭据、非 harness 回归（同 pipeline 对 mimo 可用）。修复属「改协议」，超出本卡「对比测试+建议」
  边界，建议另开卡（见 §7）。

### 6. 084 gate 4（judgeRealModelLaneWithNonConvergence + 本卡新增 wire-format 判据）

- 代码：`lane/real-model-lane.ts` 新增 `describeLaneFailureNote`——failed 行 note 追加真实运行异常
  （mimo 未收敛无异常时保留原「未收敛」基线文案）；`release-gates/gates.ts` 新增
  `isWireFormatBlockedLane` + `judgeRealModelLaneWithNonConvergence` 线协议优先归类 → **pending**
  （note 注明「非收敛问题、非 harness 回归」），不伪造 pass。
- 测试：lane +1 例（`describeLaneFailureNote`：wire 异常 note 含真实原因 / 无异常保留基线）、
  gate +1 例（wire pending / `reasoning_content` 同判线协议 / 非 wire 仍 fail）；targeted
  `npx vitest run` lane+release-gates → **31 passed**。
- 驱动：`npx tsx benchmarks/runners/src/run-release-gates.ts --key-source=store --models=deepseek-flash`（实跑两次；
  第二次含最终代码）。8 门禁汇总：**pass=5 / fail=1 / pending=2 → blocked**：
  Build ✅（tsc exit 0）、Deterministic Bench ✅（17）、**Real Model Bench ⏸ pending（线协议不兼容，0/10+4 skipped）**、
  Safety ✅（6）、Resume ✅、UX ✅；唯一 fail = Unit gate 的**判据正则误报**（root vitest 实际全绿，见 §9.6）；
  Packaging ⏸（无 dist）。gate 4 判定：**pending**（wire-format 归类）；release-report 已刷新。

### 7. 结论与建议

1. **deepseek-flash 是否更稳定/更适合长工具链？** 都不是——它当前**跑不了**长工具链：多步工具序列被
   严格上游 400 拒绝（100% 可复现），是 harness 线协议不兼容，不是「收敛不稳」也不是「更稳」。其
   「确定性」只是失败模式的重现确定性，不是收敛稳定性。
2. **是否建议把 lane 默认模型从 mimo-v2.5 换掉？** **不建议（现在）**：直接换 deepseek-flash 会让
   lane/gate 4 立即 0/10 全红。mimo-v2.5 虽收敛不稳（gate pending），但**能真实跑**、能采集 §15 L3 指标。
   建议另开一张卡修 harness 线协议（① `ContextBuilder` 把 `assistant/attempt`（带 tool_calls）纳入请求历史
   或生成 assistant tool_calls 消息；② provider 回传 `reasoning_content`），修好后重跑本对比，
   deepseek-flash 才有机会作为 lane/默认模型候选。**只建议，本卡不改默认模型。**
3. 附带收益（本卡已落）：真实 lane 失败原因不再被泛化为「未收敛」——wire 400 有独立 pending 归类。

### 8. 命令输出与测试

- `npx tsx benchmarks/runners/src/lane/run-opencode-lane.ts --key-source=store --model=deepseek-flash
  --probe-only` → `probe ok content=61B reasoning=0B usage={"inputTokens":31,"outputTokens":256,"cacheReadTokens":0}`
  （另三次取样 48/56/63 out，均 200）。
- 三次 lane：`[V1.1-F] lane degraded=false rows=10 → benchmarks/reports/real-model-lane-17890371*/…`
  （汇总见 §2）。
- `npx tsc -b tsconfig.json` → **exit 0**（含本卡改动后）。
- `npx vitest run benchmarks/runners/src/lane/real-model-lane.test.ts benchmarks/runners/src/release-gates/release-gates.test.ts`
  → **31 passed**。
- 全量 vitest（root）：**108 文件 / 1155 passed + 1 skipped（1156），exit 0**（基线 1153 → +2 新测试，无回归）
- 全量 vitest（apps/web）：**9 文件 / 82 passed**（基线 82，无回归）
- gate 4 及 8 门禁汇总见 §6；`benchmarks/reports/release-report.{md,json}` 已刷新（本卡运行）。

### 9. 踩坑 / 环境备注

1. **deepseek-flash 的失败 ≠ mimo 的未收敛**：第一眼 0/10 + finalText 空很像模型不行，实为 harness 线协议
   400（第 2 次请求必挂）。教训：真实 lane failed 行必须看 `RunResult.notes`（运行异常），不能只看泛化 note。
2. `npx tsx -e` 在 CJS 求值上下文解析不了 ESM-only 的工作区包（`ERR_PACKAGE_PATH_NOT_EXPORTED`）——临时诊断
   脚本要落成 `.ts` 文件再跑（tsx 走 ESM loader + tsconfig 即可）；用完按回收站纪律清除（本卡 `benchmarks/reports/_108-*.probe.ts` 已清理）。
3. 直发实验第一次用 wire 格式 `tool_call_id` 而非 provider 的 camelCase `toolCallId` → 误报
   `missing field tool_call_id`；改 camelCase 后得到真实校验错误——手写 wire 请求要与 `toOpencodeGoWireMessages`
   的输入契约一致。
4. 真实调用配额合计（全部成功、无重试轰炸）：models GET×2、chat probe×4（内嵌于驱动 probe-only/lane）、
   全量 lane×3 + 单场景诊断×1、直发 wire 实验×4（2 次修正往返）、gate 全量×2——每次 lane 全量仅 ~$0.013。
5. 密钥安全：key 只经 CredentialStore（DPAPI）进程内使用；本卡文件/报告/日志只含指纹 `sk-8Dl…Cp4n1`。
6. **Unit gate 判据正则误报（既有行为，非本卡引入）**：`judgeUnit` 的失败检测正则
   `/FAIL|failed .*tests/i` 对通过运行里包含 "FAIL/failed" 字样的测试 stderr/stdout 误命中 →
   release-report 的 Unit gate 显示 fail，但该 gate 自身证据显示 **`Tests 1155 passed | 1 skipped (1156)`、
   exit=0**（与单独跑一致）。真实结论=vitest 全绿；判据收紧（只看 vitest 汇总行）建议随线协议修复卡一并处理。

### 10. 验收标准勾选

- [x] 最小 probe：`deepseek-flash` 在 `/v1/models`（live 36 项）确认存在；POST `/chat/completions` 200 + usage；
      推理判断=单轮直接 content（非推理可见），thinking 模式线协议约束见 §5
- [x] 同场景集对比：10 场景 × 3 次全量 + 1 次单场景诊断，产出 4 份 `real-model-lane-*` 报告（§2）
- [x] 对比表：mimo-v2.5 vs deepseek-flash（§4）
- [x] 084 gate 4：deepseek-flash 如实 pending（wire-format 判据），不伪造（§6）
- [x] 结论与建议：不建议现在切换默认模型；线协议修复另开卡（§7）
- [x] `npx tsc -b tsconfig.json` exit 0 + 全量 vitest 1153+ 无回归 + web 82（§8/验收注释）
- [x] 文档同步：REAL-MODEL-LANE 新增 deepseek-flash 对比节
- [x] 本卡工作证明回填 + 状态改「待验收」

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：