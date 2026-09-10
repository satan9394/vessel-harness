# 107 — cache_creation 展示层（web UsageBar + local-server SSE）

- 编号：107
- 状态：待执行
- 优先级：P2
- 创建日期：2026-09-10
- 关联：099（69502c5：cacheCreationTokens 采集链路已打通）；089（cdf1374：cacheWrite 计价三档）；
      apps/web UsageBar + local-server usage SSE（目前只展示 cacheRead）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

把 089/099 的 cache_creation 能力接到展示层：`apps/web` 的 UsageBar 与 `apps/local-server` 的 usage SSE
（或等价 usage 展示）显示 **cacheWrite（cacheCreation）分项**，与 cacheRead 并列。

## 验收标准（执行器逐条勾选）

- [ ] 摸清展示链路：local-server 的 usage SSE 从哪读 UsageStore、web UsageBar 消费什么字段（grep cacheRead）
- [ ] 展示链路补齐 cacheWrite/cacheCreationTokens（含 estimated/derived 标记语义，沿用 085/089）
- [ ] 测试 ≥4 例：SSE 负载含 cacheWrite 分项/web UsageBar 渲染分项/缺字段回退/mock 数据；`tsc -b` exit 0 +
      全量 vitest（1152+ 无回归）+ web 74
- [ ] 文档同步（若涉 usage 展示说明）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做展示层消费 cacheWrite。不改采集链路（099 已通）、不改计价（089 已通）、不加依赖。
- web 套件运行：`npx vitest run --root apps/web`（独立 vite 配置）。

## 涉及文件（指针，执行器自行精化）

- `apps/local-server/`（usage SSE 端点）+ `apps/web/`（UsageBar 组件）
- `packages/shared/src/usage.ts` 或等价契约（若 SSE 负载类型需加字段）

## 方法

- 先 grep cacheRead 现状 → 加 cacheWrite 字段与渲染 → mock/测试 → 全量验证

## 工作证明（执行器回填：改动 diff/SSE 负载示例/渲染截图描述/测试输出，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：