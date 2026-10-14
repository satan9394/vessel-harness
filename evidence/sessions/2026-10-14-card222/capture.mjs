/**
 * Card 222 offline Chromium + CDP screenshot capture (zero npm deps).
 *
 *   node evidence/sessions/2026-10-14-card222/capture.mjs <appUrl> <outDir>
 *
 * Drives a headless Chromium over the DevTools Protocol using Node's built-in
 * `WebSocket` + `fetch`. Writes PNGs plus `browser-capture-meta.json`.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const appUrl = process.argv[2];
const outDir = process.argv[3];
if (!appUrl || !outDir) { process.stderr.write('usage: node capture.mjs <appUrl> <outDir>\n'); process.exit(2); }

const chrome = process.env.VESSEL_CHROME
  ?? path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
if (!fs.existsSync(chrome)) { process.stderr.write(`chromium not found: ${chrome}\n`); process.exit(2); }

const DEBUG_PORT = 9334;
const events = [];
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-card222-chrome-'));
const chromeProc = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000',
  '--no-proxy-server', '--proxy-bypass-list=<-loopback>', '--disable-features=NetworkServiceInProcess',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJson(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { const res = await fetch(url); if (res.ok) return await res.json(); } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${url}`);
}

let ws;
let nextId = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
  const waitFor = async (expression, attempts = 60) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await evaluate(expression)) return true;
      await sleep(250);
    }
    return false;
  };

  const viewport = async (width, height) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 800 });
  };
  const setLang = async (lang) => {
    await evaluate(`localStorage.setItem('vessel.ui.lang', ${JSON.stringify(lang)})`);
    await send('Page.reload', { ignoreCache: false });
    await waitFor("!!document.querySelector('.primary-nav')");
    await sleep(500);
  };

  const shots = [];
  const capture = async (id, lang, size, factsExpression) => {
    // Presentation-only capture tweak: the app shell scrolls inside `main`, so
    // release that constraint to size the emulated viewport to the real content
    // height and photograph the whole surface in one frame.
    await evaluate(`(() => { for (const el of [document.documentElement, document.body, document.querySelector('main'), document.querySelector('main .main-body')]) { if (el) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; } } return true; })()`);
    await sleep(150);
    const contentHeight = await evaluate('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1000)');
    await send('Emulation.setDeviceMetricsOverride', { width: size.width, height: Math.min(Number(contentHeight) || 1000, 6000), deviceScaleFactor: 1, mobile: size.width <= 800 });
    await sleep(300);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const bytes = Buffer.from(data, 'base64');
    const file = `card222-${id}.png`;
    fs.writeFileSync(path.join(outDir, file), bytes);
    const text = await evaluate('document.querySelector("main")?.innerText ?? ""');
    let facts = null;
    if (factsExpression) { try { facts = JSON.parse(await evaluate(`JSON.stringify(${factsExpression})`)); } catch { facts = null; } }
    shots.push({ id, file, lang, viewport: size, url: appUrl, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), facts, text: String(text).replace(/\s+/g, ' ').slice(0, 600), capturedAt: new Date().toISOString() });
    process.stdout.write(`captured ${file} (${bytes.length} bytes)\n`);
  };

  const ACTIVITY_FACTS = `({
    treeStatuses: [...document.querySelectorAll('.task-tree-node')].map((node) => node.getAttribute('data-status')),
    treeNodes: [...document.querySelectorAll('.task-tree-node')].map((node) => node.getAttribute('data-instance')),
    queueStatuses: [...document.querySelectorAll('.activity-run')].map((node) => node.getAttribute('data-status')),
    approvalButtons: [...document.querySelectorAll('.activity-run button')].map((b) => b.textContent),
  })`;
  const STUDIO_FACTS = `({
    libraryRules: document.querySelectorAll('.composer-library-list .composer-rule').length,
    stagedRules: document.querySelectorAll('.composer-staged-list .composer-rule').length,
    verdict: document.querySelector('.composer-report .status-badge')?.textContent ?? null,
    conflicts: document.querySelectorAll('.composer-conflicts li').length,
    conformance: document.querySelectorAll('.composer-conformance li').length,
    levels: document.querySelector('.composer-report p:last-of-type')?.textContent ?? null,
  })`;

  const clickArea = async (area) => {
    await evaluate(`document.querySelector('[data-area="${area}"]')?.click()`);
    await sleep(700);
  };

  const runVariant = async (lang, width, height, suffix) => {
    await viewport(width, height);
    await setLang(lang);
    await clickArea('activity');
    await waitFor("!!(document.querySelector('.activity-queue') && document.querySelector('.team-task-tree'))");
    await waitFor("document.querySelectorAll('.task-tree-node').length > 0 || document.querySelectorAll('.activity-run').length > 0", 40);
    await sleep(500);
    await capture(`activity-${lang}-${suffix}`, lang, { width, height }, ACTIVITY_FACTS);

    await setLang(lang);
    await clickArea('studio');
    await waitFor("!!document.querySelector('.agent-studio-composer')");
    await waitFor("document.querySelectorAll('.composer-library-list .composer-rule').length > 0", 40);
    await evaluate(`(() => { const buttons = [...document.querySelectorAll('.composer-library-list button')].slice(0, 3); buttons.forEach((button) => button.click()); return buttons.length; })()`);
    await sleep(300);
    await evaluate(`(() => { const button = [...document.querySelectorAll('.agent-studio-composer button')].find((item) => /Verify|校验/.test(item.textContent || '')); button?.click(); return !!button; })()`);
    await waitFor("!!document.querySelector('.composer-report')", 40);
    await sleep(400);
    await capture(`studio-${lang}-${suffix}`, lang, { width, height }, STUDIO_FACTS);
  };

  await send('Page.navigate', { url: appUrl });
  await waitFor("!!document.querySelector('.primary-nav')");
  await sleep(1200);
  await evaluate(`localStorage.setItem('vessel.ui.lang','en')`);
  await send('Page.reload');
  await sleep(2500);
  const diag = await evaluate(`(async () => {
    const out = { href: location.href, hasNav: !!document.querySelector('.primary-nav') };
    for (const p of ['/api/health','/api/projects','/api/sessions','/api/activity/runs','/api/tasks/tree']) {
      try { const r = await fetch(p); out[p] = r.status + ':' + (await r.text()).slice(0, 60); } catch (e) { out[p] = 'ERR ' + String(e); }
    }
    try { const r = await fetch('/api/health', { headers: { 'Content-Type': 'application/json' } }); out.withJsonHeader = r.status; } catch (e) { out.withJsonHeader = 'ERR ' + String(e); }
    out.statusText = document.querySelector('.statusbar .status-text')?.textContent ?? null;
    return JSON.stringify(out);
  })()`);
  process.stdout.write(`diag: ${diag}\n`);

  await runVariant('en', 1440, 1000, 'desktop');
  await runVariant('zh', 1440, 1000, 'desktop');
  await runVariant('en', 800, 1000, 'mobile800');
  await runVariant('zh', 800, 1000, 'mobile800');

  const meta = {
    tool: 'offline-chromium-cdp',
    builtFor: 'card 222 (ARC-10 / UI-013 / UI-015 / UI-016 / UI-017)',
    chromium: version['Browser'] ?? 'unknown',
    appUrl,
    capturedAt: new Date().toISOString(),
    shots,
    assertions: {
      note: 'per-shot `facts` above are the authoritative DOM-derived evidence',
    },
    captureMode: 'full-surface: internal `main` overflow released at capture time so each PNG shows the entire surface',
    events: events.slice(-40),
  };
  fs.writeFileSync(path.join(outDir, 'browser-capture-meta.json'), JSON.stringify(meta, null, 2));
  process.stdout.write(`wrote browser-capture-meta.json (${shots.length} shots)\n`);
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  chromeProc.kill();
  try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
}
