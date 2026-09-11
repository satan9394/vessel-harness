/**
 * apps/cli/startupError — CLI 启动期未捕获异常的「人话」渲染。
 *
 * 背景：入口 `main().then(process.exit)` 没有 `.catch`，配置损坏（如
 * `~/.vessel` 下被截断、或手改成非法 JSON 的配置文件）时会直接抛裸栈，用户看不到
 * 「哪个文件坏了、下一步做什么」。
 *
 * 约定：本模块是**纯函数**，只做「异常 → 文案」映射——
 * 1. 永不打印裸栈：只输出一句话（可多行）+ 一句可操作恢复指引；
 * 2. 不读文件、不访问网络、不调用 `process.exit`、不抛异常；
 * 3. 路径从异常 message 中尽力提取，提取不到就不出现空占位。
 */

/** 启动期失败的用户可读描述。 */
export interface StartupFailure {
  /** 面向用户的一段话（可多行）：什么坏了、涉及哪个文件、怎么恢复 */
  message: string;
  /** 识别到的配置/状态文件路径（无法定位时为 undefined） */
  path?: string;
  /** 分类，便于测试断言 */
  kind: 'config-corrupted' | 'file-missing' | 'permission' | 'unknown';
}

/** JSON 解析类错误的特征（Node / V8 各版本措辞不同，全部覆盖）。 */
const CONFIG_CORRUPTED_RE =
  /JSON|Unexpected token|Unexpected end of (JSON )?input|Unexpected non-whitespace/i;

const RECOVERY_CONFIG = '可把该文件移走后重试：vessel setup（交互向导）或 vessel provider add';
const RECOVERY_MISSING = '请确认路径与文件名是否正确后重试；首次使用可先运行 vessel setup 生成配置';
const RECOVERY_PERMISSION = '请稍后重试；若持续，检查杀软/只读属性';
const RECOVERY_UNKNOWN = '可用 vessel --help 查看命令，或 vessel setup 重新配置';

/** Windows 绝对路径：`C:\Users\me\.vessel\config.json`。 */
const WINDOWS_PATH_RE = /[A-Za-z]:\\[^\s"']+/g;
/** POSIX 绝对路径：`/home/me/.vessel/config.json`（`//` 开头留给下面的过滤剔除）。 */
const POSIX_PATH_RE = /\/(?!\/)[^\s"']+/g;

/** 去掉路径尾部的标点残留（`...,` / `...)` / `...）。` 等）。 */
function trimTrailingPunctuation(candidate: string): string {
  return candidate.replace(/[.,;:)\]}>"'`]+$/g, '');
}

/** 从一段文本里收集疑似绝对路径（保持出现顺序，去重）。 */
function collectPaths(text: string): string[] {
  const found: string[] = [];
  for (const [re, isWindows] of [
    [WINDOWS_PATH_RE, true],
    [POSIX_PATH_RE, false],
  ] as const) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const raw = match[0];
      // 跳过 URL 的 `://` 尾巴（如 https://host/a.json 会从第二个 `/` 起匹配）。
      if (text.slice(Math.max(0, start - 2), start) === ':/') continue;
      if (raw.startsWith('//')) continue;
      const cleaned = trimTrailingPunctuation(raw);
      if (cleaned.length < 2) continue;
      // POSIX 侧只收「有目录层级」或「像文件名」的片段，避免把 `a/b` 里的 `/b` 当路径。
      if (!isWindows && cleaned.split('/').length < 3 && !/\.[A-Za-z0-9]{1,8}$/.test(cleaned)) continue;
      if (!found.includes(cleaned)) found.push(cleaned);
    }
  }
  return found;
}

/**
 * 尽力从异常文案中提取第一个疑似文件路径；优先 `.json` 结尾的片段。
 * 提取不到返回 undefined（调用方据此省略路径行）。
 */
function extractPath(text: string): string | undefined {
  if (!text) return undefined;
  // JSON 报错里反斜杠常被转义成 `\\`，同时扫原文与还原文，优先还原后的干净路径。
  const normalized = text.replace(/\\\\/g, '\\');
  const candidates = [...collectPaths(normalized), ...collectPaths(text)];
  const unique = candidates.filter((p, i) => candidates.indexOf(p) === i);
  if (unique.length === 0) return undefined;
  const jsonLike = unique.find((p) => /\.json$/i.test(p));
  return jsonLike ?? unique[0];
}

/** 取异常的可读文案（Error.message 优先，其余 String(err)）。 */
function rawMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message && err.message.length > 0 ? err.message : String(err);
  }
  if (typeof err === 'string') return err;
  return String(err);
}

/** 按行拼接，自动丢弃空行（避免出现空占位）。 */
function compose(lines: Array<string | undefined>): string {
  return lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).join('\n');
}

/**
 * 把 CLI 启动期抛出的任意异常渲染成「人话 + 一句恢复指引」。
 * 判定顺序：config-corrupted → file-missing → permission → unknown。
 */
export function describeStartupFailure(err: unknown): StartupFailure {
  const raw = rawMessage(err).trim();
  const path = extractPath(raw);
  // 先摘掉 `.json` 这种「文件扩展名」形式的 json 字样，避免把
  // `ENOENT ... config.json` 误判成 JSON 语法错误（那属于 file-missing）。
  const syntaxProbe = raw.replace(/\.json\b/gi, '');
  const looksSyntax =
    err instanceof SyntaxError ||
    (typeof (err as { name?: unknown } | null)?.name === 'string' && (err as { name: string }).name === 'SyntaxError') ||
    CONFIG_CORRUPTED_RE.test(syntaxProbe);

  if (looksSyntax) {
    return {
      kind: 'config-corrupted',
      path,
      message: compose([
        '配置文件损坏：读取启动配置时解析失败（JSON 语法错误或内容被截断）。',
        path ? `涉及文件：${path}` : undefined,
        raw ? `原始错误：${raw}` : undefined,
        RECOVERY_CONFIG,
      ]),
    };
  }

  if (/ENOENT/.test(raw)) {
    return {
      kind: 'file-missing',
      path,
      message: compose([
        '文件不存在：启动所需的配置或状态文件没有找到（ENOENT）。',
        path ? `涉及文件：${path}` : undefined,
        raw ? `原始错误：${raw}` : undefined,
        RECOVERY_MISSING,
      ]),
    };
  }

  if (/EPERM|EACCES|EBUSY/.test(raw)) {
    return {
      kind: 'permission',
      path,
      message: compose([
        '权限不足或文件被占用：无法读写启动所需的配置或状态文件。',
        path ? `涉及文件：${path}` : undefined,
        raw ? `原始错误：${raw}` : undefined,
        RECOVERY_PERMISSION,
      ]),
    };
  }

  return {
    kind: 'unknown',
    path,
    message: compose([raw || '启动失败：发生了未预期的错误。', RECOVERY_UNKNOWN]),
  };
}
