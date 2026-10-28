# 删除与保留（DELETION-AND-RETENTION）

> 状态：**实现已接入，W3 定向单测及协调者类型检查通过，最终验收待协调者**。345a/345b/345c 与 358 的既有验收保留；2026-10-27 用户修订第六条为“伪造元数据不得删除/修改 trash 根外的内容”，不要求来源认证。恢复路径新增会话布局校验；详见 §8，全量门禁与独立复核尚待协调者完成。
> 规则依据 `docs/DESIGN-DECISIONS.md` 决策点 24；实现拆在卡 343–346。
> 本文只回答三件事：什么东西删到哪里、留多久、由谁保证不越界。

## 1. 三类删除，三条路

| 类别 | 典型对象 | 去向 | 保留期 | 可否恢复 |
|---|---|---|---|---|
| A 用户可感知的数据 | 会话目录 `<workspace>/.harness/sessions/<id>`、运行产物、`evidence/` 里的产物 | 应用内暂存区（trash） | 默认 7 天，可配 | 可，`vessel trash restore` |
| B 运行时临时文件 | 会话 `.lease` 锁、`os.tmpdir()` 下的 engine 临时工作区、sandbox 隔离目录 | 直接删除 | 无 | 不需要，可重建 |
| C 其它显式删除 | 迁移脚本清理旧文件、CLI 杂项删除 | 系统回收站 | 由 OS 管理 | 由 OS 管理 |

判据只有一条：**这份东西删掉了用户会不会想找回来**。会 → A；不会 → B；拿不准 → C。

## 2. 为什么 B 不进回收站

`.lease` 每次会话关闭都会产生一条，engine 临时工作区每次迭代一个。把它们塞进回收站有两个实测代价：Windows 上每回收一个对象要起一次 PowerShell（约 200ms），且回收站会被几十字节的锁文件刷屏，真正的用户数据反而找不着。B 类同时满足三个条件才允许直接删：由本进程/本次运行创建、不含用户内容、删掉后能从会话日志或下一次运行重建。

## 3. 暂存区布局

- 工作区内：`<workspace>/.harness/trash/<UTC时间戳>-<短id>/`
- CLI 根优先级：`--root <path>` → `VESSEL_TRASH_ROOT` → `<cwd>/.harness/trash`；不自动扫描用户级目录。API 调用方显式传 `root`。
- 每个条目一个 `entry.json`：

```json
{ "id": "20261027T031500Z-6f3a", "origin": "C:/.../.harness/sessions/sess_123", "kind": "session", "reason": "user_delete", "deletedAt": "2026-10-27T03:15:00Z", "expiresAt": "2026-11-03T03:15:00Z", "sizeBytes": 184320 }
```

- 同一卷优先 `rename`（原子、零拷贝）；跨卷才「复制 → SHA-256 校验 → 把源移入**源卷内的应用暂存区**」——源备份有自己的 `entry.json` 与独立 TTL，可单独 `list/restore/purge`，**任何一步都不直接永久删除源**，也不把源送进系统回收站。
- `restore` 把条目移回 `origin`；原路径已存在则拒绝并提示，不覆盖。
- `restore` 在任何 mkdir/写入之前，要求 origin 是 trash 根外的绝对路径，且目标及父链没有符号链接/junction；`kind: "session"` 还必须为 `<workspace>/.harness/sessions/<id>` 布局，不符报 `Invalid session restore destination`。元数据没有来源认证，布局检查不等同于工作区授权证明；其它 kind 保持原有恢复语义。
- 服务端 `DELETE /api/sessions/:id` 先持久移除索引、关闭 controller/writer，再移入该会话工作区的 `.harness/trash`；暂存失败仍按既有错误码回滚索引。CLI `trash restore` 对 `kind: "session"` 先恢复目录与日志，再从当前会话注册表的 `sessions.metadata.jsonl` 读取该 id 最后一次有效元数据，校验工作区匹配且尚未登记后重新登记；不信任 trash 元数据提供 provider/model/permission。成功后新进程的 `vessel sessions list` 可见该会话。使用同一注册表根的运行中 serve 在下一次 `GET /api/sessions` 前增量读取 journal 的完整新增行，合并当前内存中缺失的会话并更新其查询索引，无需重启。刷新不覆盖已有会话元数据、不重建索引、不写回 journal/兼容快照，也不导入其它进程的删除或已有会话修改；半行追加等待后续请求读到完整行。仅恢复目录而未成功登记的会话仍不可见。
- 恢复时应使用删除前相同的 `VESSEL_SESSION_ROOT`（未设置则为 `~/.vessel`）。历史元数据缺失、工作区不匹配、重复登记或持久化失败时，CLI 返回 1 并明确说明「目录已恢复，登记失败」；保留已恢复字节，不回移、不重复 `trash restore`。下一步先核对 `VESSEL_SESSION_ROOT` 并保留目录，检查原注册表 `sessions.metadata.jsonl` 的历史记录；需要按原元数据人工修复登记，当前没有 `--reindex` 命令，`vessel sessions list` 不会扫描目录补登记。持久化错误可能已经写入日志，因此先重新运行 `vessel sessions list` 检查实际状态。
- `GET /api/trash` 以服务端启动工作区的 `.harness/trash` 为根，执行同源校验并只返回白名单元数据；无效条目仅返回 ID 和固定原因，不暴露解析错误或文件内容。根不存在时返回空列表；该端点不执行清理或删除。

## 4. 保留期与清理

- 默认 **7 天**；`trashEntry` 的显式 `ttlDays` 优先于 `VESSEL_TRASH_TTL_DAYS`（非负整数天）。未传显式值时读取该环境变量；当前没有 settings 文件配置入口。`0` 使新条目的 `expiresAt` 为 `null`。
- 已实现触发点：`vessel serve` 成功监听后异步触发一次清理，不等待清理完成；daemon 驻留子进程初始化关闭钩子时注册每日 tick，满 24 小时调用一次清理。两者根均为 `(workspace ?? process.cwd())/.harness/trash`（daemon 当前未指定 workspace，使用启动 cwd），根不存在静默跳过，`VESSEL_TRASH_TTL_DAYS=0` 时跳过自动清理，失败只记录警告、不立即重试。daemon 的计时器不阻止进程退出，`stop()` 开始时即清除，即使关闭失败或超时也不再清理。`vessel trash purge` 可手工触发。
- 清理前先向 `<root>/_purge.jsonl` 追加 `{ts,id,origin,bytes,ok:false,reason:"retention/purge:pending"}`，成功后追加 `ok:true`；失败追加原因。当前审计记录不含 `expiresAt`，不是独立事件总线事件；审计写入失败先于删除抛错。
- 清理范围硬限定在 trash 根之内：`path.relative` 校验边界，拒绝根/祖先/条目/元数据/载荷中的链接，且必须有通过结构、日期、字节数检查的 `entry.json`。实际删除目标固定为 `path.join(root, entry.id)`，不按 `origin` 删除。`origin` 必须在根外，供 restore 使用；元数据目前没有来源认证，见 §8。
- 手工 CLI：`vessel trash list [--json]`、`vessel trash restore <id>`、`vessel trash purge [--dry-run] [--older-than <days>] [--json]`，三者均可传 `--root <path>`。`--older-than` 只进一步限制已经到期的条目，不能提前清理。没有 `--force` 或按路径 restore。CLI 返回 0＝成功（含有 skipped 的结果）、1＝运行错误、2＝参数错误；JSON 错误字段为 `error`，值是消息而非新增错误码。
- HTTP 删除错误码保持 `session_index_failed`（索引移除失败）、`session_index_stale`（索引/回滚持久化失败）、`session_controller_close_failed`（writer/controller 关闭失败）、`session_recycle_failed`（暂存失败）。`GET /api/trash` 的无效条目原因固定为 `invalid_entry`。
- **永不触碰系统回收站**（不清空、不改写、不查询后删除）。

## 5. 与既有卡的关系

- 卡 259 / 261 建立的「会话删除 → 系统回收站」改由本节 A 类接管（先进 trash，7 天后永久删）；那两张卡的验收描述要随之更新，历史证据保留。
- F6（卡 249 审计）：`.lease` 与 engine 临时工作区归 B 类，**不改成回收站**，改为「直接删除 + 本条书面例外」；`git worktree remove` 仍交给 git，登记为「git 托管删除」，不由本项目实现。
- 卡 288–292 的 fixture 读边界与 `os.tmpdir()` 测试清理属既有例外一，不受本节影响。

## 6. 明确不做

- 不清空、不修改系统回收站；不做「整盘定时清空」。
- 不对 trash 根之外的路径做任何自动永久删除。
- 不做保留期云同步、不做「按大小自动淘汰」。
- 不把 `evidence/` 与 `docs/` 纳入自动清理（它们只在显式删除时进 trash）。

## 7. 验证口径

- 单测：分类路由（A/B/C 各一条）、跨卷回退、TTL 边界（到期前 1s 不删、到期后 1s 删）、路径逃逸（`..`、符号链接、条目缺 `entry.json`）、restore 往返、原路径冲突拒绝。
- 手工（Windows）：删一个夹具会话 → 出现在 `.harness/trash/` → `restore` 还原 → 再删 → 把 `expiresAt` 改成过去 → `purge --dry-run` 列出 → `purge` 删除 → 审计事件落盘。
- 不回归：`packages/core` 的租约语义与 fail-closed 行为不变；`.lease` 被拒重开后仍能正常接管。

## 8. W3 跨平台矩阵与对抗边界（2026-10-27）

| 平台/范围 | 证据与具体测试名 | 证据层级与限制 |
|---|---|---|
| Windows 系统回收站 | `daemonRecycle.windows.test.ts`：`recycles a Unicode and apostrophe path through Windows PowerShell`、`closes the actual session writer before native recycling` | 本机原生回收站集成；既有验收见 345c/343，W3 自验计数见卡 346 Result。只回收测试自建临时目录，不清空/枚举回收站 |
| Windows 目录符号链接 / junction | `trash.escape.test.ts`：`rejects the directory-symlink lstat branch with real disk unchanged (Windows mocked metadata)`、`rejects a Windows junction to outside trash` | junction 原生夹具；目录符号链接创建因 EPERM 未实测，用类型明确的 lstat 谓词单测 + 真实磁盘快照验证拒绝分支。原生目录符号链接需有相应权限的 Windows；POSIX 保留真实链接用例 |
| Windows 应用 trash/restore | `server.test.ts`：`restores a trashed session directory with the original log bytes` | 真实临时目录、HTTP 删除和日志字节恢复；不声称恢复 HTTP 索引 |
| Windows 启动/每日 purge | `server.test.ts`：`binds before startup purge removes expired entries and preserves unexpired data`；`daemonLifecycle.test.ts`：`purges exactly once at the daily boundary, retaining unexpired payloads in the selected workspace` | 真实临时目录删除，daemon 由假时钟驱动；不是等待真实 24 小时 |
| Linux，gio 存在 | `daemonRecycle.posix.test.ts`：`uses gio trash when Linux gio is available` | 注入 runner 的命令单测；原生未实测，需 Linux + gio + 可用的桌面回收站 |
| Linux，gio 不存在 | 同文件：`fails closed without a permanent-delete fallback when Linux gio is absent` | 注入 `spawn gio ENOENT`；原生未实测，需无 gio 的 Linux 环境 |
| macOS | 同文件：`forms the macOS osascript Finder command without executing it` | 仅命令形态单测；原生未实测，需 macOS + Finder + 自动化权限 |

`trash.escape.test.ts` 的五个拒绝用例分别覆盖 `..`、目录符号链接、Windows junction、把新条目到期时间改到删除时间之前（正常的根外 origin）、缺 `entry.json`。每条比较操作前后全部名称/文件字节/链接目标及 list；junction 只在 Windows 执行。Windows 目录符号链接只模拟 lstat 的链接谓词，磁盘快照仍读取真实夹具；不会将无权限环境写成原生通过。

第六条（手工伪造 `entry.json`）采用用户修订判据：结构合法、`sizeBytes` 正确、两日期均为过去且先后合法时，允许 list 接受并 purge **根内**条目；测试实际 purge，断言仅根内条目消失，根外 origin 目录及全部内容保持一致。两日期同时伪造与仅把新条目的到期时间改早是两回事。另测伪造 session origin 非会话布局时在创建父目录前拒绝、链接父链拒绝、合法 session 路径恢复成功。

历史证据：修订前的 dry-run 拒绝断言 exit 1（合法伪造被选中）保存在卡 346 Result 的临时目录；此旧判据已被用户明确替代，不是本轮修订后门禁失败，也不证明根外删除。没有加入签名/HMAC/token/manifest、外部数据库或新依赖。

## 9. 三档回滚（说明命令，不在 W3 执行）

先停止正在运行的 Vessel 服务，再在仓库根操作。改代码/启动替代 checkout 均须维护者授权；此处不执行 commit、revert 或真实用户数据删除。原 `.harness/trash` 保留，回滚不迁移或清空已有条目。

### ① 关闭自动清理

```powershell
$env:VESSEL_TRASH_TTL_DAYS = '0'
node node_modules/typescript/bin/tsc -b tsconfig.json
node apps/cli/dist/cli.js serve --help
# 在同一环境按原启动参数重新启动 serve/daemon；已驻留旧进程须先正常停止。
```

预期：serve 启动与 daemon tick 的环境守卫跳过全部自动 purge，包含先前已到期条目；新条目的 `expiresAt` 为 null。此开关不禁用手工 `vessel trash purge`，也不改写已有条目的到期时间；不要执行手工 purge 来验证关闭开关。恢复自动清理用 `Remove-Item Env:VESSEL_TRASH_TTL_DAYS` 后重启进程（该命令只移除进程环境变量）。

### ② 会话删除退回系统回收站

当前没有运行时路由开关，345c 也尚未提交，不能 `git revert 345c`。保留索引/关闭/回滚逻辑，只替换唯一暂存调用并增加导入；以下脚本先备份原始字节且检查匹配数，失败则不写文件：

```powershell
$env:VESSEL_TRASH_TTL_DAYS = '0'
node --input-type=module -e @'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const file = 'apps/local-server/src/server.ts';
const original = fs.readFileSync(file, 'utf8');
const call = /if \(fs\.existsSync\(sessionDir\)\) trashStore\.trashEntry\(\{\r?\n\s+root: path\.join\(existing\.workspaceRoot, '\.harness', 'trash'\),\r?\n\s+target: sessionDir, kind: 'session', reason: 'user_delete',\r?\n\s+\}\);/g;
if ([...original.matchAll(call)].length !== 1 || original.includes('import { recycleDaemonPath }')) throw new Error('Source differs; review before rollback');
const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-345c-route-rollback-'));
fs.copyFileSync(file, path.join(backup, 'server.ts'));
const changed = original.replace(call, 'if (fs.existsSync(sessionDir)) await recycleDaemonPath(sessionDir);');
fs.writeFileSync(file, "import { recycleDaemonPath } from './daemon/daemonLifecycle.js';\n" + changed);
console.log('Original server.ts backup:', backup);
'@
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/vitest/vitest.mjs run apps/local-server/src/daemon/daemonRecycle.windows.test.ts
```

预期：新删除的会话经原生系统回收站；暂存模块、只读列表和已有条目不动，清理仍由第①档关闭。只在测试自建临时工作区做 HTTP 删除冒烟并确认索引消失；原 345c 的「进入 trash」测试按定义不适用于回滚后的路由，需另行审阅对应验收，不能把上述回收站测试当完整 HTTP 验收。恢复前打印的备份路径后，可用 `Copy-Item -LiteralPath '<实际备份目录>/server.ts' -Destination 'apps/local-server/src/server.ts'` 恢复原文件，重新构建；这要求备份之后没有其它 server.ts 修改。

### ③ 整批回退

范围是卡 **343–346** 的删除批次，另有依赖卡 **357/358**（只读 HTTP/daemon tick）；不包括无关卡。2026-10-27 核对：这些改动仍未提交，当前 HEAD 为 `40cd6a95c920dc2beba4b90b95d759872407dcae`，新增模块/卡未跟踪。`git revert` 只接受提交 SHA，不接受卡号，也不能撤销未提交内容。当前禁止对共享工作区执行整文件 checkout/reset 来模拟按卡回滚。

需要现在切回批次前产品时，在新的隔离 checkout 运行已提交 HEAD，原脏工作区完整保留（该 checkout 同时不含其它所有未提交批次，因此不是精确按卡撤销）：

```powershell
$rollbackRoot = 'E:\Code_file\Projects\Vessel_Harness-before-343-346'
if (Test-Path -LiteralPath $rollbackRoot) { throw 'Choose a new checkout directory' }
git worktree add --detach $rollbackRoot 40cd6a95c920dc2beba4b90b95d759872407dcae
Push-Location $rollbackRoot
try {
  npm ci
  node node_modules/typescript/bin/tsc -b tsconfig.json
  # 从该目录按原参数启动 Vessel；不要将旧 trash 内容自动搬入此目录。
} finally { Pop-Location }
```

若将来删除批次已经按卡形成独立提交，先用 `git log --oneline --all` 核对 343、344、345a/b/c、346、357、358 的实际 SHA 与依赖，再在干净工作区按新到旧显式传入这些 SHA：`git revert --no-commit <358-SHA> <357-SHA> <346-SHA> <345c-SHA> <345b-SHA> <345a-SHA> <344-SHA> <343-SHA>`。尖括号必须替换为已核对的实际 SHA；若合并在一个提交内只列一次，若混有其它功能则不能整提交回退。当前没有这些 SHA，故本命令是带明确前置条件的将来路径，**不是本轮可执行的精确回滚**；提交反向改动仍需授权。
