# 109 — 线协议修复（deepseek-flash 跑通前提）+ judgeUnit 误报

- 编号：109
- 状态：待执行
- 优先级：P0（线协议是 deepseek 系真实模型跑通前提；judgeUnit 误报影响门禁可信度）
- 创建日期：2026-09-10
- 关联：108（087977c：deepseek-flash 恒 0/10 = 100% 可复现线协议不兼容，转卡）；
      102/103（opencode-go 协议 + OpencodeGoProvider SSOT）；046（stream 契约）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（108 实测确诊）

1. **线协议不兼容（P0）**：deepseek-flash 走 `/chat/completions`，strict 上游要求：
   - 第 2 轮起 `role:'tool'` 消息**必须紧跟一条前置 `role:'assistant'` 且含 `tool_calls`** 的消息——
     当前 harness 的消息序列在第 2 次请求缺 assistant tool_calls（surface 投影未补），上游 400
     `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`；
   - 修正序列后，thinking 模式还需**回传 `reasoning_content`**（否则 400）。
   → 修后 deepseek-flash 才可能跑通 lane。
2. **judgeUnit 正则误报（P1）**：release-report 的 Unit gate 用正则判 vitest 输出，对"实际全绿"的运行误报 fail
   （108 的 release-report Unit=fail 但 vitest 实为 1155+1 exit 0）→ 门禁可信度受损。

## 验收标准（执行器逐条勾选）

### 线协议修复（P0，主）
- [ ] 定位消息组装点：surface 投影 / 请求构造（`packages/llm` 或 core 到 provider 的 messages 序列）——确认
      `role:'tool'` 前是否总有含 `tool_calls` 的 assistant 消息；无则按非流式/流式两条路径补
- [ ] 补 assistant `tool_calls` 投影（把上一轮的 tool_calls 一起发给上游——OpenAI 兼容约定；保留 tool_call_id 对应）
- [ ] thinking/推理模型：解析并**回传 `reasoning_content`**（deepseek 系；opencode-go 的 reasoning 字段，102/103 已见
      content=null + reasoning 有值）——请求时带 reasoning/thinking 回传参数（按上游要求），响应解析归一
- [ ] 不破坏 mimo-v2.5 / 其它 openai-compatible 路径（全量回归）
- [ ] 测试 ≥6 例：工具多轮序列含 assistant tool_calls / tool 响应紧跟 / reasoning_content 回传 /
      非推理模型不受影响 / 流式路径 / mock 上游 400 复现修复

### judgeUnit 误报（P1，次）
- [ ] 修 judgeUnit 判据（对通过运行的 vitest 输出不再误报）：用 exit code 或稳定摘要行判断，而非脆弱正则
- [ ] 测试：构造"全绿输出"样本断言 pass；构造真失败样本断言 fail

### 共同
- [ ] `npx tsc -b tsconfig.json` exit 0；全量 vitest（1155+ 无回归）+ web 82
- [ ] **真实验证（尽力而为）**：key 从 CredentialStore（--key-source=store，勿收 key）；deepseek-flash 跑 082 lane
      最小子集（如 B001/S001）——若线协议修复到位应 ≥1 场景通过；仍失败则如实记录新报错（不伪造，优先级 P0 但
      "真实跑通"若依赖上游更多语义则转卡）
- [ ] 文档同步（REAL-MODEL-LANE / EVENT-SPEC 若涉消息契约）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只修线协议（工具消息序列 + reasoning 回传）与 judgeUnit 判据。不改 pricing/统计/展示；不换 lane 默认模型
  （换模型另卡，需 deepseek 跑通后再说）；不加依赖。
- 密钥不落盘；真实调用配额最小化（probe + 最小子集 ×1）。

## 涉及文件（指针，执行器自行精化）

- `packages/llm/`（OpencodeGoProvider SSOT 103、OpenAICompatibleProvider、消息/usage 解析）
- `packages/core/`（AgentLoop after_model / 消息序列组装，若涉 core 需薄改+说明）
- `benchmarks/runners/src/release-gates/`（judgeUnit）
- 报告参考：`benchmarks/reports/real-model-lane-1789037140071-deepseek-flash.md`（108 失败证据）

## 方法

- 读 108 失败报告与消息组装路径 → 补 assistant tool_calls 投影 + reasoning 回传 → mock 上游 400 复现→修复 →
  judgeUnit 修 → 全量回归 → 真实最小子集验证

## 工作证明（执行器回填：改动 diff/消息序列修复点/reasoning 回传/真实子集结果/judgeUnit 修法/测试输出，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：