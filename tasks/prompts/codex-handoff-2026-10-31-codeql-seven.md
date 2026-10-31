# Codex 单：卡 371 —— 修掉 CodeQL 剩余 7 条（2026-10-31）

现状：HEAD 以 `git log -1` 为准，工作树干净；Node `v26.13.0`、npm `12.2.1`；全量门禁最近一次 17/17 exit 0。**方案已定稿，不要重新讨论方向**，按下面照做即可。卡在 `tasks/371-codeql-seven-remediation.md`（§1 是决策表，§3 是验收），本单只补代码与命令。

纪律：主线程、禁止子代理；**不 commit / 不 push**、不新建卡、不改卡首行、只在本卡末尾追加；不改 `apps/web`、不改 CI、不动 `packages/tools/src/git/Worktree.ts`、不动 `McpClient` 的 Windows shim 白名单；证据只写 `evidence/sessions/2026-10-31-codeql-seven/`。

---

## 第一批（error 级，必须先做完再碰第二批）

### 1. `packages/runtime/src/process/Process.ts`：把「argv」与「整条命令行」拆成两个 spawn 点

现状：`runCommand(command, args, opts)` 里 `spawn(command, args, { …, shell: opts.shell ?? false })`。CodeQL 因为「shell 可能为 true」把 argv 当成会被拼进命令行（alert #15/#16 与 #14 都挂在这里）。

改成：

```ts
/**
 * Two spawn shapes, deliberately separate, because only one hands text to a shell:
 *  - runCommand(argv) 满足数组契约：不设 `shell`，路径里的空格不会被拆词；
 *  - runShellCommand(commandLine) 是唯一有意为之的 shell 边界。
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

function supervise(spawnChild: () => ChildProcess, opts: SpawnOptions, command: string): Promise<SpawnResult> { /* 原有 74–148 行整段照搬 */ }
```

要点：
- `runCommand` 的 spawn 选项里**完全不出现 `shell` 键**（不是 `shell: false`）——写 `false` 骗不过 CodeQL 的 `executesArrayAsShell`，也不解决契约问题。
- 其余逻辑（`onSpawn`、stdin 写入、超时、abort、管道收集、close 解析）**一行都不要改**，整段搬进 `supervise`。`new Promise` 执行器仍同步执行，`spawn` 与 `onSpawn` 的先后顺序不变。
- `SpawnOptions.shell` 的注释改成「只由 `Sandbox.run` 的命令行模式使用；`runCommand` 会拒绝」。

### 2. `packages/runtime/src/sandbox/Sandbox.ts`：分派 + 空 argv 校验

```ts
if (opts.shell === true && args.length > 0) {
  throw new TypeError('Sandbox.run: shell mode takes a whole command line, not an argv array');
}
const result = opts.shell === true
  ? await runShellCommand(command, base)
  : await runCommand(command, args, base);
```
（`base` 就是现在传给 `runCommand` 的那个对象，字段不变。）

### 3. `benchmarks/runners/src/asserts.ts:269`：改调 `runShellCommand(cmd, { … })`

那里本来就是整条命令行、`args` 是 `[]`，语义不变。

### 4. 新增一条用例

在 `packages/runtime/src/process` 的测试里断言：`runCommand(process.execPath, ['-e','0'], { …, shell: true })` **reject**，错误信息包含 `runShellCommand`。

验证：

```powershell
node node_modules/vitest/vitest.mjs run packages/runtime/src/process
node node_modules/vitest/vitest.mjs run packages/runtime/src/sandbox
node node_modules/vitest/vitest.mjs run packages/tools/src/git/worktree.test.ts
node node_modules/vitest/vitest.mjs run packages/tools/src/tools.test.ts
npx tsc -b tsconfig.json
```

## 第二批（四条 ReDoS，可合成一次提交）

### 5. `apps/cli/src/providers/providerFactory.ts:136`（alert #18）

```ts
/** `/\/+$/` 在「长斜杠段 + 后面还有字符」时二次方；这里一次反向扫描。 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}
```
第 136 行改成 `const key = withoutTrailingSlashes(url);`。等价性自测：`"https://"→"https:"`、`""→""`、`"https://a/v1//"→"https://a/v1"`。

### 6. `apps/cli/src/ui/TerminalStatusLine.ts:3`（alert #19）

OSC 分支把 `[^\x07]*` 改成 `[^\x07\x1b]*`：

```ts
return value.replace(/\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|.)/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
```

**同时补一条测试**（这是修 bug，不是改语义）：`terminalText('\x1b]8;;https://e.com\x1b\\link\x1b]8;;\x1b\\')` 必须等于 `'link'`（现状是空串——OSC 把正文一起吞了）。既有 `statusLine.test.ts:52` 的期望（`'bad'`）必须保持不变。

### 7. `packages/memory/src/reflection/autonomousReflection.ts:36`（alert #20）

`/thin.?core|core.*import|dependenc/i` → `/thin.?core|core[^\n\r\u2028\u2029]{0,200}import|dependenc/i`。

`[^\n\r\u2028\u2029]` 与 `.` 的字符集完全相同，**只**多了 200 字符窗口；依据是这条启发式只判「同一句里同时提到 core 与 import」，真实评审句式在 40 字符内。

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

### 8. `packages/shared/src/toolPins.ts:8`（alert #21）

```ts
/** 版本横幅是 major.minor.patch；有界量词让整串扫描保持线性。 */
const VERSION_PATTERN = /(\d{1,9})\.(\d{1,9})\.(\d{1,9})/;
export function parseToolVersion(raw: string): string | null {
  return VERSION_PATTERN.exec(raw)?.[0] ?? null;
}
```
既有用例（`'codex-cli 0.164.0'`、`'opencode 2.1.4'`、`'v2.1.4'`、`'garbage'→null`）必须仍通过。

验证：

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/providers/providerFactory.failover.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/ui
node node_modules/vitest/vitest.mjs run packages/memory
node node_modules/vitest/vitest.mjs run packages/shared/src/toolPins.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/commands/toolPins.test.ts
npx tsc -b tsconfig.json
```

## 收尾

```powershell
pwsh -NoProfile -File scripts/gate-batched.ps1
```

要求 **17/17 exit 0**（Node 26）。

## 不做

- 不改 `packages/tools/src/git/Worktree.ts`（本卡刻意一行不改：它的 argv 用法本来就是对的，问题在共享的 spawn 出口）。
- 不给 `runCommand` 保留 `shell` 选项、不在测试里 skip、不把正则换成 `includes`/`split` 丢掉边界语义。
- 不动 Dependabot、不动 CI/ruleset、不 commit/push。

## 交付

- `evidence/sessions/2026-10-31-codeql-seven/report.md`：逐条「改前 → 改后 → 为什么语义没变」，附关键验证命令输出；ReDoS 四条给出修复前后的极端输入实测（参考：`#18` 4000 斜杠 8.56ms、`#19` 4000 个 `\x1b]` 19.95ms、`#20` `"core"×8000` 126.6ms、`#21` 8KB 数字 32ms）。
- 只追加到卡 371 末尾；不改首行状态与 `tasks/README.md`。
- 报告末尾一句自查：**未放宽任何判据、未跳过任何用例**；若某个新 spawn 点仍被 CodeQL 标记，说明它是「有意为之的 shell 边界」并给出 dismiss 评论草稿（协调者会去 dismiss，不要自己动 GitHub）。
