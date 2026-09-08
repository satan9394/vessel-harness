# 038 — @vessel/application 控制面：SessionController + ProjectRegistry + SessionRegistry

- 状态：待执行
- 优先级：P0（Milestone B；路线 §四 Application Layer、§5.2 API 依赖）
- 创建日期：2026-09
- 关联：路线卡 038/039/040；goal（V1.0 产品化）；依赖 037（已合入）

## 目标

在 `@vessel/application` 里新增应用控制面，为 Local Server / Web 提供稳定命令 API，替代各自复制 wiring。CLI 也改为走这些控制器（或至少提供同构接口）。

## 验收标准

- [ ] `packages/application/src/project/ProjectRegistry.ts`：列出/打开工作区项目（open 记录 workspaceRoot；list 返回项目集合）
- [ ] `packages/application/src/session/SessionRegistry.ts`：create/list/get 会话（每个会话关联 composeHarness + workspace + provider/model/permission 状态；会话 id、创建时间）
- [ ] `packages/application/src/session/SessionController.ts`：一个会话的控制对象——runTurn / interrupt（预留）/ steer（预留）/ 当前 provider/model/permission / close；把 composeHarness 的 loop/session/event 封装成稳定接口
- [ ] 数据持久化：session registry 落盘（`~/.vessel/sessions.json` 或项目 `.vessel/{project}/sessions.json`），重启可恢复会话列表
- [ ] CLI 接入：`vessel run` 走 SessionController.run（至少 run 路径经控制器）；不引入行为回归
- [ ] 全量 vitest/tsc 绿（297+ 无回归）；新增测试（ProjectRegistry/SessionRegistry/SessionController 各 ≥2 例，含状态持久化）
- [ ] 卡置"待验收"

## 涉及文件

- 新建 `packages/application/src/{project,SessionRegistry.ts,session/SessionController.ts}` + 测试
- `apps/cli/src/cli.ts`（可选接入 SessionController——若改动大则本卡先只建 controller + registry + 测试，run 接入留 039/040）
- docs/V1.0-ROADMAP-PROGRESS.md

## 依赖

- 037（@vessel/application 已存在）；interrupt/steer 是预留接口（本卡可空实现/占位），真实现入 Milestone C

## 方法

- SessionRegistry 管理 active 会话 map + 持久化；SessionController 包装 composeHarness，暴露 runTurn、状态 getter、close
- ProjectRegistry.open 验证目录存在并记录
- 会话恢复：restart 时从 sessions.json 重新 compose（可选：MVP 只恢复元数据，不急着重启 live loop）

## 工作证明（执行器回填）

- [x] 新增文件 / 测试 / 持久化验证 / tsc/vitest
  - 新增：`packages/application/src/project/ProjectRegistry.ts`(+test)、`packages/application/src/session/SessionRegistry.ts`(+test)、`packages/application/src/session/SessionController.ts`(+test)；`index.ts` 导出 ProjectRegistry/SessionRegistry/SessionController + 类型
  - 测试：ProjectRegistry 5 / SessionRegistry 5 / SessionController 4 = 新增 14 例；全量 vitest 311 passed（40 files）
  - tsc -b：exit 0；CLI mock 冒烟：kind=success
  - 持久化：sessions.json/projects.json 写 `<vesselHome>`（默认 ~/.vessel；测试注入 os.tmpdir 假 home，不碰真目录）；原子 tmp+rename；跨实例可恢复

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：