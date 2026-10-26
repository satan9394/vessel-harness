# T324 — 从 cc-switch 导出文件导入供应商（只读、默认 dry-run）

- Status: 已完成（2026-10-26；PDW 任务 `20261026163022-458501`，implement=codex、review=opencode，`accepted_local`）
- PDW task: none（契约 `.pdw/contracts/324-ccswitch-import.json`）

> 依据：`docs/MAGPIE-ABSORPTION.md` §3 P2-2。
> **硬边界**：**不读 `~/.cc-switch/cc-switch.db`**（那是 cc-switch 的用户数据，
> `docs/ideas/CC-SWITCH-MODULE-STUDY.md` 明确从未读取）。导入只接受用户自己导出的 JSON 文件。

## 1. 需求（写死）

1. 新命令：`vessel provider import --from <file.json> [--dry-run] [--yes] [--prefix <p>]`。
   - **默认 dry-run**：只打印将新增/跳过哪些供应商，不写盘。
   - `--yes` 才真正写入 `~/.vessel/providers.json`；写前按既有 store 的原子写与备份路径。
2. 容忍两种输入形状：
   - `{ "providers": [ ... ] }` 或直接 `[ ... ]`；
   - 每项字段别名：`id`/`name`、`protocol`/`app_type`、`baseUrl`/`base_url`、
     `settingsConfig.base_url`（cc-switch 导出常见嵌套）、`model`/`models[0]`、`apiKey`/`key`。
   - 认识不了的字段忽略；`protocol` 只接受 `@vessel/llm` 的既有 provider 名
     （`openai-compatible` / `anthropic` / `opencode-go`），其余项计入 `unsupported` 并跳过。
3. **凭据**：导出里若带明文 key，走既有 `CredentialStore` + `secretRef` 落库（`credential:vessel/<id>`），
   **绝不打印、绝不写进 providers.json 的 apiKey 字段**；没有 key 的项照常建配置并在结果里标
   `needsKey: true`。
4. **冲突策略**：目标 id 已存在 → 默认跳过（`skippedExisting`），不覆盖用户现有配置；
   `--prefix <p>` 时新 id 为 `<p><原 id>`，用于并存导入。
5. 输出（人读 + `--json`）：`{ added: [...], skippedExisting: [...], unsupported: [...], needsKey: [...] }`，
   退出码：有新增或全部跳过都算 0；文件不存在/JSON 非法/非对象 → 2 并给一句可操作错误。
6. 不写回 cc-switch 任何文件；不读它的数据库；不联网。

## 2. 不许做

- 不直读 `~/.cc-switch/**`（除用户显式 `--from` 指向的文件）。
- 不覆盖已存在的 provider（含同名不同 id 的猜测式合并）。
- 不在日志/stdout/stderr/测试快照里出现 key 明文（测试用假 key 并断言不出现）。
- 不改 ProviderStore 的写盘结构（沿用既有 `add()`/`save()` 路径）、不动 `packages/core`、不 commit。

## 3. 允许修改

```
apps/cli/src/providers/ccSwitchImport.ts           (新增：解析 + 映射 + 计划)
apps/cli/src/providers/ccSwitchImport.test.ts      (新增)
apps/cli/src/cli.ts                                (接 `provider import` 子命令)
apps/cli/src/cli.test.ts                           (命令层用例，可只加最小几条)
```

## 4. 验收（PDW checks 会真跑）

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/ccSwitchImport.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/cli.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

测试须覆盖：两种输入形状、别名映射、unsupported 跳过、已存在跳过、`--prefix` 并存、
dry-run 不写盘、`--yes` 落盘且 key 进 CredentialStore（用内存假后端）、输出里无 key 明文。

## 5. 回报

```
命令：<子命令与参数>
映射表：<字段别名 → ProviderConfig 字段>
凭据：<落库路径 + 明文是否可能外泄>
冲突：<默认跳过 / prefix>
测试：<新增用例数与覆盖点>
检查：<四条命令退出码>
未做：<如实写>
```

## Result

已完成（2026-10-26，PDW 任务 `20261026163022-458501`，implement=codex、review=opencode，`accepted_local`）。

- **命令**：`vessel provider import --from <file> [--dry-run] [--yes] [--prefix p] [--json]`。
  默认预览；`--dry-run` 优先于 `--yes`；文件读不到 / JSON 非法 / 形状不对 → exit 2 且给可操作文案；
  `--from` 与既有的位置参数导入（Vessel 自家导出、`--on-conflict`）互斥，混用直接报用法。
- **解析**：接受 `{providers:[...]}` 与数组两种形状；别名 `id|name`、`protocol|app_type`、
  `baseUrl|base_url|settingsConfig.base_url`、`model|models[0]`、`apiKey|key`；
  `protocol` 只接受既有 provider 名且不接受 `mock`，其余计入 `unsupported`（1 起行号）。
- **凭据**：key 只经 `store.save()` 走既有 task 034 迁移路径落 `CredentialStore`（`secretRef`），
  `providers.json` 不落明文；输出前对 `added/skippedExisting/needsKey` 再做一次 key 替换（`[redacted]`）；
  无 key 的项进 `needsKey`。
- **冲突**：已存在 id（含 `mock`）默认 `skippedExisting` 不覆盖；`--prefix` 时新 id 为 `前缀+原 id`。
- **不改 cc-switch**：只读 `--from` 指向的文件，不碰 `~/.cc-switch`。
- 检查：PDW 四条 checks 全绿（导入单测 12、`cli.test.ts` 121、`tsc -b`、`tsc --noEmit`）；
  协调者另跑全量门禁（数字见提交与 HANDOFF）。
- **留给文档卡**：`docs/PROVIDER-MANAGEMENT.md` 目前仍只写旧的 positional 导入，新 `--from` 尚未记录
  （review 角色也指出了这点；本卡 scope 不含 docs，交给 T326）。

### 已知风险（review 提出，协调者确认保留）

- cc-switch 导出里 `opencode-go` 形态与 Vessel 的 `opencode-go` 专用 provider 不一定同名同义，
  导入后可能需要手工确认协议；当前策略是按 `protocol` 字段原样接受，不做猜测式转换。

