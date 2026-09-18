import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLOSSARY, findTerm, listTerms, renderExplain, renderTermsList } from './glossary.js';
import { renderGuide } from './guide.js';
import { SettingsStore, SETTINGS_DEFS, renderSettingsList } from './settings.js';
import { cmdExplain, cmdListTerms, cmdGuide, cmdSettings, type GuideCliOptions } from './guideCommands.js';
import { dispatchSlash } from '../tui/chat.js';
import { ProviderStore } from '../providers/ProviderStore.js';
import type { ChatSessionIO } from '../tui/chat.js';

/**
 * task 117 测试：术语词库/explain/list-terms/guide/settings/TUI 复用。
 * 隔离：设置相关用例一律注入 tmp settingsRoot；**不构造默认 ProviderStore**
 * （dispatchSlash 用例用显式 tmp root 的 ProviderStore），绝不读写真实 ~/.vessel。
 */

/** 捕获 console（log/error 双通道）。 */
function capture(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const a = vi.spyOn(console, 'log').mockImplementation((...x) => logs.push(x.join(' ')));
  const b = vi.spyOn(console, 'error').mockImplementation((...x) => logs.push(x.join(' ')));
  return { logs, restore: () => { a.mockRestore(); b.mockRestore(); } };
}

function optsFor(root: string): GuideCliOptions {
  return { settingsRoot: root };
}

/** 最小 ChatSessionIO（explain 路径不读写 io，只占位）。 */
function stubIO(): ChatSessionIO {
  return {
    readLine: async () => null,
    write: () => {},
  };
}

describe('glossary — 词库完整性（task 117）', () => {
  it('≥12 条词条，且每条 zh/en/usage 非空', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(12);
    for (const e of GLOSSARY) {
      expect(e.term.trim()).not.toBe('');
      expect(e.zh.trim()).not.toBe('');
      expect(e.en.trim()).not.toBe('');
      expect(e.usage.trim()).not.toBe('');
    }
  });

  it('覆盖必需核心术语（小蜜/Call/Collect/Agent/Harness/Policy/Prompt/Lane/Bench/theme/locale/token）', () => {
    const required = ['小小蜜', 'call', 'collect', 'agent', 'harness', 'policy', 'prompt', 'lane', 'bench', 'theme', 'locale', 'token'];
    for (const q of required) {
      const hit = findTerm(q);
      expect(hit, `缺少词条: ${q}`).toBeDefined();
    }
  });
});

describe('explain — 词库查找（大小写/别名/空）', () => {
  it('大小写不敏感命中英文术语', () => {
    expect(findTerm('Call')?.term).toBe('call');
    expect(findTerm(' call ')).toBeDefined();
  });

  it('别名命中（小蜜/小助手 → 小小蜜；工具调用 → call）', () => {
    expect(findTerm('小蜜')?.term).toBe('小小蜜');
    expect(findTerm('小助手')?.term).toBe('小小蜜');
    expect(findTerm('工具调用')?.term).toBe('call');
  });

  it('未收录词返回 undefined', () => {
    expect(findTerm('不存在的术语xyz')).toBeUndefined();
    expect(findTerm('   ')).toBeUndefined();
  });

  it('renderExplain 输出含中文解释 + 英文术语 + 一句话用途', () => {
    const out = renderExplain(findTerm('call')!);
    expect(out).toContain('中文解释');
    expect(out).toContain('Call');
    expect(out).toContain('一句话用途');
    const enOut = renderExplain(findTerm('call')!, 'en');
    expect(enOut).toContain('English:');
    expect(enOut).toContain('中文解释');
  });
});

describe('CLI 命令 — explain / list-terms / guide / settings（task 117）', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-guide-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('explain 命中词条 → exit 0 且输出中英双语', async () => {
    const { logs, restore } = capture();
    const code = await cmdExplain(['Call'], new Map(), optsFor(root));
    restore();
    expect(code).toBe(0);
    const all = logs.join('\n');
    expect(all).toContain('Call');
    expect(all).toContain('中文解释');
    expect(all).toContain('一句话用途');
  });

  it('explain 未收录词 → 友好提示 + 引导 list-terms，exit 2', async () => {
    const { logs, restore } = capture();
    const code = await cmdExplain(['xyz词库外'], new Map(), optsFor(root));
    restore();
    expect(code).toBe(2);
    const all = logs.join('\n');
    expect(all).toContain('未收录术语');
    expect(all).toContain('list-terms');
  });

  it('explain 缺参数 → 用法提示，exit 2', async () => {
    const { logs, restore } = capture();
    const code = await cmdExplain([], new Map(), optsFor(root));
    restore();
    expect(code).toBe(2);
    expect(logs.join('\n')).toContain('用法');
  });

  it('list-terms 列出全部词条（中英双语）', async () => {
    const { logs, restore } = capture();
    const code = await cmdListTerms([], new Map(), optsFor(root));
    restore();
    expect(code).toBe(0);
    const all = logs.join('\n');
    for (const e of listTerms()) {
      expect(all).toContain(e.name);
      expect(all).toContain(e.en);
    }
    expect(all).toContain(`${listTerms().length} 条`);
  });

  it('settings list 显示每项中英文说明 + 可选值 + 当前值', async () => {
    const store = new SettingsStore({ rootDir: root });
    store.set('theme', 'light');
    const { logs, restore } = capture();
    const code = await cmdSettings(['list'], new Map(), optsFor(root));
    restore();
    expect(code).toBe(0);
    const all = logs.join('\n');
    expect(all).toContain('[theme]');
    expect(all).toContain('dark');
    expect(all).toContain('light');
    expect(all).toContain('[locale]');
    expect(all).toContain('zh');
    expect(all).toContain('en');
    expect(all).toContain('当前: light'); // theme 已被设置 → 当前值显示 light
    expect(SETTINGS_DEFS.length).toBeGreaterThanOrEqual(2);
  });

  it('settings set theme light → 持久化；非法值/未知键 fail loud（exit 2 + 可选值说明）', async () => {
    const store = new SettingsStore({ rootDir: root });
    // 合法设置
    const { logs: ok, restore: r1 } = capture();
    const code = await cmdSettings(['set', 'theme', 'light'], new Map(), optsFor(root));
    r1();
    expect(code).toBe(0);
    expect(ok.join('\n')).toContain('theme = light');
    expect(store.get('theme')).toBe('light');
    // 非法值
    const { logs: bad, restore: r2 } = capture();
    const code2 = await cmdSettings(['set', 'theme', 'neon'], new Map(), optsFor(root));
    r2();
    expect(code2).toBe(2);
    const badAll = bad.join('\n');
    expect(badAll).toContain('不能取');
    expect(badAll).toContain('dark');
    expect(badAll).toContain('light');
    expect(store.get('theme')).toBe('light'); // 未改动
    // 未知键
    const { logs: unk, restore: r3 } = capture();
    const code3 = await cmdSettings(['set', 'font', 'mono'], new Map(), optsFor(root));
    r3();
    expect(code3).toBe(2);
    expect(unk.join('\n')).toContain('未知设置');
  });

  it('guide 输出 zh 含中文步骤（①-④ 与 Vessel）；en 含英文', async () => {
    const zh = renderGuide('zh');
    expect(zh).toContain('①');
    expect(zh).toContain('新手引导 · Vessel');
    expect(zh).not.toContain('小小蜜');
    expect(zh).toContain('vessel explain');
    expect(zh).toContain('④');
    const en = renderGuide('en');
    expect(en).toContain('Getting Started · Vessel');
    expect(en).not.toContain('Xiaoxiaomi');
    expect(en).toContain('vessel explain');
    expect(en).toContain('④');
  });

  it('locale 切换生效：settings set locale en → guide 输出英文；set zh → 中文（--locale 可覆盖）', async () => {
    // 默认 zh
    const { logs: g0, restore: r0 } = capture();
    await cmdGuide([], new Map(), optsFor(root));
    r0();
    expect(g0.join('\n')).toContain('新手引导 · Vessel');
    // 切 en（持久化）→ guide 跟随
    const { logs: s1, restore: r1 } = capture();
    await cmdSettings(['set', 'locale', 'en'], new Map(), optsFor(root));
    r1();
    expect(s1.join('\n')).toContain('locale = en');
    const { logs: g1, restore: r2 } = capture();
    const code1 = await cmdGuide([], new Map(), optsFor(root));
    r2();
    expect(code1).toBe(0);
    expect(g1.join('\n')).toContain('Getting Started · Vessel');
    // 切回 zh → guide 中文
    const { logs: s2, restore: r3 } = capture();
    await cmdSettings(['set', 'locale', 'zh'], new Map(), optsFor(root));
    r3();
    const { logs: g2, restore: r4 } = capture();
    await cmdGuide([], new Map(), optsFor(root));
    r4();
    expect(g2.join('\n')).toContain('新手引导 · Vessel');
    // --locale 显式覆盖 settings
    const { logs: g3, restore: r5 } = capture();
    await cmdGuide([], new Map([['locale', 'en']]), optsFor(root));
    r5();
    expect(g3.join('\n')).toContain('Getting Started · Vessel');
  });

  it('settings set locale 非法值 → exit 2 且给出可选值', async () => {
    const { logs, restore } = capture();
    const code = await cmdSettings(['set', 'locale', 'fr'], new Map(), optsFor(root));
    restore();
    expect(code).toBe(2);
    const all = logs.join('\n');
    expect(all).toContain('不能取');
    expect(all).toContain('zh');
    expect(all).toContain('en');
  });

  it('settings.json 损坏 → guide/explain 都回退 zh（不抛）；口径唯一', async () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'settings.json'), '{not json', 'utf8');
    // 改前：cmdGuide 直接 `.load().locale` ⇒ 设置损坏时**抛错**；cmdExplain 走 loadLocaleOrDefault ⇒ 回退 zh。
    // 改后：两者同走 resolveGuideLocale → loadLocaleOrDefault，行为一致。
    const { logs: g, restore: r1 } = capture();
    const codeG = await cmdGuide([], new Map(), optsFor(root));
    r1();
    expect(codeG).toBe(0);
    expect(g.join('\n')).toContain('新手引导 · Vessel'); // zh 回退，而不是崩溃

    const { logs: e, restore: r2 } = capture();
    const codeE = await cmdExplain(['Call'], new Map(), optsFor(root));
    r2();
    expect(codeE).toBe(0);
    expect(e.join('\n').length).toBeGreaterThan(0);
  });

  it('locale 解析唯一实现（静态守卫）：cmdGuide/cmdExplain 不再各自 `.load().locale`', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('./guideCommands.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/function\s+resolveGuideLocale\b/);
    // 两个命令都调 resolveGuideLocale（各一次）
    expect((src.match(/resolveGuideLocale\(/g) ?? []).length).toBeGreaterThanOrEqual(3); // 定义 + 两处调用
    // 不得再有直读 settings 的 locale（那正是分叉点）
    expect(src).not.toMatch(/\.load\(\)\.locale/);
  });

  it('settings.json 损坏 → fail loud（不静默回退到默认值）', () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'settings.json'), '{not json', 'utf8');
    const store = new SettingsStore({ rootDir: root });
    expect(() => store.load()).toThrow(/损坏/);
  });
});

describe('TUI — /explain 与 ?（复用同一词库，task 117）', () => {
  let root: string;
  let store: ProviderStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-guide-tui-'));
    store = new ProviderStore({ rootDir: root });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('/explain 命中词条 → 中英双语解释', async () => {
    const res = await dispatchSlash('/explain 小蜜', { store, io: stubIO(), sessionWorkspace: root });
    expect(res?.output).toContain('小小蜜');
    expect(res?.output).toContain('中文解释');
  });

  it('? <term> 与 /explain 同一实现（命中 Collect）', async () => {
    const res = await dispatchSlash('?Collect', { store, io: stubIO(), sessionWorkspace: root });
    expect(res?.output).toContain('Collect');
    expect(res?.output).toContain('收集');
  });

  it('未收录词 → 提示 list-terms；/help 列出 /explain', async () => {
    const miss = await dispatchSlash('/explain 词库外xyz', { store, io: stubIO(), sessionWorkspace: root });
    expect(miss?.output).toContain('未收录');
    expect(miss?.output).toContain('list-terms');
    const help = await dispatchSlash('/help', { store, io: stubIO(), sessionWorkspace: root });
    expect(help?.output).toContain('/explain');
  });
});