# EVALUATION-REPORT-04 — Round 3 静态复核（崩溃面封口 / 分类精度 / 来源收窄）

> 独立 Evaluator（全新上下文，对抗立场）。**静态审查，未复跑命令**（未跑 tsc/vitest/git；命令证据采信指挥侧）。
> 判定对象：`IMPLEMENTATION-BRIEF-03.md` 验收标准 1–5。范围仅限下列 5 点。

## 1. 崩溃面契约测试的判别力 —— 通过（1 处注记）
- 真断言三件套齐备：① `cli.crashSurface.test.ts:60` `rejects.toThrow(/settings\.json/)`；`:68` `kind==='config-corrupted'`；`:69-70` 含路径 + `/vessel setup/`；`:72` `not.toMatch(/\n\s+at\s/)`。② `:84 / :92-96`（providers 同理，多断 `toContain(providerDir)`）。③ `:102` 干净对照 `resolves.toBe(0)`。
- 契约成立链静态自洽：`cmdSettingsList`（`guideCommands.ts:93`）→ `renderSettingsList` → `SettingsStore.load` 损坏即抛（`settings.ts:113`，文案含全路径）→ 不捕获，`main`（`cli.ts:1490`）reject ✅；providers 侧由 `ProviderStore.ts:556` 抛出同形文案 ✅。
- 判别力：删 `startupError.ts` 的 `config-corrupted` 分支 → `:68/:92` 的 kind 断言（值变 `unknown`）必红 ✅。
- 无"永不触发"的断言分支：`if (!rendered) expect.unreachable(...)`（`:74/:98`）只在第二次 `main()` 意外 resolve 时触发，是防御性守卫而非空转分支；catch 体内断言必然执行。
- 注记（P3，非不通过）：③ 无法捕获"缺文件被误判为损坏"——干净 root 下根本不产生异常，分类器再宽也不会让 `:102` 变红；该漂移的真实哨兵是 `startupError.test.ts:154-166`。故 ③ 只封"缺文件不得变成启动失败"，未封"缺文件不得被判为损坏"（需求只要求前者）。
- 注记（P3）：①/② 的"含路径"断言同时能被 `原始错误：` 行满足，不能单独证明 `extractPath` 提取成功（需求措辞为"渲染含路径"，仍判满足）。

## 2. startupError 判定顺序与"json 路径"反例 —— 通过（1 处 P3 反向风险）
- 顺序正确：`ENOENT` 分支 `startupError.ts:117-128` **先于** JSON 签名判定 `:147-153`；权限 `:131`。故 `ENOENT ... 'C:\tmp\json\x'` **无条件**为 `file-missing`（与正则内容无关，由顺序保证）✅；`startupError.test.ts:154-166` 锁死。
- 正则已去掉裸 `/JSON/i`（`:31-32`），且 `:147` 先剥离 `.json` 后缀再探针；真实签名仍命中（`:168-175` SyntaxError、`provider.ts` 包装文案 `invalid JSON`）。
- 反向误报（P3，可接受但不为零）：`corrupted` / `invalid JSON` 是裸关键词，剥 `.json` 后仍在；任何非 ENOENT/EPERM 的启动期异常只要文案含这两个词（如无关子系统的 "index corrupted"）即被判 `config-corrupted` 并提示 `vessel setup`（`:153-164`）。触发面窄（仅启动路径 + 关键词），未反驳验收。最小收敛方向：要求关键词与 `file/config/settings/providers/current` 或 `.json` 路径同现。

## 3. 来源收窄与双向漂移守卫 —— 通过
- `provider.ts:39` `source?: MessageSource | 'environment'` ✅；`MessageSource` 由 `events.ts:30-31` 的 `as const` 数组派生，联合与运行时数组同源。
- 漂移 A（联合/数组新增值未登记）：`messageSources.test.ts:15-19` `missing` 必含新值 → 红 ✅。
- 漂移 B（集合私自扩容）：`:30-35` 全等断言 + `:36-39` `extras===['environment']` 双保险 → 红 ✅（即便塞入 `user`/`steer`，全等断言仍红）。
- `MockProvider.test.ts` 适配仅类型化（`:3` 引入 `MessageSource`、`:90` `readonly MessageSource[]`），消息构造/正则/断言未变；运行面 `MockProvider.ts:56` 只做 `has()` 查询，收窄不影响行为 ✅。

## 4. 越界与消费点 —— 通过（附限制）
- `INJECTED_MESSAGE_SOURCES` 全仓 grep：定义 `provider.ts:54`、`MockProvider.ts:2`（import）、`:56`（唯一运行时使用）、`messageSources.test.ts`，其余命中均为 `tasks/`、`docs/` 文本。**运行时消费点仍只有 MockProvider** ✅。
- 越界：**无法用 git diff 核验**（本会话禁跑命令）。静态抽查未发现其他文件引用新行为；此项受"静态审查"限制，以指挥侧 diff 为准。

## 5. 文档一致性 —— 部分不通过（P3 残留，不否决本轮）
- `startupError.ts:106-110`（缺文件/权限 → JSON → unknown）与实现 `:117/:131/:147/:167` 一致 ✅；`startupError.test.ts:4-13` 描述与实现一致 ✅。
- **P3 残留**：`provider.ts:25-38` 的 `source` JSDoc 仍把 `steer` 列为"注入来源"，与收窄后类型 + `:51-52`（`steer` 有意排除、属实时操作者输入）矛盾；且只枚举 environment/instruction/memory/compacted-summary/steer，漏 `plan/handoff/inject`。最小修复：把 `steer` 从"注入"描述移出并指向 `INJECTED_MESSAGE_SOURCES`。

## 结论：**ACCEPT**
五点中 1/2/3/4 通过，5 为文档残留（P3）。两处 P3 残留（JSDoc 过期、反向误报关键词过宽）+ 两处注记（对照用例不封分类漂移、路径断言偏弱）均不构成返工门槛。
**最小修复方向（可并入下一轮小卡）**：① 更新 `provider.ts:25-38` JSDoc；② 收缩 `CONFIG_CORRUPTED_RE` 的 `corrupted` 分支为与文件/路径同现。
**未复跑**：`tsc -b` / 全量 vitest 采信指挥侧证据（117 文件、1255 passed + 1 skipped、exit 0）。
