# 040 — Event Projections + SSE 增强（Conversation/Tool/Usage/Policy）

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：docs/V1.0-CHECKPOINT.md Milestone B（4d1be02）。
- 优先级：P1（Milestone B；路线 §5.3、§5.2 SSE）
- 创建日期：2026-09
- 关联：路线卡 040；goal（V1.0 产品化）；依赖 038/039（已合入）

## 目标

在 `@vessel/application` 里加事件投影层：由 Event Log 派生出 Conversation/Tool/Usage/Policy 等投影，供 Web UI 只读"已发生事实"，不自己解析 JSONL。SSE 从 039 的简单事件升级为按投影输出。

## 验收标准

- [ ] `packages/application/src/projections/`：至少
  - `ConversationProjection`（user/assistant 消息流：from before_turn/after_model/tool 事件）
  - `ToolActivityProjection`（tool/call + tool/result：工具名、参数摘要、状态、耗时）
  - `UsageProjection`（after_model usage 累计：input/output/cache tokens、成本估算）
  - `PolicyProjection`（audit/denial：被拒工具、规则、时间）
  - （可再加 Task/Team 占位）
- [ ] 每个投影是纯函数 `project(events, state) → newState` 或订阅 bus 增量更新（推荐订阅 bus 增量）
- [ ] `SessionController` 暴露 `projections`（各投影实例）或 `project(projectionName)`
- [ ] local-server `/api/sessions/:id/events` SSE 升级：发投影增量事件（conversation delta / tool delta / usage delta / policy denial），而不仅是 after_turn 粗粒度
- [ ] 测试：每投影 ≥2 例（用 mock bus 事件喂），SSE 输出含投影事件
- [ ] 全量 vitest/tsc 绿（323+ 无回归）
- [ ] 卡置"待验收"

## 涉及文件

- 新建 `packages/application/src/projections/*.ts` + 测试
- `packages/application/src/session/SessionController.ts`（挂 projections）
- `apps/local-server/src/server.ts`（SSE 用投影）
- index.ts 导出

## 依赖

- 038（SessionController）、039（server）；真 streaming 事件入 Milestone C（本卡用现有 after_* 事件即可）

## 方法

- 投影 = 订阅 bus 事件的 reducer；Controller 持有实例，server SSE 转发投影事件
- UsageProjection 成本用 pricing/modelCatalog（@vessel/application 可用 loadPricing 或注入）

## 工作证明（执行器回填）

- [ ] 投影文件 / 测试 / SSE 验证

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：