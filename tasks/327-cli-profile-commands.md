# T327 — CLI：`vessel provider profile list|save|use|delete`

- Status: 已完成（2026-10-26；Sol medium 执行）
- 依赖：T325（ProviderStore 的 profile 方法）

> 让 profile 在 CLI 可用，与 Web/API 共用同一份 store 方法，不另写一套解析。

## 1. 命令面（写死）

```
vessel provider profile list [--json]
vessel provider profile save <name> --provider <id> [--model <m>] [--base-url <u>] [--label <text>]
vessel provider profile use <name> [--json]
vessel provider profile delete <name>
```

- `list`：人读一行一个（`<name>  provider=<id>  model=<m|->  baseUrl=<u|->`），`--json` 输出
  `{ profiles: [...] }`；无 profile 时人读打印 `无 profile。` 且 exit 0。
- `save`：必填 `--provider`；`--model/--base-url/--label` 可选；成功后打印写入的 name；
  校验失败（name 非法 / provider 不存在）→ exit 2 + 一行可操作错误。
- `use`：调用 `store.useProfile(name)`，人读打印 `已启用 profile <name>（provider=<id>）`；
  `--json` 输出 `{ provider }`（与 `/api/providers/:id` 的 DTO 同形不加新字段）；未知 name → exit 2。
- `delete`：不存在也 exit 0（幂等），打印是否删除。
- 所有输出不得出现 apiKey/secretRef。

## 2. 不许做

- 不在 CLI 里重新实现 profile 读写（必须调 store 方法）；不复制一份校验逻辑。
- 不改 `provider switch` 的既有语义；不动 `packages/core`；不 commit。

## 3. 允许修改

```
apps/cli/src/providers/profileCommands.ts        (新增)
apps/cli/src/providers/profileCommands.test.ts   (新增)
apps/cli/src/cli.ts                              (接 `provider profile` 子命令)
apps/cli/src/cli.test.ts                         (最小命令层用例)
```

## 4. 验收

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/profileCommands.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

测试用临时 `VESSEL_PROVIDER_ROOT`（或 store 注入），不碰真实 `~/.vessel`。

## Result

list/save/use/delete/rename 全部实现；`delete --json` 回执对齐 HTTP `{ok:true}`；cli.test 136 通过。
