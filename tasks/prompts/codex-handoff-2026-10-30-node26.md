# Codex 单：卡 367 —— 让全量门禁在 Node 26 上回到 17/17（2026-10-30）

**在 Codex 应用里跑**。模型 `gpt-6.1-sol` / `medium`，Fast 关，不用 Ultra；一轮失败后再升 `xhigh`，别预防性升档。

现状：HEAD 以 `git log -1` 为准，工作树干净。**本机 Node 已是 `v26.13.0`（nvm v2 的 shim，仓库里 `node --version` 直接给 26）**。先把卡读一遍：`tasks/367-node26-compat.md`（含 §1 失败清单、§2 Goal、§3 Acceptance、§7 环境对齐）。

**这一单的目的不是「让红变绿」，是让门禁在 26 上重新具备原来的判别力。** 三处都是防线（红绿门禁 / 删除逃逸守卫 / 会话写入），任何「放宽判据、吞掉错误、跳过用例」的做法都算失败交付。

纪律：主线程、禁止子代理；不 commit / 不 push；不改卡首行、只在卡 367 末尾追加；不改 `apps/web`；不升依赖（确需升级先单列理由）；不改 vitest 配置来吞错误；不设 `NODE_OPTIONS` / `--no-warnings` 之类的东西压掉告警。

---

## 一、红绿门禁判不出「红相」（5 个用例）

失败：`packages/policy/tests/redGreenGate.test.ts`（3）、`packages/application/src/v23Integration.test.ts`（1）、`packages/application/src/redGreenCompletion.test.ts`（1）。典型报错 `Red must fail on the configured target assertion …: expected false to be true`。

已经定位到判定点：`packages/policy/src/gates/redGreenGate.ts:36` 的 `targetOnlyFailure()`，它用正则从子进程 **stderr** 里确认「只有一个 Node 断言失败」：

```ts
/^node:assert[:/]/                                  // stderr 必须以 node:assert: 开头
/\nNode\.js v\d+\.\d+\.\d+$/                         // 结尾是 Node.js vX.Y.Z
(output.match(/^AssertionError(?: \[ERR_ASSERTION\])?:/gm) ?? []).length === 1
!/^(?!AssertionError)[A-Za-z]*Error(?: \[[^\]]+\])?:/m.test(output)
config.allowBaselineFailureReasons.every(r => output.includes(r))
```

做法：**先在 26 上抓一份真实失败子进程的原始 stderr**（用测试夹具里同一个脚本自己 spawn 一次，或者把 `team`/gate 用例里的 argv 原样跑一遍），把它与上面五条逐条对照，看 26 改了哪一条（首行前缀？结尾版本行后多了内容？多出一条 `Error [ERR_…]:`？`AssertionError` 出现两次？）。**先把差异写进报告，再改代码。**

改的时候只能让判定跟住 26 的新格式，**不许**放宽语义：仍然必须证明「只有一个断言失败、且归因于目标断言、没有别的错误、基线失败理由齐全」。有歧义就 fail-closed（现在的注释写着 `ambiguous runner reports fail closed`，保持这个立场）。

## 二、`FileHandle` 在 GC 时被关闭，26 从警告变硬错

`skills+agents` 步骤 exit 1，但 194 个测试全过；vitest 报：

```
Uncaught Exception: Error: A FileHandle object was closed during garbage collection.
File descriptor: 5 (\\?\C:\Users\…\Temp\cah-team-LrThuu\.harness\sessions\sub_1793348423373_7d41a08a\session.jsonl)
来源：packages/agents/src/team/team-runtime.test.ts（最后跑到的用例是「058 异常路径：reviewer 产出坏 JSON」）
```

也就是说：**子代理会话文件的写入路径拿到了 FileHandle 却没有显式关闭**（在异常路径上尤其容易漏）。做法：

1. 顺着 `sub_*/session.jsonl` 这条会话写入链找 `fs.promises.open` / `createWriteStream` / `FileHandle` 使用者（注意卡 353 刚改过 `Session` 的 append/lease 逻辑）。
2. 补齐 `close()`（`try/finally` 或 `await using`），异常路径也必须关。
3. 复跑 `node node_modules/vitest/vitest.mjs run packages/agents` 与 `packages/skills`，要求 **exit 0 且无 unhandled error**。

不许在 vitest 配置里忽略 unhandled error，也不许把用例改成不同步写。

## 三、`trash.escape` 的目录联接判定

失败：`packages/application/src/deletion/trash.escape.test.ts` → `rejects the directory-symlink …`，报 `Error: Linked path refused: C:\…\Temp\vessel-trash-escape-JzvIiq\trash`。

守卫在拒，但用例期望的拒绝点/形态变了。做法：在 26 上实测 `fs.symlink(target, path, 'dir'|'junction')`、`lstat`、`realpath` 的实际返回值，与用例假设对齐；修夹具或修守卫的**判定点**都行，但**拒绝必须保留**——不许把「Linked path refused」改成通配，也不许把用例改成期望成功。

---

## 自验（必须贴命令与结果）

```
node node_modules/vitest/vitest.mjs run packages/policy packages/application packages/skills packages/agents
pwsh -NoProfile -File scripts/gate-batched.ps1
```

- 第一条必须 **exit 0**（这是三处红的聚焦面）。
- 第二条是**全量 17 步**，允许跑（本卡的目的就是它），要求 **17/17 exit 0**；根与 web 的 passed 数字不得低于 24 下的基线（根 335 文件 / 3,713 + 8 skipped，web 61 / 543）。
- 若某一步因为**与本卡无关**的环境原因红（例如网络/端口），单独写清，不要顺手改别的。

## 不做

- 不装/不切 Node 版本（本机只装了 26.13.0；`nvm install 24` 有已知的 3 秒预算问题，别去折腾 nvm 配置）。
- 不写 `.nvmrc`（nvm v2 的 shim 认它，钉未安装的版本会让仓库里 `node` 直接报错——2026-10-30 已实测并回滚）。
- 不改 `engines`、不动 CI（Actions 已停用）。
- 不动 `apps/web`、不动 `packages/core` 的公共契约（除非某个泄漏点确实在 core，那就只在报告里注明并最小改动）。

## 交付

- 新目录 `evidence/sessions/2026-10-30-node26/`：`report.md`、三处红各自的「26 抓到的原始输出 → 改了什么 → 为什么判据没变松」、聚焦与全量的命令输出、失败/被拒命令原文。
- 表格式小结：三处红 → 根因（一行）→ 改动文件（`path:line`）→ 复跑结果。
- 只追加到 `tasks/367-node26-compat.md` 末尾；**不改首行状态**、不改 `tasks/README.md`（协调者收口时改）。
- 报告末尾给一句「未放宽任何门禁判据」的自查结论，并列出你能想到的反例用例（若已存在就指出名字）。

## 停止条件

三处互不依赖，一处连续两次失败就停下写清实测值、继续另外两处。若发现某处其实是**产品缺陷**（不是 26 兼容问题），停下来在卡里登记，不要在兼容补丁里顺手改产品语义。
