# 098 — 修复 `tsc -b` TS5055（cli ↔ bench-runners 类型环）

- 编号：098
- 状态：待验收
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

- [x] 复现并确认根因（`npx tsc -b tsconfig.json` 退出码/报错行；逐项目 --noEmit 对照）
- [x] **打破类型环**（选型记录理由，优先不破坏分层）——采用候选 A（+ 显式单向 references），见下
- [x] `npx tsc -b tsconfig.json` **exit 0**（无 TS5055）；`tsc -b --force` 重建也 exit 0（防增量状态假绿）
- [x] 全量 vitest（root 961 passed / 1 skipped，无回归；唯一失败为已知 process-tree 并发 flaky，隔离跑 11/11 通过）+ web 74 + 逐项目 --noEmit 全绿（17/17）
- [x] 无新依赖；分层不回退（不把 cli 逻辑塞进 runners、不把 runners 逻辑塞进 cli）
- [x] 文档同步（ARCHITECTURE §6.1 + PROVIDER-MANAGEMENT §1.6 + REAL-MODEL-LANE opencode-go 节）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

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

### 1. 根因取证（引用图 + 证据链）

`grep '@vessel/cli|@vessel/bench-runners'` 得到的实际引用图（修复前）：

```
apps/cli/src/cli.ts:244   await import('@vessel/bench-runners')     // run --bench  → runScenario
apps/cli/src/cli.ts:590   await import('@vessel/bench-runners')     // bench-report → buildReport*/rowsFromLaneReport/renderCliSummary/writeReportFiles
        │
        ▼
node_modules/@vessel/bench-runners → benchmarks/runners/dist/index.d.ts
        │  (benchmarks/runners/src/runner.ts:7 / src/contracts/vessel.ts:17)
        │  (src/lane/opencodeGoProvider.ts:24,25 / src/lane/opencodeGoProvider.test.ts:21)
        ▼
node_modules/@vessel/cli → apps/cli/dist/index.d.ts   ← cli 自己的输出，却成为 cli 自己 program 的输入
```

TS5055 的 4 个文件恰好就是 `apps/cli/src/index.ts` 的再导出闭包
（`index.ts` → `./cli.js` / `./providers/presets.data.js` / `./providers/modelFetcher.js`，其中 cli.ts 再导出 chain 命中 `cli.d.ts`），
即「cli 的 program 通过 runners 的 d.ts 又读回了自己的 d.ts」→ `would overwrite input file`。

复现（退出码实测）：

| 命令 | 退出码 | 输出 |
|---|---|---|
| `npx tsc -b tsconfig.json`（增量已 up-to-date） | **0** | 无输出（**假绿**：增量状态掩盖） |
| `npx tsc -b tsconfig.json --force` | **2** | 恰好 4 行 TS5055（上方 4 行） |
| 逐项目 `tsc -p <pkg> --noEmit`（17 项目） | 0 | 17/17 OK（类型本身正确） |

> 取证命令：`npx tsc -b tsconfig.json --force *> .tscb-before-force.log`（4 行，EXIT=2）。
> 注：`| Select-Object -First N` 会截断管道并可能提前杀死 npx，导致 `$LASTEXITCODE` 失真；
> 所有退出码证据改用 `*> logfile` 落盘后读取。

### 2. 断环方案与理由

**选型：候选 A（provider preset 数据 + 模型拉取下沉到 `packages/application`）+ 显式单向 `references`。**

- 下沉物：`presets.data.ts`（PROVIDER_CATALOG/findPreset/ProviderPreset/ProviderCategory/PROVIDER_CATEGORY_LABELS）、
  `modelFetcher.ts`（fetchOpenAIModels/modelsForProtocol/ANTHROPIC_BUILTIN_MODELS/ModelSource）。
- 新家：`packages/application/src/providers/`（新增 `index.ts` barrel，`packages/application/src/index.ts` 显式导出）。
- 理由（为什么 A 最干净）：
  1. **零新依赖**：`@vessel/application` 早已依赖 `@vessel/llm`（`ProviderName` 类型来源），且 `benchmarks/runners`
     的 `package.json` 早已声明 `@vessel/application`——两侧都已依赖它，只是把 SSOT 从「上层 app」挪到「共享 application 层」。
  2. **不制造新环**：application 不依赖 cli / runners（已核对 tsconfig references 与 imports），依赖方向单向向下。
  3. **不破坏分层**：CLI 向导与 benchmark 真实模型 lane 复用同一份 provider 目录/拉取实现（原 V1.1-C 的 SSOT 意图保留），
     只是 SSOT 位置从 `apps/cli` 改为共享层；`@vessel/cli` 的对外 API 通过再导出**保持不变**（无破坏性变更）。
  4. 对比 B（runners 改读 `configs/provider-presets.json`）：需新增读盘 + 解析 + 校验路径，丢失类型化 SSOT，
     且会与 CLI 向导的数据源分叉；对比 C（cli 侧类型隔离）：只斩断 cli→runners 类型边，bench-report 会失去对 runners
     API 的类型检查，且没有解决「runners 向上依赖 cli」这一分层倒置。A 直接消除根因。
- 附带修正：`apps/cli/tsconfig.json` 补一条**单向** reference → `benchmarks/runners`（cli.ts 静态解析
  `@vessel/bench-runners`，V1.1-E 既有事实），让 `tsc -b` 的构建序显式、不依赖旧产物残存；
  runners 侧同步删除 `../../apps/cli` reference ⇒ 引用图恢复无环。
- 未使用任何掩盖手段：`skipLibCheck` 未改动（`tsconfig.base.json` 原本即为 true，非本卡引入）、
  未加 `exclude`、未改 `outDir`/`rootDir`。

### 3. 改动 diff 摘要（21 文件，+120/−136）

| 类别 | 文件 | 改动 |
|---|---|---|
| 移动（git mv，历史保留） | `apps/cli/src/providers/{presets.data.ts,modelFetcher.ts}` → `packages/application/src/providers/` | 路径注释同步；内容不变 |
| 移动（git mv） | `apps/cli/src/providers/modelFetcher.test.ts` → `packages/application/src/providers/modelFetcher.test.ts` | 与模块同包；断言不变 |
| 拆分/改名 | `apps/cli/src/providers/presets.data.test.ts` → `apps/cli/src/providers/presets.test.ts` | 目录数据断言下沉到 `packages/application/src/providers/presets.data.test.ts`；cli 侧保留 picker 面（4 断言） |
| 新增 | `packages/application/src/providers/index.ts`、`packages/application/src/providers/presets.data.test.ts` | barrel + 目录断言（含新增 1 条 opencode-go SSOT 断言） |
| 导出面 | `packages/application/src/index.ts` | 显式导出 providers 9 个符号（避免 `export *` 撞名） |
| cli 改引用 | `apps/cli/src/{index.ts,cli.ts,tui/chat.ts,providers/setup.ts,providers/presets.ts}` | 内部/对外均指向 `@vessel/application`（`@vessel/cli` 公共 API 不变） |
| runners 改引用 | `benchmarks/runners/src/{runner.ts,contracts/vessel.ts,lane/opencodeGoProvider.ts,lane/opencodeGoProvider.test.ts,lane/ccSwitchCredential.ts}` | `@vessel/cli` → `@vessel/application`（注释同步） |
| 构建图 | `apps/cli/tsconfig.json`（+单向 reference）、`benchmarks/runners/tsconfig.json`（−apps/cli reference） | 断环 |
| 文档 | `docs/ARCHITECTURE.md`（§6.1 布局 + 依赖方向约束）、`docs/PROVIDER-MANAGEMENT.md`（§1.6 数据路径）、`docs/REAL-MODEL-LANE.md`（SSOT 与 import 说明） | 同步 |

### 4. `tsc -b` 前后输出

| 命令 | 修复前 | 修复后 |
|---|---|---|
| `npx tsc -b tsconfig.json` | exit 0（增量假绿，无输出） | **exit 0**（无输出） |
| `npx tsc -b tsconfig.json --force` | **exit 2**（4× TS5055） | **exit 0**（无输出） |
| 回收 `apps/cli/dist` + `benchmarks/runners/dist`（回收站）后 `npx tsc -b tsconfig.json` | — | **exit 0**（无 stale 产物仍绿） |
| 同上再 `npx tsc -b tsconfig.json --force` | — | **exit 0** |
| 逐项目 `tsc -p <pkg> --noEmit`（root references 17 项） | 17/17 OK | **17/17 OK** |

日志留档（工作区根，已被 `.gitignore` 的 `*.log` 覆盖，提交前已回收）：
`.tscb-before-force.log`（4 行 TS5055）、`.tscb-after.log`、`.tscb-after-cleanbuild.log`、`.tscb-after-force.log`（均空 + exit 0）。

### 5. 测试结果

| 套件 | 结果 |
|---|---|
| root `npx vitest run` | Test Files 1 failed / 94 passed (95)；**Tests 961 passed / 1 skipped / 1 failed (963)** |
| root 失败项 | `packages/runtime/src/sandbox/backend/process-tree.test.ts > attaches a pre-spawned grandchild into the job and enumerates it`（30000ms 超时）——**已知 process-tree 并发 flaky**；隔离重跑该文件 **11/11 passed**（19s），本卡未触碰 `packages/runtime` |
| 基线对照 | 基线 root 960 passed + 1 skipped；本卡 **+1 断言**（`presets.data.test.ts` 新增 opencode-go SSOT 断言）⇒ 961 |
| 本卡相关定向 | `packages/application/src/providers` + `benchmarks/runners/src/lane/opencodeGoProvider.test.ts` + `apps/cli/src/providers`：**8 files / 85 tests passed** |
| web | `apps/web npx vitest run`：**8 files / 74 tests passed** |
| CLI 冒烟 | `npx tsx apps/cli/src/cli.ts --help` exit 0（运行时 import 图正常） |

### 6. 踩坑 / 环境备注

1. **增量假绿**：`tsc -b` 在 up-to-date 状态直接 exit 0，必须 `--force`（或删除相关 dist）才能看到 TS5055。
2. **stale dist 会复现 TS5055**：只删 runners→cli 引用、但不重建 runners 产物时，cli 仍可能读到**旧**
   `benchmarks/runners/dist/index.d.ts`（它 import `@vessel/cli`）。故补 cli→runners 单向 reference 固定构建序，
   并用「回收两侧 dist 后重建」验证。
3. **管道截断失真退出码**：`npx tsc -b ... | Select-Object -First 30` 会提前终止上游进程，`$LASTEXITCODE` 可能为 0；
   改用 `*> file` 后读取。
4. **`tsc -b --clean`（root）会暴露既有 clean-build 缺陷**（包内测试文件 import 了自身 references 未声明的包，
   如 `packages/core/src/**/*.test.ts` → `@vessel/llm`，依赖残留 dist 才能解析）——属**本卡范围外**的既有问题，
   故未以 root `--clean` 作为验收基线；本卡用「回收 cli/runners dist」精确验证无 stale 假绿。
5. **既有 flaky**：root 全量并发下 process-tree 用例偶发超时（基线已知），与本次改动无关（隔离跑通过）。
6. **观察项（未修，供后续卡）**：`benchmarks/runners/tsconfig.json` 未声明 `packages/engine` reference，
   而 `src/runner.ts` import `@vessel/engine`（当前靠 node_modules dist 解析）——同类「构建图声明不全」隐患，
   本卡按范围边界不顺手改。
7. **环境**：本会话为 danger-full-access，`npx tsc` / `npx vitest` / `npx tsx` 均可直跑，无 EPERM/spawn 受限。

### 7. 结论

`apps/cli/dist/*.d.ts` 不再出现在 cli 自身 program 的输入集中（runners 的 d.ts 已不含 `@vessel/cli`），
类型环消除；`tsc -b` / `tsc -b --force` / 无 stale 产物重建三条路径均 exit 0，全量测试无回归。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
