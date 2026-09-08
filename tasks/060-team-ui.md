# 060 — Team UI（web 3-Agents 面板 + 模型选择 Auto/Fast/Pro/Pin）

- 状态：待执行
- 优先级：P1（Wave 2 / Milestone D 收尾）
- 创建日期：2026-09-08
- 关联：056（Auto 路由显示/Pin）；057（TeamProjection 数据源）；058/059（评审可见性）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8.2/§10 + §9.1 UI 元素
  （External Review Required / Copy Handoff / Open Folder / Import Result；Auto→实际模型 + Pin for session）

## 目标

web 面落地 Team 相关 UI：3-Agents 面板（Lead/Developer/Reviewer 的活动、turn、阶段，消费 057
TeamProjection）；模型选择显示 Auto/Fast/Pro + 实际解析结果 + Pin for this session（056 的 seam
最小接线；打磨不限死）。External Review Required 区（Copy/Open/Import，接 059 数据）。

## 验收标准（执行器逐条勾选）

- [ ] Team 面板：按 057 TeamProjection 渲染团队成员状态（活动 turn/工具/阶段/产出摘要）；无团队
      运行时空态友好
- [ ] 模型选择：显示 Auto/Fast/Pro（默认 Auto）+ 实际解析（Auto → <model>）+ Pin 状态；Pin 后
      session 内锁定（接 056 API/状态）
- [ ] External Review Required 区：需要外部评审时显示 + Copy Handoff / Open Folder / Import Result
      （Import 触发 059 导入）
- [ ] 后端 seam 齐（server API/SSE 给到数据；040/052 投影框架）；web 独立套件测试补对应用例
- [ ] 测试：web 组件/套件测试 ≥6 例（面板渲染/选择状态/pin/评审区）；全量 vitest（含 web 独立
      套件）+ tsc 绿（426+前卡新增数 无回归）
- [ ] 文档同步（web Team 功能）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- UI 接线 + 数据消费。若 052/053（live projections/resume）未做且适合合并，可在此卡一并处理
  （注明合并了什么）。不做 UX 深打磨、不做 Electron。

## 涉及文件（指针，执行器自行精化）

- apps/web（组件/状态/API；参考 ConversationView/StatusBar 等既有模式）
- apps/local-server（API/SSE seam）
- 057 TeamProjection / 056 Auto 选择 / 059 handoff 的消费端

## 方法

- 读 §10 与 §8.2/§9.1 UI 需求；照 042-045 既有 web 卡模式（组件+api+独立 vitest.config）
- 后端 seam 若缺，先补 API 再渲染

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
