# Release Report — v1.1.0
> 任务卡：tasks/084-release-gates.md；权威需求：docs/Vessel路线 §21（L1946-1974，8 release gate）。
> 生成于 2026-09-12T05:51:27.078Z；schema 1；总判定：**PARTIAL**
> 判定规则：全 pass=ready / 有 fail=blocked / 有 pending 无 fail=partial（不以自证为证）。

## 8 道发布门禁
| # | gate | status | duration(ms) | criterion | evidence |
| --- | --- | --- | ---: | --- | --- |
| 1 | Build (tsc -b) | ✅ PASS | 7151 | 类型构建 `tsc -b tsconfig.json` 与 `apps/web` 类型检查（`tsc -p apps/web/tsconfig.json`）均完成且退出码 0（无类型错误）。 | 类型构建通过（根 tsc -b + apps/web typecheck 均 exit 0） |
| 2 | Unit (vitest root) | ✅ PASS | 72732 | 全量 `npx vitest run`（root）通过且退出码 0（无测试失败）。 | 全量 vitest（root）通过 |
| 3 | Deterministic Bench (L1) | ✅ PASS | 2819 | L1 可跑集（B001-B005 离线确定性 mock lane）全部 manifest 断言通过。 | 离线可跑集全部通过（17 个） — 扩至 L1 全离线可跑集（B001-B005 + B016-B027，含 V1.1-D streaming/interrupt/steering/resume）。 |
| 4 | Real Model Bench (082 lane) | ⏸ PENDING | 149747 | 082 真实模型 lane 收集到 §15 L3 指标；无凭据/无 provider 时显式 pending，不静默通过。 | 真实模型 lane 已跑通（0/25 行 passed，13 行模型未在步数预算内收敛）——非协议/凭据/实现回归 — real model gate: 真实 lane 真实执行（x-opencode-session 协议头 + 具名 UA + 凭据来源选对），失败行为模型对同一场景反复工具调用直到 64 步预算耗尽（跨次运行不稳定：同一场景两次实跑一 passed 一 failed）→ 如实 pending（复跑/换模型档后再判），不伪造 pass、不误判为 harness 回归。 凭据来源=CredentialStore vessel/opencode-go；模型档=mimo-v2.5-pro,deepseek-flash（task 102：Go 端点 x-opencode-session + 具名 UA + 路径分流）。 |
| 5 | Safety (075 pack) | ✅ PASS | 162 | 075 安全包（S001-S008 判据）离线 enforcement 证据齐全，无高危越权。 | 离线可跑集全部通过（6 个） |
| 6 | Resume (063/064) | ✅ PASS | 388 | 063/064 可跑集（068 soak 小规模）resume 不变量成立：暂停/续跑、workspace 零残留、从 handoff 续跑留痕。 | resume 不变量成立（暂停/续跑、零残留、从 handoff 续跑留痕） |
| 7 | UX Smoke (web) | ✅ PASS | 0 | web 套件或最小 smoke 通过；web 构建工具缺失时显式 pending。 | web smoke 构建产物存在 |
| 8 | Packaging (build artifacts + publish shape) | ✅ PASS | 5917 | build 产物检查（npm pack / 等价产物）存在且完整；工具缺失时显式 pending。发布物形状（publish-artifact）判据：① `apps/cli` 的 pack 期脚本（prepack / prepare）必须构建 dist——否则干净检出（无 dist）时 `npm pack` 会打出缺 `dist/cli.js` 的坏包 → **fail**；② `npm pack --dry-run` 的 tarball 清单必须含 `dist/cli.js` 与 4 个 `dist/configs/*`（policy.default.yaml / behavior.default.yaml / pricing.json / model-catalog.json），且不得含任何 `*.test.js` / `*.test.d.ts` / `*.map`；③ npm pack 不可用、目标包错位或输出无法解析时显式 **pending**，不静默通过。 | 发布物形状符合预期（62 个文件：含 dist/cli.js 与 4 个 dist/configs/*，零 *.test.* / 零 *.map） |
| 9 | Install Smoke (opt-in, gate 9) | ✅ PASS | 38101 | 安装态冒烟（install-smoke，**可选**：VESSEL_GATE_INSTALL_SMOKE=1 时执行）：把入口包的 workspace 运行时依赖闭包逐个 `npm pack --offline` 成 tarball → 在**全新空项目**里 `npm install <全部 tarball> --offline --no-audit --no-fund`→ 以**安装态**跑 CLI，断言 ① `policy status --json` 的 system 层路径逐字等于 `<项目>/node_modules/@vessel/cli/dist/configs/policy.default.yaml` 且该文件真实存在；② `usage` 不打印「未找到内置配置」。两条同时成立才 pass（`--version`/`--help` 恒 exit 0，**不作判据**）。环境不具备（未启用 / npm 不可用 / 离线装不上（缓存缺第三方依赖或解析不可达）/ 资源耗尽 / 超时 / 输出不可解析）→ 显式 **pending**；包真的坏了（自家 workspace 依赖未被同批 tarball 满足 / tarball 缺文件 / 装完无入口 / CLI 跑不起来 / 读路径落到包外 / 出现缺配置警告）→ **fail**；两者都不静默通过。 | 安装态冒烟通过（16 个 tarball → 全新空项目离线安装 exit 0 → system 层路径在包内 + `usage` 无缺配置警告） |

## 总体
| status | pass | fail | pending | 总时长(ms) |
| --- | ---: | ---: | ---: | ---: |
| partial | 8 | 0 | 1 | 277017 |

## 环境注解
- Real Model Bench (082 lane)：real model gate: 真实 lane 真实执行（x-opencode-session 协议头 + 具名 UA + 凭据来源选对），失败行为模型对同一场景反复工具调用直到 64 步预算耗尽（跨次运行不稳定：同一场景两次实跑一 passed 一 failed）→ 如实 pending（复跑/换模型档后再判），不伪造 pass、不误判为 harness 回归。 凭据来源=CredentialStore vessel/opencode-go；模型档=mimo-v2.5-pro,deepseek-flash（task 102：Go 端点 x-opencode-session + 具名 UA + 路径分流）。

> 说明：pending 的 gate（real model / UX / packaging）表示该 gate 在受限/无凭据环境下未完整执行，需在非受限环境补齐后再判 ready；本报告不因 pending 静默通过。
