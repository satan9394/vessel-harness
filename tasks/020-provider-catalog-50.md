# 020 — 供应商预设库扩充到 50+（对标 cc-switch 全表）

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：CHANGELOG.md V0.8（71 家预填）。
- 优先级：P0
- 创建日期：2026-09（夜，用户睡前反馈）
- 关联卡片：目标 goal-c055c16c；021（TUI）依赖本卡目录数据

## 目标

供应商预设库从现有 12 个扩充到 50+，对齐 cc-switch 覆盖：官方（Anthropic/OpenAI/Gemini/xAI…）+ 国内厂商（DeepSeek/Qwen/Kimi/GLM/MiniMax/混元/阶跃/零一…）+ 聚合（OpenRouter/硅基流动/OneAPI…）+ 本地/推理（vLLM/Ollama/LM Studio…）+ 国际（Groq/Mistral/Cohere/Cerebras…）。做成可扩展数据目录（非硬编码 switch）。

## 验收标准

- [ ] 预设数据目录（如 providers/presets.data.ts 或 .json）：每项 { id, name, protocol, baseUrl, defaultModel?, auth: 'api-key'|'oauth'|'none'|'env', hint?, region? }，≥50 条
- [ ] 条目来源经调研核实（每个主要厂商的 base-url/协议正确——派调研子代理核实）
- [ ] 现有 12 条兼容迁移（id 不变，presets.ts 改为从数据目录加载）
- [ ] 分类（official/cn/aggregator/local/intl）可用于 picker 分组
- [ ] 测试：加载 ≥50、协议合法、id 唯一、分类齐全
- [ ] `npx vitest run` 全绿；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"

## 涉及文件

- `apps/cli/src/providers/presets.ts` → 数据目录化
- 测试 + `docs/V07-PROGRESS.md`（新进度）
- `docs/PROVIDER-CATALOG.md`（供应商目录文档，供用户查）

## 依赖

- 调研：cc-switch 预设全表核实（子代理）
- 阻塞于：调研返回

## 设计锚点

- cc-switch 50+ 预设的覆盖范围做对标清单（调研报告给全表）
- 数据驱动：新增供应商不改逻辑只加数据
- auth 标注（api-key/oauth/none）供向导与 /connect 用

## 工作证明（执行器回填）

- [ ] diff / 测试 / tsc

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回
- 备注：
