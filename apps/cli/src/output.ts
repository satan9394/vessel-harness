/**
 * cli/output — `--json` 的极小输出层（G-11 / BRIEF-10）。
 *
 * 约定：
 * - `--json` 模式下 stdout **只允许**出现一段可解析 JSON（禁 banner/提示行）；
 * - 错误一律走 stderr：`--json` 时是合法 JSON，否则沿用各命令既有文案；
 * - 本模块不做业务判断，只做「怎么打印」——数据由调用方从既有 store 方法取。
 */

/** 是否处于 JSON 输出模式（`--json` 或 `--json=true` 都算）。 */
export function isJson(flags: Map<string, string>): boolean {
  return flags.has('json');
}

/** 打印单个 JSON 文档（唯一 stdout 出口；调用方在此之后不应再打印别的行）。 */
export function emitJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/**
 * 统一失败出口：`--json` 时往 stderr 打 JSON 信封，否则由调用方决定文案。
 * 返回传入的退出码，便于 `return fail(...)`。
 */
export function fail(code: number, message: string, flags: Map<string, string>, human?: () => void): number {
  if (isJson(flags)) {
    console.error(JSON.stringify({ error: { message, code } }));
  } else if (human) {
    human();
  } else {
    console.error(message);
  }
  return code;
}
