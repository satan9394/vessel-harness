# 097 — 凭据来源纠偏（移除对本机 CC Switch 应用数据的依赖）

- 编号：097
- 状态：待验收
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

- [x] **移除运行时对本机 CC Switch 数据的依赖**：`ccSwitchCredential.ts` **整体删除**（选型见下），
      全仓无任何指向 `~/.cc-switch` 的代码路径（grep + 源码树守卫测试双证据）
- [x] **凭据来源收敛为两条**：① 环境变量 `OPENCODE_API_KEY`；② 仓库 CredentialStore（034/069 DPAPI +
      secretRef `credential:vessel/opencode-go`，用户经 `vessel provider add` / setup 向导主动写入）。
      resolver 保持可注入可 mock（`credentialAwareOpencodeGoKey({store,createStore,env,fallback})`）
- [x] 相关测试不再依赖本机 db：原 16 例随模块删除，重写为 12 例（env/store 两来源 + 注入 + 健壮性 +
      不读本机数据守卫 + lane 集成），全部 mock/临时目录 fixture，**无「需要本机 db 才能过」的测试**
- [x] 文档纠偏：`docs/REAL-MODEL-LANE.md` §CC Switch 凭据转接 → §凭据来源（env / CredentialStore）+
      「不读取任何用户本机应用数据」；`tasks/V1.1-F-real-model-verify.md` 末尾加更正备注（不改历史结论）；
      附带修正 `docs/RELEASE-GATES.md` gate 4 的过期描述
- [x] 全量 vitest（root 957 passed + 1 skipped，唯一 fail 为已知 process-tree 并发 flaky，隔离 11/11 绿）
      + tsc 0 + web 74
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

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

### 0. 选型：**整体删除** `ccSwitchCredential.ts`（不是改造为 mock 接口）

理由：该模块的**全部**功能就是「读用户本机应用数据取 key」——`defaultCcSwitchDbPath()` /
`SqliteCcSwitchReader`（`node:sqlite` 只读 `~/.cc-switch/cc-switch.db`）/ `probeCcSwitchOpencode()` /
`resolveApiKeyField()`（解析 `{file:}`、`{env:}` 引用，即读 opencode 的 key 文件）/ `migrateOpencodeGoCredential()`。
改造为纯内存/mock 接口只会留下一个「没有真实来源」的空壳，反而制造「还能从某处读 key」的误导。
模块里真正可复用的只有两个常量（`OPCODE_GO_CRED_SERVICE` / `OPCODE_GO_CRED_ACCOUNT`）和 resolver
相关的三个函数，它们**迁到新的凭据来源模块** `opencodeGoCredential.ts`（见 §2），
`node:sqlite` 依赖随模块消失。**未删除用户本机任何文件**（`~/.cc-switch/` 未触碰，只是不再读它）。

### 1. diff（`git diff --stat`，删除的两个文件见 §2）

```
 benchmarks/runners/src/lane/ccSwitchCredential.test.ts | 247 -----------------  (D 删除)
 benchmarks/runners/src/lane/ccSwitchCredential.ts      | 270 -----------------  (D 删除)
 benchmarks/runners/src/lane/index.ts                   |   4 +-
 benchmarks/runners/src/lane/opencodeGoProvider.test.ts |   6 +-
 benchmarks/runners/src/lane/opencodeGoProvider.ts      |  65 ++-----------
 benchmarks/runners/src/lane/run-opencode-lane.ts       |  35 +++-------
 benchmarks/runners/src/lane/run-v11f-verify.ts         |  19 +++-----
 benchmarks/runners/src/run-release-gates.ts            |  31 +++++---------
 docs/REAL-MODEL-LANE.md                                |  60 ++++++++----------
 docs/RELEASE-GATES.md                                  |   7 ++--
 tasks/V1.1-F-real-model-verify.md                      |  11 ++++
 11 files changed, 91 insertions(+), 664 deletions(-)
 + 新增（A）：benchmarks/runners/src/lane/opencodeGoCredential.ts（96 行）
 + 新增（A）：benchmarks/runners/src/lane/opencodeGoCredential.test.ts（210 行 / 12 例）
```

### 2. 删除 / 改造清单

| 项 | 动作 | 说明 |
| --- | --- | --- |
| `lane/ccSwitchCredential.ts` | **删除**（回收站） | 读本机 `~/.cc-switch/cc-switch.db` + `{file:}` key 文件；`node:sqlite` 依赖随之移除 |
| `lane/ccSwitchCredential.test.ts` | **删除**（回收站） | 原 16 例：11 例围绕 CC Switch 库探查/字段解析/迁移（随模块删除，不可保留）；5 例属凭据 resolver/lane 集成 → 重写进新测试 |
| `lane/opencodeGoCredential.ts` | **新增** | 唯一凭据来源模块：`OPENCODE_API_KEY_ENV` / `OPCODE_GO_CRED_SERVICE`/`ACCOUNT` / `OPENCODE_GO_CREDENTIAL_SOURCES`（诊断文案）/ `envOpencodeGoKey` / `credentialStoreOpencodeGoKey` / `credentialAwareOpencodeGoKey`。**不 import `node:fs`**，不读任何文件；store 后端抛错 → 不抛、落下一级 |
| `lane/opencodeGoCredential.test.ts` | **新增** | 12 例：来源常量收敛 / env 来源 / store 优先+env 回退+fallback / 实参断言 / 后端抛错不抛 / `createStore` 注入一次 / 临时目录自建 `.cc-switch` fixture 不被读取 / **仓库源码树守卫** / lane 无 key pending + 有 key 构造 + mock provider passed |
| `lane/opencodeGoProvider.ts` | 改造 | 删掉 `import ... from './ccSwitchCredential.js'`，改 import 新模块；搬走 4 个 resolver 符号；头部注释写明「凭据来源只有两条，不读任何用户本机应用数据」 |
| `lane/index.ts` | 改造 | `export * from './ccSwitchCredential.js'` → `'./opencodeGoCredential.js'`（避免 `export *` 同名歧义，不在 provider 里再 re-export） |
| `lane/run-opencode-lane.ts` / `run-v11f-verify.ts` / `run-release-gates.ts` | 改造 | 删除 `migrateOpencodeGoCredential()` 调用与 `--db <cc-switch.db>` 参数（含 release-gates 的 `argValue` 死代码）；改为 `createCredentialStore()` + `credentialAwareOpencodeGoKey({store})` 直读；证据/报告字段 `keySource` 改 `OPENCODE_GO_CREDENTIAL_SOURCES`，去掉 `ccSwitchBaseUrl`/`ccSwitchRowId`/`migrated` |
| `docs/REAL-MODEL-LANE.md` | 改写 | §「CC Switch 凭据转接（V1.1-F）」→ §「凭据来源（env / CredentialStore，task 097 纠偏）」+ 显式「不读取任何用户本机应用数据」引用块 + 代码示例去 migrate |
| `docs/RELEASE-GATES.md` | 纠偏（范围外补充） | gate 4 说明仍写「从 `~/.cc-switch/cc-switch.db` 探查」，属**描述已移除行为**的过期文档 → 同步为两来源 |
| `tasks/V1.1-F-real-model-verify.md` | 追加更正备注 | 只加「更正备注（不改历史结论）」，历史实测结论保持原样 |

**范围边界确认**：`packages/application/src/credential/**`（CredentialStore 本体）**零改动**；
real-model lane 其它逻辑、pricing、provider preset 目录均未触碰。新增依赖 0 个。

### 3. grep 验证（运行时无 `~/.cc-switch`）

命令（扫 apps/packages/benchmarks 的**非测试**源码，needle = `.cc-switch` / `cc-switch.db` / `node:sqlite` / `DatabaseSync`）：

```
RUNTIME SCAN: 0 hits (no .cc-switch / cc-switch.db / node:sqlite / DatabaseSync in non-test source)
```

残留 `cc-switch` 字样**全部是「学开源项目」的注释引用**（保留，任务卡明确允许），无一是数据访问路径：

```
apps\cli\src\providers\setup.ts:10        * opencode /connect, Pi /model, cc-switch Add-Provider + Fetch Models):
apps\cli\src\usage\UsageStore.ts:15       * Reference model: cc-switch usage tracking
apps\cli\src\cli.ts:402                   /** `vessel setup` — interactive guided provider wizard (cc-switch-style UX). */
packages\application\...\modelFetcher.ts:10   real (cc-switch's "Fetch Models" behavior).
packages\application\...\presets.data.ts:12,76,114,116,119,125  预设来源标注
packages\shared\src\pricing.ts:11         归一规则（学 cc-switch 的 candidates 思路…）
benchmarks/runners/src/lane/opencodeGoCredential.ts:6   学习对象是 cc-switch 开源项目的模块设计
```

另有**守卫测试**把该结论钉死：`opencodeGoCredential.test.ts` 的「仓库源码树守卫」递归扫
`apps/*/src` + `packages` + `benchmarks/runners/src` 的 `.ts/.tsx/.js/.mjs/.cjs`（排除 `*.test.ts`、
`node_modules`、`dist`），断言上述 4 个 needle 命中数为 0 —— 任何人再引入本机应用数据读取都会红。

docs/tasks 中的 `~/.cc-switch` 提及为**历史记录与开源项目调研**（`docs/ideas/CC-SWITCH-MODULE-STUDY.md`、
`docs/ideas/PROVIDER-UX-RESEARCH.md`、`docs/V1.1-ROADMAP.md` 的 V1.1-F 历史条目、V1.1-F 卡历史正文、本卡），
按任务卡要求保留（**不篡改历史记录**）。
`benchmarks/reports/V1.1-F-openmodel-lane.json` 是 2026-09-08 历史实跑证据（含 `ccSwitchBaseUrl` 字段），
**未改写**（不伪造历史证据）；下次跑 `run-opencode-lane.ts` 会按新字段集重写该文件。

### 4. 测试与类型验证（本机实跑）

```
npx tsc -b tsconfig.json --pretty false          → EXIT=0

npx vitest run benchmarks/runners/src/lane       → 3 files / 39 passed
  ✓ opencodeGoProvider.test.ts (15)   ✓ opencodeGoCredential.test.ts (12)   ✓ real-model-lane.test.ts (12)

npx vitest run  (root 全量)                      → 94 passed | 1 failed (95 files)
                                                  957 passed | 1 failed | 1 skipped (959 tests)
  唯一 fail：packages/runtime/src/sandbox/backend/process-tree.test.ts
             > attaches a pre-spawned grandchild into the job and enumerates it  (30s timeout)
  隔离复跑：npx vitest run packages/runtime/src/sandbox/backend/process-tree.test.ts → 11/11 passed
            （已知 task 072 并发计时 flaky，非本卡回归）

cd apps/web && npx vitest run                    → 8 files / 74 passed
```

计数核对：基线 961 passed（含旧 16 例）→ 删除 16 例 + 新增 12 例 = **957 passed**，差值恰为 4，无其它回归。

### 5. 踩坑与备注

1. **`export *` 同名歧义**：一度想在 `opencodeGoProvider.ts` 里 re-export 迁移走的符号以「零改动」，
   但 `index.ts` 同时 `export *` 两个模块会导致同名符号按 ESM 规范被判歧义而**静默消失**。
   改为「新模块唯一定义 + provider 只 import 不 re-export」，并同步改 `opencodeGoProvider.test.ts` 的 import。
2. **守卫测试的自指**：守卫要断言源码里没有 `.cc-switch` 字面量，而测试文件自身必须写出这些 needle
   → 扫描时排除 `*.test.ts`（已在测试注释里写明理由）。
3. **`credentialStoreOpencodeGoKey` 原本会抛**：`CredentialStore.getSync()` 在后端不可用时抛
   `CredentialError`（见 `CredentialStore.test.ts`），与 resolver 注释承诺的「读不到/不可用绝不抛」矛盾。
   本卡在该函数内加 `try/catch` 落下一级来源（**不改 CredentialStore 本身**），并补 2 例测试。
4. **驱动脚本 `--db` 参数删除**：`run-opencode-lane.ts` / `run-v11f-verify.ts` / `run-release-gates.ts`
   原先靠 `--db` 指定 CC Switch 库；参数已无意义，一并删除（含 release-gates 中随之变成死代码的 `argValue`）。
5. **环境**：本会话 `tsc` / `vitest` 均直跑成功，无 EPERM/沙箱阻塞，无需降级记录。
6. **未做**：不改 CredentialStore、不改 lane 其它逻辑、不动 pricing、不删用户本机任何文件、不加依赖。

### 6. 提交

- 实现提交：`6be5527` — `refactor(bench): 097 drop local cc-switch app-data credential source`（14 files changed,
  +521 / -677）。本行由 docs 提交补记。
- 工作树提交前只含本卡改动（无 `docs/V1.0-CHECKPOINT.md` 等指挥侧改动，未混入其它任务卡）。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
