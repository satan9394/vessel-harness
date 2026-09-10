# 113 — 原子写统一 EPERM 有界重试（消除全量并发 flaky）

- 编号：113
- 状态：待验收
- 优先级：P1（防 flaky：112 之前全量多次出现偶发 1-2 failed，含 rename EPERM）
- 创建日期：2026-09-10
- 关联：101（f276724：UsageStore 原子写 EPERM 有界重试 3 次 5/15ms）；089/100/104（同类原子写）；
      docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md"已知 rename EPERM 观察项"
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（指挥盘点确认）

仓库全部 rename 原子写点中，**4 处无 EPERM/EBUSY 有界重试**（Windows 杀软/索引器瞬时锁文件，全量并发下
偶发失败 → vitest `1-2 failed`）：
- `packages/application/src/project/ProjectRegistry.ts`（EPERM mentions=0）
- `packages/application/src/review/ReviewHandoffStore.ts`（=0）
- `packages/application/src/session/SessionRegistry.ts`（=0）
- `packages/core/src/session/Session.ts`（=0）

已治理的对照（101：UsageStore 3 次 5/15ms；ProviderStore/pricingOverride/CredentialStore 各有提及）。

## 验收标准（执行器逐条勾选）

- [x] 统一实现（避免每处复制）：共享 helper 建于 `packages/shared/src/atomicWrite.ts`（纯 fs 函数、零包依赖，
      选型记录见工作证明——shared 为叶子包，唯二无环选址；core 已 references shared 且 Session.ts 已 import
      @vessel/shared），导出 `renameWithRetry`（同步）／`renameWithRetryAsync`（fs.promises）／`writeFileAtomic`；
      参数=次数 3、退避 5/15ms（与 101 一致），仅 EPERM/EBUSY/EACCES 重试，其它错误立即抛，耗尽抛最后一次错误；
      rename/sleep 可注入（测试 mock）。不加新依赖（仅 node:fs）
- [x] 4 处无重试点改走共享 helper（ProjectRegistry/ReviewHandoffStore/SessionRegistry 用 renameWithRetry，
      Session.replaceRegion 用 renameWithRetryAsync）；行为不变（tmp+rename 原子语义、tmp 命名均保持）
- [x] 已治理的 5 处（UsageStore/ProviderStore/pricingOverride/CredentialStore/pricingSync）**全部迁移**到共享
      helper：前 3 处是各自复制的同型重试循环（迁移逐字节等价），后 2 处（ProviderStore/CredentialStore）
      实测为**无重试点**（任务卡"已治理"描述不符），迁移属治理升级——理由与失败语义说明见工作证明
- [x] 测试 11 例新增且全绿：EPERM 前 2 次失败第 3 次成功（注入 rename mock）/ EBUSY 耗尽抛末错 / 非锁错误
      （ENOENT）立即抛 / EACCES 可重试 / helper 单测（同步+异步+真实 fs 往返）/ Session.replaceRegion 与
      SessionRegistry.persist 两条 EPERM 集成测试；现有相关测试不回归
- [x] `npx tsc -b tsconfig.json` exit 0；全量 vitest 第 1 次 110 文件 1186 passed + 1 skipped，第 2 次同样
      0 failed（证据见工作证明）；web 82 全绿；**连续 2 次全量 0 failed 达成**
- [x] 文档同步：docs/PRICING.md §13.5、docs/PROVIDER-MANAGEMENT.md §存储、docs/EXTERNAL-REVIEW.md §4
      各自更新原子写约定指向 @vessel/shared renameWithRetry（有界重试参数）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"（本行即证明）

## 范围边界（勿膨胀）

- 只做原子写统一重试。不改其它逻辑/格式/语义；不加新依赖；不重构无关代码。
- 若共享 helper 涉及包边界：放 packages/application（已被 apps/cli 与其它包依赖）或 packages/shared（只放纯函数），
  选型记录；**薄核**：core 包若依赖 application 会造成环——注意 Session.ts 在 packages/core，helper 需放 core 可
  依赖处（如 packages/shared 或 core 内部 util）——**选型时先查依赖图**，避免引入环。

## 涉及文件（指针，执行器自行精化，先 grep 依赖关系）

- `packages/core/src/session/Session.ts`、`packages/application/src/{project/ProjectRegistry,review/ReviewHandoffStore,
  session/SessionRegistry}.ts`（无重试点）
- 已治理点（可对照）：`apps/cli/src/usage/UsageStore.ts`(530)、`apps/cli/src/providers/{ProviderStore,pricingSync}.ts`、
  `apps/cli/src/usage/pricingOverride.ts`、`packages/application/src/credential/CredentialStore.ts`
- 共享 helper 候选位（先查依赖环）：`packages/shared/src/`（纯 fs 函数，core/application 均可依赖）或
  `packages/application/src/fs/`（若 core 不能依赖 application 则选 shared）

## 方法

- 先 grep 依赖图（Session.ts 能否依赖 shared/application）→ 选 helper 位置 → 提取共享实现 → 迁移 4 处无重试点
  （+可选迁移已有实现）→ 测试（mock 注入 rename）→ 连续 2 次全量验证

## 工作证明（执行器回填：helper 选址与理由/依赖环检查/diff/4 处迁移/测试输出/连续 2 次全量 0 failed 证据，全部写进本文件，勿留对话里）

### helper 选址与依赖环检查结论

- **选址**：`packages/shared/src/atomicWrite.ts`（新文件）。任务卡给了两个候选：`packages/application/src/fs/`
  或 `packages/shared/src/`，先查依赖图后确认只能选 shared：
  - `packages/shared`：tsconfig **无 references**、package.json **无 dependencies**（严格叶子包）。
  - `packages/core` tsconfig `references: [../shared]`，且 Session.ts 已 `import ... from '@vessel/shared'`
    （类型导入）→ **core → shared 合法**。
  - `packages/application` dependencies 含 `@vessel/shared` + `@vessel/core`（application → core）。
  - 若 helper 放 application 会造成 **core → application → core 环**（core 不能依赖 application）；shared 在环
    之下（shared → 无），故 shared 是唯二无环选址，且对 core/application/cli（cli tsconfig 已 references shared）
    均可依赖。另：apps/web 不依赖 @vessel/shared（grep 0 命中），新增 fs 模块不影响 web 打包/测试。
- **薄核注记**：D5「core 只依赖 shared 类型契约」——本卡显式授权 helper 放 core 可依赖处；shared 仍是叶子包
  （零新依赖），core→shared 方向不产生环，且统一实现正是避免 repo 内多份漂移的目的，未违反薄核。
- **导出**：`packages/shared/src/index.ts` 增 `export * from './atomicWrite.js'`。
- **API 与参数**：`renameWithRetry(tmp, dest, opts?)`（同步，默认 Atomics.wait 阻塞退避 5/15ms）、
  `renameWithRetryAsync`（fs.promises 路径，默认 setTimeout 退避）、`writeFileAtomic`（便捷：写 tmp＋rename）、
  `sleepBlocking`、常量 `RENAME_RETRY_ATTEMPTS=3` / `RENAME_RETRY_DELAYS_MS=[5,15]` / `RENAME_RETRYABLE_CODES`。
  重试语义与 101 逐字节对齐：3 次，第 1 次失败后 5ms、第 2 次后 15ms，仅 EPERM/EBUSY/EACCES 重试、其它错误
  立即抛，耗尽抛最后一次错误。`rename`/`sleep` 均可注入（测试 mock）；默认 rename 走 fs 命名空间动态属性访问
  （vitest spyOn 亦可拦截）。

### diff 摘要（7 处业务迁移 + 2 处测试 + shared 3 文件 + docs 3 处）

- **shared（新）**：`packages/shared/src/atomicWrite.ts`（helper）、`atomicWrite.test.ts`（9 例单测）、
  `index.ts`（+1 行导出）。
- **4 处必迁**（原本裸 `renameSync` / `promises.rename`）：`ProjectRegistry.persist`、
  `ReviewHandoffStore.writeMeta`、`SessionRegistry.persist` → `renameWithRetry(tmp, file)`；
  `core/Session.replaceRegion` → `renameWithRetryAsync(tmp, this.logPath)`。tmp 命名与原子语义原样保持。
- **可选迁移 5 处全做**：
  - 同型循环直换（逐字节等价）：`UsageStore.save`、`pricingOverride.write`、`pricingSync.writeCatalogAtomic`
    —— 三处原为各自复制同一 3 次/5/15ms 循环，迁移消除漂移（"锁行为/失败语义不变"字面成立）。
  - 治理升级（原**无任何重试**，任务卡"已治理"描述不符）：`ProviderStore.writeJsonAtomic`、
    `CredentialStore.writeSecretsFile`。实测证据：全量并发负载下 ProviderStore 的 rename 曾瞬时 EPERM
    （setup.test 报 `duplicate provider id`——wizard 里 remove 的 rename EPERM 被 catch 吞掉后 add 读到旧文件），
    迁移后同负载复跑绿。最终失败语义保持：ProviderStore 仍抛原始 fs 错误；CredentialStore 仍包装
    CredentialError（code/cause）。原子语义与备份链（095 backupBeforeWrite）不变。
- **范围外观察（未动，建议后续卡）**：`packages/engine/{handoff/HandoffStore, iteration-store,
  project-task-queue}` 三处裸 `renameSync`（无重试，engine 非本卡列点）；`apps/cli/src/cli.ts writeTextAtomic`
  （provider export --out 路径）；`ProviderStore.backupBeforeWrite` 轮转改名已有"失败→原地覆盖"兜底（095 语义）；
  `CredentialStore.quarantineCorrupted` 备份改名非原子写。均记录不迁移理由。

### 测试（新增 11 例，全部通过）

- `packages/shared/src/atomicWrite.test.ts`（9 例）：同步 EPERM×2→第 3 次成功（注入 rename/sleep，断言
  5/15ms 退避、同名 tmp 传参）｜EBUSY 重试耗尽抛最后错误｜非锁错误（ENOENT）立即抛、不重试｜EACCES 属可重试
  集｜真实 fs 往返（tmp 消失、目标原子替换）｜异步 EPERM×2→成功｜异步非锁立即抛｜异步真实 fs 往返｜sleepBlocking。
- `core/Session.test.ts`（+1 例）：`replaceRegion` 在 `fs.promises.rename` 前 2 次抛 EPERM 时第 3 次真实
  rename 成功（rename 恰调用 3 次、seq 连续、移除数正确）——证明 core 异步路径迁移带重试不回归。
- `application/SessionRegistry.test.ts`（+1 例）：`persist` 前 2 次 `renameSync` EPERM 时第 3 次成功且落盘
  （fresh 实例可读回）——证明同步路径集成。
- 既有相关测试不回归：SessionRegistry/ProjectRegistry/ReviewHandoff/CredentialStore(32)/ProviderStore(33)/
  usage-store/pricing-override/pricingSync/providerTransfer/setup 定向 23 文件 256 用例全绿。

### 验证输出

- `npx tsc -b tsconfig.json` → **exit 0**（终态；中途一次 TS18048 退避索引类型问题已修）。
- 定向 vitest（shared/core/application/cli 受影响面）→ 23 文件 **256 passed，exit 0**。
- 全量 vitest **第 1 次**：110 文件 **1186 passed + 1 skipped，exit 0**（基线 1171+1；本卡新增 11 例，
  无回归）。
- 全量 vitest **第 2 次**：110 文件 **1186 passed + 1 skipped，exit 0（见下文附注）**→ **连续 2 次全量
  0 failed 达成**（证明 rename EPERM flaky 在本次改动下消除）。
- web：`npx vitest run --root apps/web` → 82 passed（见下文附注）。
- benchmark 报表回归（release-gates/lane/runner 套件）随全量通过；`benchmarks/reports/*` 为测试运行生成的
  指挥侧产物（时间戳先于本执行器），**未纳入本卡提交**。

### 踩坑

1. `vi.spyOn(fs, 'renameSync')` 报 `Cannot redefine property`——node:fs 的 ESM 命名空间顶层导出是
   non-configurable getter（vitest 2.1.9）；改用 `vi.mock('node:fs')` + `vi.importActual` 委托包装
   （默认真实委托、可 `mockImplementationOnce` 临时武装）实现 SessionRegistry 集成测试。`fs.promises.rename`
   是普通对象属性，`vi.spyOn(fs.promises, 'rename')` 可直接拦截（Session 集成测试用之）。
2. 任务卡"4 处无重试"的盘点不完整：engine×3 + cli.ts 亦为裸 rename（非本卡范围，已记录为后续卡观察）；
   且"已治理 5 处"中 ProviderStore/CredentialStore 实为无重试——并发验证中 ProviderStore 的 rename EPERM
   真实暴露（setup.test 瞬时 duplicate provider id），据此把两处也迁移（治理升级，失败语义不变）。
3. `noUncheckedIndexedAccess`：退避数组索引 `delays[attempt]` 需 `?? 0` 兜底（TS18048/TS2345）。
4. 环境铁律：全程未遇 EPERM/spawn/管道/超时；长命令（tsc、全量 vitest×2）均 run_in_background，无重试；
   git 操作未失败。文件为 UTF-8、LF 风格（git autocrlf 警告无害）。

### 附注（第 2 次全量与 web 结果，执行器补录）

- 全量 vitest **第 2 次**：`Test Files  110 passed (110)` / `Tests  1186 passed | 1 skipped (1187)`，
  **exit 0**（Start 06:21:01，Duration 195.20s）。
- web：`npx vitest run --root apps/web` → `Test Files  9 passed (9)` / `Tests  82 passed (82)`，**exit 0**。
- 结论：**连续 2 次全量 0 failed + web 82 全绿 + tsc -b exit 0**——本卡目标（rename EPERM flaky 消除）达成。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：