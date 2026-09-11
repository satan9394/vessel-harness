/**
 * apps/cli/src/guide/settings.ts — 设置项定义 + 持久化（task 117，设置引导）。
 *
 * `vessel settings` 命令族：每个设置项自带中英文说明 + 可选值说明（设置引导）。
 * 持久化到 `<settingsRoot>/settings.json`（原子 tmp+rename 写，同 ProviderStore/UsageStore）。
 *
 * root 解析：`VESSEL_SETTINGS_ROOT` > `VESSEL_USAGE_ROOT` > `~/.vessel`
 * （复用 usage root 的口径：cli.test.ts 已把 VESSEL_USAGE_ROOT 指到临时目录，
 * 设置读写天然隔离，绝不碰真实 ~/.vessel；独立设置测试注入 VESSEL_SETTINGS_ROOT）。
 *
 * 当前设置项：theme（主题配色 dark|light）、locale（输出语言 zh|en）。
 * 职责边界：只做「说明 + 存取值」，不改 core/策略/定价。theme 目前**没有任何消费者**：
 * 取值只被持久化到 settings.json，不影响输出/渲染（文案如实标注为未生效）；
 * locale 会被 guide 真正消费（后续 explain 亦然）。
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renameWithRetry } from '@vessel/shared';
import { defaultUsageRoot } from '../usage/UsageStore.js';
import type { GuideLocale } from './guide.js';

/** 生效的设置根目录（VESSEL_SETTINGS_ROOT > VESSEL_USAGE_ROOT > ~/.vessel）。 */
export function resolveSettingsRoot(): string {
  return process.env.VESSEL_SETTINGS_ROOT ?? process.env.VESSEL_USAGE_ROOT ?? defaultUsageRoot();
}

export interface SettingValueDef {
  value: string;
  /** 中文说明 */
  zh: string;
  /** English description */
  en: string;
}

export interface SettingDef {
  /** 设置键（如 theme / locale） */
  key: string;
  /** 中文说明 */
  zh: string;
  /** English description */
  en: string;
  /** 可选值（每个带中英文说明） */
  values: SettingValueDef[];
  /** 缺省值 */
  default: string;
}

/** 设置项定义（设置引导的唯一来源：说明 + 可选值全在这）。 */
export const SETTINGS_DEFS: readonly SettingDef[] = [
  {
    key: 'theme',
    zh: '界面主题：CLI 输出使用的配色方案（当前版本仅保存该偏好，尚未作用于任何输出/渲染；后续版本生效）。',
    en: 'UI theme: the color scheme for CLI output (this version only stores the preference — it does not affect any output/rendering yet; effective in a later version).',
    values: [
      { value: 'dark', zh: '深色（默认）', en: 'dark (default)' },
      { value: 'light', zh: '浅色', en: 'light' },
    ],
    default: 'dark',
  },
  {
    key: 'locale',
    zh: '输出语言（中英文）：guide/解释等引导文案的语言，zh = 中文，en = English。',
    en: 'Output locale: the language used by guide/explain content; zh = Chinese, en = English.',
    values: [
      { value: 'zh', zh: '中文（默认）', en: 'Chinese (default)' },
      { value: 'en', zh: 'English（英文）', en: 'English' },
    ],
    default: 'zh',
  },
];

export interface VesselSettings {
  theme: 'dark' | 'light';
  locale: GuideLocale;
}

export function settingDef(key: string): SettingDef | undefined {
  return SETTINGS_DEFS.find((d) => d.key === key);
}

/** 某设置键是否可取该值（大小写不敏感）。 */
export function isAllowedValue(key: string, value: string): boolean {
  const def = settingDef(key);
  if (!def) return false;
  return def.values.some((v) => v.value === value);
}

/**
 * 设置存储：读 `settings.json`（缺文件 → 默认值；损坏 → fail loud throw）。
 * 写：原子 tmp+rename。
 */
export class SettingsStore {
  readonly rootDir: string;
  readonly file: string;

  constructor(opts: { rootDir?: string } = {}) {
    this.rootDir = path.resolve(opts.rootDir ?? resolveSettingsRoot());
    this.file = path.join(this.rootDir, 'settings.json');
  }

  /** 读当前设置：缺文件/残缺字段 → 用定义里的默认值补齐。 */
  load(): VesselSettings {
    const out: VesselSettings = {
      theme: SETTINGS_DEFS[0]!.default as VesselSettings['theme'],
      locale: SETTINGS_DEFS[1]!.default as VesselSettings['locale'],
    };
    if (!fs.existsSync(this.file)) return out;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown;
    } catch (err) {
      throw new Error(`settings.json 损坏（${this.file}）: ${(err as Error).message}`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`settings.json 格式非法（${this.file}）：需要 JSON 对象`);
    }
    const rec = raw as Record<string, unknown>;
    const theme = typeof rec.theme === 'string' ? (rec.theme as string) : undefined;
    const locale = typeof rec.locale === 'string' ? (rec.locale as string) : undefined;
    if (theme !== undefined) {
      if (!isAllowedValue('theme', theme)) throw new Error(`settings.json 里 theme="${theme}" 不是合法值（dark|light）`);
      out.theme = theme as VesselSettings['theme'];
    }
    if (locale !== undefined) {
      if (!isAllowedValue('locale', locale)) throw new Error(`settings.json 里 locale="${locale}" 不是合法值（zh|en）`);
      out.locale = locale as VesselSettings['locale'];
    }
    return out;
  }

  /** 读单个设置值（键必须是已定义设置，否则 throw）。 */
  get(key: string): string {
    const def = settingDef(key);
    if (!def) throw new RangeError(`未知设置 "${key}"（可用: ${SETTINGS_DEFS.map((d) => d.key).join(' / ')}）`);
    return this.load()[key as keyof VesselSettings] as string;
  }

  /**
   * 设置值并落盘。校验 fail loud：未知键 / 非法值 → RangeError（附带可选值说明）。
   * 返回写盘后的完整设置。
   */
  set(key: string, value: string): VesselSettings {
    const def = settingDef(key);
    if (!def) {
      throw new RangeError(`未知设置 "${key}"（可用: ${SETTINGS_DEFS.map((d) => d.key).join(' / ')}；说明见 vessel settings list）`);
    }
    if (!isAllowedValue(key, value)) {
      const allowed = def.values.map((v) => `${v.value}（${v.zh}）`).join(' / ');
      throw new RangeError(`设置 "${key}" 不能取 "${value}"；可选值: ${allowed}`);
    }
    const current = this.load();
    const next: VesselSettings = { ...current, [key]: value as never };
    fs.mkdirSync(this.rootDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    renameWithRetry(tmp, this.file);
    return next;
  }
}

/** 渲染设置列表（每项 = 中英文说明 + 可选值 + 当前值）。 */
export function renderSettingsList(store: SettingsStore): string {
  const current = store.load();
  const lines = SETTINGS_DEFS.map((d) => {
    const values = d.values.map((v) => `    - ${v.value.padEnd(6)} ${v.zh} / ${v.en}`).join('\n');
    return [
      `[${d.key}] 当前: ${String(current[d.key as keyof VesselSettings])}`,
      `  中文: ${d.zh}`,
      `  English: ${d.en}`,
      `  可选值:`,
      values,
    ].join('\n');
  });
  return [
    '=== 设置项（vessel settings）===',
    ...lines,
    '修改: vessel settings set <theme|locale> <value>（如 set theme light / set locale en）',
  ].join('\n');
}

/** 渲染单条设置说明（set 失败/成功提示共用）。 */
export function renderSettingDetail(def: SettingDef, current: string): string {
  const values = def.values.map((v) => `  - ${v.value.padEnd(6)} ${v.zh} / ${v.en}`).join('\n');
  return [
    `[${def.key}] 当前: ${current}`,
    `  中文: ${def.zh}`,
    `  English: ${def.en}`,
    `  可选值 (allowed):`,
    values,
  ].join('\n');
}