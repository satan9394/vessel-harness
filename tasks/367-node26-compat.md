# 任务卡 367: Node 26 适配（红绿门禁三连 + FileHandle GC 关闭变硬错 + 目录联接判定）

- Status: 已验收（2026-10-30，协调者独立复跑）：Node 26.13.0 上全量门禁 **17/17 exit 0**（根 335 文件 / 3,725 + 8、web 61 / 543、conformance 25/25 $0，日志 `%TEMP%/vessel-gate-2ffd7094`）。三处：红相首行判定跟随 26 的 `node:internal/assert/utils:<n>`（其余四条未动、十变体反例只有两条 accepted）；`SubagentManager` 的 `close()` 移入 `finally`（产品侧真实句柄泄漏，26 把 GC 关闭变硬错照出来的）；trash 链接用例改成按路径匹配的夹具 mock（产品守卫零改动，实测它不比较 inode）
- PDW task: none
- 来源：2026-10-30 01:00 本机 nvm v1→v2 迁移把 Node 从 24.14.0 升到 **26.13.0**（迁移 STEP 6 删旧目录报 AccessDenied，但 PATH 与 registry 已指向新 nvm）。之后在 26 上复跑 `scripts/gate-batched.ps1`，**17 步里 3 步红**；同一份代码在 24 上是 17/17 全绿。

## 1. 现象（2026-10-30 在 Node 26.13.0 上的实测）

日志目录 `%TEMP%/vessel-gate-d5e9ae11/`。三处红，症状分三类：

1. **红绿门禁（红相）判不出来** —— `tools+policy` 步骤 exit 1：
   - `packages/policy/tests/redGreenGate.test.ts`：3 failed
     - `records real target assertion failure and refuses unfinished repairs` → `AssertionError: expected false to be true`
     - `rejects a changing Red baseline and an unchanged source repair` → 期望错误含 `No source repair`，实际是 `Error: Missing, changed or untrusted Red proof/test identity`
     - `permits completion only after real Green plus full suite; later edits invalidate it` → `expected { success: false, … } to match { success: true, … }`
   - `packages/application/src/v23Integration.test.ts`：`Red must fail on the configured target assertion with unchanged evaluator tests and baseline sources: expected false to be true`
   - `packages/application/src/redGreenCompletion.test.ts`：`evaluator-owned subprocess evidence admits ordinary completion` → `expected false to be true`
2. **FileHandle 在 GC 时被关闭从「弃用警告」变成硬错** —— `skills+agents` 步骤 exit 1，但**测试全过**（23 文件 / 194 passed）：
   `Vitest caught 1 unhandled error … Uncaught Exception: Error: A FileHandle object was closed during garbage collection. This used to be a binary-compat change; Serialized Error: { code: 'ERR_INVALID_STATE' }`
   即某个用例或被测代码没有显式 `close()`，24 下只是警告，26 下 vitest 直接判失败。
3. **目录联接/符号链接判定变了** —— `application` 步骤：`packages/application/src/deletion/trash.escape.test.ts` 的 `rejects the directory-symlink …` 失败，报 `Error: Linked path refused: C:\…\Temp\vessel-trash-escape-JzvIiq\trash`。守卫本身在拒，但用例期望的拒绝点/形态与 26 下建出来的链接不匹配。

**其余全绿**（同一次 26 复跑）：`shared+core` 279、`llm` 336、`behavior+context` 164、`runtime+memory` 205、`telemetry+engine` 223、`cli` 783、`local-server` 320、`benchmarks` 541、`root-index` 14、`web-root` 543、三处 tsc exit 0、离线 conformance 25/25 $0。所以不是「26 跑不起来」，是三处语义变化。

## 2. Goal

在**不削弱红绿门禁强度**的前提下，让全量门禁在 Node 26 上恢复 17/17：

1. 红相判定：查清 `RedGreenGate` 是如何确认「目标断言确实失败」的（子进程退出码 / 断言文本 / 身份哈希），说明 26 上哪一环变了，并让判定在 26 上重新成立。**不许**把「红相失败」放宽成 skip 或只看退出码不为 0——那正是这条门禁要防的假绿。
2. FileHandle：定位未显式关闭的句柄（`skills+agents` 范围），补 `close()`/`using`，让 unhandled error 消失；不接受用 vitest 配置忽略该错误。
3. `trash.escape` 的目录联接用例：查清 26 下 `fs.symlink(type: 'junction'|'dir')` 与 `realpath/lstat` 的实际差异，修正夹具或守卫的判定点；守卫只能更严，不能更松（这是删除逃逸防护）。

## 3. Acceptance

- A1 `pwsh -NoProfile -File scripts/gate-batched.ps1` 在 Node 26.13.0 上 **17/17 exit 0**，附日志目录；根与 web 的 passed 数字不少于 24 下的基线（根 335 文件 / 3,713 + 8，web 61 / 543）。
- A2 三处红各自的根因写成一句话 + 对应 diff 位置（`path:line`），不接受「升级后就好了」。
- A3 红绿门禁的强度有反证：至少一条用例证明「目标断言没失败时门禁仍然拒绝」（若原有用例已覆盖，指出来即可）。
- A4 `trash.escape` 的拒绝理由仍指向链接逃逸，不允许为了变绿把「Linked path refused」换成通配或直接把用例改成期望成功。
- A5 不改 `apps/web` 行为、不升级依赖版本（只改代码/夹具）。若确实需要升某个依赖，先在卡里单列并给理由。

## 4. Blast Radius

`packages/policy/src/**`（红绿门禁）、`packages/application/src/redGreenCompletion*`、`v23Integration*`、`packages/application/src/deletion/**`、`packages/skills/**` 与 `packages/agents/**`（FileHandle 泄漏点），加对应测试。**禁止**改 `apps/web`、禁止放宽门禁判据、禁止改 vitest 配置吞错误。

## 5. Result

待执行。

已派单：`tasks/prompts/codex-handoff-2026-10-30-node26.md`（2026-10-30，Codex 应用，`gpt-6.1-sol` / medium）。派单里把三处红的**判定点**都指到了行：`packages/policy/src/gates/redGreenGate.ts:36` 的 `targetOnlyFailure()` 五条正则、`packages/agents/src/team/team-runtime.test.ts` 泄漏的 `sub_*/session.jsonl` 句柄、`trash.escape` 的目录联接判定；并写明「判据只能跟住 26 的新格式，不许放宽语义」。

## 6. 运行时的两种走法（记录事实，供拍板）

- **走法 A（最省）**：回到 Node 24 —— `nvm install 24.14.0` + `nvm use 24.14.0`，本机现在只装了 26.13.0，需要联网下载；代码零改动，门禁回复全绿。代价是机器上又多一个运行时版本。
- **走法 B**：留在 26，按本卡修三处。代价是要动 `packages/policy` 与 `packages/application` 的门禁代码，属**安全相关改动**，必须独立复核（红绿门禁与删除逃逸守卫都是防线）。

## 7. 环境对齐（2026-10-30 实测；哪些该动、哪些别动）

| 位置 | 现状 | 处置 |
|---|---|---|
| `package.json` `engines` | `node: ">=20"` | **不动**：这是对外契约（也覆盖 CI 的 22），不是本机版本钉 |
| 仓库根 `.nvmrc` | 之前没有。2026-10-30 我试过写入 `24.14.0`，**当场撤销**（原因见下） | 等 24 真装上再落：`nvm pin 24.14.0`（nvm v2 自带该命令） |
| `AGENTS.md` 技术栈行 | 原来写死「本机 Node v24.14.0」 | 已改为「≥20 + 26 三红见卡 367 + `.nvmrc` 的 shim 陷阱」 |
| `HANDOFF.md §0 全量门禁` | 原来只有 24 的全绿 | 已改：26 上 3 步红、24 上 17/17 |
| `.github/workflows/ci.yml` | `node-version: [22]` 单值 | **不动**：仓库已转纯本地开发、Actions 整体停用（见 HANDOFF「远端 GitHub 状态」）。若哪天恢复 CI，再把 matrix 与目标版本对齐 |
| `docs/DESIGN-DECISIONS.md`、`PROJECT-BRIEF.md` | 写「Node ≥20」 | 不动，仍然成立 |
| `REVIEW-REPORT-V0x.md`、旧 HANDOFF 段 | 历史报告写 v24 | **不动**：历史快照 |
| 本机 nvm | v2.0.1，只装了 26.13.0（default） | 待办：装 24；见下 |

**为什么 `.nvmrc` 被撤掉了**：nvm v2 的 shim（`.nodejs` → `.shim`）会读 `.nvmrc` 并**强制**用它。写入 `24.14.0` 之后，仓库里任何 `node` 调用立刻变成 `Node.js v24.14.0 is not installed or cannot be found`——连 pre-commit hook 和 `vitest` 都跑不了。钉一个没装的版本等于把工具链锁死，所以先不留文件。

**为什么装不上 24**：`nvm install 24.14.0` 报 `failed to fetch version manifests from any server (budget 3s)`，官方源与 npmmirror 都超时；但同一时刻 `curl https://nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip` 是 **HTTP 200、36,217,529 字节**可取的。也就是说网络通、**nvm v2.0.1 的 index.tab 预算只有 3 秒**，打不过 Bitz Net 代理的握手延迟（约 2 秒）。`nvm config list` / `config docs` 都没有超时项，改 `node_mirror` 也救不了（已改回默认 `https://nodejs.org/dist`）。

**三条可行路径（任选一条）**：

1. 重试 `nvm install 24.14.0`（代理偶快时能过 3 秒预算）。
2. 手工铺 portable 副本：`curl -L -o %TEMP%\n24.zip https://nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip` → 解到 `%LOCALAPPDATA%\vessel-runtime\node-v24.14.0-win-x64` → 只在跑门禁的终端里把该目录前置 PATH（不动 nvm 状态，删目录即回滚）。
3. 留在 26，按本卡 §2 修三处（改动落在红绿门禁与删除逃逸守卫上，必须独立复核）。

## 8. Codex 执行交证（2026-10-30，未代签收）

执行单：`tasks/prompts/codex-handoff-2026-10-30-node26.md`。主线程执行，未启动子代理或外部 agent，未 commit/push；卡首行状态与 `tasks/README.md` 未动。

报告与三处修前原始输出、反例、完整门禁日志：[`evidence/sessions/2026-10-30-node26/report.md`](../evidence/sessions/2026-10-30-node26/report.md)。源码产物 SHA-256：同目录 `source-hashes.json`；结构化验收：`verification.json`。

- 红相：真实子进程 stderr 只有首行前缀检查不符（26 为 `node:internal/assert/utils:146`），其它四项均符合；只增加该精确格式，保留目标归因、单断言、无其它错误、版本尾行等判据。
- FileHandle：确认是已有的产品资源生命周期缺陷，`SubagentManager` 的成功路径 close 在 `runTurn` 抛错时被绕过；按本卡已明确授权的异常路径清理要求，改为 finally 关闭，既有错误结果语义不变。新增真实句柄断言，成功/异常返回后 fd=-1、租约不存在、会话日志仍保留。未扩展产品语义修复。
- trash：实测原生 dir symlink 为 EPERM、junction 可建且被拒；另捕获两目录 bigint inode 不同但 Number 相同，证明全局 inode mock 会误标祖先。只修测试 mock 的路径身份，精确 `Linked path refused: <directory-link>` 与磁盘不变断言保留，产品删除守卫零改动。

最终自验（Node v26.13.0，最后一次源码编辑后）：聚焦命令 exit 0，71 文件 / 691 passed + 3 skipped；全量 `scripts/gate-batched.ps1` **17/17 exit 0**，根 **335 文件 / 3,725 passed + 8 skipped**，web **61 / 543**，三处 tsc exit 0、离线 conformance **25/25，$0**。原始日志 `%TEMP%/vessel-gate-f4f6e2f3` 已完整存入证据目录。`git diff --check` exit 0。未改 Node/engines/.nvmrc/CI/Web/依赖/vitest 配置，未设 NODE_OPTIONS。

未运行独立复核（执行单明确禁止子代理）；本段仅交执行证据，协调者仍须独立复核后签收。反例包括：目标不失败、混合无关错误、第二个断言、缺目标理由、未知内部前缀、缺版本尾行、尾随诊断/stdout 污染、伪造 proof、基线/测试变更、回归失败、链接逃逸；完整用例名见报告末段。

自查：未放宽任何门禁判据。

## 9. 协调者验收（2026-10-30，Node 26.13.0 独立复跑）

采信，三处判据我逐条核过 diff，并自己复跑了聚焦与全量。

**全量（我自己跑的，不是它的数字）**：`pwsh -NoProfile -File scripts/gate-batched.ps1` **17/17 exit 0**——根 **335 文件 / 3,725 passed + 8 skipped**、web **61 / 543**、三处 tsc exit 0、离线 conformance **25/25、$0**，日志 `%TEMP%/vessel-gate-2ffd7094`。聚焦面另跑一次 `packages/policy packages/application packages/skills packages/agents`：**71 文件 / 691 passed + 3 skipped，exit 0**。`git diff --check` exit 0；`package.json` / `package-lock.json` / `vitest.config.ts` / `apps/web` 零改动。数字对得上基线：根 3,713 + 12（新参数化 10 + 句柄 2）= 3,725。

**逐项核对**：

1. **红相首行**——我自己在本机跑了一场未捕获断言，原始 stderr 第一行确实是 `node:internal/assert/utils:146`，与它报告里的一致。改动只是把首行判定从 `^node:assert[:/]` 换成「老格式 或 `node:internal/assert/utils:<n>` + 换行」，另外四条（版本尾行、单个 `AssertionError`、无其它 `Error`、基线理由齐全）一字未动。**没有放宽**：新增的 10 条参数化用例里只有「老格式」「26 格式」两条 accepted，其余八条（未知内部前缀、缺行号、第二个断言、无关错误、缺目标理由、缺版本尾行、尾随诊断、stdout 污染）全部要求拒绝。
2. **FileHandle**——它把 `SubagentManager.delegate()` 里「只有成功返回才 `close()`」改成整块 `try { … } finally { await runtime.close() }`。这是**产品侧真实泄漏**，26 只是把 GC 关闭从警告变成硬错把它照出来了；改动是收尾位置，不碰结果契约、事件词汇与重试策略。新增用例在成功与抛错两条路径上断言 `fd === -1`、`.lease` 不存在、`session.jsonl` 仍保留——是真的回归护栏，不是把断言改软。
3. **trash 链接用例**——根因在测试夹具而不在守卫：旧 mock 重写 `Stats.prototype.isSymbolicLink` 并按 `ino` 匹配，而两个不同目录的 Number inode（`…33107` / `…33108`）在 2^53 以上会相等，于是 ancestors 也被误标成链接。它改成包装 `fs.lstatSync`、只对目标路径注入谓词。我另外查了产品侧：`packages/application/src/deletion/trash.ts` 只用 `isSymbolicLink()`，**根本不比较 inode**，所以没有遗留精度风险；拒绝理由（精确到 `Linked path refused: <directory-link>`）与「磁盘/列表不变」断言都还在。

**两处我在验收记录里留档、但不阻塞**：

- `finally { await runtime.close() }` 在**错误路径**上若 `close()` 自己抛错，会顶掉原始错误，外层 catch 拿到的就是 close 的错。当前没有用例覆盖这一点，未来可以做「主错误优先、close 失败只记诊断」的加固。
- 首行正则的两个分支不对称：新分支要求行号后紧跟换行，老分支不要求。效果是**更严**（无换行的形态会 fail-closed），不是漏洞，但读代码的人容易以为是笔误，值得加一行注释。

**边界**：Node 24 未复测（本机只有 26.13.0，`nvm install` 受 3 秒预算限制装不上）。三处改动按构造都是跨版本中性的——首行判定接受两种格式、句柄关闭与版本无关、夹具按路径匹配。真要在 24 上跑，需要在能装 24 的机器上补一次。
