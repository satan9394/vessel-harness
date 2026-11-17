# Codex 任务书：修掉 CodeQL 剩余 7 条告警（卡 371）

> 这份文件是**自包含**的：直接把它交给 Codex 就能开工，不需要再读仓库里的其它文档。
> 仓库：`E:\Code_file\Projects\Vessel_Harness`（TypeScript monorepo，Node 26 / npm 12）。
> 方案已定稿，**不要重新讨论方向**，照做即可。

## 0. 前置与纪律

- 开工前：`git log -1`（HEAD 以实际为准）、`git status --porcelain` 应为空、`node -v` 应为 `v26.13.0`。
- 主线程执行，**禁止子代理**；**不 commit / 不 push**；不新建任务卡；不改任何卡的首行状态与 `tasks/README.md`。
- 只允许改下面 §2–§3 点名的文件与其测试；**`packages/tools/src/git/Worktree.ts` 一行都不要动**（它的 argv 用法本来就对，问题在共享的 spawn 出口）。
- 不动 `packages/tools/src/mcp/McpClient.ts` 的 Windows shim 白名单、不动 `apps/web`、不动 CI 配置。
- 证据只写 `evidence/sessions/2026-10-31-codeql-seven/`。

## 1. 背景：7 条告警分别是什么

CodeQL 首次全量扫描在 `main` 上开出 9 条；其中 2 条已由维护者判定误报并 dismiss（参数指纹哈希、回环服务的诊断 JSON）。剩下 7 条要修，实测数据来自调查阶段（复现用同样形态的极端输入即可）：

| 告警 | 规则 | 位置 | 现状实测 |
|---|---|---|---|
| #15 / #16 | `js/shell-command-constructed-from-input`（error） | `packages/tools/src/git/Worktree.ts:62`（同一位置两条） | 该函数全程 argv，shell 从未开启；但 `runCommand` 的 `shell: opts.shell ?? false` 让判定认为「可能开 shell」 |
| #14 | `js/shell-command-injection-from-environment` | `packages/runtime/src/process/Process.ts:62` | 程序名来自 `%SystemRoot%\…\powershell.exe` / `process.execPath`；今天无调用方同时传 `shell:true` |
| #18 | `js/polynomial-redos` | `apps/cli/src/providers/providerFactory.ts:136` | `/\/+$/`：1000/2000/4000 个斜杠 → 0.65 / 2.18 / 8.56 ms |
| #19 | `js/polynomial-redos` | `apps/cli/src/ui/TerminalStatusLine.ts:3` | `("\x1b]")×n` → 1.35 / 5.52 / 19.95 ms；**另有 bug**：OSC 之后正文被吞 |
| #20 | `js/polynomial-redos` | `packages/memory/src/reflection/autonomousReflection.ts:36` | `"core"×8000` → 126.6 ms（`.*` 无界） |
| #21 | `js/polynomial-redos` | `packages/shared/src/toolPins.ts:8` | 8KB 数字 → 32 ms（每个起点重扫数字串） |

## 2. 第一批（error 级，必须先做完再碰第二批）

### 2.1 `packages/runtime/src/process/Process.ts`：拆成两个 spawn 点

现状：`runCommand(command, args, opts)` 内部 `spawn(command, args, { …, shell: opts.shell ?? false })`。

改成三个函数（原有 74–148 行的全部逻辑——`onSpawn`、stdin 写入、超时、abort、管道收集、close 解析——**一行不改地整段搬进 `supervise`**）：

```ts
/**
 * Two spawn shapes, deliberately separate, because only one hands text to a shell:
 *  - runCommand(argv): no `shell` option at all, so a path with spaces stays one word;
 *  - runShellCommand(commandLine): the single intentional shell boundary.
 */
export function runCommand(command: string, args: string[], opts: SpawnOptions): Promise<SpawnResult> {
  if (opts.shell) return Promise.reject(new TypeError('runCommand: argv is not shell-interpreted; use runShellCommand(commandLine)'));
  return supervise(() => spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    windowsHide: true,
    detached: opts.processGroup === true && process.platform !== 'win32',
  }), opts, command);
}

export function runShellCommand(command: string, opts: SpawnOptions): Promise<SpawnResult> {
  return supervise(() => spawn(command, [], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    windowsHide: true,
    shell: true,
    detached: opts.processGroup === true && process.platform !== 'win32',
  }), opts, command);
}

function supervise(spawnChild: () => ChildProcess, opts: SpawnOptions, command: string): Promise<SpawnResult> {
  /* 原 74–148 行照搬：new Promise 执行器仍同步执行，spawn 与 onSpawn 的先后顺序不变 */
}
```

要点：

- `runCommand` 的 spawn 选项里**完全不出现 `shell` 键**。写 `shell: false` 骗不过 CodeQL 的 `executesArrayAsShell`，也没解决契约问题。
- `SpawnOptions.shell` 的注释改成「只由 `Sandbox.run` 的命令行模式使用；`runCommand` 会拒绝」。

### 2.2 `packages/runtime/src/sandbox/Sandbox.ts`：分派 + 空 argv 校验

```ts
if (opts.shell === true && args.length > 0) {
  throw new TypeError('Sandbox.run: shell mode takes a whole command line, not an argv array');
}
const result = opts.shell === true
  ? await runShellCommand(command, base)
  : await runCommand(command, args, base);
```

`base` 就是现在传给 `runCommand` 的那个对象，字段不变。

### 2.3 `benchmarks/runners/src/asserts.ts:269`：改调 `runShellCommand(cmd, { … })`

那里本来就是整条命令行、`args` 为 `[]`，语义不变。

### 2.4 新增用例

在 `packages/runtime/src/process` 的测试里断言：`runCommand(process.execPath, ['-e','0'], { …, shell: true })` **reject**，错误信息包含 `runShellCommand`。

### 2.5 第一批验证

```powershell
node node_modules/vitest/vitest.mjs run packages/runtime/src/process
node node_modules/vitest/vitest.mjs run packages/runtime/src/sandbox
node node_modules/vitest/vitest.mjs run packages/tools/src/git/worktree.test.ts
node node_modules/vitest/vitest.mjs run packages/tools/src/tools.test.ts
npx tsc -b tsconfig.json
```

## 3. 第二批（四条 ReDoS，可合成一次提交）

### 3.1 `apps/cli/src/providers/providerFactory.ts:136`（#18）

```ts
/** `/\/+$/` 在「长斜杠段 + 后面还有字符」时二次方；这里一次反向扫描。 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}
```

第 136 行改为 `const key = withoutTrailingSlashes(url);`。
等价性自测：`"https://"→"https:"`、`""→""`、`"https://a/v1//"→"https://a/v1"`。

### 3.2 `apps/cli/src/ui/TerminalStatusLine.ts:3`（#19）

```ts
return value.replace(/\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|.)/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
```

只把 `[^\x07]*` 改成 `[^\x07\x1b]*`（排除 ESC 后，每个 `ESC ]` 起点最多扫到下一个 ESC 就失败，整体线性）。

**必须补一条测试**（这是修 bug）：`terminalText('\x1b]8;;https://e.com\x1b\\link\x1b]8;;\x1b\\')` 等于 `'link'`（现状返回空串——OSC 把正文一起吞了）。既有 `statusLine.test.ts:52` 的期望（`'bad'`）必须保持不变。

### 3.3 `packages/memory/src/reflection/autonomousReflection.ts:36`（#20）

`/thin.?core|core.*import|dependenc/i` → `/thin.?core|core[^\n\r\u2028\u2029]{0,200}import|dependenc/i`

`[^\n\r\u2028\u2029]` 与 `.` 的字符集完全相同（JS 的 `.` 正好只排除这四个行终止符），**只**多了 200 字符窗口；依据是这条启发式只判「同一句里同时提到 core 与 import」，真实评审句式在 40 字符内。

若重扫仍判 ReDoS，改用手写单次扫描（语义严格等价）：

```ts
function mentionsCoreImport(text: string): boolean {
  for (const raw of text.split(/[\n\r\u2028\u2029]/)) {
    const s = raw.toLowerCase();
    const at = s.indexOf('core');
    if (at >= 0 && s.indexOf('import', at + 4) >= 0) return true;
  }
  return false;
}
```

### 3.4 `packages/shared/src/toolPins.ts:8`（#21）

```ts
/** 版本横幅是 major.minor.patch；有界量词让整串扫描保持线性。 */
const VERSION_PATTERN = /(\d{1,9})\.(\d{1,9})\.(\d{1,9})/;
export function parseToolVersion(raw: string): string | null {
  return VERSION_PATTERN.exec(raw)?.[0] ?? null;
}
```

既有用例（`'codex-cli 0.164.0'`、`'opencode 2.1.4'`、`'v2.1.4'`、`'garbage'→null`）必须仍通过。

### 3.5 第二批验证

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/providerFactory.failover.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/ui
node node_modules/vitest/vitest.mjs run packages/memory
node node_modules/vitest/vitest.mjs run packages/shared/src/toolPins.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/commands/toolPins.test.ts
npx tsc -b tsconfig.json
```

## 4. 收尾

```powershell
pwsh -NoProfile -File scripts/gate-batched.ps1
```

要求 **17/17 exit 0**。

## 5. 明确不要做的事

- 不改 `packages/tools/src/git/Worktree.ts`；不给 `runCommand` 保留 `shell` 选项；不用 `JSON.stringify` 之类「假转义」代替结构性修复。
- 不为了消警把正则换成 `includes`/`split` 丢掉边界语义；不在测试里 skip 用例。
- 不动 Dependabot、不动 CI/ruleset、不 commit/push、不改 GitHub 上的告警状态（协调者来做）。

## 6. 交付

- `evidence/sessions/2026-10-31-codeql-seven/report.md`：逐条「改前 → 改后 → 为什么语义没变」，附关键命令输出；四条 ReDoS 给出修复前后的极端输入实测（基线见 §1 表格）。
- 只追加到 `tasks/371-codeql-seven-remediation.md` 末尾；不改首行状态、不改 `tasks/README.md`。
- 报告末尾一句自查：**未放宽任何判据、未跳过任何用例**；若新的 spawn 点仍被 CodeQL 标记，说明它是「有意为之的 shell 边界」并给一段 dismiss 评论草稿。

## 7. 完成时给我

1. 改动文件清单（与 §2–§3 的点名文件对照）。
2. 每条告警一行定性（修好了 / 仍会被标记 + 原因）。
3. 聚焦测试与全量门禁的 exit code 与数字。
4. 有没有出现新的 CodeQL 告警点（有就给 dismiss 草稿）。
