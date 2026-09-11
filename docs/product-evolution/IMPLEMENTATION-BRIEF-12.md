# IMPLEMENTATION-BRIEF-12 — TUI `/permission` 与 `/model` 假成功修复（G-13-P1，P1 安全类）

> Round 11 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-13 + G-13 侦察结论（`SCOPING` 系列）。
> **这是安全类正确性问题，不是一致性美化**：`/permission` 文案宣称"权限切换为 X（会话内生效）"，但主循环**从不回写** `permission` 变量 → 用户以为已切到 `read-only`，实际仍是 `workspace-write`。`/model` 同款。

## 目标

让 `/permission` 与 `/model` **真正生效**（作用于后续回合），并顺带把结果落到 `SessionMeta`（重启/`resume` 后仍记得）。

## 用户场景

用户在 TUI 里输入 `/permission read-only`（意图：接下来只读，别改我文件）→ 现状：界面回复"已切换为 read-only（会话内生效）"，但下一次对话里 Write 工具**照旧能写**——**用户被自己以为的安全设置欺骗**。期望：切换后本会话后续回合真的被 Policy 拒写；且 `vessel resume` 回来仍是该权限。

## 当前问题（证据）

- `apps/cli/src/tui/chat.ts`：`SlashResult` 只有 `output?`/`quit?`（约 :199-204）；主循环拿到结果后**只** `io.write(res.output)`（约 :326-331），**从不**回写 `permission`/`model` 局部变量（全文件无重赋值）。
- 文案却断言已切换：`/permission` 分支（约 :456-459）、`/model` 分支（约 :452-455）、`/help` 列表（约 :421）。
- `harness` 是**懒构建且被缓存**（`if (!harness) harness = await buildHarness()`，约 :334），即使改了局部变量，旧 harness 仍持有旧权限 → 必须**丢弃缓存重建**。
- 对照：`SessionMeta.permission` 已在 `buildHarness` 登记（约 :288-296），`resume` 会读它（`cli.ts:1616`）→ **持久化通道已存在**，只差把切换写进去。

## 理想行为

1. `SlashResult` 增加可选 `permission?: PermissionMode` 与 `model?: string`（或等价的"待应用变更"结构）。
2. `/permission <mode>`：校验取值合法（非法 → 明确报错且**不**宣称成功）；合法则返回 `{ output: '已切换…（本会话后续回合生效）', permission }`。
3. `/model <id>`：同上返回 `{ model }`；若该模型不在当前 provider 的可用清单里，给出**明确警告但不阻断**（或按现状允许，需在回复说明取舍）。
4. 主循环：收到 `permission`/`model` 后**真正更新**对应局部变量、**丢弃 harness 缓存**（置 `null`/`undefined`，下次懒建时用新值）、并 `registry.put` 更新该会话的 `SessionMeta`（`model` 变化时同步更新）。
5. 文案诚实化：`/help` 与两条命令的提示语必须与实际行为一致（"本会话后续回合生效"）。
6. `/provider` 与 `/setup` 两个 case 调同一向导（约 :430-440）——保持行为不变，仅合并重复分支（可选、低成本）。

## 涉及模块

`apps/cli/src/tui/chat.ts`（主）；测试 `apps/cli/src/tui/chat.test.ts`。

## 不能破坏什么

- 既有 TUI 行为与全部既有测试（欢迎语、`/help` 既有条目、`/cost`、`/explain`、`?`、`/quit`、Ctrl+C、mock 冒烟、G-09 成本行、G-10 会话登记）。
- `SessionMeta` 结构不变；`resume` 读取路径不变。
- 测试隔离（AGENTS.md §8）：注入临时 `VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT`/`VESSEL_SESSION_ROOT`/`VESSEL_SETTINGS_ROOT`；不碰真实 `~/.vessel`（全局 `vitest.setup.ts` 已有兜底）。
- `tsc -b` 0；全量 `vitest` 全绿。无新依赖。

## 验收标准（**关键：必须有负对照，只断言文案就是假绿**）

1. **AC1（判别性，安全类）**：脚本化驱动 `runChat`——先 `/permission read-only`，再跑一个会触发 Write 的回合 → 断言该 Write 被 **Policy 拒**（DENIED/deny 事件或工具失败），**且文件中确实没有被写入**。
2. **AC1 负对照**：**不加** `/permission read-only` 的同样回合 → 写入**成功**（证明 AC1 的"被拒"来自权限切换，而非测试环境本来就写不了）。
3. **AC2**：`/model <id>` 之后的一次回合，断言 provider **实际收到的 model** 是新值（不是只断言界面文案）；负对照：不加 `/model` 时仍是旧值。
4. **AC3 落盘**：`/permission` 之后 `SessionMeta.permission` 被更新（临时 `VESSEL_SESSION_ROOT`），且**新进程 `vessel resume` 仍是该值**。
5. **AC4 非法取值**：`/permission bogus` → 明确报错、**不**宣称成功、且**不改变**当前权限。
6. 既有 TUI 测试全绿；`tsc -b` 0。

## 错误场景

- `registry.put` 失败（磁盘/并发）→ 只 warn，不阻断会话（权限仍在本会话生效）。
- 切换权限后 harness 重建失败 → 报错并保留旧 harness（不静默降级到"以为切了但没切"）。

## 测试要求

- 小卡串行；执行器不跑命令，由指挥复跑 `tsc` + 全量 vitest + **判别性 E2E**（AC1 的正反两例，必须看到"被拒 vs 通过"的差异）。
- 完成后交独立静态 Evaluator 复核（重点：AC1/AC2 是否真有负对照；是否有任何路径仍"宣称成功但没生效"）。
