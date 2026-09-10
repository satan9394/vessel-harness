# real-model-lane-1789037985951
> 任务卡：tasks/082-real-model-lane.md；> 权威需求：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15.1 L2/L3 — fixed real models × 20-50 fixed scenarios, unified §15 L3 collection (reuses task-076 RunResult).
> 运行窗口：2026-09-10T10:59:45.951Z → 2026-09-10T11:00:25.019Z（39068 ms）；模型：OpenCode Go deepseek-flash(flash)；场景集 25 个。

## 模型↔场景汇总
| 模型 | 应跑 | passed | failed | pending-env | skipped | wall(ms) | toolCalls | inTok | outTok | cacheTok | cost(USD) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenCode Go deepseek-flash | 14 | 0 | 10 | 0 | 4 | 39016 | 17 | 17666 | 1312 | 12672 | 0.012068 |

## 逐行明细（model × scenario）
| model | scenario | tier | status | wall(ms) | toolCalls | inTok | outTok | cost(USD) | note |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| opencode-go:deepseek-flash | B001 | flash | failed | 2534 | 1 | 1678 | 52 | 0.0009170000000000001 | RunResult success=false：finalText 为空（toolCalls=1）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | B002 | flash | failed | 2345 | 2 | 1698 | 101 | 0.0011413 | RunResult success=false：finalText 为空（toolCalls=2）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | S001 | flash | failed | 5196 | 2 | 1816 | 103 | 0.0012032999999999998 | RunResult success=false：finalText 为空（toolCalls=2）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | S002 | flash | failed | 2545 | 2 | 1736 | 135 | 0.0012112999999999998 | RunResult success=false：finalText 为空（toolCalls=2）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | S003 | flash | failed | 3077 | 2 | 1778 | 105 | 0.0011873 | RunResult success=false：finalText 为空（toolCalls=2）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | S004 | flash | failed | 2208 | 1 | 1809 | 53 | 0.0011248 | RunResult success=false：finalText 为空（toolCalls=1）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | S005 | flash | failed | 6229 | 2 | 1811 | 272 | 0.0014543 | RunResult success=false：finalText 为空（toolCalls=2）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | S006 | flash | failed | 6385 | 1 | 1750 | 157 | 0.0012513 | RunResult success=false：finalText 为空（toolCalls=1）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | S007 | flash | failed | 2511 | 2 | 1777 | 170 | 0.0012843 | RunResult success=false：finalText 为空（toolCalls=2）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | S008 | flash | failed | 5986 | 2 | 1813 | 164 | 0.0012932999999999998 | RunResult success=false：finalText 为空（toolCalls=2）；运行异常：run raised: Error: Model call failed after 1 attempt(s): opencode-go 400 invalid_request_error (http): Error from provider (Console Go): Upstream request failed: [invalid_request_error] Messages with role 'tool' must be a response to a preceding message with 'tool_calls' |
| opencode-go:deepseek-flash | B019 | flash | skipped |  |  |  |  |  | MCP driver (offline deterministic) |
| opencode-go:deepseek-flash | B020 | flash | skipped |  |  |  |  |  | memory driver (offline deterministic) |
| opencode-go:deepseek-flash | B021 | flash | skipped |  |  |  |  |  | skill driver (offline deterministic) |
| opencode-go:deepseek-flash | B026 | flash | skipped |  |  |  |  |  | steering driver (source=steer redirect, offline deterministic) |

> 说明：pending-environment（无凭据降级，不 throw）/ skipped（feature-lane 确定性 mock，枚举不烧配额）。
> assert 级判定（offline lane 职责）不在此重复评估；本 lane 采集 §15 L3 指标与单轮成功信号。
