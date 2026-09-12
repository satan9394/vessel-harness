import * as yaml from 'js-yaml';
import type {
  PolicyArtifacts,
  PolicyDeclaration,
  PolicyRule,
  ProfileMode,
  VerdictAction,
} from '@vessel/shared';
import { globMatch } from './globmatch.js';
const KNOWN_TOP_KEYS = new Set([
  'version', 'profile', 'approval', 'filesystem', 'shell', 'network', 'git', 'tools', 'audit', 'session', 'guidance',
]);

const SHELL_DENY_SETS: Record<string, RegExp[]> = {
  'destructive-delete': [
    /^(rm|rmdir)\s+-[a-z]*r/i,
    /^del\s+\/s/i,
    /^rmdir\s+\/s/i,
    /^Remove-Item\s+-Recurse/i,
  ],
  'disk-format': [/^mkfs/i, /^format\s/i, /^diskpart/i],
  'partition-write': [/^fdisk/i, /^parted/i, /^gdisk/i],
};

/**
 * Compile a `Shell(...)` / `Bash(...)` command matcher into a predicate
 * (POLICY-SPEC §3.3 — the `*` shape is defined as "命令前缀").
 *
 * - No `*` → legacy semantics kept verbatim: literal *prefix* match
 *   (`startsWith`), so `Bash(rm -rf ./node_modules)` behaves exactly as before.
 * - With `*` → anchored glob: `*` becomes `.*` (spaces included, so a trailing
 *   `*` means "any suffix"), every other character is escaped literally, and
 *   the whole pattern is anchored. `Shell(git push --force*)` therefore matches
 *   `git push --force origin main` — the pre-fix literal `startsWith` never did.
 */
function shellCommandPredicate(
  prefix: string,
): (call: { toolName: string; arguments: Record<string, unknown> }) => boolean {
  const matches = prefix.includes('*')
    ? (() => {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
        const re = new RegExp(`^${escaped}$`);
        return (cmd: string) => re.test(cmd);
      })()
    : (cmd: string) => cmd.startsWith(prefix);
  return (call) => call.toolName === 'Shell' && matches(String(call.arguments.command ?? '').trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// C-3 修复 — 内置 `git:force-push` 的**专用**谓词（位置无关 + 包装剥离）
//
// 旧谓词 `/^git\s+push\s+(-f|--force)\b/` 要求 `-f`/`--force` **紧跟** `push`，
// 于是真实绕过形全部漏网（独立安全复评 C-3）：`git push origin main --force`
// （refspec 尾置）、`git -C repo push --force`、`sh -c "git push --force"`、
// `sudo git push --force`、`env VAR=x git push --force`。默认策略下
// `workspace-write + approval: never` 的 profile 门兜得住，但在 S006 /
// `--permission danger-full-access` 这类放宽会话里，deny 规则是**唯一防线**。
//
// 作用域纪律：本块只替换 `git:force-push` 这条**内置语义规则**的实现。
// `shellCommandPredicate`（策略作者写的 `Shell(...)`/`Bash(...)`）的 `*` 语义
// 按本卡要求**保持不变**（锚定 glob + 逐字转义，不做包装剥离），两者互不影响。
//
// C-3 残留盲区补充（放宽会话下实测仍可绕过）：`git push origin +main`（`+<refspec>`
// 强制推送，标准惯用写法）、`env -S "git push --force" …`（env 的 split-string
// 脚本模式）、`eval "git push --force origin main"`（与 `sh -c` 同类的字符串套壳）。
// 三者的判定仍全部落在 `git:force-push` 这一条内置谓词里。
// ─────────────────────────────────────────────────────────────────────────────

/** 包装器递归剥离的最大深度（`sudo sh -c 'env x sh -c …'` 之类）。 */
const MAX_WRAPPER_DEPTH = 4;

const EMPTY_OPTS: ReadonlySet<string> = new Set<string>();

/** 前缀式包装器：剥掉后对**剩余部分**重判（`sudo` / `env` / `nohup` …）。 */
const PRIVILEGE_WRAPPERS = new Set([
  'sudo', 'doas', 'env', 'command', 'nohup', 'nice', 'time', 'setsid', 'stdbuf', 'ionice',
]);

/** `sh -c "…"` 家族：取引号内脚本**递归**判定（引号已由 tokenizer 剥掉）。 */
const SHELL_WRAPPERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash']);

/**
 * 每个包装器里**带独立值**的选项（`sudo -u root`、`nice -n 10`）；`--opt=value`
 * 写法自成一体、无需额外跳词。刻意按包装器分表：`env -i` 是「不取值」的
 * （`-i` 若被当成取值选项，`env -i git push --force` 反而会漏判）。
 */
const WRAPPER_VALUE_OPTS: Record<string, ReadonlySet<string>> = {
  sudo: new Set([
    '-u', '-g', '-p', '-C', '-h', '-U', '-r', '-t', '-T', '-D', '-R',
    '--user', '--group', '--prompt', '--chdir', '--host', '--role', '--type',
    '--other-user', '--close-from', '--command-timeout',
  ]),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
  nice: new Set(['-n', '--adjustment']),
  stdbuf: new Set(['-i', '-o', '-e', '--input', '--output', '--error']),
  ionice: new Set(['-c', '-n', '-p', '-u', '--class', '--classdata', '--pid', '--uid']),
  time: new Set(['-f', '-o', '--format', '--output']),
};

/** `git` 全局选项中带独立值的（`git -C <path> push …`）——不影响子命令判定。 */
const GIT_GLOBAL_VALUE_OPTS = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path',
  '--config-env', '--super-prefix', '--attr-source',
]);

function shellBasename(token: string): string {
  return (token.replace(/\\/g, '/').split('/').pop() ?? token).replace(/\.exe$/i, '');
}

/** 按**未被引号包裹**的 `|` `||` `&&` `;` 与换行切段，避免跨管道/分号误判。 */
function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      buf += ch;
      if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        buf += command[i + 1]!;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      buf += ch + command[i + 1]!;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '|' || ch === '&' || ch === ';' || ch === '\n' || ch === '\r') {
      segments.push(buf);
      buf = '';
      if ((ch === '|' || ch === '&') && command[i + 1] === ch) i++;
      continue;
    }
    buf += ch;
  }
  segments.push(buf);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * 引号感知 token 化：引号内空白不切分，且**去掉引号本身**——`sh -c "git push
 * --force"` 因此得到一个完整脚本 token，可直接递归判定。
 */
function tokenizeShellSegment(segment: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  const flush = (): void => {
    if (buf.length > 0) {
      tokens.push(buf);
      buf = '';
    }
  };
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) {
        buf += segment[i + 1]!;
        i++;
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < segment.length) {
      buf += segment[i + 1]!;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return tokens;
}

/**
 * force 选项判定按 **token 精确匹配**（而非 `\b` 边界）：`--force\b` 会在
 * `e` 与 `-` 之间形成词边界，从而把 `--force-like-branch`（分支名，不是选项）
 * 误判为 force push。
 */
function isForcePushOption(token: string): boolean {
  if (token === '--force' || token === '-f' || token === '--force-with-lease') return true;
  if (token.startsWith('--force=') || token.startsWith('--force-with-lease=')) return true;
  // 短选项簇（`-f` / `-uf` / `-fu`）；长选项（`--follow-tags` / `--force-like-*`）显式排除
  return /^-[A-Za-z]+$/.test(token) && token.includes('f');
}

/**
 * `+<refspec>`（`git push origin +main`）：`git-push(1)` 把 refspec 前缀 `+` 定义为
 * "allow non-fast-forward updates"，与 `--force` 等价 —— 这是强制推送的**标准惯用
 * 写法**，只看 `-f`/`--force` 选项的旧实现必然漏判。
 *
 * 判定绑定到 **refspec 位置**（`push` 之后的参数），所以命令里任意位置出现 `+` 都不会
 * 误命中：`git push origin a+b`（`+` 不在 token 开头）、`git push origin main && echo a+b`
 * （`&&` 已切段，第二段段首是 `echo`）均为 false。
 *
 * 引号由 `tokenizeShellSegment` 剥掉：`git push origin "+main"` 得到 token `+main`
 * ⇒ 命中（shell 引号不改变参数内容，语义上确为强制推送）。`+` 也**从不**是 git push
 * 的选项前缀，故任何以 `+` 开头的参数按 fail-closed 记为强制推送。
 */
function isForceRefspec(token: string): boolean {
  return token.startsWith('+');
}

/** `git push` 中**带独立值**的选项（`-o <opt>` / `--receive-pack <path>`）：其值不是 refspec。 */
const GIT_PUSH_VALUE_OPTS = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

/** 命令形如 `git <全局选项…> push <args…>`，且 push 之后出现 force 选项或 `+<refspec>`。 */
function isGitPushWithForce(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  if (shellBasename(tokens[0]!) !== 'git') return false;
  let i = 1;
  for (; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === '--') {
      i++;
      break;
    }
    if (!token.startsWith('-')) break; // 第一个非选项 token 即子命令
    if (GIT_GLOBAL_VALUE_OPTS.has(token)) i++; // 跳过 `-C <path>` 的独立值
  }
  if (tokens[i] !== 'push') return false;
  for (let j = i + 1; j < tokens.length; j++) {
    const token = tokens[j]!;
    if (isForcePushOption(token)) return true;
    // `-o <opt>` 之类取独立值的选项：连它的值一起跳过，避免把值当 refspec
    if (GIT_PUSH_VALUE_OPTS.has(token)) {
      j++;
      continue;
    }
    if (isForceRefspec(token)) return true;
  }
  return false;
}

/** `bash -lc "…"` / `sh -c '…'` → 脚本参数；不是 `-c` 形式则返回 null。 */
function shellDashCArg(tokens: string[]): string | null {
  for (let i = 1; i < tokens.length; i++) {
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(tokens[i]!)) return tokens[i + 1] ?? null;
  }
  return null;
}

/**
 * `env -S "<script>"` / `env --split-string="<script>"` → 被执行的命令文本。
 *
 * `-S` **不是**无值开关：GNU `env(1)` 的 split-string 模式把 `-S` 的值按空白切成
 * 参数，再接上其后的其余参数，整体就是它要执行的命令行。旧实现把 `-S` 当无值开关
 * （见 `WRAPPER_VALUE_OPTS.env` 的注释），于是脚本 token 被当成普通参数丢弃 ⇒
 * `env -S "git push --force" origin main` fail-open。
 */
function envSplitScript(tokens: string[]): string | null {
  const takesValue = WRAPPER_VALUE_OPTS.env ?? EMPTY_OPTS;
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue; // env VAR=x
    if (!token.startsWith('-')) return null; // 到达命令本身，本段没有 -S
    let split: string | null = null;
    let restFrom = i + 1;
    if (token.startsWith('--split-string=')) {
      split = token.slice('--split-string='.length);
    } else if (token === '-S' || token === '--split-string' || /^-[A-Za-z]*S[A-Za-z]*$/.test(token)) {
      split = tokens[i + 1] ?? null;
      restFrom = i + 2;
    }
    if (split !== null) return [split, ...tokens.slice(restFrom)].join(' ').trim();
    if (token === '--') return null;
    if (takesValue.has(token) && i + 1 < tokens.length) i++; // 跳过其他取值选项的值
  }
  return null;
}

/** 剥掉前缀式包装器及其选项（含 `env VAR=x` 赋值），返回剩余 token。 */
function stripWrapper(tokens: string[]): string[] {
  const head = shellBasename(tokens[0]!);
  const takesValue = WRAPPER_VALUE_OPTS[head] ?? EMPTY_OPTS;
  let i = 1;
  for (; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (head === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (token === '--') {
      i++;
      break;
    }
    if (!token.startsWith('-')) break;
    if (takesValue.has(token) && i + 1 < tokens.length) i++;
  }
  return tokens.slice(i);
}

/**
 * 段内是否出现 `git` + `push` 两个**独立 token**（顺序：git 在前）——保守兜底的触发签名。
 *
 * 用**独立 token** 而不是子串：`echo "git push --force"` 里整段是一个 token，
 * 它只是被打印的文本，不构成签名；`git log --grep push` 虽然含签名，但段首就是
 * `git`，走精确判定，不会落到兜底上。
 */
function mentionsGitPush(tokens: string[]): boolean {
  let seenGit = false;
  for (const token of tokens) {
    if (!seenGit && shellBasename(token) === 'git') {
      seenGit = true;
      continue;
    }
    if (seenGit && token === 'push') return true;
  }
  return false;
}

/** 文本级 `git … push` 签名（token 被引号粘成一个整体时的补充手段）。 */
const GIT_PUSH_TEXT = /(?:^|\s)(?:\S*\/)?git\s+(?:\S+\s+)*push(?:\s|$)/;

/**
 * 兜底签名：只在**无法继续展开**的分支（包装层级/递归层数超限）使用。
 * 先按独立 token 判定，再退一步按文本判定——`sudo×5 sh -c "git push origin main"`
 * 里的脚本是一个被引号粘起来的 token，只有文本级签名才认得出。
 */
function looksLikeGitPush(tokens: string[]): boolean {
  return mentionsGitPush(tokens) || GIT_PUSH_TEXT.test(tokens.join(' '));
}

/**
 * 单段判定：循环剥离包装器，`sh -c` / `env -S` / `eval` 取脚本递归，最后按 git push 语义判定。
 *
 * 优先级（R-1，独立安全复评给出的保守立场）：
 *  1. **精确判定优先**：段首是 `git`、或包装器/解释器可完整展开时，给出确定结论
 *     （`git push origin main` 无任何 force 迹象且解析完整 ⇒ allow）。
 *  2. **仅在解析不完整/存在未跟随的间接层时**才 fail-closed ⇒ deny（见末尾分支），
 *     gated by `mentionsGitPush`，因此与本规则无关的命令不会被误拦。
 */
function detectForcePushInTokens(tokens: string[], depth: number): boolean {
  let current = tokens;
  let stripped = 0;
  while (current.length > 0) {
    const head = shellBasename(current[0]!);
    // `env -S "<script>"`：`-S` 的**值**才是被执行的命令。必须在通用
    // `PRIVILEGE_WRAPPERS` 剥离**之前**取出来递归，否则脚本 token 会被当作
    // 普通参数丢掉（修复前的 fail-open 形）。`env -S "echo hi"` 递归后段首是
    // `echo` ⇒ false，不会过度拦截。
    if (head === 'env') {
      const script = envSplitScript(current);
      if (script !== null) return detectForcePush(script, depth + 1);
    }
    // `eval "<string>"`：与 `sh -c` 同类的「字符串套一层」。`eval` 会把**全部**参数
    // 用空格拼接后再执行，故这里同样拼接后递归（`eval git push --force` 与
    // `eval "git push --force"` 等价）。边界：只有 `eval` 位于**段首**（包装剥离后
    // 的首 token）才按命令处理；出现在参数位（`git commit -m "eval …"`、
    // `echo eval …`）一律不触发。
    if (head === 'eval') {
      const script = current.slice(1).join(' ').trim();
      return script.length === 0 ? false : detectForcePush(script, depth + 1);
    }
    if (PRIVILEGE_WRAPPERS.has(head)) {
      const next = stripWrapper(current);
      if (next.length >= current.length) return false; // 无可剥离（防死循环）
      if (stripped >= MAX_WRAPPER_DEPTH) {
        // 包装层级已达到跟随上限却仍有外层 ⇒ 本段展开不完（未解析）⇒ fail-closed，
        // 但仍要求 git+push 签名，避免 `sudo×6 ls` 这类无关命令被误拦。
        return looksLikeGitPush(next);
      }
      current = next;
      stripped++;
      continue;
    }
    if (SHELL_WRAPPERS.has(head)) {
      const script = shellDashCArg(current);
      if (script !== null) return detectForcePush(script, depth + 1);
      // 解释器执行**脚本文件**（`sh deploy.sh` / `bash -e build.sh`）：文件内容不可知
      // ⇒ 执行体未解析 ⇒ fail-closed（`sh -c "echo hi"` 已被上一行精确解析，不受影响；
      // 只有 `-c` 之外的真参数才算「脚本文件」，故 `bash --version` / 裸 `sh` 不命中）。
      return current.slice(1).some((token) => !token.startsWith('-'));
    }
    // 段首是 git：精确判定（`git log --grep push` 在此确定为 allow，不走兜底）。
    if (head === 'git') return isGitPushWithForce(current);
    // 段首既不是 git、也不是我们跟随的包装器：段内出现 `git`+`push` 独立 token 时，
    // 该处的执行体无法确定（`xargs` / `timeout` / `watch` / `find -exec` / 未跟随的
    // 间接层）⇒ R-1 fail-closed。**不含该签名 ⇒ allow**，这是防过度拦截的硬边界
    // （`xargs ls`、`echo a+b`、`npm run push` 一律不命中）。
    return mentionsGitPush(current);
  }
  return false;
}

/**
 * 入口：分段后逐段判定（`|` / `;` / `&&` / `||` / 换行 不互相污染）。
 *
 * 覆盖的绕过形：位置无关的 `-f`/`--force`/`--force-with-lease[=…]`、`+<refspec>`
 * 强制推送、`sudo`/`doas`/`env`/`command`/`nohup`/`nice`/`time`/`setsid`/`stdbuf`/
 * `ionice` 前缀包装、`sh -c`/`bash -lc` 家族、`env -S`/`--split-string` 脚本模式、
 * `eval` 字符串执行（后三者递归，递归/剥离深度上限 `MAX_WRAPPER_DEPTH` = 4）。
 *
 * **保守兜底（R-1，独立安全复评要求，优先级高于「标注边界」）**：凡**解析不完整 /
 * 存在未跟随的间接层**、且段内出现 `git`+`push` 独立 token 的，一律判定为**命中
 * （deny）**：未跟随的包装器（`xargs git push --force`、`timeout … git push --force`）、
 * 包装层级超出跟随上限、递归层数超限；解释器执行**脚本文件**（`sh script.sh`，
 * 内容不可读）即使不含 git/push 字样也判命中。理由：force push 的合法用法极少，
 * 漏放（allow）意味唯一防线失效，误拦代价远小于漏放。
 * 反向硬边界：**不含 git+push 签名、也不是「解释器执行脚本文件」的段绝不因此被拦**
 * （`xargs ls`、`echo a+b`、`npm run push`、`git log --grep push` 均不命中）。
 * 代价（已知的过度拦截，如实记录）：`xargs git push origin main`、`timeout 60 git push
 * origin main` 这类「未跟随包装器 + 普通 push」也会 deny——它们与 force push 只差
 * 一层无法静态确认的包装，按保守立场不区分。
 *
 * **余下真正无法覆盖的边界（仍然返回 allow，由 profile 门 / 沙箱等其他防线承担）**：
 * - 变量 / 别名 / 函数 / 命令替换间接：`CMD="git push --force"; $CMD`、`alias gp=…`、
 *   `$(cat cmds.txt)`、反引号——段内没有 `git`+`push` 独立 token，签名不成立；
 * - 外部脚本文件内容不可知：`./release.sh`、`python x.py`（**注**：`sh release.sh`
 *   已被上面的脚本文件分支拦下，`.sh` 直接执行形式不在本谓词职责内）；
 * - heredoc / 标准输入喂给解释器：`… | sh`、`sh < cmds.txt`（无脚本文件参数时）；
 * - 运行时构造后再执行：`base64 -d | sh`、`printf '%s' "$P" | sh`；
 * - 引号未闭合（tokenizer 按「引号一直开到段尾」容错，不额外降级）：这些形在真实
 *   shell 里本就不会执行成 git push，且降级会与正常命令的解析口径冲突。
 */
function detectForcePush(command: string, depth = 0): boolean {
  for (const segment of splitShellSegments(command)) {
    const tokens = tokenizeShellSegment(segment);
    if (tokens.length === 0) continue;
    if (depth > MAX_WRAPPER_DEPTH) {
      // 递归层数超限（`sh -c` / `env -S` / `eval` 套娃）：本层不再展开 ⇒ 未解析
      // ⇒ 含 git+push 签名即 fail-closed。
      if (looksLikeGitPush(tokens)) return true;
      continue;
    }
    if (detectForcePushInTokens(tokens, depth)) return true;
  }
  return false;
}

/**
 * Parse a `Bash(...)` / `Shell(...)` / `Write(path=...)` style matcher into
 * (domain, predicate) per POLICY-SPEC §3.3.
 */
function parseMatcher(match: string): { domain: 'shell' | 'filesystem' | 'tools'; predicate: (call: { toolName: string; arguments: Record<string, unknown> }) => boolean; label: string } {
  const shellMatch = /^(Bash|Shell)\((.*)\)$/.exec(match);
  if (shellMatch) {
    const prefix = shellMatch[2]!.replace(/^"(.*)"$/, '$1');
    return {
      domain: 'shell',
      label: `Shell(${prefix})`,
      predicate: shellCommandPredicate(prefix),
    };
  }
  const pathMatch = /^(Read|Write|Edit)\(path=(glob\s+)?"?([^")]+)"?\)$/.exec(match);
  if (pathMatch) {
    const toolName = pathMatch[1]!;
    const glob = pathMatch[3]!;
    return {
      domain: 'filesystem',
      label: `${toolName}(${glob})`,
      predicate: (call) => {
        if (call.toolName !== toolName) return false;
        const p = String(call.arguments.path ?? call.arguments.file_path ?? '');
        return globMatch(glob, p.replace(/\\/g, '/'));
      },
    };
  }
  // bare tool name or tool(prefix)
  const bare = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(match);
  if (bare) {
    return {
      domain: 'tools',
      label: bare[1]!,
      predicate: (call) => call.toolName === bare[1],
    };
  }
  return {
    domain: 'tools',
    label: match,
    predicate: () => false, // unknown syntax — never matches (fail-closed elsewhere)
  };
}

function fsPathRule(toolNames: string[], glob: string, action: VerdictAction, id: string, reason?: string): PolicyRule {
  return {
    id,
    domain: 'filesystem',
    action,
    reason,
    match: (call) => {
      if (!toolNames.includes(call.toolName)) return false;
      const p = String(call.arguments.path ?? '');
      return globMatch(glob, p.replace(/\\/g, '/'));
    },
  };
}

/**
 * policy/risk — Policy Compiler (POLICY-SPEC §1.1): one declaration expands to
 * the four artifacts (Prompt Guidance / Tool Interceptor / Runtime Deny / Audit).
 * Any safety claim with enforcement but no runtime rule => compile error (双通道强制).
 */
export function compilePolicy(declaration: PolicyDeclaration): PolicyArtifacts {
  // fail loud on unknown keys
  for (const key of Object.keys(declaration)) {
    if (!KNOWN_TOP_KEYS.has(key)) {
      throw new Error(`policy compile error: unknown top-level key "${key}"`);
    }
  }
  if (!declaration.version) throw new Error('policy compile error: version required');
  if (!declaration.profile) throw new Error('policy compile error: profile required');
  if (!declaration.approval) throw new Error('policy compile error: approval required');

  const profile: ProfileMode = declaration.profile;
  const approval = declaration.approval;
  const promptGuidance: string[] = [];
  const deniedTools: string[] = [];
  const rules: PolicyRule[] = [];

  // guidance (soft channel — produces no audit facts)
  for (const g of declaration.guidance ?? []) promptGuidance.push(g);
  if (declaration.filesystem?.protected?.length) {
    promptGuidance.push(`不要改写受保护路径：${declaration.filesystem.protected.join(', ')}（硬执法，不可豁免）。`);
  }
  if (declaration.filesystem?.deny_read?.length) {
    promptGuidance.push(`不要读取凭据/敏感文件：${declaration.filesystem.deny_read.join(', ')}（硬执法）。`);
  }
  if (declaration.filesystem?.confinement) {
    const allowed = declaration.filesystem.allow ?? [];
    const spec = allowed.length
      ? `显式授权路径：${allowed.map((a) => `${a.path}(${a.mode})`).join(', ')}`
      : '无显式授权路径（仅工作区根可达）';
    promptGuidance.push(`文件访问被限制在允许集合：工作区根 + 显式授权路径。${spec}。越界读写会硬拒绝。`);
  }
  if (declaration.shell?.deny?.length) {
    promptGuidance.push(`破坏性命令（${declaration.shell.deny.join(', ')}）被硬拦截，先说明原因与范围再考虑受管替代。`);
  }
  if (declaration.git?.force_push) {
    promptGuidance.push('不要 force push 重写共享分支历史。');
  }

  // Tool Interceptor: bare-name deny removes tools from the visible schema
  for (const t of declaration.tools?.deny ?? []) deniedTools.push(t);

  // Runtime Deny rules
  for (const p of declaration.filesystem?.protected ?? []) {
    rules.push(fsPathRule(['Write', 'Edit'], p, 'deny', `fs-protected:${p}`, '.git/受保护路径不可写（硬执法）'));
  }
  for (const d of declaration.filesystem?.deny_read ?? []) {
    rules.push(fsPathRule(['Read', 'Grep'], d, 'deny', `fs-deny-read:${d}`, '凭据文件禁止读取'));
  }

  // task 073 — allow-set confinement lexical pre-check at the Executor seam.
  // Authoritative canonical allow-set enforcement lives in tools/guards.ts
  // `assertConfined` (has workspace root + realpath). This rule gives a second,
  // earlier hard deny (→ audit/denial via AgentLoop) for the unambiguous lexical
  // cases: `..` escapes and absolute paths not covered by an absolute allow entry.
  // Workspace-relative paths are left to the tool guard so the lexical rule never
  // false-positives on normal workspace ops.
  const confinement = declaration.filesystem?.confinement;
  if (confinement === true) {
    const allowAbs = (declaration.filesystem?.allow ?? [])
      .filter((a) => a.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(a.path))
      .map((a) => a.path);
    const coversAbs = (abs: string): boolean => {
      const norm = abs.replace(/[\\/]+/g, '/');
      return allowAbs.some((ap) => {
        const aNorm = ap.replace(/[\\/]+/g, '/');
        return norm === aNorm || norm.startsWith(aNorm.replace(/\/$/, '') + '/');
      });
    };
    rules.push({
      id: 'fs-confinement',
      domain: 'filesystem',
      action: 'deny',
      reason: 'path outside filesystem confinement allow set (workspace root + explicit allow)',
      match: (call) => {
        if (!['Read', 'Write', 'Edit'].includes(call.toolName)) return false;
        const p = String(call.arguments.path ?? '');
        if (!p) return false;
        const hasDotDot = p.split(/[\\/]+/).includes('..');
        if (hasDotDot) return true;
        // absolute path not covered by an explicit absolute allow → deny
        const isAbsolute = p.startsWith('/') || p.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(p);
        if (isAbsolute && !coversAbs(p)) return true;
        return false;
      },
    });
  }

  for (const cat of declaration.shell?.deny ?? []) {
    const regexes = SHELL_DENY_SETS[cat];
    if (!regexes) {
      throw new Error(`policy compile error: unknown shell.deny category "${cat}"`);
    }
    rules.push({
      id: `shell-deny:${cat}`,
      domain: 'shell',
      action: 'deny',
      reason: `dangerous command category: ${cat} (never_auto, any profile)`,
      match: (call) => {
        if (call.toolName !== 'Shell') return false;
        const cmd = String(call.arguments.command ?? '');
        return regexes.some((re) => re.test(cmd));
      },
    });
  }

  for (const sr of declaration.shell?.scoped_rules ?? []) {
    const parsed = parseMatcher(sr.match);
    rules.push({
      id: sr.id ?? `shell-scoped:${sr.match}`,
      domain: parsed.domain,
      action: sr.action,
      reason: sr.reason,
      match: parsed.predicate,
    });
  }

  for (const tr of declaration.tools?.rules ?? []) {
    const parsed = parseMatcher(tr.match);
    rules.push({
      id: tr.id ?? `tools-rule:${tr.match}`,
      domain: parsed.domain,
      action: tr.action,
      reason: tr.reason,
      match: parsed.predicate,
    });
  }

  if (declaration.git?.force_push) {
    const action = declaration.git.force_push;
    rules.push({
      id: 'git:force-push',
      domain: 'git',
      action,
      reason: 'force push 重写共享分支历史',
      // C-3：位置无关 + 包装剥离（见文件上方 `detectForcePush` 的说明）。
      // 之前是 `/^git\s+push\s+(-f|--force)\b/`，只认「`-f`/`--force` 紧跟 push」。
      match: (call) => {
        if (call.toolName !== 'Shell') return false;
        const cmd = String(call.arguments.command ?? '');
        return detectForcePush(cmd);
      },
    });
  }

  for (const d of declaration.network?.deny_domains ?? []) {
    rules.push({
      id: `net-deny:${d}`,
      domain: 'network',
      action: 'deny',
      reason: `denied domain: ${d}`,
      match: () => false, // no WebFetch tool in v0.1 six-tool plane; declared for audit completeness
    });
  }

  // 双通道强制: every safety claim with enforcement produced at least one runtime
  // rule above (per-domain check happens in behavior/compiler via policy_ref).

  return {
    promptGuidance,
    deniedTools,
    rules,
    profile,
    approval,
    fsConfig: {
      protected: declaration.filesystem?.protected ?? [],
      denyRead: declaration.filesystem?.deny_read ?? [],
      allow: declaration.filesystem?.allow ?? [],
      confinement: declaration.filesystem?.confinement === true,
    },
    shellAllow: declaration.shell?.allow ?? [],
  };
}

export function parsePolicyYaml(text: string): PolicyDeclaration {
  const doc = yaml.load(text) as { policy?: PolicyDeclaration } | PolicyDeclaration;
  const decl = (doc as { policy?: PolicyDeclaration }).policy ?? (doc as PolicyDeclaration);
  if (!decl || typeof decl !== 'object') {
    throw new Error('policy compile error: expected a `policy:` mapping');
  }
  return decl;
}

export function compilePolicyYaml(text: string): PolicyArtifacts {
  return compilePolicy(parsePolicyYaml(text));
}
