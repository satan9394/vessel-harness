/**
 * UI geometry acceptance check (PDW `checks` entry for layout work).
 *
 * Builds the web bundle, serves it from a disposable workspace, drives the local Chrome over CDP
 * (no Playwright dependency), and asserts that the conversation's non-transcript furniture never
 * escapes its column and covers the module cards below it.
 *
 * Why a browser: jsdom has no layout engine, and the defect this exists for (card 277 C-F1) passed
 * every component test while the footer was painting 36px over the Goals card.
 *
 * Invariants per viewport (measured after scrolling .conversation-wrap to its bottom):
 *   - .composer-shell bottom <= .conversation bottom  (footer stays inside its column)
 *   - .module-sections top  >= .conversation bottom   (cards start after it)
 *   - .meter-keys' parent rect does not intersect .module-card-goal (1px tolerance)
 *   - .message-list-scroll keeps a usable height      (the fix must not squeeze the transcript away)
 *
 * Exit 0 only when every case passes; failures print the offending numbers and exit 1.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const repo = process.cwd();
const CASES = [
  { name: '360x900-1line', width: 360, height: 900, lines: 1, minTranscript: 60 },
  { name: '360x900-8lines', width: 360, height: 900, lines: 8, minTranscript: 60 },
  { name: '960x600-8lines', width: 960, height: 600, lines: 8, minTranscript: 60 },
  { name: '1440x480-8lines', width: 1440, height: 480, lines: 8, minTranscript: 60 },
  { name: '1440x900-8lines', width: 1440, height: 900, lines: 8, minTranscript: 60 },
];
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const fails = [];
const results = [];

function build() {
  const vite = join(repo, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) throw new Error(`vite not found at ${vite}`);
  execFileSync(process.execPath, [vite, 'build'], { cwd: join(repo, 'apps', 'web'), stdio: 'pipe' });
}

const root = mkdtempSync(join(tmpdir(), 'vessel-uigeom-'));
const ps = (c) => execFileSync('powershell', ['-NoProfile', '-Command', c], { encoding: 'utf8' }).trim();
ps(`New-Item -ItemType Directory -Force -Path '${join(root, 'ws')}','${join(root, 'providers')}','${join(root, 'usage')}','${join(root, 'sessions')}' | Out-Null`);
const ws = ps(`(Resolve-Path '${join(root, 'ws')}').Path`);
const port = 5811, cdpPort = 9341, base = `http://127.0.0.1:${port}`;

const MEASURE = `(() => {
  const wrap = document.querySelector('.conversation-wrap');
  if (wrap) { wrap.scrollTop = wrap.scrollHeight; wrap.scrollTop = wrap.scrollHeight; }
  const q = (s) => document.querySelector(s);
  const box = (el) => el ? { top: +el.getBoundingClientRect().top.toFixed(2), bottom: +el.getBoundingClientRect().bottom.toFixed(2), height: +el.getBoundingClientRect().height.toFixed(2) } : null;
  const hints = q('.meter-keys')?.parentElement;
  const goals = q('.module-card-goal');
  const conv = q('.conversation');
  const shell = q('.composer-shell');
  const list = q('.message-list-scroll');
  const sections = q('.module-sections');
  const h = hints?.getBoundingClientRect(), g = goals?.getBoundingClientRect();
  return {
    hints: box(hints), goals: box(goals), conversation: box(conv), composer: box(shell), sections: box(sections), transcript: box(list),
    overlap: h && g ? !(h.bottom <= g.top || h.top >= g.bottom) : null,
    overlapPx: h && g ? +Math.max(0, Math.min(h.bottom, g.bottom) - Math.max(h.top, g.top)).toFixed(2) : null,
    footerOverflowPx: conv && shell ? +(shell.getBoundingClientRect().bottom - conv.getBoundingClientRect().bottom).toFixed(2) : null,
    sectionsGapPx: conv && sections ? +(sections.getBoundingClientRect().top - conv.getBoundingClientRect().bottom).toFixed(2) : null,
    transcriptClientH: list ? list.clientHeight : null,
  };
})()`;

let server, chrome, conn;
try {
  build();
  server = spawn(process.execPath, ['--import', 'tsx', 'apps/cli/src/cli.ts', 'serve', '--port', String(port), '--workspace', ws], {
    cwd: repo, env: { ...process.env, VESSEL_PROVIDER_ROOT: join(root, 'providers'), VESSEL_USAGE_ROOT: join(root, 'usage'), VESSEL_SESSION_ROOT: join(root, 'sessions') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ } await wait(500); }
  const created = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: ws, provider: 'mock', model: 'mock' }) });
  if (!created.ok) throw new Error(`session create ${created.status}`);

  chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${join(root, 'chrome')}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60; i += 1) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl; if (target) break; } catch { /* wait */ } await wait(250); }
  if (!target) throw new Error('no CDP endpoint');
  conn = new WebSocket(target);
  await new Promise((res, rej) => { conn.onopen = res; conn.onerror = () => rej(new Error('CDP websocket failed')); });
  let id = 0; const pending = new Map();
  conn.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { id += 1; pending.set(id, { res, rej }); conn.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Page.navigate', { url: base }, sessionId);
  await wait(4000);
  const entered = await evaluate(`(() => { const b = document.querySelector('.side-item.topic-session'); b?.click(); return !!b; })()`);
  if (!entered) throw new Error('session row not found in the sidebar');
  await wait(2500);

  for (const c of CASES) {
    await send('Emulation.setDeviceMetricsOverride', { width: c.width, height: c.height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await wait(700);
    await evaluate(`(() => {
      const ta = document.querySelector('textarea.composer-input');
      if (!ta) return false;
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, ${JSON.stringify(Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n'))}.split('\\n').slice(0, ${c.lines}).join('\\n'));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await wait(600);
    const m = await evaluate(MEASURE);
    const bad = [];
    if (m.footerOverflowPx === null) bad.push('conversation/composer missing');
    else if (m.footerOverflowPx > 0.5) bad.push(`footerOverflowPx=${m.footerOverflowPx}`);
    if (m.sectionsGapPx === null) bad.push('module-sections missing');
    else if (m.sectionsGapPx < -0.5) bad.push(`sectionsGapPx=${m.sectionsGapPx}`);
    if (m.overlap !== false) bad.push(`overlap=${m.overlap} (${m.overlapPx}px)`);
    if ((m.transcriptClientH ?? 0) < c.minTranscript) bad.push(`transcriptClientH=${m.transcriptClientH}`);
    results.push({ case: c.name, ...m, failures: bad });
    if (bad.length) fails.push(`${c.name}: ${bad.join(', ')}`);
  }
} catch (error) {
  fails.push(`harness error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try { conn?.close(); } catch { /* ignore */ }
  chrome?.kill(); server?.kill(); await wait(600);
}

const out = { generatedAt: new Date().toISOString(), cases: results, failures: fails };
writeFileSync(join(repo, 'evidence', 'sessions', 'ui-geom-check.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out, null, 2));
if (fails.length) { console.error(`geometry check failed:\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`geometry check passed (${CASES.length} cases)`);
