# 任务卡 367: Node 26 适配（红绿门禁三连 + FileHandle GC 关闭变硬错 + 目录联接判定）

- Status: 待执行（2026-10-30，Node 24 → 26.13.0 后全量门禁首次复跑暴露）
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
