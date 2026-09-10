# 111 — lane 默认模型切换：mimo-v2.5 → deepseek-flash

- 编号：111
- 状态：待验收
- 优先级：P1（110 建议 + 指挥采纳；改善 real-model lane 稳定性）
- 创建日期：2026-09-10
- 关联：110（1b076e2：deepseek 全场景 10/10、收敛快）；108/109（wire 修复打通 deepseek）；
      docs/REAL-MODEL-LANE.md；082 lane；084 gate 4
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

把 082 real-model lane 的**默认模型**从 `mimo-v2.5` 换成 `deepseek-flash`（110 终对比：稳定性 10/10 全过 vs
mimo 恒有失败、收敛快；成本更高已记录）。**只改默认值 + 相关文档/常量**，不动协议/判据；暴露 `--models`
覆盖以保留 mimo 复跑能力。

## 验收标准（执行器逐条勾选）

- [x] 定位 lane 默认模型常量/默认参数（`benchmarks/runners/src/lane/`：defaultLaneModels 或等价，102/110 用过
      `--models`）——把默认从 mimo-v2.5 改为 deepseek-flash（**保留显式 --models=mimo-v2.5 覆盖能力**）
- [x] 相关默认（如推理预算/路径声明：deepseek 走 /chat/completions 已由 109 支持）核对无遗漏
- [x] 文档同步：`docs/REAL-MODEL-LANE.md` 默认模型节（写明：默认 deepseek-flash，理由=稳定性；成本特性注明：
      单轮最高 $0.94 vs mimo $0.59；`--models=mimo-v2.5` 可复跑）；若 release-report 或 gate 文档引默认也同步
- [x] 测试：默认值断言（CLI 无 --models 时 resolve 到 deepseek-flash；显式 --models=mimo-v2.5 覆盖）；`tsc -b`
      exit 0 + 全量 vitest（1166+ 无回归）+ web 82
- [x] **可选（尽力而为）**：真实 lane 默认跑 1 个场景确认默认生效（key 从 CredentialStore；不强制，若环境受限注明）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只改默认模型 + 文档 + 默认断言。不动协议/判据/pricing；不做 UI；不加依赖。
- 密钥不落盘（CredentialStore/env；输出只许指纹）。

## 涉及文件（指针，执行器自行精化）

- `benchmarks/runners/src/lane/`（默认模型常量：opencodeGoProvider.ts / lane 驱动 index 或 run 脚本）
- `docs/REAL-MODEL-LANE.md`

## 方法

- 读 110 报告与 lane 默认定义 → 改默认 → 断言/文档 → 全量验证

## 工作证明（执行器回填：改了什么/默认断言/文档 diff/测试结果，全部写进本文件，勿留对话里）

- [x] 已回填（2026-09-10T12:25Z；key 只经 CredentialStore（来源名/长度，无片段；指纹 sk-8Dl…），未落盘）

### 1. 改动 diff（默认改点，全在 `benchmarks/runners/src/`）

| 文件 | 改动 |
| --- | --- |
| `lane/opencodeGoProvider.ts` | ① 新增 `DEEPSEEK_FLASH_MODEL_ID = 'deepseek-flash'` 常量；② 抽出 `assembleLaneModels()` 装配器；③ 新增 `defaultLaneModels(available)`——**默认 flash 档优先 `deepseek-flash`**（live 清单含则选），pro 档保持 MIMO V2.5 Pro；live 无 deepseek-flash（如无 key 内置参考快照）→ 回退 `selectMimoModel` 既定 MIMO V2.5 系选择，不抛；④ 新增 `explicitLaneModels(ids, tiers)`——显式 `--model=`/`--models=` 覆盖助手（直接映射指定 id，不经过默认选择，**mimo-v2.5 复跑能力保留**）；⑤ `defaultMimoLaneModels` 保留（MIMO 专属选择/回退语义，装配逻辑与旧实现等价，行为不变） |
| `lane/run-opencode-lane.ts` | 导入改 `defaultLaneModels` + `explicitLaneModels`；`buildModels` 内部委托 `explicitLaneModels`（无 `--model` → 默认档；有 → 显式覆盖）；启动日志 `[111] lane 默认模型档（flash 优先 deepseek-flash）：…`（替换原 `MIMO target from list`）；`--model` 帮助注释更新（`--model=mimo-v2.5` 保留复跑） |
| `run-release-gates.ts` | 导入改 `defaultLaneModels` + `explicitLaneModels`；`--models` 缺省 → `defaultLaneModels`（flash=deepseek-flash）；显式分支改用 `explicitLaneModels(ids, ['flash'])`（语义与旧内联映射一致） |

协议/判据/pricing **零改动**；`--model=` / `--models=` 参数未删（覆盖路径 = `explicitLaneModels`，有断言兜底）。

### 2. 默认断言（`lane/opencodeGoProvider.test.ts` 新增 5 条，task 111 组）

1. 无 `--models`/`--model`（live 含 deepseek-flash）：`defaultLaneModels` → flash 档 = `deepseek-flash`（≠ mimo-v2.5），pro 档 = `mimo-v2.5-pro`；
2. live 无 deepseek-flash（无 key 内置参考快照）→ 回退 `mimo-v2.5`，不 throw；
3. 显式 `--models=mimo-v2.5` → `explicitLaneModels(['mimo-v2.5'],['flash'])` = `opencode-go:mimo-v2.5/flash`（mimo 复跑能力保留）；
4. 显式 `--model=deepseek-flash,mimo-v2.5 --tier=both` → 两 id × 两档 4 条映射；
5. `defaultMimoLaneModels` 保留 MIMO 语义（显式/回退不动）。

### 3. 文档 diff（`docs/REAL-MODEL-LANE.md`）

- **新增「默认模型档切换（task 111：mimo-v2.5 → deepseek-flash）」节**（置于「终对比（task 110）」后）：默认 flash=deepseek-flash（稳定性 10/10、gate 4 pending→pass）；成本特性注明**单轮最高 $0.94 vs mimo $0.592**（usage 波动，需 release 观察）；显式 `--model=mimo-v2.5` / `--models=mimo-v2.5` 可复跑；协议/判据未动。
- V1.1-C「模型确认」bullets：默认档改由 `defaultLaneModels()` 决定（deepseek-flash 优先，MIMO V2.5 系回退），`defaultMimoLaneModels` 保留为 MIMO 专属选择；显式覆盖经 `explicitLaneModels`。
- 「推理模型预算」bullets：注明 `deepseek-flash`（thinking 模式）走同一 `OpencodeGoProvider`、`max_tokens=8192` 默认相同，`reasoning_content` 归一/回传由 109 承载。
- 「凭据来源」代码示例：`defaultMimoLaneModels` → `defaultLaneModels`（注释标注 task 111）。
- release-report/gate 文档核对：`benchmarks/reports/release-report.{md,json}` 为**上次 gate 实跑的生成产物**（其中 real-model-bench 模型档已记 `deepseek-flash`，与新默认一致；wire-400 pending 为 108 时代历史 run note，非默认声明），重生成需整跑 8 gate 烧配额 → 本次不同步、在涉文件备注记录。

### 4. 测试/命令输出

- `npx tsc -b tsconfig.json` → **exit 0**（含新导出 defaultLaneModels/explicitLaneModels/DEEPSEEK_FLASH_MODEL_ID）。
- lane 定向：`npx vitest run benchmarks/runners/src/lane/opencodeGoProvider.test.ts` → **20/20 passed**（原 15 + 新 5），exit 0。
- 全量 vitest（root）：**108 文件 / 1171 passed + 1 skipped（1172），exit 0**（基线 1166+1；+5 为本卡新断言，无回归）。
- 全量 vitest（apps/web）：**9 文件 / 82 passed，exit 0**（基线 82，无回归）。

### 5. 可选真实验证（默认生效，环境可用，1 次调用不重试）

命令（**无 `--model`**，key 从 CredentialStore `--key-source=store`；仅指纹 sk-8Dl…）：
`npx tsx benchmarks/runners/src/lane/run-opencode-lane.ts --key-source=store --scenarios=B001 --label=111-default-b001`

```
[111] lane 默认模型档（flash 优先 deepseek-flash）：OpenCode Go mimo-v2.5-pro(pro), OpenCode Go deepseek-flash(flash)
[102] models=mimo-v2.5-pro/flash, deepseek-flash/flash scenarios=B001
[102] route deepseek-flash → /chat/completions (openai-chat, implemented)
[V1.1-F] lane degraded=false rows=2 → benchmarks/reports/real-model-lane-1789042974212.md
```

报告 `benchmarks/reports/real-model-lane-1789042974212.{md,json}`：**`opencode-go:deepseek-flash` B001 passed**
（1 toolCall，in 3481/out 179，cost $0.002175）；mimo-v2.5-pro 同时跑 B001 亦 passed（driver 既有
tier 收敛行为：无 `--tier` 时 autoIds 均标 flash，pro 档也会跑 flash 场景——**改动前同语义**，非回归）。
→ **默认已生效**：live 清单解析 + deepseek-flash 端到端跑通。

### 6. 踩坑 / 环境备注

1. **probe 目标**：`run-opencode-lane.ts` operator 用 `models[0].defaultModel` 探针 → 本次探到
   `mimo-v2.5-pro`（`defaultLaneModels` 先 push pro 档；与 task 102/105 时代的既有行为一致，非本卡引入）。要
   探 deepseek-flash 可显式 `--model=deepseek-flash --probe-only`；未改动（范围克制）。
2. **run-opencode-lane 的 autoIds 收敛**：无 `--tier` 时（默认 flash），autoIds 里 pro 档模型也以 flash 档跑
   flash 场景（既有设计，110/102 时代同语义）；若想「只跑 deepseek-flash 单档」可 `--model=deepseek-flash`；
   本卡未改该行为（非默认改点）。
3. 全量 vitest 在非受限环境实跑成功（未走沙箱降级通道）；真实调用配额 ≈ models GET×1 + probe×1 +
   B001×2 ≈ $0.005（全部成功，零密钥落盘）。
4. 未触碰指挥侧文档（docs/V1.0-CHECKPOINT.md、docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md 等）；release-report
   为生成产物，未人工改（见 §3）。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：