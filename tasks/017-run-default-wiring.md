# 017 — `cah run` 默认走当前供应商 + TaskRouter/pricing 接入

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：CHANGELOG.md V0.6（run 默认 + pricing）。
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 014–016；目标 goal-575e1e4b

## 目标

`cah run` 未显式给 --provider/--model 时，用当前默认供应商（current.json）构造 provider；供应商默认模型进 TaskRouter 的 TierModelMap 来源；pricing.json 支持按模型价目（拉到的模型清单可作为价目键）。

## 验收标准

- [ ] cmdRun 未显式 provider → 读 current 供应商构造（protocol→createProvider；model 用供应商的 model 或 --model 覆盖）
- [ ] `cah run` 显式 --provider 仍优先（向后兼容）；无 current 且无显式 → 退回 mock + 提示
- [ ] TaskRouter 接入：供应商的默认模型可注入 TierModelMap（如 current 供应商 pro/fast 都指向它的 model）——至少文档化如何接 + 一个辅助函数
- [ ] pricing.json 扩展：支持 { models: { "<model-id>": {input,output,cacheRead} } }（拉到的模型可查价）；缺省回落 default
- [ ] Vitest：run 默认走 current 供应商（fake 验证）、显式优先、无 current 退 mock、pricing 解析
- [ ] `npx vitest run` 全绿；`npx tsc -b` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件

- apps/cli：cmdRun 默认供应商逻辑、pricing 加载
- packages/llm 或 apps/cli：TierModelMap 辅助
- `configs/pricing.json` 扩展 + 测试 + `docs/V06-PROGRESS.md`

## 依赖

- 依赖任务卡：014、015、016
- 阻塞于：016 合入

## 设计锚点

- 显式配置永远优先（项目一贯原则）
- current 供应商 = 默认体验；mock 是兜底（无配置时也能玩）
- TaskRouter 的 TierModelMap 本就是数据注入——current 供应商 model 作 pro/fast 默认即可，不重造

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
