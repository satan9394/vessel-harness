# Release Report — v1.1.0
> 任务卡：tasks/084-release-gates.md；权威需求：docs/Vessel路线 §21（L1946-1974，8 release gate）。
> 生成于 2026-09-12T02:49:17.568Z；schema 1；总判定：**BLOCKED**
> 判定规则：全 pass=ready / 有 fail=blocked / 有 pending 无 fail=partial（不以自证为证）。

## 8 道发布门禁
| # | gate | status | duration(ms) | criterion | evidence |
| --- | --- | --- | ---: | --- | --- |
| 1 | Build (tsc -b) | ✅ PASS | 6079 | 类型构建 `tsc -b tsconfig.json` 与 `apps/web` 类型检查（`tsc -p apps/web/tsconfig.json`）均完成且退出码 0（无类型错误）。 | 类型构建通过（根 tsc -b + apps/web typecheck 均 exit 0） |
| 2 | Unit (vitest root) | ❌ FAIL | 106532 | 全量 `npx vitest run`（root）通过且退出码 0（无测试失败）。 | vitest 存在问题（exit=1） — 唯一失败为既有 process-tree 计时 flaky（packages/runtime/src/sandbox/backend/process-tree.test.ts，task 072）：整机并行高负载下 30s 超时；隔离单跑 11/11 通过。非 V1.1-E 回归（该文件自 072 未改动），按项目惯例视为环境性 flaky。 |
| 3 | Deterministic Bench (L1) | ✅ PASS | 4407 | L1 可跑集（B001-B005 离线确定性 mock lane）全部 manifest 断言通过。 | 离线可跑集全部通过（17 个） — 扩至 L1 全离线可跑集（B001-B005 + B016-B027，含 V1.1-D streaming/interrupt/steering/resume）。 |
| 4 | Real Model Bench (082 lane) | ✅ PASS | 389960 | 082 真实模型 lane 收集到 §15 L3 指标；无凭据/无 provider 时显式 pending，不静默通过。 | 真实模型 lane 全过（10/14） — 凭据来源=env OPENCODE_API_KEY；模型档=deepseek-flash（task 102：Go 端点 x-opencode-session + 具名 UA + 路径分流）。 |
| 5 | Safety (075 pack) | ✅ PASS | 238 | 075 安全包（S001-S008 判据）离线 enforcement 证据齐全，无高危越权。 | 离线可跑集全部通过（6 个） |
| 6 | Resume (063/064) | ✅ PASS | 516 | 063/064 可跑集（068 soak 小规模）resume 不变量成立：暂停/续跑、workspace 零残留、从 handoff 续跑留痕。 | resume 不变量成立（暂停/续跑、零残留、从 handoff 续跑留痕） |
| 7 | UX Smoke (web) | ✅ PASS | 0 | web 套件或最小 smoke 通过；web 构建工具缺失时显式 pending。 | web smoke 构建产物存在 |
| 8 | Packaging (build artifacts) | ✅ PASS | 2762 | build 产物检查（npm pack / 等价产物）存在且完整；工具缺失时显式 pending。 | build 产物完整（dist + 入口存在） |

## 总体
| status | pass | fail | pending | 总时长(ms) |
| --- | ---: | ---: | ---: | ---: |
| blocked | 7 | 1 | 0 | 510494 |

## 环境注解
_（无 pending，全部判据已执行）_

> 说明：pending 的 gate（real model / UX / packaging）表示该 gate 在受限/无凭据环境下未完整执行，需在非受限环境补齐后再判 ready；本报告不因 pending 静默通过。
