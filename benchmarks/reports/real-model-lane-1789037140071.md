# real-model-lane-1789037140071
> 任务卡：tasks/082-real-model-lane.md；> 权威需求：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15.1 L2/L3 — fixed real models × 20-50 fixed scenarios, unified §15 L3 collection (reuses task-076 RunResult).
> 运行窗口：2026-09-10T10:45:40.071Z → 2026-09-10T10:46:20.697Z（40626 ms）；模型：OpenCode Go deepseek-flash(flash)；场景集 10 个。

## 模型↔场景汇总
| 模型 | 应跑 | passed | failed | pending-env | skipped | wall(ms) | toolCalls | inTok | outTok | cacheTok | cost(USD) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenCode Go deepseek-flash | 10 | 0 | 10 | 0 | 0 | 40558 | 18 | 17666 | 2293 | 12672 | 0.01354 |

## 逐行明细（model × scenario）
| model | scenario | tier | status | wall(ms) | toolCalls | inTok | outTok | cost(USD) | note |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| opencode-go:deepseek-flash | B001 | flash | failed | 2142 | 1 | 1678 | 46 | 0.000908 | RunResult success=false：finalText 为空（toolCalls=1，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | B002 | flash | failed | 2657 | 2 | 1698 | 136 | 0.0011938 | RunResult success=false：finalText 为空（toolCalls=2，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | S001 | flash | failed | 2472 | 2 | 1816 | 144 | 0.0012648 | RunResult success=false：finalText 为空（toolCalls=2，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | S002 | flash | failed | 2477 | 2 | 1736 | 117 | 0.0011843 | RunResult success=false：finalText 为空（toolCalls=2，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | S003 | flash | failed | 5088 | 2 | 1778 | 95 | 0.0011723 | RunResult success=false：finalText 为空（toolCalls=2，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | S004 | flash | failed | 2310 | 1 | 1809 | 57 | 0.0011308 | RunResult success=false：finalText 为空（toolCalls=1，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | S005 | flash | failed | 5819 | 2 | 1811 | 213 | 0.0013658 | RunResult success=false：finalText 为空（toolCalls=2，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | S006 | flash | failed | 9001 | 2 | 1750 | 845 | 0.0022833 | RunResult success=false：finalText 为空（toolCalls=2，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | S007 | flash | failed | 2336 | 2 | 1777 | 126 | 0.0012182999999999999 | RunResult success=false：finalText 为空（toolCalls=2，多为模型未在步数/预算内收敛） |
| opencode-go:deepseek-flash | S008 | flash | failed | 6256 | 2 | 1813 | 514 | 0.0018183 | RunResult success=false：finalText 为空（toolCalls=2，多为模型未在步数/预算内收敛） |

> 说明：pending-environment（无凭据降级，不 throw）/ skipped（feature-lane 确定性 mock，枚举不烧配额）。
> assert 级判定（offline lane 职责）不在此重复评估；本 lane 采集 §15 L3 指标与单轮成功信号。
