# T288 — Benchmark fixture 读边界防泄漏（HARNESS² P0-2）

- Status: 已完成（2026-10-25；PDW 任务 `accepted_local`；未提交、未推送）
- PDW task: 20261025091835-8ee8aa
- Mode: standard（benchmark 契约 + 共用复制路径，纯增量）
- Source: `docs/HARNESS2-ABSORPTION-ASSESSMENT.md` §3 P0-2；用户 2026-10-25 选定该项开工
- Risk: medium（动了所有 scenario 共用的 fixture 复制路径）

## Goal

让"被测评 harness 提前看到评测判据"从静默变成机器可见：runner 把 fixture 复制进 workspace 时按规则过滤掉判据文件，复制后复查；场景未声明却命中硬红线时立即报错并列出路径，不进入被测执行。

## Not Doing

- 不做英文词表正文扫描（`benchmark`/`evaluation`/`grader`/`rubric`/`score` 在 `docs/`、`tasks/` 会大面积误伤，评估报告已划红线）。
- 不把 `tests/**` 一刀切当泄露：B002 的 `tests/*.test.js` 就是任务目标，必须继续复制进 workspace。
- 不改 `hidden` 注入语义（B003 是 run 后注入，已有正确方向）。
- 不改 `adapters/*.ts` 与 `contracts/vessel.ts` 里各自的 `copyDir`（那是外部 CLI 的工作目录复制，不是 fixture 复制）。
- 不新增/修改场景判据文本，不跑 `--live`。
- 不 commit / 不 push / 不删除任何文件。

## 设计（协调者已定，实现者按此实现，不自选方案）

1. `types.ts`：`ScenarioManifest` 新增可选 `leak_globs?: string[]`。
2. `manifest.ts`：`KNOWN_KEYS` 加 `leak_globs`；加载时校验必须是字符串数组（非数组或含非字符串元素 → 抛 manifest 错误，fail loud，与现有未知键风格一致）。
3. `runner.ts`：
   - 内置硬红线常量 `BUILTIN_LEAK_GLOBS = ['RUBRICS.json', 'RUBRIC.json']`，大小写不敏感、任意层级生效。**只放这两个明确判据文件名**，不得扩展成词表。
   - 新增导出函数 `matchLeakGlob(relPath, pattern)`：相对路径、正斜杠归一化、支持 `*`（不跨目录）与 `**`（跨目录）。模式以 `/` 开头视为相对 fixture 根锚定。
   - `copyDir(src, dest, isExcluded?)` 增加可选过滤谓词；**不传时必须与现状逐字节一致**（普通文件/目录递归、静默跳过符号链接的既有语义不变）。
   - `runScenario` 里：`declared = manifest.leak_globs ?? []` → `copyDir(fixtureDir, workspace, rel => matchesAny(declared, rel))` → 复制后调 `assertNoLeakPaths(workspace, { declared, builtin })`：遍历 workspace，命中内置红线且未被 declared 覆盖 → 抛 `FixtureLeakError`；命中 declared → 同样报错（说明过滤未生效，例如从别处复制进来）。
   - `FixtureLeakError` 消息必须含：命中的 workspace 相对路径、命中的模式、来源（builtin / declared），以及两条出路（把判据文件移出 fixture 目录，或把模式写进该场景 manifest 的 `leak_globs`）。
   - 检查必须发生在 `prepareFixtureSetup` 之后、`snapshotBefore` 之前，且在 `driveScenario` 之前。
4. 错误分类：与 `FixtureSetupError` 同一捕获路径（gate 判 `pending-environment`），不得被吞成普通 fail。

## Acceptance

- AC1：manifest 接受 `leak_globs: string[]`；类型错误与未知键仍 fail loud；`docs/BENCHMARK-SPEC.md` §3.0 表 A 同步（键数 11→12，新增一行写清"相对 fixture 根的 glob，用于把判据文件排除在 workspace 之外"，并注明内置红线 `RUBRICS.json`/`RUBRIC.json`）。
- AC2：声明了 `leak_globs` 的场景，命中文件不出现在 workspace；未命中的文件与目录结构原样保留（含空目录）。
- AC3：未声明时命中内置红线（任意层级、大小写不敏感）→ 复制后立刻抛 `FixtureLeakError`，消息含相对路径与两条出路；不进入 `driveScenario`。
- AC4：现有 25 个 fixture 零影响——B002 的 `tests/**` 仍进 workspace；`runner.test.ts`、`spec-manifest-parity.test.ts`、离线 `bench:conformance` 保持通过。
- AC5：新增 `benchmarks/runners/src/fixture-leak-guard.test.ts`，覆盖：内置命中抛错（含 `sub/RUBRICS.json` 与 `rubrics.json` 大小写）、声明后过滤、`*` 不跨目录而 `**` 跨目录、未命中路径逐字节一致、过滤后空目录保留。测试用 `mkdtemp` 自建 fixture（`os.tmpdir()` 下，允许测试清理自己的临时目录）。
- AC6：`node node_modules/vitest/vitest.mjs run benchmarks/runners/src/fixture-leak-guard.test.ts benchmarks/runners/src/spec-manifest-parity.test.ts benchmarks/runners/src/runner.test.ts` 通过；`node node_modules/typescript/bin/tsc -b tsconfig.json` exit 0；`node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` exit 0。

## Blast Radius

`benchmarks/runners/src/runner.ts`、`manifest.ts`、`types.ts`、新增 `fixture-leak-guard.test.ts`、`docs/BENCHMARK-SPEC.md`。回滚：`git checkout -- benchmarks/runners/src/runner.ts benchmarks/runners/src/manifest.ts benchmarks/runners/src/types.ts docs/BENCHMARK-SPEC.md` 并回收新增测试文件。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、PDW 任务的 check 日志与 review 结论；协调者另跑全量 `npm run test:all`（两个 root）与离线 conformance。

## Result

已完成。机制按卡实现：`manifest.leak_globs?: string[]`（顶层键，`KNOWN_KEYS` 第 12 个；非字符串数组即抛错）→ `copyDir(fixtureDir, workspace, isExcluded)` 复制期过滤（不传谓词时旧语义逐字节不变）→ `prepareFixtureSetup` 之后、`snapshotBefore` 与 `driveScenario` 之前 `assertNoLeakPaths` 复查 → 命中内置红线 `RUBRICS.json` / `RUBRIC.json`（任意层级、大小写不敏感）而未被声明覆盖时抛 `FixtureLeakError`。`FixtureLeakError extends FixtureSetupError`，因此仍走 release gate 的 `pending-environment` 分类。

`matchLeakGlob` 是独立实现：`*` 不跨目录、`**` 跨目录、`**/` 可匹配零层、开头 `/` 锚定 fixture 根、大小写不敏感。没有复用 `asserts.ts` 的 `globToRegExp`（它大小写敏感且 `**/` 不匹配零层），也没有引入 `@vessel/tools`（bench-runners 不依赖它）。

PDW 任务 `20261025091835-8ee8aa`：`accepted_local`，5 次调用、0 修复，artifact `0b720909a1280146a07d95bf859a01a300ed18d7b687c5fae90ff629aa7fec8c`。四条 check 全 exit 0；review 对 AC1–AC6 逐条 pass。首轮 scan 曾因模型把正则转义 `\.` 写进 JSON 而解析失败，`resume` 后正常。

门禁（在最后一次源码/文档编辑之后，协调者亲自执行）：`tsc -b` exit 0、`typecheck:tests` exit 0、`npm run test:all` 根 **306 文件 / 3223 passed + 6 skipped**、web **58 文件 / 494 passed**、离线 `bench:conformance --all` **25/25** exit 0。

协调者另补了两处对账（不在 AC 内）：`docs/BENCHMARK-SPEC.md` §2.1 原写「fixture 全部内容原样复制」，加过滤后会变假话，已改成「默认全部复制，命中 `leak_globs` 的判据文件被排除」并注明现存 25 个 fixture 无判据文件；卡与契约里「26 个 fixture」的数字更正为 25。

遗留（本次不做，均已有文字记录，需另开卡）：
- 跨 harness 车道未覆盖：`adapters/{claude,codex,dsh,opencode,pi}.ts` 与 `contracts/vessel.ts` 各有一份不过滤的私有 `copyDir`，`BENCHMARK-SPEC` §2.4 已写明本守卫只覆盖 `runScenario`。
- 泄漏被 gate 归为 `pending-environment`（不是 fail）：CI 上判据泄漏不会变红，若要硬失败得改 `release-gates/gates.ts`。
- 场景若把 `task_file` 自己写进 `leak_globs`，会在读取任务文本处抛裸 `ENOENT`；表 A 只做了口头提醒。
- `assertNoLeakPaths` 不跟随 junction/symlink（S003 依赖此行为），通过 fixture 外部链接暴露的判据不会命中；spec 未写明该边界。

未验证：macOS 上的行为（本机 Windows）；真实模型车道与 `--live` 不涉及本卡。

