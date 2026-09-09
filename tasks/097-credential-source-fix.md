# 097 — 凭据来源纠偏（移除对本机 CC Switch 应用数据的依赖）

- 编号：097
- 状态：待执行（等 085 合入后派活，避免同批次冲突）
- 优先级：P0（边界与安全：不该读用户本机应用数据）
- 创建日期：2026-09-08
- 关联：V1.1-F（f4236d7 引入 `benchmarks/runners/src/lane/ccSwitchCredential.ts` 读 `~/.cc-switch/cc-switch.db`）；
      034/069（CredentialStore DPAPI + secretRef）；docs/ideas/CC-SWITCH-MODULE-STUDY.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（用户明确纠正）

V1.1-F 把「从本机安装的 CC Switch 应用配置（`~/.cc-switch/cc-switch.db`，35MB SQLite）读取 API key」
当成凭据来源，并落了 `ccSwitchCredential.ts`（含 16 个测试）。用户指出：**学习对象是 cc-switch 开源项目
的模块设计，不是去动本机应用数据**。读取用户本机应用数据库越界，应移除。

## 验收标准（执行器逐条勾选）

- [ ] **移除运行时对本机 CC Switch 数据的依赖**：`benchmarks/runners/src/lane/ccSwitchCredential.ts` 不再
      读取 `~/.cc-switch/cc-switch.db` 或任何用户本机应用数据（删除该模块，或改造为纯内存/mock 接口——
      选型记录理由）。仓库内**不再有任何指向 ~/.cc-switch 的代码路径**（grep 验证）
- [ ] **凭据来源收敛为两条**：① 环境变量 `OPENCODE_API_KEY`；② 仓库 CredentialStore（034/069 DPAPI +
      secretRef，用户经 `vessel provider add` / setup 向导主动写入）。resolver 保持可注入可 mock
- [ ] 相关测试不再依赖本机 db（改为注入 mock / 临时目录自建 fixture）；若原 16 例依赖真实 db，改写或删除并在
      任务卡说明（不得保留"需要本机 db 才能过"的测试）
- [ ] 文档纠偏：`docs/REAL-MODEL-LANE.md` 的「CC Switch 凭据转接」节改写为「凭据来源（env / CredentialStore）」；
      说明"不读取任何用户本机应用数据"；任务卡 V1.1-F 的对应工作证明加一行更正备注（不改历史结论，只加纠正）
- [ ] 全量 vitest（root 900± 无回归）+ tsc 0 + web 74
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做凭据来源纠偏 + 文档纠正。不改 CredentialStore 本身（034/069 已验收）；不改真实模型 lane 其它逻辑；
  不动 pricing（085 卡负责）。
- 不删除用户本机任何文件（含 cc-switch.db）——只是不再读它。

## 涉及文件（指针，执行器自行精化）

- `benchmarks/runners/src/lane/ccSwitchCredential.ts` + `ccSwitchCredential.test.ts`（移除/改造）
- `benchmarks/runners/src/lane/opencodeGoProvider.ts`（resolver：env + CredentialStore，去掉 cc-switch 分支）
- `docs/REAL-MODEL-LANE.md`（§CC Switch 凭据转接 改写）
- `tasks/V1.1-F-real-model-verify.md`（加更正备注）
- grep 全仓 `cc-switch` / `.cc-switch` 确认无残留运行时引用（docs 里对开源项目的引用保留）

## 方法

- 先 grep 定位所有 `~/.cc-switch` 运行时引用 → 移除/改造 → 测试改为注入 mock → 文档纠偏 → 全量验证

## 工作证明（执行器回填：改了什么/删除或改造的模块/grep 验证结果/测试输出/diff，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
