# 104 — P2：供应商导入导出 + 备份轮转 + 多端点测速

- 编号：104（合并 CC-SWITCH-MODULE-STUDY 候选卡 095/096）
- 状态：待验收
- 优先级：P2
- 创建日期：2026-09-09
- 关联：101（ProviderStore costMultiplier 已加）；docs/CC-SWITCH-IMPROVEMENTS-PROGRESS.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

1. **095 导入导出 + 备份轮转**：`vessel provider export/import <file>`（**导出默认脱敏**：key 不落明文，写
   secretRef 占位或 `<redacted>`）；`~/.vessel/backups/` 轮转（保留 N 份）。
2. **096 多端点 + 测速**：`ProviderConfig.endpoints[]`（同 provider 多 baseUrl）+ `vessel provider endpoint
   add/remove/test`；测速结果**只作建议**，不自动改默认端点。

## 验收标准（执行器逐条勾选）

### 095 export/import + backups
- [ ] `vessel provider export [--out <file>]`：导出 providers 配置为 JSON；**默认脱敏**（apiKey → secretRef 占位或
      `<redacted>`，绝不写明文 key）；`--with-secrets` 需显式确认（或拒绝，选型记录）
- [ ] `vessel provider import <file>`：导入并合并（同名冲突策略明确：跳过/覆盖/询问，记录）；导入的占位 key
      不产生明文
- [ ] `~/.vessel/backups/` 轮转：每次写配置前备份 + 保留 N 份（可配），原子写
- [ ] 测试 ≥6 例：导出脱敏/导入合并/冲突策略/备份轮转上限/原子写/异常

### 096 endpoints + 测速
- [ ] `ProviderConfig.endpoints?: {url, label?}[]`（缺省时用 baseUrl）；`vessel provider endpoint add/remove/list`
- [ ] `vessel provider endpoint test [--all]`：对端点做最小探测（连通/延迟），输出**建议**但不改默认（除非用户显式
      `--set-default`）
- [ ] 测试 ≥5 例：端点增删/列表/测速结果形状/不自动改默认/异常

### 共同
- [ ] `npx tsc -b tsconfig.json` exit 0；全量 vitest（root 1102+ 无回归）+ web 74
- [ ] 文档同步（PROVIDER-MANAGEMENT：导出脱敏语义、备份轮转、端点与测速）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 095+096。不做 UI；不加新依赖；不读用户本机应用数据；**密钥绝不落明文**（导出脱敏是硬要求）。

## 涉及文件（指针，执行器自行精化）

- `apps/cli/src/providers/ProviderStore.ts`（providers.json SSOT + 备份）
- `apps/cli/src/cli.ts`（provider 命令组）
- `packages/application/src/credential/`（034/069：secretRef 语义，导出用占位）
- 参考报告 §1 供应商模块（cc-switch 的导入导出/备份）

## 方法

- 先读 ProviderStore 现状与 secretRef 约定 → 导出脱敏 → 导入合并 → 备份轮转 → endpoints + 测速 → 测试

## 工作证明（执行器回填：改了什么/导出脱敏证据/备份轮转/端点测速/测试输出，全部写进本文件，勿留对话里）

### 1. 改动文件（4 改 + 6 新增，835 insertions / 8 deletions）

| 文件 | 改动 |
|---|---|
| `apps/cli/src/providers/ProviderStore.ts` | +257：`ProviderEndpoint`/`ProviderConfig.endpoints?`、`effectiveEndpoints/addEndpoint/removeEndpoint`、写前备份轮转 `backupBeforeWrite`、`backupsDir/listBackups/parseBackupKeep`、`backupKeep` 选项 + `VESSEL_PROVIDER_BACKUP_KEEP`、endpoints 校验 |
| `apps/cli/src/providers/providerTransfer.ts`（新） | 导出信封 + 脱敏 `redactProvider` + `buildExport/serializeExport` + `parseImportFile/importProviders`（冲突策略 skip/overwrite、dryRun、明文 key 剥离） |
| `apps/cli/src/providers/endpointProbe.ts`（新） | `probeEndpoint/probeProviderEndpoints/rankProbes/suggestEndpoint/probeUrlFor`（最小探测，可注入 fetch/时钟） |
| `apps/cli/src/cli.ts` | +315：`provider export/import`、`provider endpoint list/add/remove/test`、`--set-default`、`defaultProviderStore({backupKeep})`、`writeTextAtomic`、USAGE、list 显示端点数 |
| `docs/PROVIDER-MANAGEMENT.md` | +56：§2 存储表加 `backups/` 与 `endpoints`；新增 §3.1 导入导出与备份轮转、§3.2 多端点与测速 |
| 测试（新 4 文件 + cli.test.ts 扩充） | `providerTransfer.test.ts`(12)、`providerBackup.test.ts`(8)、`providerEndpoints.test.ts`(7)、`endpointProbe.test.ts`(9)、`cli.test.ts` +8 例 = **新增 44 例** |

无新依赖、无跨层依赖（全部落在 apps/cli + docs）、无永久删除（轮转用改名/覆盖，见 §3）。

### 2. 导出脱敏证据（真跑 CLI，`VESSEL_PROVIDER_ROOT` 指向临时目录，假 key `sk-fake-DEMO-0001`）

`providers.json`（盘上，key 已进 CredentialStore，只留引用）：
```json
[{ "id": "ds", "name": "ds", "protocol": "openai-compatible",
   "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat",
   "secretRef": "credential:vessel/ds",
   "endpoints": [ { "url": "https://api.deepseek.com/v1" },
                  { "url": "https://backup.example/v1", "label": "backup" } ] },
 { "id": "ant", "name": "ant", "protocol": "anthropic",
   "baseUrl": "https://api.anthropic.com", "model": "claude-sonnet-4-5" }]
```

`vessel provider export`（stdout，原文）：
```json
{
  "kind": "vessel-provider-export",
  "version": 1,
  "exportedAt": "2026-09-09T16:53:05.273Z",
  "redacted": true,
  "keysRedacted": 1,
  "current": "mock",
  "count": 2,
  "providers": [
    { "id": "ds", "name": "ds", "protocol": "openai-compatible",
      "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat",
      "secretRef": "credential:vessel/ds",
      "endpoints": [ { "url": "https://api.deepseek.com/v1" },
                     { "url": "https://backup.example/v1", "label": "backup" } ] },
    { "id": "ant", "name": "ant", "protocol": "anthropic",
      "baseUrl": "https://api.anthropic.com", "model": "claude-sonnet-4-5" }
  ]
}
```
- `grep sk-fake-DEMO-0001` 导出输出 → **无匹配**（脚本判定 "no plaintext key in export output (OK)"）；导出文本不含 `"apiKey"` 字段（`buildExport()` 落盘前自检，命中即抛错）。
- `vessel provider export --with-secrets` → **exit 2 直接拒绝**（选型：本项目不存在明文导出路径），不产生任何文件。
- `vessel provider import <export>` 到全新 root：`已导入：新增 2`，导入后 `providers.json` 只含 `secretRef` 引用、无明文 key；密钥需 `vessel provider set <id> --api-key <key>` 本地补录。
- 冲突策略（选型记录）：默认 `skip`（同名保留本地）；`--on-conflict overwrite` 覆盖文件字段但**保留本地 secretRef**；非交互 CLI 不「询问」；全部同名跳过时不写盘。

### 3. 备份轮转策略（`~/.vessel/backups/`）

- 写 `providers.json` / `current.json` **之前**，旧文件字节原样复制为 `backups/<kind>.<ISO 时间戳>.json`（可直接拷回回滚）；随后仍走原子写（`.tmp` → rename）。
- 保留份数：默认 5，可配 `--keep <n>`（import）或 `VESSEL_PROVIDER_BACKUP_KEEP`（0 = 关闭）；每类文件各自计数，非法值 fail loud。
- **轮转零删除**（删除铁律）：达到上限时把最旧一份**改名**成新时间戳再覆盖，文件数恒 ≤ N；改名失败（Windows 偶发 EPERM）退化为原地覆盖最旧文件。
- 真跑证据：7 次写盘 → `backups/` 恒 5 个文件；`VESSEL_PROVIDER_BACKUP_KEEP=2` → 恒 2 个文件（见下方命令输出）。

### 4. 端点测速结果形状（真跑，`vessel provider endpoint test ds --timeout 400`）

```
探测 provider "ds" 的 2 个端点（GET {base}/models，不带凭据，超时 400ms）:
  ~ https://api.deepseek.com/v1  HTTP 401  247ms
  ✖ https://backup.example/v1 [backup]  timeout after 400ms  413ms
  建议：https://api.deepseek.com/v1（已是默认端点，247ms）——仅建议，未改动默认端点。
```
- 结果形状：`{url, label?, probeUrl, reachable, ok, status?, latencyMs, error?}`；排序 = 2xx/3xx → 可达未鉴权 → 不可达，同档延迟升序。
- 探测**不带任何凭据**（单测断言 headers 只有 `accept`），401/403 算可达。
- **只给建议不改默认**：`baseUrl` 未被自动修改（单测断言 providers.json 原样）；只有显式 `--set-default`（且单个 id）才改 baseUrl 并写前备份；全部不可达 → exit 1、配置不变。

### 5. 测试与命令输出

```
npx tsc -b tsconfig.json                     → EXIT=0（无输出）
新增 4 个测试文件：                            36 passed (4 files)
  providerTransfer.test.ts (12) / providerBackup.test.ts (8)
  providerEndpoints.test.ts (7) / endpointProbe.test.ts (9)
apps/cli/src/cli.test.ts                     51 passed（原 43 + 新增 8）
apps/web（apps/web 下 npx vitest run）        74 passed (8 files)
全量 root（npx vitest run，默认超时）          1147 passed | 1 skipped | 1 failed（process-tree 时序 flaky，见 §6）
全量 root（--testTimeout=120000，隔离 root）   1147 passed | 1 skipped | 1 failed（唯一失败是断言「默认 root=~/.vessel」的用例，被隔离 env 变量破坏，属预期）
全量 root（--testTimeout=180000，收尾复跑）    1148 passed | 1 skipped | 108 files passed（EXIT=0，见 §6.1 说明）
process-tree 单跑（--testTimeout=120000）     11 passed（53s，含目标用例 39.7s）
chat.test 单跑（隔离 VESSEL_PROVIDER_ROOT）   16 passed；不隔离则 1 failed（见 §6.2）
备份轮转真跑：7 次写 → count=5；KEEP=2 → count=2
```
新增测试覆盖：导出脱敏/占位 secretRef/自带 secretRef 保留/导出不含 mock/export→import 端到端/冲突 skip/overwrite 保留密钥引用/明文 key 剥离/非法文件 fail loud/dry-run/裸数组白名单；备份：首次不备份、上限轮转、零删除、keep=0、current.json 同类备份、原子写无残留、parseBackupKeep 校验；端点：回退语义/增删/重复与非法校验/落盘往返；探测：200/401/网络错/超时/不携带凭据/URL 归一/排序/无建议/候选池语义；CLI：export --out 脱敏、--with-secrets 拒绝、stdout 导出、import 合并与 dry-run、endpoint 增删列表、test 建议不改默认、--set-default 才改、全不可达 exit 1、用法错误 exit 2。

### 6. 踩坑与环境备注

1. **`packages/runtime/.../process-tree.test.ts` 时序 flaky（基线已知）**：并行全量跑时 30s 超时（目标用例单跑 39.7s），`--testTimeout=120000` 单跑 11/11 绿；收尾复跑（`--testTimeout=180000`）全量 1148 passed + 1 skipped、EXIT=0。与 104 无关（未触碰 runtime/sandbox）。
2. **`apps/cli/src/tui/chat.test.ts` 未隔离 provider root（既有缺陷，非 104 引入）**：该文件的 `runChat` 用例不传 store → 读**真实** `~/.vessel/current.json`；本机经卡片 105 真跑后 `current.json = opencode-go`，于是 TUI 用例去调真供应商并报 401（`Missing API key`）。隔离 `VESSEL_PROVIDER_ROOT` 后 16/16 绿；全量并行时它常因 `cli.test.ts` 对同一 env 变量的临时设置而“意外被隔离”而通过——是竞态，不是稳定绿。建议另开小卡修（给 chat.test 加 root 隔离），本卡不动（范围边界）。
3. `Remove-Item` 被环境守卫拦截（删除铁律）——脚本内不做任何删除，未受影响。
4. 未读任何用户本机应用数据；所有真跑均用 `VESSEL_PROVIDER_ROOT` 指向 `%TEMP%` 隔离目录；测试假 key 一律 `sk-fake-*`。
5. 提交只含 104 的 4 改 6 新 + 本卡；`benchmarks/reports/V1.1-F-openmodel-probe-105-*.json`（指挥侧 105 产物）未纳入。

### 7. 验收标准逐条勾选

**095 export/import + backups**
- [x] `vessel provider export [--out <file>]`：默认脱敏（apiKey → `secretRef: credential:vessel/<id>` 占位，绝不写明文）；`--with-secrets` 直接拒绝（exit 2，选型记录见 §2）
- [x] `vessel provider import <file>`：合并导入，同名冲突默认 `skip`、`--on-conflict overwrite` 可选（记录见 §2）；导入的占位 key 不产生明文（文件内明文 apiKey 亦被剥离并报告）
- [x] `~/.vessel/backups/` 轮转：每次写配置前备份 + 保留 N 份（默认 5，`--keep`/`VESSEL_PROVIDER_BACKUP_KEEP` 可配）+ 原子写 + **零删除轮转**
- [x] 测试 ≥6 例：实际 20 例（导出脱敏 5 + 导入合并 7 + 备份轮转 8）

**096 endpoints + 测速**
- [x] `ProviderConfig.endpoints?: {url, label?}[]`（缺省回退 baseUrl）；`vessel provider endpoint add/remove/list`
- [x] `vessel provider endpoint test [<id>] [--all]`：最小探测（连通/延迟）+ 建议，**不自动改默认**；仅显式 `--set-default` 才改
- [x] 测试 ≥5 例：实际 24 例（store 层 7 + 探测层 9 + CLI 层 8）

**共同**
- [x] `npx tsc -b tsconfig.json` exit 0；全量 vitest 1148 passed + 1 skipped（108 files passed，EXIT=0；两处既有环境/隔离问题见 §6）；web 74 passed
- [x] 文档同步（PROVIDER-MANAGEMENT §2/§3.1/§3.2：导出脱敏语义、备份轮转、端点与测速）
- [x] 本卡"工作证明"回填 + 状态改"待验收"

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
