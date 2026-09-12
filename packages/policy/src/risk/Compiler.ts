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

/** `git` 的**配置**选项（其值是 `key=value`）：`-c <k=v>` / `--config[=…]` / `--config-env=…`。 */
const GIT_CONFIG_VALUE_OPTS = new Set(['-c', '--config', '--config-env']);

/**
 * R-1 ②（git alias 走私）：`-c` / `--config[=…]` / `--config-env=…` 的值以 `alias.`
 * 开头 ⇒ 本段命令行里存在一层**无法静态展开的间接**：
 *  - `git -c alias.p='push --force' p`（独立复评实测漏网）：展开文本藏在 `-c` 的**值**
 *    里，子命令 token 只是别名名 `p`，精确判定看不到 `push`；
 *  - `alias.x='!<任意 shell>'`：`!` 前缀让别名执行任意 shell 命令，展开后可能是任何
 *    命令，远超本谓词的静态解析能力。
 * 因此按 R-1 的保守立场 **fail-closed**（命中 = deny）。git config 的键不分大小写，按 `i` 匹配。
 *
 * 为什么判据钉在 **`alias.` 键**上（而不是「值里出现 push」）：键是最外层语法结构，不依赖
 * 对展开文本做子串猜测——`alias.p='!git "pu"sh --force'` 之类引号/拼接形会绕开子串匹配，
 * 却绕不开「这就是一个别名定义」。
 *
 * **R-1 ③ 扩到跨命令形（第三轮复评 EVALUATION-REPORT-23）**：`-c` 只覆盖「同一段内定义 +
 * 同一段内调用」。真实的跨段走私形 `git config alias.p 'push --force' && git p` 里，
 * 定义段（`git config …`）与调用段（`git p`）是**两个 segment**，逐段精确判定两边都看不到
 * force ⇒ 修复前 allow。而两段在同一个 shell 里顺序执行、别名**在同一 shell 会话内生效**，
 * 因此判定必须**整条命令级**：任一 segment 定义别名 ⇒ 整条 deny，**不要求**同段内还要调用
 * 该别名（见 `gitArgsDefineAlias`）。
 *
 * 已知代价（如实记录，属 R-1 已接受的过度拦截）：定义**任何**别名都判 deny，与是否 force
 * 无关（`git -c alias.st=status st`、`git config alias.st status`）。非别名的配置完全不受
 * 影响——负对照：`git -c core.pager=cat status`、`git -c user.email=a@b push origin main`、
 * `git config user.email a@b`、`git config core.pager cat` 仍按原语义判定。
 */
function definesGitAlias(token: string, next: string | undefined): boolean {
  let value: string | undefined;
  if (/^--(?:config|config-env)=/i.test(token)) {
    value = token.slice(token.indexOf('=') + 1); // `--config=alias.p=…` / `--config-env=alias.p=…`
  } else if (token.startsWith('-c') && token.length > 2) {
    value = token.slice(2); // 紧贴写法 `-calias.p='push --force'`
  } else if (GIT_CONFIG_VALUE_OPTS.has(token)) {
    value = next; // 独立值写法 `-c alias.p='push --force'`
  }
  return value !== undefined && /^alias\./i.test(value);
}

/**
 * `git config` 的**读取**动作选项（`--get` / `--get-all` / `--get-regexp` / `--list` / `-l`）：
 * 只是在**读**配置，不构成别名定义。R-1 ③ 的负对照要求 `git config --get alias.p` 保持
 * allow —— 本实现**能**区分读取与定义（读取动作选项在扫描时直接短路为「不是定义」），
 * 因此如实放行，不做「键出现即拦」的粗判。
 *
 * 边界（如实记录）：`git config alias.p`（单个参数、无值）在 git 语义里同样是**读取**，
 * 本实现按「无值 ⇒ 不是定义」放行；`git config --unset alias.p` 是**删除**别名，同样无值
 * ⇒ 放行（删除不产生新的未解析执行体）。二者都不会让别名指向 force push。
 */
const GIT_CONFIG_READ_OPTS = new Set([
  '--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l',
]);

/** `git config` 里**取独立值**的选项（`--file <path>` / `--type <type>`）：其值不是配置键。 */
const GIT_CONFIG_OPT_VALUE_OPTS = new Set(['-f', '--file', '--blob', '--type', '--default']);

/**
 * 整条命令级别名判据（R-1 ③）：段首是 `git` 且该段**定义**了 `alias.` 键 ⇒ true。
 *
 * 覆盖两种定义语境：
 *  - `git -c alias.p='push --force' p`（全局选项位，委托 `definesGitAlias`）；
 *  - `git config [--global|--system|--local|--file …] alias.<name> <value>`（子命令位，本函数）。
 *    只认「键 + 值」都出现的**定义**写法；`--get` / `--list` / 单参数读取一律 false
 *    （见 `GIT_CONFIG_READ_OPTS` 的说明）。
 *
 * 只用于**定义**判定：调用与否、调用在哪一段都不影响结论（跨段调用同样拦）。
 */
function gitArgsDefineAlias(tokens: string[]): boolean {
  let i = 1;
  for (; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === '--') {
      i++;
      break;
    }
    if (!token.startsWith('-')) break; // 第一个非选项 token 即子命令
    if (definesGitAlias(token, tokens[i + 1])) return true; // `git -c alias.p=…`
    if (GIT_GLOBAL_VALUE_OPTS.has(token)) i++; // 跳过 `-C <path>` 的独立值
  }
  if (tokens[i] !== 'config') return false;
  let key: string | undefined;
  let value: string | undefined;
  for (i = i + 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.startsWith('-')) {
      if (GIT_CONFIG_READ_OPTS.has(token)) return false; // `--get`/`--list` = 读取，不是定义
      if (GIT_CONFIG_OPT_VALUE_OPTS.has(token)) i++; // 跳过 `--file <path>` 之类选项的值
      continue; // 作用域/类型等无值选项（`--global` / `--bool`），不影响键值位置
    }
    if (key === undefined) {
      key = token;
      continue;
    }
    if (value === undefined) value = token;
  }
  return key !== undefined && value !== undefined && /^alias\./i.test(key);
}

function shellBasename(token: string): string {
  return (token.replace(/\\/g, '/').split('/').pop() ?? token).replace(/\.exe$/i, '');
}

/**
 * 续行语义的两种**互斥解释**（R-1 ①，第三轮复评 EVALUATION-REPORT-23 改为并集判定）。
 *
 * - `posix`：POSIX `sh` 语义 —— 只有 `\` + LF / CRLF 是续行，`^` 是普通字符。
 * - `cmd`：Windows `cmd.exe` 语义 —— 只有 `^` + LF / CRLF 是续行，`\` 是普通字符
 *   （`packages/tools/src/shell/shellTool.ts:44/70`：Windows 走 cmd，`Process.ts` 用
 *   `shell: true`）。
 *
 * 不再按 `process.platform` 二选一：策略**编译期**与命令**真实执行期**可能不在同一平台
 * （策略可在 Linux/CI 上编译、命令在 Windows cmd 里执行，或套一层 `cmd /c` / ssh 到别处），
 * 平台分支必然在某一侧漏判。改为**两种语义各判一次取并集**（见 `detectForcePush`）。
 */
type ContinuationMode = 'posix' | 'cmd';

/**
 * 续行规范化（R-1 ①，**在分段之前**执行），按 `mode` 只认该 shell 的一种续行符。
 *
 * 动机：真实 shell 会把「行尾续行符 + 换行」拼成**一条**命令，而 `splitShellSegments` 只按
 * `\n` / `\r` 切段：续行形因此被切成两段、各自精确判定为 allow（`git push ^` + CRLF +
 * `--force origin main` ⇒ 两段都不含 force ⇒ 漏网，独立复评 EVALUATION-REPORT-22 实测；
 * 上一轮修复只按 `\` 拼接，于是 `git status \` + 换行 + `git push --force origin main` 在
 * **cmd 里其实是两条命令**却被合并 ⇒ 反而 fail-open，EVALUATION-REPORT-23 判 REJECT）。
 *
 * 规则（`mode` 决定认哪一个续行符，另一个**原样保留**）：
 *  - `posix`：`\` + LF / CRLF 是续行，shell **删掉这一对**（等价于上下两行直接拼接）。按
 *    **反斜杠奇偶**判定：连续 N 个反斜杠后紧跟换行时，只有 N 为**奇数**（最后一个反斜杠
 *    转义换行）才算续行；N 为偶数时反斜杠两两成对 = 字面反斜杠，换行仍是**真分隔符**
 *    （`echo a\\` + 换行 + `git status` 依旧是两条命令）。`^` 在此模式下不是续行符。
 *  - `cmd`：`^` + LF / CRLF 是续行（cmd 同样把两者删掉后拼接）。**行尾判定**：`^` 只在其后
 *    **紧跟**换行时才算续行；`echo a^b` 里的 `^` 后面是普通字符 ⇒ 原样保留（它是 cmd 的
 *    转义符，不是续行），不会被吞掉。`\` 在此模式下**不参与续行**、原样保留 —— 于是
 *    `\` + 换行仍是**真分隔符**，下游分段器据此切成两条命令（配合 `splitShellSegments` /
 *    `tokenizeShellSegment` 的 `mode` 参数：cmd 模式下 `\` 也不再充当转义符，否则换行会被
 *    当成「被转义的字符」吞进同一段）。
 *  - 引号**不参与**判定：POSIX 下双引号内的 `\` + 换行同样拼接，故 `posix` 一律拼接
 *    （`sh -c "git push \` + 换行 + `--force"` ⇒ `sh -c "git push --force"`，递归判定命中）。
 *    单引号内也一并拼接，是本实现的保守取舍（POSIX 里单引号内反斜杠是字面量），方向是
 *    「更倾向合并」。
 *  - **多行脚本（没有续行符的真换行）不受影响**：仍按 `\n` / `\r` 切成独立段，因此
 *    `echo a` + 换行 + `git status` 依旧是两条命令（负对照用例锁定）。
 *  - 幂等：拼接后不再含「该模式的续行符 + 换行」，重复调用是恒等变换；非续行字符
 *    （`C:\repo`、`find … {} \;`、行中的 `a^b`）逐字保留。
 */
function normalizeLineContinuations(command: string, mode: ContinuationMode): string {
  let out = '';
  let i = 0;
  while (i < command.length) {
    const ch = command[i]!;
    if (ch === '\\' && mode === 'posix') {
      let run = 0;
      while (i + run < command.length && command[i + run] === '\\') run++;
      const nl = /^\r?\n/.exec(command.slice(i + run));
      if (nl !== null && run % 2 === 1) {
        // 奇数个反斜杠：最后一个转义换行 ⇒ 续行（删掉「反斜杠 + 换行」这一对）
        out += '\\'.repeat(run - 1);
        i += run + nl[0]!.length;
        continue;
      }
      out += '\\'.repeat(run);
      i += run;
      continue;
    }
    if (ch === '^' && mode === 'cmd') {
      const nl = /^\r?\n/.exec(command.slice(i + 1));
      if (nl !== null) {
        // cmd 续行：`^` 只在**行尾**（后随换行）才吞；行中的 `^`（`echo a^b`）走下面原样输出
        i += 1 + nl[0]!.length;
        continue;
      }
    }
    // 另一种模式的续行符（posix 下的 `^`、cmd 下的 `\`）原样输出。
    out += ch;
    i++;
  }
  return out;
}

/**
 * 按**未被引号包裹**的 `|` `||` `&&` `;` 与换行切段，避免跨管道/分号误判。
 *
 * `mode` 只影响「`\` 是否转义下一个字符」：POSIX 里 `\` 是转义符（`\;` 不当分隔符、
 * `\` + 换行已被 `normalizeLineContinuations` 拼掉），cmd 里 `\` 是**普通字符**
 * （cmd 的转义符是 `^`）。若 cmd 模式仍让 `\` 吞掉其后字符，`\` + 换行就会被当成
 * 「被转义的字符」拼进同一段，段边界错位 ⇒ 上一轮的 fail-open 复现。
 */
function splitShellSegments(command: string, mode: ContinuationMode): string[] {
  const segments: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      buf += ch;
      if (ch === '\\' && mode === 'posix' && quote === '"' && i + 1 < command.length) {
        buf += command[i + 1]!;
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\\' && mode === 'posix' && i + 1 < command.length) {
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
 *
 * `mode` 与 `splitShellSegments` 同义：POSIX 下 `\` 转义下一个字符（`\;` ⇒ `;`），
 * cmd 下 `\` 是普通字符（Windows 路径 `C:\repo` 不会被拆词，`\` + 换行留下的字面
 * 反斜杠也照常留在 token 里）。
 */
function tokenizeShellSegment(segment: string, mode: ContinuationMode): string[] {
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
      if (ch === '\\' && mode === 'posix' && quote === '"' && i + 1 < segment.length) {
        buf += segment[i + 1]!;
        i++;
        continue;
      }
      buf += ch;
      continue;
    }
    if (ch === '\\' && mode === 'posix' && i + 1 < segment.length) {
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
    // R-1 ②：`-c` 里的 alias 定义 = 未解析的间接层 ⇒ fail-closed。必须在跳过其值之前判定。
    if (definesGitAlias(token, tokens[i + 1])) return true;
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
 * 整条命令级别名走私判定（R-1 ③）递归体：包装剥离 + `sh -c` / `eval` 取脚本后，
 * 段首落在 `git` 上就按 `gitArgsDefineAlias` 判「是否定义了别名」。
 *
 * 与 force-push 判定并列、**独立**于「调用了哪个别名」：只要命令里出现别名定义即命中
 * （跨命令形 `git config alias.p 'push --force' && git p` 的定义段与调用段是两段）。
 * 深度超限 / 无法展开时返回 false —— 「未解析层」的 fail-closed 责任在
 * `detectForcePushInTokens`，本函数不重复承担，避免把无关命令拦下。
 */
function definesGitAliasInTokens(
  tokens: string[],
  mode: ContinuationMode,
  depth: number,
): boolean {
  let current = tokens;
  let stripped = 0;
  while (current.length > 0) {
    const head = shellBasename(current[0]!);
    if (head === 'git') return gitArgsDefineAlias(current);
    if (head === 'env') {
      // `env -S "<script>"`：`-S` 的**值**才是被执行的命令（与 force-push 判定同口径）。
      const script = envSplitScript(current);
      if (script !== null && depth <= MAX_WRAPPER_DEPTH) {
        return definesGitAliasInCommand(script, mode, depth + 1);
      }
    }
    if (PRIVILEGE_WRAPPERS.has(head)) {
      if (stripped >= MAX_WRAPPER_DEPTH) return false;
      const next = stripWrapper(current);
      if (next.length >= current.length) return false; // 无可剥离（防死循环）
      current = next;
      stripped++;
      continue;
    }
    if (SHELL_WRAPPERS.has(head)) {
      const script = shellDashCArg(current);
      if (script === null || depth > MAX_WRAPPER_DEPTH) return false;
      return definesGitAliasInCommand(script, mode, depth + 1);
    }
    if (head === 'eval') {
      const script = current.slice(1).join(' ').trim();
      if (script.length === 0 || depth > MAX_WRAPPER_DEPTH) return false;
      return definesGitAliasInCommand(script, mode, depth + 1);
    }
    return false; // 段首既非 git 也非可跟随层：本段没有别名定义
  }
  return false;
}

/** 命令级别名定义判定（分段 → 逐段 `definesGitAliasInTokens`）。 */
function definesGitAliasInCommand(
  command: string,
  mode: ContinuationMode,
  depth: number,
): boolean {
  if (depth > MAX_WRAPPER_DEPTH) return false;
  for (const segment of splitShellSegments(normalizeLineContinuations(command, mode), mode)) {
    const tokens = tokenizeShellSegment(segment, mode);
    if (tokens.length > 0 && definesGitAliasInTokens(tokens, mode, depth)) return true;
  }
  return false;
}

/**
 * 单段判定：循环剥离包装器，`sh -c` / `env -S` / `eval` 取脚本递归，最后按 git push 语义判定。
 *
 * 优先级（R-1，独立安全复评给出的保守立场）：
 *  1. **精确判定优先**：段首是 `git`、或包装器/解释器可完整展开时，给出确定结论
 *     （`git push origin main` 无任何 force 迹象且解析完整 ⇒ allow）。
 *  2. **仅在解析不完整/存在未跟随的间接层时**才 fail-closed ⇒ deny（见末尾分支），
 *     gated by `mentionsGitPush`，因此与本规则无关的命令不会被误拦。
 *
 * `mode` 只影响递归时的续行语义 —— 递归进来的脚本文本尚未规范化，必须用**同一个** mode
 * 继续（并集判定由最外层 `detectForcePush` 完成；递归里再取并集会破坏 `depth` 语义与
 * 「一次解释」的可读性）。
 */
function detectForcePushInTokens(
  tokens: string[],
  mode: ContinuationMode,
  depth: number,
): boolean {
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
      if (script !== null) return detectsForcePushUnder(script, mode, depth + 1);
    }
    // `eval "<string>"`：与 `sh -c` 同类的「字符串套一层」。`eval` 会把**全部**参数
    // 用空格拼接后再执行，故这里同样拼接后递归（`eval git push --force` 与
    // `eval "git push --force"` 等价）。边界：只有 `eval` 位于**段首**（包装剥离后
    // 的首 token）才按命令处理；出现在参数位（`git commit -m "eval …"`、
    // `echo eval …`）一律不触发。
    if (head === 'eval') {
      const script = current.slice(1).join(' ').trim();
      return script.length === 0 ? false : detectsForcePushUnder(script, mode, depth + 1);
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
      if (script !== null) return detectsForcePushUnder(script, mode, depth + 1);
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
 * 单一语义下的判定入口：按 `mode` 规范化续行后分段、逐段判定
 * （`|` / `;` / `&&` / `||` / 换行 不互相污染）。公共入口是下方的 `detectForcePush`
 * （两种语义取并集），本函数只负责「一次解释」。
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
 * **R-1 复评新增（EVALUATION-REPORT-22）**：
 * - ① **续行拼接**：入口先按 `mode` 做 `normalizeLineContinuations`，把该 shell 的续行符 +
 *   换行**拼回一条命令**再做分段 / token 化（见 `detectForcePush` —— 两种 shell 语义不同，
 *   已改为并集判定，不再声称「对齐真实 shell」）。
 * - ② **git alias 走私**：`git -c alias.p='push --force' p` —— 展开文本藏在 `-c` 的
 *   **值**里、子命令 token 只是别名名 `p`，段内精确判定看不到 `push`。凡 `-c` /
 *   `--config[=…]` / `--config-env=…` 的值定义别名（键以 `alias.` 开头，含 `-c` 紧贴写法
 *   `-calias.p=…`）一律 fail-closed ⇒ deny；`git -c alias.p='!git push --force' p` 同理。
 *   负对照（刻意不误判）：`git -c core.pager=cat status`、`git -c user.email=a@b push
 *   origin main` 仍 allow。代价：`git -c alias.st=status st` 这类普通别名定义也会 deny
 *   （见 `definesGitAlias`）。
 * - ③ **alias 跨命令形（EVALUATION-REPORT-23 追加）**：`git config alias.p 'push --force'
 *   && git p`（定义段与调用段分离，**不要求**同段内调用）。整条命令任一段定义了
 *   `alias.` 键 ⇒ deny（见 `definesGitAliasInTokens` / `gitArgsDefineAlias`）。
 *
 * **余下真正无法覆盖的边界（仍然返回 allow，由 profile 门 / 沙箱等其他防线承担）**：
 * - 变量 / 别名 / 函数 / 命令替换间接：`CMD="git push --force"; $CMD`、`alias gp=…`、
 *   `$(cat cmds.txt)`、反引号——段内没有 `git`+`push` 独立 token，签名不成立；
 * - 变量展开后再喂解释器：`CMD='git push --force'; sh -c "$CMD"`（`-c` 的脚本参数是
 *   `$CMD` 字面量，静态不可知）；别名定义值经变量间接同样不可见：
 *   `CFG='alias.p=push --force'; git -c "$CFG" p`（`-c` 的实参是 `$CFG` 字面量）；
 * - 标准输入 / 运行时构造后喂解释器：`printf '%s' "$P" | sh`、`echo … | sh`、
 *   `sh < cmds.txt`、`base64 -d | sh`、heredoc；
 * - **ANSI-C 引号**（`$'\x2d\x2dforce'`、`$'--for\x63e'`）：转义序列未解码，token 不构成
 *   force 选项形状；
 * - **整条命令被引号粘成一个词**：`"git push \\\n--force"` 的 POSIX 续行拼接后是**一个带
 *   空格的单词**（shell 找同名可执行文件，不是 git 调用）⇒ 如实判 allow（见用例「已知边界」）；
 * - 外部脚本文件内容不可知：`./release.sh`、`python x.py`（**注**：`sh release.sh`
 *   已被上面的脚本文件分支拦下，`.sh` 直接执行形式不在本谓词职责内）；
 * - 引号未闭合（tokenizer 按「引号一直开到段尾」容错，不额外降级）：这些形在真实
 *   shell 里本就不会执行成 git push，且降级会与正常命令的解析口径冲突。
 */
function detectsForcePushUnder(
  command: string,
  mode: ContinuationMode,
  depth = 0,
): boolean {
  for (const segment of splitShellSegments(normalizeLineContinuations(command, mode), mode)) {
    const tokens = tokenizeShellSegment(segment, mode);
    if (tokens.length === 0) continue;
    // R-1 ③：别名**定义**是整条命令级的未解析间接层，优先于逐段的 force 判定
    // （定义段本身通常不含 push，调用段只有一个别名名 `p`）。
    if (definesGitAliasInTokens(tokens, mode, depth)) return true;
    if (depth > MAX_WRAPPER_DEPTH) {
      // 递归层数超限（`sh -c` / `env -S` / `eval` 套娃）：本层不再展开 ⇒ 未解析
      // ⇒ 含 git+push 签名即 fail-closed。
      if (looksLikeGitPush(tokens)) return true;
      continue;
    }
    if (detectForcePushInTokens(tokens, mode, depth)) return true;
  }
  return false;
}

/**
 * R-1 ① 入口（**平台并集判定**，EVALUATION-REPORT-23 修复）：同一段命令按 **POSIX sh**
 * 与 **Windows cmd.exe** 两种续行语义**各解析一次**，任一语义下判定为 force push
 * ⇒ 返回 true（命中 = deny）。
 *
 * 为什么不做 `process.platform` 分支：策略**编译期**与命令**真实执行期**可能不在同一平台
 * （策略在 Linux/CI 编译、命令在 Windows cmd 执行；或套 `cmd /c` / ssh 到另一台机器），
 * 平台分支必然在其中一侧漏判。两种语义的续行符不同（POSIX 认 `\`、cmd 认 `^`），
 * 一个字符串在两种解释下可以**是两条命令**也可以**是一条命令**——上一轮「无条件按 `\`
 * 拼接」正是把 cmd 里 `git status \` + 换行 + `git push --force origin main` 合并成一条，
 * 使段首子命令变成 `status` ⇒ allow（真实 cmd 执行的是两条命令，第二条就是 force push）
 * ⇒ 引入 P1 fail-open。
 *
 * **代价（如实记录）**：某些命令在一种语义下是 force push、另一种下不是，会被**更保守地
 * deny**（例如 `git push \` + 换行 + `--force origin main`：POSIX 下是续行 ⇒ force push，
 * cmd 下是两条命令、第二条只是名为 `--force` 的命令）。这正是本仓「漏放代价远大于误拦」的
 * 既定取舍（见上方保守兜底段落）。反向的过度拦截还包括：cmd 下 `^` 对其他元字符的转义
 * （`echo a^&b`）未建模，`^&` 仍被当作段分隔符 ⇒ 可能多拦，方向同样是「更保守」。
 */
function detectForcePush(command: string): boolean {
  return (
    detectsForcePushUnder(command, 'posix') ||
    detectsForcePushUnder(command, 'cmd')
  );
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
