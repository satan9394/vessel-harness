# 015 — `cah models` 命令：拉取供应商模型列表

- 状态：待执行
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：依赖 014（取供应商配置）；目标 goal-575e1e4b

## 目标

`cah models [--provider <p>]` 列出某供应商可用模型。OpenAI 系调 `GET {base}/v1/models` 真实枚举（cc-switch Fetch Models 对齐）；Anthropic 无公开枚举端点 → 内置模型清单兜底并注明来源；mock → 提示离线。

## 验收标准

- [ ] `fetchOpenAIModels(baseUrl, apiKey)`：GET {base}/v1/models，解析 data[].id；非 2xx/网络错 → 明确错误
- [ ] 内置 Anthropic 模型清单（claude-opus/sonnet/haiku 当前代际，注明"内置清单非实时"）+ 提示可用 `/v1/models` 的兼容层
- [ ] `cah models` 命令：缺省用当前供应商；`--provider` 指定；输出模型 id 列表（每行一个，可复制）
- [ ] 无配置/无网络时的行为：清晰提示（"请先 cah provider add" / "无法拉取，显示内置清单"）
- [ ] Vitest：fake /v1/models server 拉取解析、错误路径、anthropic 兜底、mock 提示
- [ ] `npx vitest run` 全绿；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件

- apps/cli：models 命令 + modelFetcher 模块
- 测试 + `docs/V06-PROGRESS.md`

## 依赖

- 依赖任务卡：014
- 阻塞于：014 合入

## 设计锚点

- cc-switch 的 Fetch Models 同款：用配置的 key 调 /v1/models
- Anthropic 官方无 models 枚举端点（调研确认）→ 内置清单兜底，诚实标注
- 输出纯模型 id 列表，方便直接 `--model <id>` 用

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
