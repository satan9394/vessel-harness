/**
 * UI landing (VESSEL-UI-2026-02) offline Chromium + CDP screenshot capture — zero npm deps.
 *
 *   node evidence/sessions/2026-10-15-ui-landing/capture.mjs <appUrl> <outDir> [matrix]
 *
 * `matrix` defaults to "p2" (workbench light/dark). Other values: "full" (the
 * DoD matrix: zh/en x light/dark x desktop/1366/1023/800 across regions).
 * Theme is forced through CDP `prefers-color-scheme` emulation, so the real
 * app's `@media (prefers-color-scheme: dark)` path is what gets photographed.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const appUrl = process.argv[2];
const outDir = process.argv[3];
const matrix = process.argv[4] ?? 'p2';
if (!appUrl || !outDir) { process.stderr.write('usage: node capture.mjs <appUrl> <outDir> [matrix]\n'); process.exit(2); }

const chrome = process.env.VESSEL_CHROME
  ?? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
if (!fs.existsSync(chrome)) { process.stderr.write(`chromium not found: ${chrome}\n`); process.exit(2); }

const DEBUG_PORT = 9336;
const events = [];
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-uilanding-chrome-'));
const chromeProc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000',
  '--no-proxy-server', '--proxy-bypass-list=<-loopback>', '--disable-features=NetworkServiceInProcess',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { const res = await fetch(url); if (res.ok) return await res.json(); } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

let ws;
let nextId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const version = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('no page target');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = (event) => reject(new Error(String(event.message ?? 'ws error'))); });
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') events.push({ kind: 'exception', detail: message.params?.exceptionDetails?.text ?? '', url: message.params?.exceptionDetails?.url });
    if (message.method === 'Runtime.consoleAPICalled') events.push({ kind: `console.${message.params?.type}`, detail: (message.params?.args ?? []).map((arg) => arg.value ?? arg.description).join(' ') });
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, method } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`)); else resolve(message.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate failed');
    return result.result?.value;
  };
  const waitFor = async (expression, attempts = 80) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return true;
      await sleep(250);
    }
    return false;
  };
  const setTheme = async (theme) => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  };
  const setLang = async (lang) => {
    await evaluate(`localStorage.setItem('vessel.ui.lang', ${JSON.stringify(lang)})`);
    await send('Page.reload', { ignoreCache: false });
    await waitFor("!!document.querySelector('.primary-nav')");
    await sleep(600);
  };

  const shots = [];
  const capture = async (id, meta, factsExpression) => {
    // Presentation-only capture tweak: release the internal `main` scroll so the
    // emulated viewport can size to the real content and photograph it in one frame.
    await evaluate(`(() => { for (const el of [document.documentElement, document.body, document.querySelector('main')]) { if (el) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; } } return true; })()`);
    await sleep(150);
    const contentHeight = await evaluate('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1000)');
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const bytes = Buffer.from(data, 'base64');
    const file = `${id}.png`;
    fs.writeFileSync(path.join(outDir, file), bytes);
    const text = await evaluate('document.querySelector("main")?.innerText ?? ""');
    let facts = null;
    if (factsExpression) { try { facts = JSON.parse(await evaluate(`JSON.stringify(${factsExpression})`)); } catch { facts = null; } }
    shots.push({ id, file, ...meta, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), facts, text: String(text).replace(/\s+/g, ' ').slice(0, 900), capturedAt: new Date().toISOString() });
    process.stdout.write(`captured ${file} (${bytes.length} bytes, contentHeight=${contentHeight})\n`);
  };

  const THEME_FACTS = `({
    theme: getComputedStyle(document.documentElement).getPropertyValue('color-scheme'),
    bg: getComputedStyle(document.body).backgroundColor,
    panelRadius: getComputedStyle(document.querySelector('.main') ?? document.body).borderRadius,
    navBackdrop: getComputedStyle(document.querySelector('.navigation-shell') ?? document.body).backdropFilter,
    topbarBackdrop: getComputedStyle(document.querySelector('.topbar') ?? document.body).backdropFilter,
    navBg: getComputedStyle(document.querySelector('.navigation-shell') ?? document.body).backgroundColor,
    gridCols: getComputedStyle(document.querySelector('.app') ?? document.body).gridTemplateColumns,
    navAreas: [...document.querySelectorAll('[data-area]')].map((b) => b.getAttribute('data-area')),
  })`;

  const clickArea = async (area) => {
    await evaluate(`document.querySelector('[data-area="${area}"]')?.click()`);
    await sleep(700);
  };

  const viewport = async (width, height, mobile) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: mobile ?? width <= 800 });
  };

  await send('Page.navigate', { url: appUrl });
  await waitFor("!!document.querySelector('.primary-nav')");
  await sleep(1500);

  const runShot = async (id, lang, theme, width, height, area) => {
    await setTheme(theme);
    await setLang(lang);
    await viewport(width, height);
    if (area && area !== 'workbench') await clickArea(area);
    await sleep(500);
    await capture(id, { lang, theme, viewport: { width, height }, area: area ?? 'workbench', url: appUrl }, THEME_FACTS);
  };

  if (matrix === 'p2') {
    await runShot('p2-workbench-light', 'zh', 'light', 1440, 1000, 'workbench');
    await runShot('p2-workbench-dark', 'zh', 'dark', 1440, 1000, 'workbench');
    await runShot('p2-activity-dark', 'zh', 'dark', 1440, 1000, 'activity');
  } else if (matrix === 'p6') {
    // P6: studio wall + activity + workbench across desktop/1366 + light/dark.
    const runArea = async (id, lang, theme, width, height, area) => {
      await setTheme(theme);
      await setLang(lang);
      await viewport(width, height);
      await clickArea(area);
      await sleep(700);
      await capture(id, { lang, theme, viewport: { width, height }, area, url: appUrl }, `({
        composerRules: document.querySelectorAll('.composer-library-list .composer-rule').length,
        composerEmpty: document.querySelector('.composer-empty')?.textContent ?? null,
        borderedEntries: [...document.querySelectorAll('.behavior-entry, .behavior-layers > li')].filter((n) => getComputedStyle(n).borderTopWidth === '0px' && getComputedStyle(n).borderLeftWidth === '0px').length,
        rows: [...document.querySelectorAll('.activity-sessions .btn, .side-item')].map((n) => n.textContent).slice(0, 8),
        gridCols: getComputedStyle(document.querySelector('.app') ?? document.body).gridTemplateColumns,
      })`);
    };
    await runArea('p6-studio-light', 'zh', 'light', 1440, 1000, 'studio');
    await runArea('p6-studio-dark', 'zh', 'dark', 1440, 1000, 'studio');
    await runArea('p6-studio-1366-dark', 'zh', 'dark', 1366, 900, 'studio');
    await runArea('p6-activity-dark', 'zh', 'dark', 1440, 1000, 'activity');
    await runArea('p6-workbench-1366-light', 'zh', 'light', 1366, 900, 'workbench');
  } else if (matrix === 'p3' || matrix === 'p4' || matrix === 'p5') {
    // Session view + the 300px review bar (the docked inspector) + the persistent plan strip.
    const prefix = matrix;
    const openSession = async () => {
      await evaluate(`document.querySelector('.topic-session, .side-item.topic-session')?.click()`);
      await sleep(900);
      const hasToolbar = await waitFor("!!document.querySelector('.inspector-toolbar button')");
      if (hasToolbar) {
        // Deterministic: open only when currently closed (reloads persist the state).
        const expanded = await evaluate(`document.querySelector('.inspector-toolbar button')?.getAttribute('aria-expanded')`);
        if (expanded !== 'true') { await evaluate(`document.querySelector('.inspector-toolbar button')?.click()`); await sleep(500); }
      }
      return hasToolbar;
    };
    const runSession = async (id, lang, theme, width, height) => {
      await setTheme(theme);
      await setLang(lang);
      await viewport(width, height);
      await clickArea('workbench');
      await openSession();
      await sleep(700);
      await capture(id, { lang, theme, viewport: { width, height }, area: 'session', url: appUrl }, `({
        inspectorTabs: [...document.querySelectorAll('.inspector-tabs [role="tab"]')].map((b) => b.textContent),
        inspectorRole: document.querySelector('.docked-inspector')?.getAttribute('role'),
        inspectorWidth: document.querySelector('.docked-inspector')?.getBoundingClientRect().width ?? null,
        gridCols: getComputedStyle(document.querySelector('.dual-surface') ?? document.body).gridTemplateColumns,
        railItems: [...document.querySelectorAll('.rail .rail-item')].map((b) => b.getAttribute('data-area')),
        hasToolbar: !!document.querySelector('.inspector-toolbar button'),
        planSteps: [...document.querySelectorAll('.plan-step')].map((n) => n.getAttribute('data-step-state')),
        planCount: document.querySelector('.plan-checklist')?.getAttribute('data-plan-steps') ?? null,
        planTitle: document.querySelector('.plan-title')?.textContent ?? null,
        planLabels: [...document.querySelectorAll('.plan-label')].map((n) => n.textContent),
        capsules: [...document.querySelectorAll('.composer-capsules .capsule')].map((n) => n.textContent),
        modePills: [...document.querySelectorAll('.mode-pill')].map((n) => ({ label: n.textContent, pressed: n.getAttribute('aria-pressed') })),
        meters: [...document.querySelectorAll('.meters .meter')].map((n) => n.textContent),
      })`);
    };
    await runSession(`${prefix}-session-light`, 'zh', 'light', 1440, 1000);
    await runSession(`${prefix}-session-dark`, 'zh', 'dark', 1440, 1000);
    await runSession(`${prefix}-session-en-dark`, 'en', 'dark', 1440, 1000);
    await runSession(`${prefix}-session-1023-dark`, 'zh', 'dark', 1023, 900);
    await runSession(`${prefix}-session-800-dark`, 'zh', 'dark', 800, 1000);
  } else {
    const regions = ['workbench', 'activity', 'studio', 'settings'];
    for (const lang of ['zh', 'en']) {
      for (const theme of ['light', 'dark']) {
        for (const [suffix, width, height] of [['desktop', 1440, 1000], ['1366', 1366, 900], ['1023', 1023, 900], ['800', 800, 1000]]) {
          for (const area of regions) {
            await runShot(`full-${area}-${lang}-${theme}-${suffix}`, lang, theme, width, height, area);
          }
        }
      }
    }
  }

  // Untweaked viewport shot: proves the real (non-released-scroll) layout too.
  await setTheme('light');
  await setLang('zh');
  await viewport(1440, 1000);
  await clickArea('workbench');
  await sleep(400);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'p2-workbench-light-viewport.png'), Buffer.from(data, 'base64'));

  const meta = {
    tool: 'offline-chromium-cdp',
    builtFor: 'VESSEL-UI-2026-02 UI landing (docs/design-prototypes/IMPLEMENTATION-PLAN.md)',
    matrix,
    chromium: version['Browser'] ?? 'unknown',
    appUrl,
    capturedAt: new Date().toISOString(),
    shots,
    captureMode: 'full-surface for matrix shots (internal `main` overflow released); one viewport-faithful shot appended',
    events: events.slice(-40),
  };
  fs.writeFileSync(path.join(outDir, 'browser-capture-meta.json'), JSON.stringify(meta, null, 2));
  process.stdout.write(`wrote browser-capture-meta.json (${shots.length} shots)\n`);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  chromeProc.kill();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
}
