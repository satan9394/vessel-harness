# Codex 交接单（第二波）· 2026-10-27 · 剩余未解决项全量

> 用法：在 Codex 应用里把本文件路径给它，并说明要跑哪一波（例如「按本文件跑波次 A」）。
> 本文件取代 `tasks/prompts/codex-handoff-2026-10-27-final.md` 的剩余部分；第一波 T1–T4 已完成并验收，
> 不要再做。执行者不要改本文件、不要改任务卡正文（只填 Result 段）。
> 卡与契约：每项都有卡可读；走 PDW 时另有 `.pdw/contracts/` 下同名契约。
> 中止背景：`evidence/sessions/2026-10-27-pdw-halt.md`（今天在 PDW 上起过又停掉的任务，别重做重复项）。

## 0. 全局约定（违反即视为交付无效）

1. 仓库根 `E:\Code_file\Projects\Vessel_Harness`，Windows + PowerShell 7。
2. **只改「允许改的文件」列出的路径**；多改一个文件即越界。允许清单已按「会牵连的测试/文档」补全——上一波
   正是因为清单漏了 `apps/cli/src/i18n.ts`、`apps/cli/src/cli.test.ts`，导致金标测试红。
3. 不 commit / push / 建分支；不改 `.pdw/`、不改 `.agents/skills/`、不改 `package.json`/锁文件（除明确允许）。
4. 不跑全量门禁（`scripts/gate-batched.ps1` 由协调者统一跑）；只跑本任务的定向自验。
5. 命令被拒或失败：贴原始报错与 exit code，不推测、不伪造；不许为了让测试过而放宽断言、加 sleep 或加重试。
6. 报告四段：改动文件、命令 + exit + 计数、未做的与原因、被拒命令原文。
7. 复核必须独立（另起子代理，不复用实现会话）；复核只读，不得改任何文件。
8. 同一文件同一时刻只有一个写者；波次内的文件集已保证不重叠，跨波必须等上一波结束。
9. 不自动驱动本机其他 Agent CLI（dsh / opencode / claude / pi）。
10. 走 PDW 时**运行期间冻结工作树**：PDW 1.3.3 的指纹覆盖整个工作树，`new` 之后任何文件写入
    （包括回填任务卡）都会在模型调用前判 `Source drift`。卡与文档要先写完，`PDW task:` 行跑完再补。

## 1. 模型与思考档位（按任务定，照这个配）

档位词表按后端分列：**Codex** 支持 `low/medium/high/xhigh/max/ultra`；**DeepSeek(OpenCode)** 只有
`low/high/max`。写错档位不会报错，只会静默按默认思考跑，所以下表要照抄。

**配额策略（2026-10-27 维护者定）**：先把 Codex 额度用满，再转 PDW（DeepSeek 写）。因此下表的实现档位
在「不牺牲正确性」的前提下偏上取，不再为了省额度压到 low。

| 编号 | 任务 | 波次 | 实现 | 复核 | 依据 |
|---|---|---|---|---|---|
| T7 | 卡 353 租约绕过 | A ✅ | `gpt-6.1-sol` / high | `gpt-6.1-sol` / high | 已完成 |
| T6 | 卡 345c 删除改道 | A ✅ | `gpt-6.1-sol` / high | `gpt-6.1-sol` / medium | 已完成（含测试夹具授权修复） |
| T13 | 卡 357 `GET /api/trash` | A ✅ | `gpt-6.1-terra` / medium | `gpt-6.1-terra` / low | 已完成 |
| T14 | 卡 358 daemon tick | A ✅ | `gpt-6.1-sol` / medium | `gpt-6.1-terra` / medium | 已完成 |
| T5b | 卡 350c exit 2 判据 | B | `gpt-6.1-terra` / medium | `gpt-6.1-terra` / low | 单测试文件、判据明确 |
| T12 | 卡 356 价目值守卫文档 | B | `gpt-6.1-terra` / **medium** | `gpt-6.1-terra` / low | 文档 + 可能的差分脚本 |
| T8 | 卡 354 看板对账 170–183 | C | `gpt-6.1-sol` / medium | `gpt-6.1-terra` / medium | 跨 12 张卡核证据，判断「能否复验」需要强模型 |
| T11 | 卡 355 陈旧卡对账（含 S002/S006） | C | `gpt-6.1-sol` / medium | `gpt-6.1-terra` / medium | 要读代码判断判据是否可证伪 |
| T9 | 卡 351 Packaging gate | D | `gpt-6.1-terra` / medium | 不需要 | 只跑现有入口、不改判据 |
| T10 | 卡 260/275 浏览器第二轮 | D | `gpt-6.1-terra` / medium（可配 `pdw_ui_verifier`） | `gpt-6.1-terra` / medium | 交互走查要看图并判「无法验证」 |

升级阶梯：先按上表跑；红了再升（`medium → high`，同模型），每升一级必须在报告里写「哪条命令红了」。
`ultra` 只用于**文件集互不重叠**的并行子代理；波次 C 的 T8/T11 共用 `tasks/README.md`，禁止并行。
`service_tier`（Fast）默认关，不要开。

## 2. 冲突矩阵（决定必须串行的地方）

| 文件 | 被哪些任务改 | 结论 |
|---|---|---|
| `apps/local-server/src/server.ts` | T6、T13 | **必须 T6 → T13 串行**，同一写者 |
| `docs/DELETION-AND-RETENTION.md` | T6、T13、T14 | 串行；谁最后改谁保证全文一致 |
| `tasks/README.md` | T8、T11 | **必须 T8 → T11 串行**（都改路线层表） |
| `apps/local-server/src/routes/profileParity.test.ts` | T5b | 与 A/C/D 波无重叠，可并行 |
| `packages/core/src/session/*` | T7 | 独占，不与任何任务并行 |

## 3. 波次安排

- **波次 A ✅ 已完成并验收（2026-10-27）**：T7 → T6 → T13 → T14 串行交付，四段独立复核 PASS，
  协调者复跑 core/session 27、core 133、daemon 32、local-server 312，全量门禁 17 步全绿。**不要重做**。
- **波次 B（剩余）**：T5b、T12。文件互不重叠，可并行。
- **波次 C（剩余，串行）**：T8 → T11（共用 `tasks/README.md`，同一时刻一个写者）。
- **波次 D（剩余）**：T9、T10（T10 只写 `evidence/`）。

B、C、D 三波之间文件集互不重叠（B 写测试/文档，C 写 `tasks/`，D 写 `tasks/351` 与 `evidence/`），
可以同时开三道；唯一例外是 **T8 与 T11 必须串行**。

---

## T7 · 卡 353：`Session.append` 重开不重取租约

**实现** `gpt-6.1-sol` / high；**复核** `gpt-6.1-sol` / high。波次 A 第一段。

### 问题与证据

`packages/core/src/session/Session.ts`：`open()` 里 `acquireLease` 拿 `.lease`；`close()` 删掉它并把
`fd` 置 `null`（L273-284）；但 `append()`（L183-196）在 `fd` 为空时**只** `fs.promises.open(logPath,'a')`，
没有再取租约。于是 `close()` 之后再 `append()` 会在无租约状态下继续写日志——单写者 fail-closed 被绕过。
来源：`docs/product-evolution/PRODUCT-STATE.md` Round 11「残留（下一批）」第 ① 条。

### 要做

1. 先写红测试：同一 `Session` 实例 `close()` 后 `append()`，当前实现下必须能写成功（红）。
2. 修：`append()` 重开句柄前重新 `acquireLease`（复用静态方法）；**不要**改成「close 后对象永久不可用」——
   既有 reopen-after-close 行为必须保留（`packages/core/src/session` 现有 3 文件 / 24 条用例里有它）。
3. 负向用例：把 `.lease` 写成确定存活的 pid（例如测试进程自身），`close()` 后 `append()` 必须抛错，
   且 jsonl 不新增任何字节。
4. 不改 append-only 语义、不改 `.lease` 格式（首行 pid、次行 ISO 时间戳）、不动 `replaceRegion`。

### 允许改的文件

`packages/core/src/session/Session.ts`、`packages/core/src/session/Session.test.ts`、
`packages/core/src/session/SessionLease.test.ts`、`tasks/353-session-append-lease-bypass.md`（只填 Result）。

### 自验

```
node node_modules/vitest/vitest.mjs run packages/core/src/session
node node_modules/vitest/vitest.mjs run packages/core
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

报告附 `git diff --stat -- packages/core`，说明改动是否只在 Session 及其测试。

---

## T6 · 卡 345c：服务端删除改道 + serve 启动清理

**实现** `gpt-6.1-sol` / high；**复核** `gpt-6.1-sol` / medium。波次 A 第二段（等 T7 全绿）。

### 问题与证据

`apps/local-server/src/server.ts:884-923` 的 `DELETE /api/sessions/:id` 现在走
`recycleDaemonPath(sessionDir)`（L909），即系统回收站；按决策点 24 与 `docs/DELETION-AND-RETENTION.md`，
A 类数据应先进应用内暂存区。345a 的 `packages/application/src/deletion/trash.ts` 与 345b 的 CLI 已交付。

### 要做

1. 删除去向改为 `<workspaceRoot>/.harness/trash`（用 `import { trashStore } from '@vessel/application'`，
   **禁止** `packages/application/dist/...` 相对导入——vitest 别名指向 `src`，相对 dist 会让测试在测构建产物）。
2. 顺序不变：索引持久移除 → 关 controller/writer → 移入暂存；失败回滚。错误码
   `session_index_failed` / `session_index_stale` / `session_recycle_failed` 含义不变（后者＝连暂存都失败）。
3. `vessel serve` 启动时 best-effort purge：根为 `(VesselServerOptions.workspace ?? process.cwd())/.harness/trash`；
   异步触发、不 await、失败只 `console.warn`、不阻塞监听；根不存在静默 no-op；`VESSEL_TRASH_TTL_DAYS=0` 不清。
4. 测试 ≥4 条：删除后目录在 trash 且列表消失；restore 后回来；暂存失败时索引回滚 + `session_recycle_failed`；
   启动 purge 被调用（构造已到期条目 + 临时根；TTL=0 时断言未处理）。

### 允许改的文件

`apps/local-server/src/server.ts`、`apps/local-server/src/server.test.ts`、`docs/DELETION-AND-RETENTION.md`、
`tasks/345-app-trash-and-retention.md`（只填 345c 段）。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T13 · 卡 357：`GET /api/trash` 只读列表

**实现** `gpt-6.1-terra` / medium；**复核** `gpt-6.1-terra` / low。波次 A 第三段（T6 之后，同一个 `server.ts`）。

### 问题与证据

卡 345 §2 第 4 条要求「HTTP 只读：`GET /api/trash`（同源、不含凭据、不带删除动作）」，目前**不存在**：
`apps/local-server/src` 全目录搜 `api/trash` / `trashStore` 零命中。T6 只做了删除改道与启动清理。

### 要做

1. 新增 `GET /api/trash`：返回 `trashStore.list({ root })` 的 DTO，字段白名单
   （`id/origin/kind/reason/deletedAt/expiresAt/sizeBytes` + `skipped`），**不含**任何文件内容与凭据；
   与既有写请求一致地做同源校验。
2. 根与 T6 一致：`(opts.workspace ?? process.cwd())/.harness/trash`；根不存在返回空列表而不是 404。
3. 只读：不得接受 DELETE/POST；不得触发 purge。
4. 测试 ≥3 条：空根、有条目时的 DTO 形状、跨源请求被拒。

### 允许改的文件

`apps/local-server/src/server.ts`、`apps/local-server/src/server.test.ts`、`docs/DELETION-AND-RETENTION.md`、
`tasks/357-trash-http-readonly.md`（只填 Result）。

### 自验

同上（`apps/local-server` + 两处 tsc）。

---

## T14 · 卡 358：daemon 每日 tick 清理到期条目

**实现** `gpt-6.1-sol` / medium；**复核** `gpt-6.1-terra` / medium。波次 A 第四段。

### 问题与证据

`docs/DELETION-AND-RETENTION.md` §4 写的触发点是「`vessel serve` 启动 + daemon 每日 tick + 手工」，
但 `apps/local-server/src/daemon/daemonLifecycle.ts` 里搜 `purge` / `trash` **零命中**，每日 tick 从未接。
（serve 启动那半由 T6 补齐。）

### 要做

1. 在 daemon 生命周期里加每日 tick：到点调用一次 `trashStore.purge`，失败只记录不重试到阻塞；
   tick 必须能被 `stop()` 清掉（不得留下定时器让进程不退出）。
2. 保留 `VESSEL_TRASH_TTL_DAYS=0` 关闭语义；与 serve 启动清理共用同一根规则。
3. 测试 ≥2 条：注入可控时钟/短间隔，断言到点触发一次；`stop()` 之后不再触发。
4. 不改 daemon 的既有回收（`recycleDaemonPath`）语义。

### 允许改的文件

`apps/local-server/src/daemon/daemonLifecycle.ts`、`apps/local-server/src/daemon/daemonLifecycle.test.ts`、
`docs/DELETION-AND-RETENTION.md`、`tasks/358-daemon-trash-tick.md`（只填 Result）。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/local-server/src/daemon
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T5b · 卡 350c：`profileParity` 的 exit 2 可达路径

**实现** `gpt-6.1-terra` / medium；**复核** `gpt-6.1-terra` / low。波次 B（与 A 并行安全）。

### 问题与证据

卡 350 的偶发是 `expected 2 to be 0`。已确认：`profileCommands` 的 `delete` 分支**幂等**
（`deleted=false` 也 `return 0`，`apps/cli/src/providers/profileCommands.ts:47-52`），所以「CLI 读错根」
产生不了 exit 2；exit 2 只来自同一文件 L56-58 的 `catch`（典型是 `store.deleteProfile` 抛
`provider_profiles_corrupted`，见 `apps/local-server/src/providers/ProviderStore.ts:354`）。
卡 350 已加两条隔离守卫，但没有用例覆盖这条路径，PDW 的只读复核（`20261027093657-9b91ec`）因此判 fail。

### 要做

1. 新增一条用例：把临时根下 `provider-profiles.json` 写成非法 JSON 后跑
   `main(['provider','profile','delete','work','--json'])`，断言返回 **2**，且错误证据含映射文案
   「provider-profiles.json 损坏」（`profileCommands.ts` 的 `ERRORS.provider_profiles_corrupted`）；
   `stderr` 与 JSON 输出两处都查。
2. 同一用例对同一根直接 `fetch` `DELETE /api/providers/profiles/work`（带 Origin 头；不要复用会强断言
   200/201 的 `http()` 助手），断言 `error: 'provider_profiles_corrupted'`。
3. 注释写清推理：delete 幂等 ⇒ 读错根不会产生 exit 2；本用例是「exit 2 可达路径」的证据，不是复现原始偶发。
4. 不改弱卡 350 的两条守卫与四条逐字比对断言。

### 允许改的文件

`apps/local-server/src/routes/profileParity.test.ts`、`tasks/350c-profile-parity-exit2.md`（只填 Result）。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/local-server/src/routes/profileParity.test.ts
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T12 · 卡 356：价目值守卫的文档诚实化（+ 可选的升级差分）

**实现** `gpt-6.1-terra` / low（若做第 3 条升 medium）；**复核** `gpt-6.1-terra` / low。波次 B。

### 问题与证据

`docs/MAGPIE-ABSORPTION.md` §5 最后一行仍写「尚未实现：价目值守卫（P2-1）」，但实现**早在卡 092** 就落地：
`apps/cli/src/usage/pricingOverride.ts` 的 `repair()` 是值守卫三态（`applied` / `skipped-absent` /
`skipped-user-modified`），入口 `vessel pricing override repair --file <repairs.json>`
（`apps/cli/src/cli.ts:2510-2557`），卡 323 也已核实为「已具备」。这是文档失真，不是缺功能。

### 要做

1. 改 `docs/MAGPIE-ABSORPTION.md`：把 P2-1 标为已具备，写清落点（`pricingOverride.ts` 的 `repair` 三态 +
   CLI 入口）、验收信号（`skipped-user-modified` 不可被覆盖），并保留真实缺口。
2. 真实缺口只有一条：**没有**「对比两版内置 `configs/pricing.json` 自动生成 `repairs.json`」的命令。
   在 §5 与 `tasks/323-pricing-value-guard.md` 末尾各追加一行说明。
3. （可选，默认不做）若要补差分脚本：新建 `scripts/pricing-upgrade-diff.mjs`，
   `--from <旧价目> --to <新价目> --out <repairs.json>`，只输出「旧值→新值」条目，并加 3 条单测
   （同值跳过、缺条目跳过、结构非法报错）。做了就把卡 356 的 Result 写明，并在 `tasks/README.md` 记一行。

### 允许改的文件

`docs/MAGPIE-ABSORPTION.md`、`tasks/323-pricing-value-guard.md`（只追加）、`tasks/356-pricing-value-guard-docs.md`（只填 Result）；
**仅当做第 3 条时**追加允许：`scripts/pricing-upgrade-diff.mjs`（新建）、`scripts/pricing-upgrade-diff.test.mjs`（新建）。

### 自验

```
git diff --stat -- docs/MAGPIE-ABSORPTION.md tasks/323-pricing-value-guard.md
node node_modules/vitest/vitest.mjs run apps/cli/src/usage/pricing-override.test.ts   # 只证没碰坏既有行为
```

---

## T8 · 卡 354：看板对账 170–183

**实现** `gpt-6.1-terra` / medium；**复核** `gpt-6.1-terra` / low。波次 C 第一段（必须先于 T11）。

### 问题与证据

`tasks/README.md` 路线层表里 170–181 仍写「本地全门禁通过；待验收」，183 同批；182/183 另称已合入。
卡面停在「待用户验收 / 待验收」。这批是 2026-10-02/03 的 V1.5/V1.6 交付，后续 epic 已覆盖。

### 要做

1. 逐张读卡（170–181、183），对每条交付主张在当前 HEAD 找可复验证据（源码/测试是否还在？定向测试是否过？）。
   允许只跑定向测试，不跑全量门禁。
2. 每张卡**末尾追加**结论，不改正文：`已验收（2026-10-27 对账，依据 …）` 或 `仍待用户验收（缺 …）`
   或 `无法确认（查过：…）`。
3. 更新 `tasks/README.md` 路线层对应行；不动 182/183 已有结论。
4. **不许**在没有本次证据时写「已验收」。

### 允许改的文件

`tasks/170-adaptive-compaction-and-overflow-recovery.md`、`tasks/171-mcp-process-tree-job-object-and-lazy-proxy.md`、
`tasks/172-agent-teams-dag-orchestration-and-route-snapshots.md`、`tasks/173-session-streaming-and-multiframe-zstd-eval.md`、
`tasks/174-epic-industrial-resilience-and-teams-mesh.md`、`tasks/175-visual-team-dag-canvas-and-staged-approval.md`、
`tasks/176-headless-daemon-and-tray-resilience.md`、`tasks/177-tool-self-healing-and-bounded-output.md`、
`tasks/178-sqlite-wal-session-index-and-fts5-search.md`、`tasks/179-epic-universal-team-workspace-and-daemon-mesh.md`、
`tasks/180-os-native-sandboxing-and-restricted-tokens.md`、`tasks/181-evolving-knowledge-graph-and-hybrid-memory.md`、
`tasks/183-epic-hardened-runtime-and-cognitive-memory.md`（以上仅末尾追加）、`tasks/README.md`、
`tasks/354-board-reconcile-170-183.md`（只填 Result）。

### 自验

```
node scripts/check-append-only.mjs <上面列出的卡路径>
git diff --stat -- tasks
```

报告给「卡 → 结论 → 依据（文件:行 或 测试命令）」对照表。

---

## T11 · 卡 355：陈旧状态卡对账（含 S002/S006 判据）

**实现** `gpt-6.1-terra` / medium；**复核** `gpt-6.1-terra` / low。波次 C 第二段（T8 之后，同一 README）。

### 问题与证据

- `071-windows-sandbox-backend.md`：待验收，但沙箱链路后由 255/256/281/287 重做。
- `281-arch07-posix-fallback-decision.md`：阻塞待拍板，而方案 2 已由 287 实现。
- `196-evaluator-red-green-reproduction-gate.md`：「Epic 199 全量门禁待执行」，199 早已合入。
- `217-event-projection-contracts-and-compaction-conservation.md`：与已验收的 217 architecture 卡**同号**，
  状态「就绪待执行」；事件投影/压缩守恒后由 236/244/247 落地。
- `149-live-baseline-blocked.md`：blocked；153 已回退并立「不自动驱动本机其他 agent」口径。
- `tasks/_missions/mission-02/M1-residual-wording.md`、`W4-repair-comment-367.md`：归档区仍写「待执行」。
- `119-safety-scenario-falsifiable-criteria.md`：**部分完成**，S002/S006 恒真判据当时登记「仍待加锁」。

### 要做

1. 逐张读卡 → 结论（被哪张取代 / 已解决 / 仍缺什么），每条有依据。
2. 被取代的卡末尾追加 `已被 <卡号> 取代（2026-10-27 对账）`；不改正文、不删卡。
3. 对 119：核对 `benchmarks/runners/src/conformance/asserts.ts`（约 103 行）、
   `benchmarks/runners/src/offline.ts`（约 218/219/253/254 行）、
   `benchmarks/runners/src/safety-discrimination.test.ts`（约 23 行），确认 S002/S006 判据现在是否可被证伪。
   已加锁就写依据；仍未加锁就新建 `tasks/352-safety-s002-s006-criteria.md` 记录缺口与最小修法，
   **不要**放宽判据。
4. 同步 `tasks/README.md` 对应行。

### 允许改的文件

`tasks/071-windows-sandbox-backend.md`、`tasks/119-safety-scenario-falsifiable-criteria.md`、
`tasks/149-live-baseline-blocked.md`、`tasks/196-evaluator-red-green-reproduction-gate.md`、
`tasks/217-event-projection-contracts-and-compaction-conservation.md`、`tasks/281-arch07-posix-fallback-decision.md`、
`tasks/_missions/mission-02/M1-residual-wording.md`、`tasks/_missions/mission-02/W4-repair-comment-367.md`
（以上仅末尾追加）、`tasks/README.md`、`tasks/355-stale-cards-reconcile.md`（只填 Result）、
必要时新建 `tasks/352-safety-s002-s006-criteria.md`。

### 自验

```
node scripts/check-append-only.mjs <上面列出的卡路径>
git diff --stat -- tasks
```

---

## T9 · 卡 351：Packaging gate 实跑一次

**实现** `gpt-6.1-terra` / low；不设复核。波次 D。

### 问题与证据

`benchmarks/runners/src/release-gates/gates.ts` 有 packaging 门；`docs/V1.6-STABLE-CHECKLIST.md` 记录它此前
「需要 dist」而未跑。现在 `apps/cli/dist/cli.js` 与 `apps/web/dist/index.html` 都存在。

### 要做

1. 找 packaging gate 的**现有**入口（`benchmarks/runners/src/release-gates/`；不新建入口、不加 npm script）。
2. 用现有 dist 跑一次，记 exit 与输出；dist 缺失/过期先 `tsc -b` 重建再跑一次。
3. 结果写进 `tasks/351-packaging-gate-run.md`：入口命令、exit、失败原因、下一步建议。
4. **不要**改 gate 判据凑通过。

### 允许改的文件

`tasks/351-packaging-gate-run.md`（新建，含 Result）。允许运行构建命令（产物已 gitignore）。

### 自验

```
node node_modules/typescript/bin/tsc -b tsconfig.json
<你找到的 packaging gate 入口命令>
```

---

## T10 · 卡 260/275：真实浏览器验收（第二轮）

**实现** `gpt-6.1-terra` / medium（可用项目内置 `pdw_ui_verifier` 取证，它只许写指定临时目录）；
**复核** `gpt-6.1-terra` / medium。波次 D。

### 已知限制（不要再试第二遍）

第一轮 `evidence/sessions/2026-10-26-iab-acceptance/report.md`：IAB 无浏览器菜单缩放、`Ctrl+=` 无效、
CDP `deviceScaleFactor` 只改 DPR（918→DPR 1.5、`innerWidth` 仍 918）。所以「150%/200% 真实缩放」与
「原生输入法」允许判为 **无法验证**，其余项必须做完。

### 要做（A–I）

夹具工作区放系统临时目录，独立 `USERPROFILE`/`HOME` 以免 Activity 混入真实项目；`vessel serve` 起 5678：

- A 矩阵：360/768/1024/1440/1920 × 浅/深 × 中/英，workbench / conversation / activity / settings 各一格；
  每格记 `documentElement.scrollWidth` vs `innerWidth`；≥12 张截图。
- B 键盘与无障碍：只用键盘走 导航 → 新建会话 → 发送 → Inspector → 删除确认 → Esc；记焦点可见、遮挡、Esc 回位；
  抽查 10 个控件 accessible name。
- C 首屏焦点 + 跨工作区草稿隔离。
- D 生效 Policy 只读面板（来源、无编辑入口）。
- E 工具卡默认折叠、错误原因可见、Stop 请求中禁用与失败原因、消息区内部滚动。
- F 删除：确认 → 消失 → 刷新仍消失；再制造一次回收失败（占用目录）看原因与重试。
- G Activity 四态分组与刷新保持。
- H 刷新保史（消息、工具卡、终止提示）。
- I 端到端：新建 → 发送 → 工具调用 → Diff → 刷新保史 → 删除进暂存区。

### 允许改的文件

只写 `evidence/sessions/2026-10-27-iab-acceptance-run2/`（报告 + 截图）。不改产品代码、不改测试。

### 自验

每条「通过 / 不通过（附现象）/ 无法验证（附原因与两种手段实测值）」；截图不得出现非夹具项目名与用户会话标题。

---

## 8. 这一波不做（沿用既有决定，别顺手开工）

跨供应商 failover、配额感知路由、profile 自动同步、本地网关 3425、订阅 OAuth 复用、明文 key 落盘、
中间件插件体系、自动账号发现、GitHub Release / npm 发布、force push。

## 9. 不能交给 Codex 的（维护者本人）

| 项 | 为什么 |
|---|---|
| 卡 346 收口（跨平台矩阵、六条逃逸对抗、文档一致性、三档回滚） | 需要把 343–345 的产物整体验成可交付状态，且要写回滚说明，由协调者做 |
| 卡 343 是否保留（回收原语由上一会话越界代做、未提交） | 维护者决定；撤回方式在卡 343 与 HANDOFF §0 |
| 决策点 24 的三处口径复核（7 天默认、TTL=0、临时文件不进回收站） | 口径拍板 |
| 卡 277 人眼确认 | 只能人看 |
| UI-10 的 150%/200% 真缩放、原生输入法 | IAB 做不到，真机才行 |
| ARCH-04 跨 harness live 证据 | 要驱动本机其他 CLI，须逐次授权 |
| 154 release-report 刷新、155 3 小时墙钟 soak、156 门槛复核 | 需真实供应商配额 / 机器占用 |
| U1–U5 与 PR 页面旧身份、npm `_npmUser` | 需以你名义对外提交，或被门禁拦 |

## 10. 交回来时给什么

每个编号贴：改动文件清单、每条自验命令 + exit + 计数、未做与原因、被拒命令原文、以及
`git diff --stat` 的范围证据。协调者会逐项复跑定向测试、再跑一次
`pwsh -NoProfile -File scripts/gate-batched.ps1`，以自己跑出来的数字落卡；执行者与复核子代理的自述只作参考。

## 11. 走 PDW 时的机械步骤（可选，两条路选一）

**路线 1：Codex 应用直接跑**（推荐给本单，波次内文件不重叠）——把本文件路径给它，说明跑哪一波。

**路线 2：PDW 驱动，Codex 当写者**：

```powershell
pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind code-heavy     # sol/high；文档类用 -Kind small
pwsh -NoProfile -File scripts/pdw-batch.ps1 -Contract .pdw/contracts/353-session-append-lease-bypass.json,.pdw/contracts/345c-server-trash-routing.json -Kind code-heavy
```

- 开跑前把卡写完；**运行期间冻结工作树**（PDW 的指纹覆盖整个工作树，任何写入都会判 `Source drift`）。
- 契约已备：`353`、`345c`、`350c`、`356`（`350`、`350b` 是 2026-10-27 已用过的那两份）。
  `354/355/351` 暂无契约：354/355 要改「被跟踪的卡」，而现有 `scripts/check-append-only.mjs` 比的是
  `git diff HEAD`，会把卡 340 留下的存量改动也算成删除——**转 PDW 之前得先给这个脚本加
  「按任务起点基线比对」的模式**，否则 append-only 判据会误红。`351` 是一次性取证，直接手工跑更合适。
- 批次跑完只是 `accepted_local`，不等于验收；协调者仍要逐项复跑。

## 12. 配额策略：Codex 用尽后转 PDW（2026-10-27 维护者定）

1. **默认顺序**：能交给 Codex 的一律先交 Codex，额度尽量用满（因此 §1 的档位偏上取，不再为省额度压到 low）。
2. **判定用尽**：出现 `You've hit your usage limit` 或模型不可用时，按 `evidence/sessions/2026-10-27-pdw-halt.md`
   §2 的做法先排环境问题（opencode 二进制被升级成占位脚本这类），确认不是环境再判「额度用尽」。
3. **切换动作**：
   ```powershell
   pwsh -NoProfile -File scripts/pdw-route.ps1 -Kind deepseek     # implement = opencode / deepseek-v4.1-flash / high
   pwsh -NoProfile -File scripts/pdw-batch.ps1 -Contract <契约> -Kind deepseek
   ```
   只读四角色本来就是 DeepSeek（`scan`/`test-plan` `#high`，`review`/`planner` `#max`），不需要改。
4. **切换前必须确认**：该任务的契约文件已存在；卡与文档已写完（PDW 跑期间不能写仓库）；不然就先补契约/文档。
5. **恢复**：Codex 额度回来后 `scripts/pdw-route.ps1 -Kind general`（或 `code-heavy`）切回；`.pdw/config.json`
   每次切换都有备份，见 `.pdw/skill-upgrade-<日期>/config.json.bak-route-*`。
6. **不再新增任务卡**：这一轮把未解决项清完就收口（维护者的明确要求）。之后只做卡 346 的收口与验收，
   有新想法再另立批次。
