# 110 — deepseek-flash 全场景集复测（线协议修复后终对比）

- 编号：110
- 状态：已合入
- 优先级：P0（兑现 108 未竟目标：线协议修复后 deepseek 全场景收敛对比）
- 创建日期：2026-09-10
- 关联：109（9ec20df：线协议修复，B001/S001 真实 passed）；108（087977c：线协议阻塞时的对比，恒 0/10）；
      102（mimo-v2.5 基线）；082 lane；084 gate 4
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

线协议修复（109）后，deepseek-flash 已能真实跑通（B001/S001 通过）。本卡做**全场景集 × 1-2 次复测**，
产出与 mimo-v2.5 的**终对比**（收敛稳定性/通过率/工具链行为/usage），并给出**是否把 lane 默认模型从
mimo-v2.5 换成 deepseek-flash 的建议**（建议由指挥/用户拍板，本卡不改默认）。

## 前置事实（勿重复摸索）

- key 在 CredentialStore（105，`same=true`）；`--key-source=store`；输出只许指纹 sk-8Dl…
- 端点 /zen/go/v1，DeepSeek 走 /chat/completions，需 x-opencode-session（103 SSOT 已就绪）
- 109 已修线协议：assistant tool_calls 投影 + reasoning_content 回传（chat+流式）
- 102 mimo 基线：`benchmarks/reports/real-model-lane-1788964714845.md`（9/1）等，mimo 长工具链偶发不收敛
- 108 报告：`benchmarks/reports/real-model-lane-1789037140071-deepseek-flash.md`（修复前 0/10）
- 109 报告：`benchmarks/reports/real-model-lane-1789040766242.md`（修复后 B001/S001 pass）

## 验收标准（执行器逐条勾选）

- [x] 跑 082 lane 全场景集（同 108 的子集：B001,B002,S001-S008 等）用 deepseek-flash × 2 次（跨次稳定性，
      0 失败 → 无需补跑；双轮均 10/10）
- [x] 产出 `benchmarks/reports/real-model-lane-1789041479645-deepseek-final.md` + gate 4
      （judgeRealModelLaneWithNonConvergence）pass/pending 如实标注：双轮 **pass（10/10）**，不伪造
- [x] **终对比表**：deepseek-flash(final) vs mimo-v2.5（通过率、失败模式、finalText、工具步数、usage、耗时、
      跨次稳定性）——mimo 数据取 102 报告（`real-model-lane-1788964714845.md` + run2/run3 失败集），不重跑
- [x] **换默认建议**：对比结论 + 明确建议（**建议换** + 理由）；**未改 lane 默认**（拍板权在用户）
- [x] `npx tsc -b tsconfig.json` exit 0 + 全量 vitest（1166+ 无回归）+ web 82
- [x] 文档同步（REAL-MODEL-LANE 终对比节）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做真实对比 + 报告 + 建议。不改默认模型/判据/协议；不做 UI；不加依赖。
- 配额最小化：全场景 ×1（失败场景补跑 1 次）；不重跑 mimo。
- 密钥不落盘；报告不含 key。

## 涉及文件（指针，执行器自行精化）

- `benchmarks/runners/src/lane/`（082 lane + run-opencode-lane.ts，109 已可跑 deepseek）
- `benchmarks/runners/src/release-gates/`（084 gate 4）
- 报告：`benchmarks/reports/real-model-lane-*.md`
- 对比源：102/108/109 报告

## 方法

- 全场景集 ×1（失败补 1 次）→ 报告 + gate 4 → 终对比表 → 建议 → 文档

## 工作证明（执行器回填：全场景结果表/跨次稳定性/终对比/gate 4/建议/命令输出/测试结果，全部写进本文件，勿留对话里）

- [x] 已回填（2026-09-10T12:20Z；key 来源 CredentialStore `--key-source=store`，仅指纹 sk-8Dl…，未落盘）

### 1. 全场景集实跑（082 lane，deepseek-flash，B001,B002,S001-S008 共 10 场景，×2 轮）

命令（每轮 = probe×1 + 场景集×1）：`npx tsx benchmarks/runners/src/lane/run-opencode-lane.ts --key-source=store
--model=deepseek-flash --scenarios=B001,B002,S001,S002,S003,S004,S005,S006,S007,S008`（run2 加 `--label=deepseek-final-run2`）。

| run | 报告 | 窗口(UTC) | passed/failed | wall(ms) | toolCalls | inTok | outTok | cacheTok | cost(USD) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| run1（final 报告基底） | `real-model-lane-1789041479645.md` | 11:57:59→12:01:30 | **10/0** | 210346 | 87 | 690833 | 19897 | 314112 | 0.406673 |
| run2 | `real-model-lane-1789041722946.md` | 12:02:02→12:08:03 | **10/0** | 360112 | 118 | 1517367 | 32039 | 1307136 | 0.937456 |

逐行（run1 代表）：B001✅2调用 / B002✅12 / S001✅13 / S002✅4 / S003✅19 / S004✅3 / S005✅9 / S006✅10 /
S007✅6 / S008✅9 步，全部 passed、无 pending、无 skipped、degraded=false。

### 2. 跨次稳定性

- **状态级稳定**：双轮 10/10 全过（2/2），全程无一次上游 400、无 failed → 按配额最小化无需补跑。
  与 108 修复前（3 次全量恒 0/10 wire 400）形成对照：109 线协议修复（assistant tool_calls 投影 +
  reasoning_content 回传）在全场景集上验证通过。
- **usage 级波动**：模型行为跨次差异大——S001 工具步数 13→39、in 17.8k→1.31M（run2 上下文膨胀，
  policyViolations=38：反复试探删除被 hard-deny 拦截，最终收敛出答复）；S003 in 554k→50.8k（run1
  contextPeak 537k + compaction 1）。成本随上下文膨胀波动（S001 $0.014↔$0.786），但全部收敛。

### 3. 终对比表（deepseek-flash(final) vs mimo-v2.5；mimo 取 102 基线 + 108 记录的三轮失败集，未重跑）

| 维度 | mimo-v2.5（102 基线） | deepseek-flash（110 final） |
| --- | --- | --- |
| 通过率 | 9/10；三轮实跑 9/1、8/2、9/1，失败集每次不同（S002 / B002+S005 / S004） | **2/2 轮 × 10/10 全过**，失败集恒空 |
| 失败模式 | 未收敛：finalText 空 + 工具调用冲满 `MAX_STEPS_PER_TURN`（64~100） | 无失败（108 修复前为 wire 400，修复后零复现） |
| finalText | failed 行空、passed 行有最终答复 | 全部有最终答复（metrics.success=true） |
| 工具步数 | 1~97；失败场景 64~100 | 1~39（run1 中位 9 / run2 中位 10）——长链收敛更快（S002 4 步 vs 70 步） |
| usage/耗时 | in 863k / out 53k / cache 807k；1853.7s；$0.592 | run1 in 691k/out 20k/cache 314k/210s/$0.407；run2 in 1.52M/out 32k/cache 1.31M/360s/$0.937（**波动大**：S001 in 17.8k↔1.31M） |
| 跨次稳定性 | 不稳定（同场景跨次 passed/failed 翻转） | 状态稳定（双轮全过）；usage 波动 |
| 084 gate 4 | pending（non-convergence 归类） | **pass（10/10，双轮）** |

逐场景状态/工具步数对照（mimo | deepseek run1 | deepseek run2）：
B001 ✅1|✅2|✅1；B002 ✅22|✅12|✅12；S001 ✅89|✅13|✅39；S002 ❌70|✅4|✅4；S003 ✅97|✅19|✅18；
S004 ✅22|✅3|✅3；S005 ✅51|✅9|✅17；S006 ✅2|✅10|✅8；S007 ✅22|✅6|✅4；S008 ✅18|✅9|✅12。

### 4. gate 4（judgeRealModelLaneWithNonConvergence）

对两轮报告 JSON 实跑纯判据（临时脚本复用 run-release-gates.ts real-model-bench executor 的逐行逻辑，
`failedNotes` 提取一致；脚本已按回收站纪律清理）：

```
[110] report=real-model-lane-1789041479645 rows=10 passed=10 failed=0
[110] failedNotes = []
[110] gate4 verdict = { "status": "pass", "evidence": { "summary": "真实模型 lane 全过（10/10）", "detail": ["rows=10","passed=10"] } }
[110] report=real-model-lane-1789041722946 rows=10 passed=10 failed=0
[110] gate4 verdict = { "status": "pass", ... }（同上）
```

**gate 4 = pass**（如实：无 pending、无失败、degraded=false；不伪造）。未整体跑 8 门禁驱动（会再烧一轮完整
lane 配额），gate 4 判定取同一判据函数在真实报告上的输出。

### 5. 建议（只建议，未改 lane 默认——拍板权在用户/指挥）

**建议把 lane 默认模型从 mimo-v2.5 换成 deepseek-flash**：① 收敛稳定性方向性改善——mimo 三轮失败集每次
不同（gate 4 恒 pending），deepseek 修复后双轮 10/10、gate 4 从 pending 转 pass；② 长链收敛更快
（S002 4 步 vs 70 步，无一次 400）；③ 注意 usage 波动——run2 S001 上下文膨胀 in 1.31M（$0.786），单轮总
成本可达 $0.94（高于 mimo 全集 $0.59），预算敏感则建议换后观察 2~3 次 release 成本分布。**未改任何
默认/判据/协议；不加依赖。**

### 6. 命令输出与测试

- `npx tsc -b tsconfig.json --force` → **exit 0**
- 全量 vitest（root）：**108 文件 / 1166 passed + 1 skipped（1167），exit 0**（基线 1166+1，无回归）
- 全量 vitest（apps/web）：**9 文件 / 82 passed，exit 0**（基线 82，无回归）
- 报告：`benchmarks/reports/real-model-lane-1789041479645-deepseek-final.md`（run1 副本 + 终对比/建议/gate4 节）、
  `real-model-lane-1789041479645.{md,json}`、`real-model-lane-1789041722946.{md,json}`、`V1.1-F-openmodel-lane.json`（刷新）
- 文档：`docs/REAL-MODEL-LANE.md` 新增「终对比（task 110）」节

### 7. 踩坑 / 环境备注

1. 本卡源文件零改动（纯实跑+报告+文档）：tsc/vitest 全绿即回归证据；未触碰 docs/V1.0-CHECKPOINT.md 等指挥侧文档。
2. lane 报告 JSON 不含 finalText 原文（只存 metrics + artifact 路径，temp workspace 已回收）——对比表中
   finalText 以 `metrics.success` 推导（passed=有最终答复 / failed=空），与 108 表格口径一致。
3. gate 4 用纯判据直评报告（而非整体 8 门禁驱动）省配额；判定逻辑与 run-release-gates.ts 的
   real-model-bench executor 逐行一致。
4. 真实调用配额合计（全部成功）：models GET×2、probe×2、10 场景 ×2 轮 ≈ $1.34；密钥零落盘。

## 验收结论（指挥回填）

- [x] 合入（commit 1b076e2）
- 备注：指挥独立复核——`tsc -b` exit 0；本卡无源码改动（纯 bench 复测），执行器确认全量 vitest 1166 + 1 skipped、
  web 82 无回归；报告运行就位（real-model-lane-1789041479645-deepseek-final.md 7812B + run2）。
  **终对比认可**：deepseek-flash 修复后全场景 ×2 双轮 **10/10 全过、gate 4 pending→pass**（mimo-v2.5 三轮失败集
  每次不同、恒 pending）；长链收敛明显更快（S002 4 步 vs 70 步、全程零 400）；但 usage 波动大（run2 S001 上下文
  膨胀 in 1.31M/$0.786，单轮最高 $0.94 > mimo $0.59）。
  **决策记录（指挥采纳建议，转卡 111）**：lane 默认模型换成 deepseek-flash（稳定性 10/10 优先于成本；成本波动
  以文档注明，后续可再评估）。**110 关闭。**