/**
 * apps/cli/src/guide/guideCommands.ts — `vessel` 引导命令族（task 117）。
 *
 * 命令：
 *   - `vessel explain <term>`（别名 `vessel term <term>`）查词库给中英文解释；
 *     未收录 → 友好提示 + `vessel list-terms`。
 *   - `vessel list-terms` 列出全部术语（中英双语）。
 *   - `vessel guide [--locale zh|en]` 新手分步引导；locale 缺省跟随 settings。
 *   - `vessel settings list [--json]` 设置项说明（中英文 + 可选值 + 当前值）；
 *     `--json`（G-11）时 stdout 只打 `{ settings: {...} }`。
 *   - `vessel settings set <theme|locale> <value>` 设置（带每项说明；非法值 fail loud）。
 *
 * opts（测试注入）：`settingsRoot` 覆盖设置根（缺省 resolveSettingsRoot()）、
 * `log`/`error` 覆盖输出通道。所有命令**不构造默认 ProviderStore**，无需
 * VESSEL_PROVIDER_ROOT 隔离；settings 落盘走 usage/settings root（见 settings.ts）。
 */

import { findTerm, listTerms, renderExplain, renderTermsList } from './glossary.js';
import { renderGuide, type GuideLocale } from './guide.js';
import { SettingsStore, loadLocaleOrDefault, renderSettingsList, renderSettingDetail, settingDef, type VesselSettings } from './settings.js';
import { emitJson, fail, isJson } from '../output.js';

export interface GuideCliOptions {
  /** 覆盖设置根（测试注入 tmp）；缺省 resolveSettingsRoot() */
  settingsRoot?: string;
  /** 输出通道（测试 capture；缺省 console.log） */
  log?: (line: string) => void;
  /** 错误通道（测试 capture；缺省 console.error） */
  error?: (line: string) => void;
}

function logOf(opts: GuideCliOptions): (line: string) => void {
  return opts.log ?? ((line: string) => console.log(line));
}
function errorOf(opts: GuideCliOptions): (line: string) => void {
  return opts.error ?? ((line: string) => console.error(line));
}

function settingsStoreFor(opts: GuideCliOptions): SettingsStore {
  return new SettingsStore({ rootDir: opts.settingsRoot ?? undefined });
}

/**
 * guide 命令族的生效 locale：`--locale` 显式 > settings.locale > `'zh'`（**唯一实现**）。
 *
 * 此前 `cmdExplain` 与 `cmdGuide` 各写一份：前者走 `loadLocaleOrDefault`（设置损坏 ⇒ 回退 'zh'），
 * 后者直读 settings 的 locale（设置损坏 ⇒ **抛错**）—— 同一句声明（"locale 缺省跟随 settings"）
 * 两种行为，且 `settings.ts` 的注释声称"两处都调 `loadLocaleOrDefault`"，与实现不符。
 * 现两处都走本函数，`--locale` 校验与回退口径只有一份。
 */
function resolveGuideLocale(
  flags: Map<string, string>,
  opts: GuideCliOptions,
): { ok: true; locale: GuideLocale } | { ok: false } {
  const raw = flags.get('locale');
  if (raw !== undefined) {
    if (raw !== 'zh' && raw !== 'en') {
      errorOf(opts)(`--locale 需要 zh|en（收到 "${raw}"）。`);
      return { ok: false };
    }
    return { ok: true, locale: raw };
  }
  // 缺省跟随 settings；口径的唯一实现见 settings.ts 的 loadLocaleOrDefault
  // （缺失/损坏/字段残缺一律回退 zh，绝不让输出失败；TUI 的 resolveChatLocale 共用同一段）。
  return { ok: true, locale: loadLocaleOrDefault(settingsStoreFor(opts)) };
}

/** `vessel explain <term>`（别名 `vessel term <term>`）——查词库给中英文解释。 */
export async function cmdExplain(
  args: string[],
  flags: Map<string, string>,
  opts: GuideCliOptions = {},
): Promise<number> {
  const log = logOf(opts);
  const term = args[0];
  if (!term) {
    errorOf(opts)(
      '用法: vessel explain <term>（如 vessel explain Call）；列出全部: vessel list-terms',
    );
    return 2;
  }
  const entry = findTerm(term);
  if (!entry) {
    log(`未收录术语 "${term}"。试试: vessel list-terms（查看全部 ${listTerms().length} 条），或换个叫法（如 小蜜/Call/Collect）。`);
    return 2;
  }
  // 生效 locale（`--locale` 显式 > settings.locale > 'zh'）—— 唯一实现在 resolveGuideLocale。
  const resolved = resolveGuideLocale(flags, opts);
  if (!resolved.ok) return 2;
  log(renderExplain(entry, resolved.locale));
  return 0;
}

/** `vessel list-terms` —— 列出全部术语（中英双语）。 */
export async function cmdListTerms(_args: string[] = [], _flags: Map<string, string> = new Map(), opts: GuideCliOptions = {}): Promise<number> {
  logOf(opts)(renderTermsList(listTerms()));
  return 0;
}

/** `vessel guide [--locale zh|en]` —— 新手分步引导（locale 缺省跟随 settings）。 */
export async function cmdGuide(
  _args: string[] = [],
  flags: Map<string, string> = new Map(),
  opts: GuideCliOptions = {},
): Promise<number> {
  // 生效 locale（`--locale` 显式 > settings.locale > 'zh'）—— 唯一实现在 resolveGuideLocale。
  const resolved = resolveGuideLocale(flags, opts);
  if (!resolved.ok) return 2;
  logOf(opts)(renderGuide(resolved.locale));
  return 0;
}

/** `vessel settings [list]` —— 显示设置项说明与当前值（设置引导）；`--json` 给 `{ settings: {...} }`。 */
async function cmdSettingsList(flags: Map<string, string>, opts: GuideCliOptions): Promise<number> {
  const store = settingsStoreFor(opts);
  if (isJson(flags)) {
    // --json：stdout 只打 { settings: {...} }（缺文件/残缺字段走默认值，同样是合法 JSON）。
    // 关键：**只有 JSON 模式**才把 settings.json 损坏降级为 stderr 上的 JSON 信封 + 退出码 1
    // （与 main() 的 catch 同码）；非 JSON 路径必须保持 fail loud——cli.crashSurface.test.ts ①
    // 要求 `main(['settings','list'])` 在损坏时 reject，绝不能被这里吞掉。
    try {
      emitJson({ settings: store.load() });
      return 0;
    } catch (err) {
      return fail(1, `[vessel settings list] ${(err as Error).message}`, flags);
    }
  }
  logOf(opts)(renderSettingsList(store));
  return 0;
}

/** `vessel settings set <theme|locale> <value>` —— 设置（带说明；非法值 fail loud）。 */
async function cmdSettingsSet(args: string[], opts: GuideCliOptions): Promise<number> {
  const error = errorOf(opts);
  const log = logOf(opts);
  const key = args[1];
  const value = args[2];
  if (!key || value === undefined) {
    error('用法: vessel settings set <theme|locale> <value>');
    error('  theme:  dark | light（仅保存偏好；当前不影响输出/渲染）');
    error('  locale: zh | en（输出语言）');
    error('查看说明: vessel settings list');
    return 2;
  }
  const def = settingDef(key);
  if (!def) {
    error(`未知设置 "${key}"（可用: theme / locale；说明见 vessel settings list）`);
    return 2;
  }
  const store = settingsStoreFor(opts);
  let next;
  try {
    next = store.set(key, value);
  } catch (err) {
    const current = String(store.load()[key as keyof VesselSettings] ?? def.default);
    error(`[vessel settings set] ${(err as Error).message}`);
    error(renderSettingDetail(def, current));
    return 2;
  }
  log(`✔ 已设置 ${key} = ${value}（${def.values.find((v) => v.value === value)?.zh ?? value}）`);
  const current = next as unknown as Record<string, string>;
  log(`  当前: ${Object.entries(current).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  if (key === 'locale') {
    log(`  guide/解释输出语言已切换：vessel guide 现在用 ${value === 'en' ? 'English' : '中文'}。`);
  }
  if (key === 'theme') {
    log(`  主题偏好已保存为 ${value === 'dark' ? '深色（dark）' : '浅色（light）'}（仅保存该偏好；当前版本不影响任何输出/渲染）。`);
  }
  return 0;
}

/** `vessel settings <list|set> [...]` —— 命令族入口。 */
export async function cmdSettings(
  args: string[],
  flags: Map<string, string> = new Map(),
  opts: GuideCliOptions = {},
): Promise<number> {
  const sub = args[0] ?? 'list';
  switch (sub) {
    case 'list':
      return cmdSettingsList(flags, opts);
    case 'set':
      return cmdSettingsSet(args, opts);
    default:
      errorOf(opts)(`未知 settings 子命令 "${sub}"（可用: list / set；查看: vessel settings list）`);
      return 2;
  }
}