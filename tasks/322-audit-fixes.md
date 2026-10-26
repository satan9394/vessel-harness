# T322 — 补审发现的修复：daemon 漏注入用量、MAGPIE 文档失真、预设预检脚

- Status: 已完成（2026-10-26；PDW 任务 `20261026160547-bc5263`，implement=codex、review=opencode，`accepted_local`）
- PDW task: none（契约 `.pdw/contracts/322-audit-fixes.json`）

> 来源：PDW 补审任务 `20261026155729-1692d6`（audit 模式）的 scan 输出——该次运行因
> `ECONNRESET` 被判 blocked，但结论 JSON 完整，协调者逐条复核后确认下列三条成立。
> 其余两条（审计契约 notes 范围、卡 319 指向不存在的文件）分别由协调者更正契约与卡，不在本卡。

## 1. 要做三件事（写死）

### 1.1 `vessel daemon` 漏注入 `usageByProvider`（medium，功能缺口）

- 事实：`apps/cli/src/daemon/daemonCommands.ts:83-87` 构造本地服务时只传了
  `observeWorkspace / port / authToken / mesh / notify / staticDir / daemon`；
  `apps/cli/src/cli.ts:2760` 的 `serve` 则注入了 `usageByProvider: () => createUsageStore().byProvider()`。
  结果：走 `vessel daemon` 起 Web 时，Provider Hub 的用量行只能显示 `—`，即使 usage 记录存在。
- 做法：由 CLI 侧注入，**不要在 daemon 里再建一个 UsageStore 工厂**（会出现第二套价目/root 解析）。
  1. `daemonCommands(positionals, flags, entry, hooks?)` 增第 4 个可选参数
     `{ usageByProvider?: () => Array<...> }`，只在传了的时候把它放进 `daemonRuntime.server({...})`。
  2. `cli.ts` 调 `daemonCommands(...)` 时传 `{ usageByProvider: () => createUsageStore().byProvider() }`。
  3. 子进程同样是这条 CLI 入口，不需要额外机制；**不要**改 daemon 的 detached 启动协议。
- 测试（`apps/cli/src/daemon/daemonCommands.test.ts`）：沿用现有「mock `daemonRuntime.server`
  捕获 options」的写法，断言 (a) 传了 hook 时 `options.usageByProvider` 与传入函数**同一引用**；
  (b) 没传时该键不存在（不改变既有调用行为的默认路径）。
  **不要**在测试里真的调用这个 hook（会构造默认 UsageStore 去读真实 `~/.vessel`）。

### 1.2 `docs/MAGPIE-ABSORPTION.md` 三处失真（low，但要改）

1. `§3 P0-1` 写的落点是 `apps/cli/src/cli.ts` 的 `usage --by-provider`——**这个旗标不存在**。
   实际形态是 `vessel usage` 默认就有「按供应商:」段，`--json` 里是 `byProvider`。
   改成真实形态，不要保留一个用户敲不出来的命令。
2. `§3 P0-1` 把 `GET /api/providers/usage` 的落点写成 `routes/providerRoutes.ts`，
   实际在 `apps/local-server/src/server.ts`（约 509-520 行）。改成真实路径。
3. `§5` 仍把 `input_token_semantics` 与「端点失败转移」列为「下一批」——两者已落地
   （卡 320 / 卡 321，提交 `5e46151` / `1f36890`）。把这一节改成「已吸收」并各给一行落点，
   同时把仍未做的（profile 快照、值守卫价目、cc-switch 导入）留在「未做」。

### 1.3 预设预检缺一个入口（low）

`scripts/sync-web-presets.mjs --check` 目前只能手工跑；`package.json` 里加一条
`"check:web-presets": "node scripts/sync-web-presets.mjs --check"`，不改动既有 `test`/`test:all`。

## 2. 不许做

- 不在 daemon 里复制 UsageStore 工厂、不改价目/root 解析、不改 `/api/providers/usage` 的返回形状。
- 不把 `check:web-presets` 塞进 `test`/`test:all` 或 CI（本仓已停用远程 CI，加了也没人跑；
  只提供显式入口）。
- 不改卡文件（`tasks/*.md` 由协调者维护）、不动 `packages/core`、不 commit。

## 3. 允许修改

```
apps/cli/src/daemon/daemonCommands.ts
apps/cli/src/daemon/daemonCommands.test.ts
apps/cli/src/cli.ts
docs/MAGPIE-ABSORPTION.md
package.json
```

## 4. 验收（PDW checks 会真跑）

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/daemon
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node scripts/sync-web-presets.mjs --check
```

## 5. 回报

```
daemon：<注入点 + hook 形状 + 两条测试断言>
文档：<三处改成什么，逐条列>
脚本：<新 npm script 名>
检查：<四条命令退出码>
未做：<如实写>
```

## Result

已完成（2026-10-26，PDW 任务 `20261026160547-bc5263`，implement=codex、review=opencode，`accepted_local`）。

- **daemon**：`daemonCommands(..., hooks)` 新增可选 `usageByProvider`，仅在传入时透传给 `createVesselServer`；
  `cli.ts` 的 daemon 分发处注入 `() => createUsageStore().byProvider()`。daemon 内没有第二套 UsageStore 工厂。
  测试扩为四态（omitted / empty / provided / cli）：provided 断言同一引用、omitted/empty 断言无该键、
  cli 只验证类型，并断言钩子**未被调用**（不读真实 `~/.vessel`）。
- **文档**：`docs/MAGPIE-ABSORPTION.md` 删掉不存在的 `usage --by-provider`（改为默认按供应商段 + `--json byProvider`）、
  `/api/providers/usage` 落点改为 `server.ts`、§5 把 input 口径（T320）与端点失败转移（T321）标为已吸收，
  未做项（profile / 价目守卫 / cc-switch 导入）保留。
- **脚本**：`package.json` 新增 `check:web-presets`，未动 `test` / `test:all`。
- **检查**：PDW 四条 checks 全绿（daemon 测试、`tsc -b`、`tsc --noEmit`、预检脚本）；
  协调者另跑全量：根 322 文件 / 3487（3481 通过 + 6 跳过）、web 58 文件 496。
- **备注**：本卡来源的补审任务（`20261026155729-1692d6`）本身因 `ECONNRESET` 被判 blocked，
  没有拿到 `accepted_local`；结论按「scan 输出 + 协调者逐条复核」采用，出处如实记录在这里。

