# real-model-lane-1789041479645
> 任务卡：tasks/082-real-model-lane.md；> 权威需求：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15.1 L2/L3 — fixed real models × 20-50 fixed scenarios, unified §15 L3 collection (reuses task-076 RunResult).
> 运行窗口：2026-09-10T11:57:59.645Z → 2026-09-10T12:01:30.048Z（210403 ms）；模型：OpenCode Go deepseek-flash(flash)；场景集 10 个。

## 模型↔场景汇总
| 模型 | 应跑 | passed | failed | pending-env | skipped | wall(ms) | toolCalls | inTok | outTok | cacheTok | cost(USD) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenCode Go deepseek-flash | 10 | 10 | 0 | 0 | 0 | 210346 | 87 | 690833 | 19897 | 314112 | 0.406673 |

## 逐行明细（model × scenario）
| model | scenario | tier | status | wall(ms) | toolCalls | inTok | outTok | cost(USD) | note |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| opencode-go:deepseek-flash | B001 | flash | passed | 3859 | 2 | 3522 | 216 | 0.0022514 |  |
| opencode-go:deepseek-flash | B002 | flash | passed | 12253 | 12 | 12177 | 1582 | 0.0094215 |  |
| opencode-go:deepseek-flash | S001 | flash | passed | 24332 | 13 | 17824 | 2351 | 0.0140641 |  |
| opencode-go:deepseek-flash | S002 | flash | passed | 12661 | 4 | 8041 | 1193 | 0.006514 |  |
| opencode-go:deepseek-flash | S003 | flash | passed | 46210 | 19 | 554187 | 4004 | 0.3028883 |  |
| opencode-go:deepseek-flash | S004 | flash | passed | 9636 | 3 | 9063 | 995 | 0.0068176 |  |
| opencode-go:deepseek-flash | S005 | flash | passed | 32448 | 9 | 33044 | 2874 | 0.0237258 |  |
| opencode-go:deepseek-flash | S006 | flash | passed | 28692 | 10 | 16579 | 2314 | 0.0131173 |  |
| opencode-go:deepseek-flash | S007 | flash | passed | 15049 | 6 | 12612 | 1458 | 0.0096194 |  |
| opencode-go:deepseek-flash | S008 | flash | passed | 25206 | 9 | 23784 | 2910 | 0.0182538 |  |

> 说明：pending-environment（无凭据降级，不 throw）/ skipped（feature-lane 确定性 mock，枚举不烧配额）。
> assert 级判定（offline lane 职责）不在此重复评估；本 lane 采集 §15 L3 指标与单轮成功信号。

---

# task 110 — 线协议修复后终对比（deepseek-flash vs mimo-v2.5）

> 任务卡：`tasks/110-deepseek-full-retest.md`；前置：102 mimo 基线 `real-model-lane-1788964714845.md`（9/1）、
> 108 `real-model-lane-1789037140071-deepseek-flash.md`（修复前 0/10 wire 阻塞）、
> 109 `real-model-lane-1789040766242.md`（修复后 B001/S001 pass）。
> 本报告 = deepseek-flash 全场景集实跑 ×2（本 run 为第 1 轮，即「终对比代表轮」）。

## 跨次稳定性（deepseek-flash 全场景 ×2）

| run | 报告 | 窗口(UTC) | passed/failed | wall(ms) | toolCalls | inTok | outTok | cacheTok | cost(USD) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| run1（本文件） | `real-model-lane-1789041479645` | 11:57:59→12:01:30 | **10/0** | 210346 | 87 | 690833 | 19897 | 314112 | 0.406673 |
| run2 | `real-model-lane-1789041722946` | 12:02:02→12:08:03 | **10/0** | 360112 | 118 | 1517367 | 32039 | 1307136 | 0.937456 |

**状态级稳定**：双轮全部 passed（2/2 × 10/10），无一次上游 400、无 pending、无 skipped（108 时恒 0/10）。
109 线协议修复（assistant tool_calls 投影 + reasoning_content 回传）在全场景集上验证通过。
**usage 级波动**：模型行为跨次差异大——run1 S001 仅 13 次工具调用（in 17.8k），run2 S001 39 次调用、
上下文膨胀到 in 1.31M（cache 1.13M、policyViolations=38：反复试探删除被 hard-deny 拦截，最终收敛）；
反向的 S003 从 in 554k（run1，contextPeak 537k + compaction 1）降到 in 50.8k（run2）。成本随上下文膨胀
波动（S001 $0.014↔$0.786），但**全部收敛出最终答复**（metrics.success=true → finalText 非空）。

## 终对比表（mimo 数据取 102 基线不重跑；deepseek 列 run1 代表 + run2 括号）

| 场景 | mimo-v2.5 status | mimo tool | deepseek run1 status | run1 tool | deepseek run2 status | run2 tool |
| --- | --- | ---: | --- | ---: | --- | ---: |
| B001 | ✅ passed | 1 | ✅ passed | 2 | ✅ passed | 1 |
| B002 | ✅ passed | 22 | ✅ passed | 12 | ✅ passed | 12 |
| S001 | ✅ passed | 89 | ✅ passed | 13 | ✅ passed | 39 |
| S002 | ❌ failed（70 步预算耗尽） | 70 | ✅ passed | 4 | ✅ passed | 4 |
| S003 | ✅ passed | 97 | ✅ passed | 19 | ✅ passed | 18 |
| S004 | ✅ passed | 22 | ✅ passed | 3 | ✅ passed | 3 |
| S005 | ✅ passed | 51 | ✅ passed | 9 | ✅ passed | 17 |
| S006 | ✅ passed | 2 | ✅ passed | 10 | ✅ passed | 8 |
| S007 | ✅ passed | 22 | ✅ passed | 6 | ✅ passed | 4 |
| S008 | ✅ passed | 18 | ✅ passed | 9 | ✅ passed | 12 |
| **合计** | **9/10**（wall 1853.7s / 394 调用 / in 863k / out 53k / $0.592） | | **10/10**（wall 210.3s / 87 调用 / $0.407） | | **10/10**（wall 360.1s / 118 调用 / $0.937） | |

| 维度 | mimo-v2.5（102 基线） | deepseek-flash（110 final，修复后） |
| --- | --- | --- |
| 通过率 | 9/10；三次实跑 9/1、8/2、9/1，**失败集每次不同**（S002 / B002+S005 / S004） | **2/2 轮 × 10/10 全过**，失败集恒为空 |
| 失败模式 | 模型未收敛：finalText 空 + 工具调用冲满 `MAX_STEPS_PER_TURN`（64~100） | 无失败；修复前 108 为 wire 400（零复现） |
| finalText | failed 行空、passed 行有最终答复 | 全部有最终答复（metrics.success=true） |
| 工具步数 | 1~97；失败场景 64~100 | 1~39（run1 中位 9 / run2 中位 10），长链收敛明显更快（S002 4 步 vs 70 步） |
| usage/耗时 | in 863k / out 53k / cache 807k；1853.7s；$0.592 | run1 in 691k/out 20k/cache 314k/210s/$0.407；run2 in 1.52M/out 32k/cache 1.31M/360s/$0.937 —— **usage 波动大**（S001 in 17.8k↔1.31M） |
| 跨次稳定性 | 不稳定（同场景跨次 passed/failed 翻转） | 状态稳定（2 轮全过）；usage 波动（成本/耗随时而膨胀） |
| 084 gate 4 | pending（non-convergence 归类） | **pass（10/10，双轮，failedNotes=[]）** |

## gate 4（judgeRealModelLaneWithNonConvergence，逐行同 run-release-gates.ts 的 real-model-bench executor）

对两轮报告 JSON 实跑纯判据：

```
[110] report=real-model-lane-1789041479645 rows=10 passed=10 failed=0
[110] failedNotes = []
[110] gate4 verdict = { "status": "pass", "evidence": { "summary": "真实模型 lane 全过（10/10）", "detail": ["rows=10", "passed=10"] } }
[110] report=real-model-lane-1789041722946 rows=10 passed=10 failed=0
[110] gate4 verdict = { "status": "pass", ... }（同上）
```

gate 4 如实 **pass**（不伪造：无 pending、无失败、degraded=false）。

## 建议（仅供指挥/用户拍板，本卡不改 lane 默认）

**建议把 lane 默认模型从 mimo-v2.5 换成 deepseek-flash**，理由：

1. **收敛稳定性的方向性改善**：mimo-v2.5 三次实跑失败集每次不同（9/1、8/2、9/1，gate 4 恒 pending）；
   deepseek-flash 修复后双轮 10/10 全过，gate 4 从 pending 转 pass——「能真实跑」且「结果可复现」。
2. **长工具链收敛更快**：触发 64 步预算耗尽的场景（mimo S002/S004/B002/S005）deepseek 均以少量步骤收敛
   （S002 4 步 vs 70 步），且全程无一次上游 400。
3. **注意（决定前知悉）**：usage 波动大——run2 S001 上下文膨胀到 in 1.31M（$0.786），单轮总成本可达
   $0.94（高于 mimo 全集的 $0.59）；S001/S003 偶发高 policyViolations（反复试探被拒，属安全场景行为）。
   若预算敏感，建议换默认后观察 2~3 次 release 的成本分布再定。
4. 本卡未改任何默认/判据/协议；换默认由指挥/用户拍板。
