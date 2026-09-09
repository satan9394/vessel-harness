# Release Report — v1.1.0
> 任务卡：tasks/084-release-gates.md；权威需求：docs/Vessel路线 §21（L1946-1974，8 release gate）。
> 生成于 2026-09-09T01:15:30.256Z；schema 1；总判定：**BLOCKED**
> 判定规则：全 pass=ready / 有 fail=blocked / 有 pending 无 fail=partial（不以自证为证）。

## 8 道发布门禁
| # | gate | status | duration(ms) | criterion | evidence |
| --- | --- | --- | ---: | --- | --- |
| 1 | Build (tsc -b) | ✅ PASS | 2647 | 类型构建 `tsc -b tsconfig.json` 完成且退出码 0（无类型错误）。 | 类型构建通过（tsc -b exit 0） |
| 2 | Unit (vitest root) | ❌ FAIL | 65179 | 全量 `npx vitest run`（root）通过且退出码 0（无测试失败）。 | vitest 存在问题（exit=1） — 唯一失败为既有 process-tree 计时 flaky（packages/runtime/src/sandbox/backend/process-tree.test.ts，task 072）：整机并行高负载下 30s 超时；隔离单跑 11/11 通过。非 V1.1-E 回归（该文件自 072 未改动），按项目惯例视为环境性 flaky。 |
| 3 | Deterministic Bench (L1) | ✅ PASS | 4488 | L1 可跑集（B001-B005 离线确定性 mock lane）全部 manifest 断言通过。 | 离线可跑集全部通过（17 个） — 扩至 L1 全离线可跑集（B001-B005 + B016-B027，含 V1.1-D streaming/interrupt/steering/resume）。 |
| 4 | Real Model Bench (082 lane) | ⏸ PENDING | 0 | 082 真实模型 lane 收集到 §15 L3 指标；无凭据/无 provider 时显式 pending，不静默通过。 | 真实模型 lane 未运行（无 credential/provider） — real model gate: 无真实 API 凭据 → pending（配好 provider 后重跑），不静默通过。 |
| 5 | Safety (075 pack) | ✅ PASS | 275 | 075 安全包（S001-S008 判据）离线 enforcement 证据齐全，无高危越权。 | 离线可跑集全部通过（6 个） |
| 6 | Resume (063/064) | ✅ PASS | 394 | 063/064 可跑集（068 soak 小规模）resume 不变量成立：暂停/续跑、workspace 零残留、从 handoff 续跑留痕。 | resume 不变量成立（暂停/续跑、零残留、从 handoff 续跑留痕） |
| 7 | UX Smoke (web) | ✅ PASS | 1 | web 套件或最小 smoke 通过；web 构建工具缺失时显式 pending。 | web smoke 构建产物存在 |
| 8 | Packaging (build artifacts) | ⏸ PENDING | 3486 | build 产物检查（npm pack / 等价产物）存在且完整；工具缺失时显式 pending。 | 未发现 build 产物（dist 缺失） — packaging gate: 需要非受限环境构建出 dist 后重跑；当前显式 pending 不静默通过。 |

## 总体
| status | pass | fail | pending | 总时长(ms) |
| --- | ---: | ---: | ---: | ---: |
| blocked | 5 | 1 | 2 | 76470 |

## 环境注解
- Real Model Bench (082 lane)：real model gate: 无真实 API 凭据 → pending（配好 provider 后重跑），不静默通过。
- Packaging (build artifacts)：packaging gate: 需要非受限环境构建出 dist 后重跑；当前显式 pending 不静默通过。

> 说明：pending 的 gate（real model / UX / packaging）表示该 gate 在受限/无凭据环境下未完整执行，需在非受限环境补齐后再判 ready；本报告不因 pending 静默通过。
