/**
 * Card 221 offline headless-browser evidence capture.
 *
 * Drives the locally-built offline Chromium (ms-playwright cache) over CDP with
 * Node's built-in WebSocket — no npm dependency, no network. Captures the Agent
 * Studio L0–L4 inspector in Chinese, English, and at an 800px viewport, then
 * records the raw `/api/behavior/inspect` payload alongside the screenshots.
 *
 * Usage: node capture-studio.mjs <appUrl> <outDir>
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const appUrl = process.argv[2];
const outDir = path.resolve(process.argv[3] ?? '.');
const debugPort = 9333;
const chrome = process.env.VESSEL_CHROME
  ?? path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
if (!appUrl) throw new Error('appUrl required');
if (!existsSync(chrome)) throw new Error(`Chromium not found: ${chrome}`);
mkdirSync(outDir, { recursive: true });

const profile = path.join(os.tmpdir(), `vessel-card221-cdp-${Date.now()}`);
const browser = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--disable-extensions', '--disable-background-networking', '--disable-sync', 'about:blank',
], { stdio: 'ignore' });
const killBrowser = () => { try { browser.kill(); } catch { /* already gone */ } };
process.on('exit', killBrowser);
process.on('uncaughtException', error => { console.error(error); process.exit(1); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = list.find(target => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chromium CDP endpoint never became ready');
}

function connect(url) {
  const socket = new WebSocket(url);
  let next = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('CDP socket error')));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { ready, send, close: () => socket.close() };
}

const cdp = connect(await endpoint());
await cdp.ready;
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

async function evaluate(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`evaluate failed: ${result.exceptionDetails.text} :: ${expression}`);
  return result.result.value;
}

async function waitFor(expression, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`!!(${expression})`)) return;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${label} :: ${expression}`);
}

async function setViewport(width, height, scale) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
}

async function openInspector(lang) {
  if (await evaluate(`location.origin === new URL(${JSON.stringify(appUrl)}).origin`)) {
    await evaluate(`localStorage.setItem('vessel.ui.lang', ${JSON.stringify(lang)})`);
  } else {
    await cdp.send('Page.navigate', { url: appUrl });
    await waitFor(`location.origin === new URL(${JSON.stringify(appUrl)}).origin && document.readyState === 'complete'`, `${lang}: first origin load`);
    await evaluate(`localStorage.setItem('vessel.ui.lang', ${JSON.stringify(lang)})`);
  }
  await cdp.send('Page.navigate', { url: appUrl });
  await waitFor(`document.querySelector('[data-area="activity"]')`, `${lang}: navigation shell`);
  await evaluate(`document.querySelector('[data-area="activity"]').click()`);
  await waitFor(`document.querySelector('.activity-sessions button')`, `${lang}: session list`);
  await evaluate(`document.querySelector('.activity-sessions button').click()`);
  await evaluate(`document.querySelector('[data-area="studio"]').click()`);
  await waitFor(`document.querySelector('.agent-studio-inspector .behavior-inspection') || document.querySelector('.agent-studio-inspector [role="alert"]')`, `${lang}: inspector result`);
  await sleep(400);
}

async function capture(file) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(shot.data, 'base64');
  writeFileSync(path.join(outDir, file), bytes);
  return { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** Scroll the semantic-category badges and 5-level compatibility ladders into view for a second shot. */
async function captureLadderSection(file) {
  await evaluate(`document.querySelector('.behavior-entries')?.scrollIntoView({ block: 'start' })`);
  await sleep(350);
  return capture(file);
}

const shots = [];
await setViewport(1440, 960, 2);
await openInspector('zh');
shots.push(await capture('card221-studio-inspector-zh-desktop.png'));
shots.push(await captureLadderSection('card221-studio-inspector-zh-entries.png'));
const zhText = await evaluate(`document.querySelector('.agent-studio-inspector').innerText.slice(0, 4000)`);
await openInspector('en');
shots.push(await capture('card221-studio-inspector-en-desktop.png'));
shots.push(await captureLadderSection('card221-studio-inspector-en-entries.png'));
const enText = await evaluate(`document.querySelector('.agent-studio-inspector').innerText.slice(0, 4000)`);
await setViewport(800, 1000, 2);
await openInspector('en');
shots.push(await capture('card221-studio-inspector-en-800px.png'));
shots.push(await captureLadderSection('card221-studio-inspector-en-800px-entries.png'));
const ladder = await evaluate(`Array.from(document.querySelectorAll('.behavior-ladder li')).length`);
const layers = await evaluate(`Array.from(document.querySelectorAll('.behavior-layers li')).map(li => li.getAttribute('data-layer'))`);

let apiInspect = null;
try {
  const meta = JSON.parse(readFileSync(path.join(outDir, 'browser-fixture-meta.json'), 'utf8'));
  apiInspect = await evaluate(`fetch('/api/behavior/inspect?sessionId=' + ${JSON.stringify(meta.sessionId)}, { headers: { Origin: location.origin } }).then(r => r.json())`);
} catch (error) { apiInspect = { error: String(error) }; }

writeFileSync(path.join(outDir, 'browser-capture-meta.json'), JSON.stringify({
  appUrl, chrome, viewportDesktop: { width: 1440, height: 960, deviceScaleFactor: 2 },
  viewportResponsive: { width: 800, height: 1000, deviceScaleFactor: 2 },
  shots, ladderStepsPerEntry: ladder, layerLevels: layers,
  inspectorText: { zh: zhText, en: enText },
  apiInspect,
}, null, 2));

console.log(JSON.stringify({ shots, ladderStepsPerEntry: ladder, layerLevels: layers }, null, 2));
cdp.close();
browser.kill();
await sleep(200);
process.exit(0);
