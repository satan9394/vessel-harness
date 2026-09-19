/**
 * Vessel Local Web — lightweight i18n skeleton (task 045).
 *
 * Zero-dependency zh/en dictionaries plus a `t(key)` translator. Default
 * language follows navigator.language (`zh*` → 'zh', otherwise 'en'); an
 * explicit user choice persists to localStorage under `vessel.ui.lang` and
 * overrides the detected default. Locale + storage are injectable so the logic
 * is unit-testable under node (which has neither `navigator` nor
 * `localStorage`); in the browser defaults read from the real globals.
 *
 * This module deliberately does NOT import i18next / react-i18next. The plain
 * dictionaries + `t()` below are enough for the core UI copy. All values are
 * strings; dynamic parts use `{var}` placeholders substituted by `t`.
 */

export type Lang = 'zh' | 'en';

/** localStorage key that persists the user's explicit language choice. */
export const LANG_STORAGE_KEY = 'vessel.ui.lang';

/** A string message; `{var}` placeholders are filled by `t` when params given. */
export type MessageTemplate = string;

/**
 * Core UI copy — the keys the skeleton translates. Content (session text,
 * tool names, code) is intentionally left untranslated.
 */
export interface Messages {
  newSession: MessageTemplate;
  projects: MessageTemplate;
  recentSessions: MessageTemplate;
  settings: MessageTemplate;
  language: MessageTemplate;
  send: MessageTemplate;
  stop: MessageTemplate;
  running: MessageTemplate;
  thinking: MessageTemplate;
  inputPlaceholder: MessageTemplate;
  serverDown: MessageTemplate;
  statusOk: MessageTemplate;
  statusDown: MessageTemplate;
  emptyTitle: MessageTemplate;
  emptyBody: MessageTemplate;
  noProjects: MessageTemplate;
  noSessions: MessageTemplate;
  placeholderDev: MessageTemplate;
  /** **已声明未实现**的占位串：由 `App.tsx` 的 `UNIMPLEMENTED` 清单消费（触发条件见该处注释）。 */
  unimplemented: MessageTemplate;
  tasksPlaceholder: MessageTemplate;
  changedFilesPlaceholder: MessageTemplate;
  customize: MessageTemplate;
  customizeHead: MessageTemplate;
  interruptTitle: MessageTemplate;
  /** Team module placeholder when no session is selected (task 060) */
  teamModuleNoSession: MessageTemplate;
  /** Goal module placeholder when no session is selected (task 065) */
  goalModuleNoSession: MessageTemplate;
}

export const zh: Messages = {
  newSession: '+ 新建会话',
  projects: '项目',
  recentSessions: '最近会话',
  settings: '设置',
  language: '语言',
  send: '发送',
  stop: '停止',
  running: '运行中…',
  thinking: '思考中…',
  inputPlaceholder: '输入消息… (Enter 发送)',
  serverDown: '无法连接 local server——请先运行 vessel serve（127.0.0.1:5678）。',
  statusOk: 'Vessel local server 正常（v{version}）',
  statusDown: 'local server 未连接——请先 vessel serve（127.0.0.1:5678）',
  emptyTitle: '选择或新建会话',
  emptyBody:
    '从左侧 Recent Sessions 选择一个会话开始对话，或点击 + New Session 打开一个项目。',
  noProjects: '暂无项目',
  noSessions: '暂无会话',
  placeholderDev: '（开发中）',
  unimplemented: '未实现（占位）。',
  tasksPlaceholder: '任务列表占位（开发中）。',
  changedFilesPlaceholder: '变更文件列表占位（开发中）。',
  customize: '自定义',
  customizeHead: '显示模块',
  interruptTitle: '中断当前回合（占位：直接 POST /interrupt）',
  teamModuleNoSession: '选择或新建一个会话后，Team 面板（模型选择 / 3-Agents 活动 / External Review）将在此显示。',
  goalModuleNoSession: '选择或新建一个会话后，Goal 面板（任务队列 / 迭代回放 / 每次运行）将在此显示。',
};

export const en: Messages = {
  newSession: '+ New Session',
  projects: 'Projects',
  recentSessions: 'Recent Sessions',
  settings: 'Settings',
  language: 'Language',
  send: 'Send',
  stop: 'Stop',
  running: 'Running…',
  thinking: 'Thinking…',
  inputPlaceholder: 'Type a message… (Enter to send)',
  serverDown: 'Cannot reach local server — please run `vessel serve` (127.0.0.1:5678).',
  statusOk: 'Vessel local server ok (v{version})',
  statusDown: 'Local server not connected — please run `vessel serve` (127.0.0.1:5678).',
  emptyTitle: 'Select or start a session',
  emptyBody:
    'Pick a session from Recent Sessions to start chatting, or click + New Session to open a project.',
  noProjects: 'No projects',
  noSessions: 'No sessions',
  placeholderDev: '（under development）',
  unimplemented: 'Not implemented (placeholder).',
  tasksPlaceholder: 'Task list placeholder (under development).',
  changedFilesPlaceholder: 'Changed files placeholder (under development).',
  customize: 'Customize',
  customizeHead: 'Display modules',
  interruptTitle: 'Interrupt the current turn (placeholder: POST /interrupt)',
  teamModuleNoSession:
    'Select or start a session and the Team panel (model select / 3-agent activity / External Review) appears here.',
  goalModuleNoSession:
    'Select or start a session and the Goals panel (task queue / iteration replay / per-run control) appears here.',
};

/** All dictionaries keyed by language. */
export const DICT: Record<Lang, Messages> = { zh, en };

export type MessageKey = keyof Messages;

/** Minimal storage contract so tests can inject an in-memory stub. */
export interface PersistStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Minimal locale provider contract (navigator.language in the browser). */
export interface LocaleSource {
  language: string;
}

function pickStorage(): PersistStorage | null {
  try {
    return (globalThis as { localStorage?: PersistStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

function pickLocale(): LocaleSource | null {
  try {
    return (globalThis as { navigator?: LocaleSource }).navigator ?? null;
  } catch {
    return null;
  }
}

function isLang(value: string | null | undefined): value is Lang {
  return value === 'zh' || value === 'en';
}

/** Read the persisted override ('zh'|'en'); null when absent / invalid. */
export function loadStoredLang(storage?: PersistStorage | null): Lang | null {
  const store = storage === undefined ? pickStorage() : storage;
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
  return isLang(raw) ? raw : null;
}

/** Infer the default from locale: `zh*` → 'zh', anything else → 'en'. */
export function inferLang(locale?: LocaleSource | null): Lang {
  const source = locale === undefined ? pickLocale() : locale;
  const lang = source?.language ?? '';
  return lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** Resolve the effective language: stored override wins, else locale default. */
export function getInitialLang(opts?: {
  storage?: PersistStorage | null;
  locale?: LocaleSource | null;
}): Lang {
  return loadStoredLang(opts?.storage) ?? inferLang(opts?.locale);
}

/** Persist the user's explicit choice; safe no-op when storage unavailable. */
export function saveLang(lang: Lang, storage?: PersistStorage | null): void {
  const store = storage === undefined ? pickStorage() : storage;
  if (!store) return;
  try {
    store.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* storage blocked/full — degrade silently */
  }
}

/**
 * Return a bound `t` translator for `lang`. Fills `{var}` placeholders from
 * params. Unknown keys and missing languages fall back to en, then the raw key,
 * so a missing translation never crashes and stays greppable.
 */
export function translate(lang: Lang): (key: MessageKey, params?: Record<string, string>) => string {
  return (key, params) => {
    let value: string | undefined = DICT[lang]?.[key];
    if (value === undefined) value = en[key]; // fallback: en
    if (value === undefined) return key; // fallback: raw key
    if (!params) return value;
    return value.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
  };
}

/** The i18n API surfaced via React context: current lang, a `t`, a setter. */
export interface I18nApi {
  lang: Lang;
  t: (key: MessageKey, params?: Record<string, string>) => string;
  setLang: (lang: Lang) => void;
}