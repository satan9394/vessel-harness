# 098 — 修复 `tsc -b` TS5055（cli ↔ bench-runners 类型环）

- 编号：098
- 状态：待执行
- 优先级：P0（破坏项目标准类型检查命令 `npx tsc -b tsconfig.json`）
- 创建日期：2026-09-08
- 关联：V1.1-E（2069343，apps/cli 引入 bench-report 动态 import bench-runners）；V1.1-F（f4236d7，
  `opencodeGoProvider.ts` import `@vessel/cli` 的 `findPreset`/`fetchOpenAIModels`）；085（085 卡报告该缺陷）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（已定位）

`npx tsc -b tsconfig.json` 报 4 行错误（exit 2）：
```
error TS5055: Cannot write file 'apps/cli/dist/cli.d.ts' because it would overwrite input file.
error TS5055: Cannot write file 'apps/cli/dist/index.d.ts' because it would overwrite input file.
error TS5055: Cannot write file 'apps/cli/dist/providers/modelFetcher.d.ts' because it would overwrite input file.
error TS5055: Cannot write file 'apps/cli/dist/providers/presets.data.d.ts' because it would overwrite input file.
```
根因：**项目引用类型环**——`apps/cli/src/cli.ts` 动态 `import('@vessel/bench-runners')`（bench-report 命令）+
`benchmarks/runners/src/lane/opencodeGoProvider.ts` `import '@vessel/cli'`（复用 findPreset/fetchOpenAIModels）⇒
tsc -b 把 `apps/cli/dist/*.d.ts` 同时当作 runners 的**输入**与 cli 的**输出** ⇒ TS5055。
逐项目 `tsc -p <pkg> --noEmit` 全绿（17/17），说明类型本身正确，只是构建图成环。

## 验收标准（执行器逐条勾选）

- [ ] 复现并确认根因（`npx tsc -b tsconfig.json` 退出码/报错行；逐项目 --noEmit 对照）
- [ ] **打破类型环**（选型记录理由，优先不破坏分层）：
      候选 A：把 provider preset 数据 + 模型拉取下沉到下层包（如 `packages/application` 或 `packages/shared`），
      cli 与 runners 都依赖下层（消除 cli→runners / runners→cli 双向引用）；
      候选 B：runners 改为读数据文件（如 `configs/provider-presets.json`）而非 `import '@vessel/cli'`；
      候选 C：cli 的 bench-report 命令改为运行时动态加载 + 类型隔离（不进入 cli 的类型图）。
      ——任选其一（或组合），但**不得**靠 `skipLibCheck`/`exclude dist` 之类掩盖问题（要真正打破环）。
- [ ] `npx tsc -b tsconfig.json` **exit 0**（无 TS5055）；`tsc -b --force` 重建也 exit 0（防增量状态假绿）
- [ ] 全量 vitest（root 960+ 无回归）+ web 74 + 逐项目 --noEmit 全绿
- [ ] 无新依赖；分层不回退（不把 cli 逻辑塞进 runners、不把 runners 逻辑塞进 cli）
- [ ] 文档同步（若涉及包边界变化，更新 ARCHITECTURE 或相关说明）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只修类型环/构建图。不改计价（085 已验收）、不改真实模型 lane 业务逻辑（097 负责凭据来源纠偏）。
- 不动 `apps/web`（独立 vite）。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/cli.ts`（bench-report 动态 import）+ `apps/cli/src/index.ts`（V1.1-C 导出的 findPreset/fetchOpenAIModels）
- `benchmarks/runners/src/lane/opencodeGoProvider.ts`（import @vessel/cli）
- `benchmarks/runners/src/{index.ts,contracts/index.ts}`（导出面）
- 若下沉：`packages/application/src/`（或 shared）新增 preset/模型拉取模块 + 两侧改引用
- tsconfig：`tsconfig.json` / 各包 tsconfig（仅在必要时调整 references，不靠 exclude 掩盖）

## 方法

- 先复现 + 画出当前引用图（grep `@vessel/cli`、`@vessel/bench-runners`）→ 选最干净的断环方案 → 实施 →
  `tsc -b` 与 `tsc -b --force` 双验证 → 全量测试

## 工作证明（执行器回填：根因取证/断环方案与理由/改动 diff/tsc -b 前后输出/测试结果，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
