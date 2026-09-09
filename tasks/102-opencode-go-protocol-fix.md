# 102 — opencode-go 协议修正 + 真实 lane 跑通（x-opencode-session）

- 编号：102
- 状态：待执行
- 优先级：P0（让 V1.1-C/F 的真实模型闭环真正跑通；此前 401 系 key 错误）
- 创建日期：2026-09-09
- 关联：V1.1-C（d0da3ed lane 接线）；V1.1-F（f4236d7，401 结论已作废）；097（移除本机 key 来源）；
      docs/OPENCODE-KEY-VERIFY.md（8e15e66 实测报告）；082 lane；084 real-model gate
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 背景（实测结论，来自 docs/OPENCODE-KEY-VERIFY.md）

用用户提供的 key（指纹 `sk-8Dl…Cp4n1`）实测：opencode **Go 端点** `https://opencode.ai/zen/go/v1` 鉴权通过
（/v1/models 200，35 模型含 mimo-v2.5/-pro），但**强制 `x-opencode-session` 头**——缺失返回 400
`MissingSessionID`；补随机 UUID 后 `POST /chat/completions` + `model=mimo-v2.5` **200 成功**（usage 正常返回）。
Zen 端点（/zen/v1）该 key 余额 0（401 CreditsError）——两套计费独立，本卡只接 **Go 端点**。

## 验收标准（执行器逐条勾选）

- [ ] **协议修正**：opencode-go provider 客户端补齐 Go 端点要求 —— `x-opencode-session`（稳定 session id，
      每次会话一个 UUID；重试复用同一 id）+ 具名 User-Agent（按官方要求）；错误分类区分 400 MissingSessionID
      与 401 CreditsError
- [ ] **路径分流**（按实测）：chat/completions 承载 GLM/Kimi/LongCat/DeepSeek/MiMo/Hy/Omen；`/messages` 承载
      MiniMax/Qwen；`/responses` 承载 Grok/GPT-5.6-Luna/Muse Spark —— 本卡至少支持 **mimo-v2.5 走 chat/completions**，
      其余路径做**能力声明/路由映射**（不强行全实现，记录边界）
- [ ] **真实 lane 跑通**：以 MIMO V2.5（mimo-v2.5）跑 082 lane 的 LANE_SCENARIOS 授权子集（或最小可跑集），
      产出真实 §15 L3 报告（benchmarks/reports/）；推理模型需留思维链预算（max_tokens 足够）
- [ ] **084 real-model gate**：接真实 lane 后该 gate 结果更新（能跑通即 pass；若受额度/限流影响如实标注）
- [ ] **文档纠偏**：V1.1-F 卡与 docs/REAL-MODEL-LANE.md 更新结论（此前 401 系 key 来源错误，非实现缺陷；
      协议要求 x-opencode-session）
- [ ] 测试 ≥6 例：session 头注入/缺头 400 分类/路径分流映射/mock 端到端/降级；`npx tsc -b tsconfig.json` exit 0 +
      全量 vitest（1039+ 无回归）+ web 74
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Go 端点协议修正 + mimo-v2.5 真实跑通 + gate 更新 + 文档纠偏。不接 Zen 端点（余额 0）；不做 UI。
- **密钥安全**：key 只在进程内使用（执行器从任务指令获取，**绝不写入任何文件/git/日志/任务卡/报告**）；
  仓库代码里只允许从 env `OPENCODE_API_KEY` 或 CredentialStore 读取（097 已立此约定）。
- 真实调用配额最小化（连通 + lane 跑一次）。

## 涉及文件（指针，执行器自行精化）

- `benchmarks/runners/src/lane/opencodeGoProvider.ts`（协议头/路径分流/session id）
- `benchmarks/runners/src/lane/opencodeGoCredential.ts`（097：env + CredentialStore，不改来源）
- `benchmarks/runners/src/lane/`（082 lane 驱动）、`release-gates/`（084 gate）
- `docs/REAL-MODEL-LANE.md`、`tasks/V1.1-F-real-model-verify.md`（结论纠偏）
- 参考：`docs/OPENCODE-KEY-VERIFY.md`

## 方法

- 读实测报告 → 在 provider 客户端加 x-opencode-session + User-Agent + 错误分类 → 用真实 key（进程内）跑
  最小连通确认 → 跑 lane 子集出报告 → 更新 gate 与文档

## 工作证明（执行器回填：协议改动/真实跑结果/session 头证据/lane 报告路径/测试输出，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
