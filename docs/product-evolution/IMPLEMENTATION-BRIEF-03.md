# IMPLEMENTATION-BRIEF-03 — 崩溃面契约的自动化封口 + 分类精度 + 来源类型收窄

> Round 3 切片（Orchestrator 产出）。来源：Round 2 的两份独立裁定残留（`EVALUATION-REPORT-03.md` N1/N2/N3/N4、`-RECHECK.md` LOW、Round 1 残留 N5）。
> 本切片 = **一组高度耦合的小问题**：都围绕"启动/配置失败这条路径的可信度"，不做功能扩张。

## 目标

1. **让"用户可见的崩溃面契约"有测试兜底**——现在删掉 `cli.ts` 的 `.catch` 不会有任何测试变红（N1，P2）。
2. **让"配置文件损坏"的分类不再误报**——裸 `/JSON/i` 会把"目录名含 json 的 ENOENT"判成损坏（N2，P3）。
3. **让 source 类型不再裸奔**——`ChatMessage.source` 收窄，使"新注入来源未登记"在编译期或守卫测试期暴露（N5，P3）。

## 当前问题（证据）

- **N1**：`startupError.test.ts` 只测纯函数；**没有任何测试经过 `main()`/入口 catch**。Round 2 实测证明这条路径出过两个致命缺陷（JSDoc 注释截断使整个 CLI 不可运行；正则字符类未转义使清洗失效）——若当时有该测试，至少第一个能在测试期暴露。
- **N2**：`startupError.ts` 的分类顺序里，`config-corrupted` 的特征匹配过宽（含裸 `/JSON/i`）；一条形如 `ENOENT: no such file or directory, open '...\\json\\x'` 的错误会被判成"配置文件损坏"，给出错误指引。
- **N5**：`ChatMessage.source?: string`（裸 string）；`MESSAGE_SOURCES` 守卫只锁住"events 联合 → 集合"一条边，`Builder` 合成的 `'environment'` 与未来新值都无约束。

## 理想行为

1. `main(['settings','list'])` 在 `settings.json` 损坏时 **reject**，且把该错误交给 `describeStartupFailure` 后得到 `kind='config-corrupted'`、message 含**该文件路径**与「vessel setup」、且**不含 stack 行**；`providers.json` 损坏时同样成立（走 `main(['provider','list'])`）。
2. `ENOENT` 类错误**优先**判为 `file-missing`（即使 message 里出现 "json" 字样），除非同时具备真正的 JSON 语法特征（如 `Unexpected token` / `Unexpected end of JSON` / `position \d+`）。
3. `ChatMessage.source` 类型收窄为 `MessageSource | 'environment'`（`MessageSource` 来自 `events.ts`）；漂移守卫测试补一条：断言**允许的额外值只有 `'environment'`**。

## 涉及模块

`apps/cli/src/startupError.ts`（N2）、`apps/cli/src/startupError.test.ts`（N2 用例）、**新** `apps/cli/src/cli.crashSurface.test.ts`（N1）、`packages/shared/src/provider.ts`（N5 类型）、`packages/shared/src/messageSources.test.ts`（N5 守卫）、必要时 `packages/context/src/builder/Builder.ts`（若类型收窄导致 `'environment'` 需标注）。

## 不能破坏什么

- 退出码语义：未知命令 **2**、成功 **0**、入口兜底 **1**（Round 2 刚建立）。
- 既有全量：`tsc -b` 0；`vitest` 116 文件 / **1248 passed + 1 skipped** 全绿。
- 测试隔离（AGENTS.md 约束 8）：`VESSEL_SETTINGS_ROOT`/`VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT` 指向 `mkdtemp` 临时目录，`afterEach` 还原，**不碰真实 `~/.vessel`**；临时目录清理**照抄 `apps/cli/src/cli.test.ts` 既有写法**。
- 不引入子进程（本环境 spawn 易 EPERM）：契约测试必须 **in-process**（直接 `await main(...)`）。

## 验收标准

1. 新增 `apps/cli/src/cli.crashSurface.test.ts`（≥3 例）：坏 `settings.json` → `main(['settings','list'])` reject，经 `describeStartupFailure` 渲染后含路径 + 「vessel setup」+ 无 stack；坏 `providers.json` → 同理；**对照**：临时 root 干净时 `main(['settings','list'])` resolve 为 **0**。
2. **判别力**：手工把 `cli.ts` 的 `.catch` 注释掉，逻辑上不影响该测试（因为它测的是 `main()` reject 后由 `describeStartupFailure` 渲染的契约）；但**把 `startupError.ts` 的 `config-corrupted` 分支删掉，N1 与 N2 的用例必须变红**（请在实现说明里确认这一点）。
3. N2 用例：`ENOENT ... 'C:\\tmp\\json\\x'` → `kind==='file-missing'`（**不得**为 `config-corrupted`）；而 `Unexpected token } in JSON at position 5` + `.json` 路径仍判 `config-corrupted`。
4. N5：`packages/shared/src/provider.ts` 的 `source` 类型为 `MessageSource | 'environment'`；`tsc -b` 0；`messageSources.test.ts` 增加"仅允许 environment 额外"的断言。
5. 全量 `npx vitest run` + `npx tsc -b` 绿；测试文件均在临时 root 下隔离运行。

## 错误场景

- 临时 root 不存在 → 测试自建（`mkdirSync recursive`）。
- 干净 root 下 `provider list` → 不应抛错（走默认/mock），保持现状。

## 测试要求

- 全部写入型微任务（单文件/单点），**执行器不跑命令**；由指挥复跑 `tsc` + 全量 vitest + 崩溃面 E2E（settings/providers 双例 + 干净对照）。
- 之后交**独立静态 Evaluator** 复核（Round 3 验收）。
