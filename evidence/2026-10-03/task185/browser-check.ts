/** Offline end-to-end check. Uses the bundled Playwright runtime; installs nothing. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { SessionController, SessionRegistry, ProjectRegistry, ReviewHandoffStore } from '@vessel/application';
import { NativeMeshEventBus } from '@vessel/agents';
import { MockProvider } from '@vessel/llm';
import { createVesselServer } from '../../../apps/local-server/src/server.js';

const { chromium } = createRequire(import.meta.url)(process.env.VESSEL_PLAYWRIGHT_PACKAGE!);
const repo = path.resolve(import.meta.dirname, '../../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-185-browser-'));
const token = 'ab'.repeat(24); // Offline fixture credential, never a real launch token.
const mesh = new NativeMeshEventBus({ nodeId: randomUUID(), endpoint: 'http://127.0.0.1:31885', token, roleCapabilities: ['generator'], status: 'online', latencyMs: 0 });
mesh.startHeartbeat = () => {}; // No peer processes or outgoing probes in this check.
mesh.trustPeer({ nodeId: randomUUID(), endpoint: 'http://127.0.0.1:31886', token: 'cd'.repeat(24), roleCapabilities: ['evaluator'], status: 'online', latencyMs: 12 });
mesh.trustPeer({ nodeId: randomUUID(), endpoint: 'http://127.0.0.1:31887', token: 'ef'.repeat(24), roleCapabilities: ['generator'], status: 'offline', latencyMs: 42 });
process.env.VESSEL_PROVIDER_ROOT = path.join(root, 'providers');
process.env.VESSEL_USAGE_ROOT = path.join(root, 'usage');
const registry = new SessionRegistry({ vesselHome: path.join(root, 'home'), index: true });
const server = createVesselServer({ port: 31885, authToken: token, mesh,
  staticDir: path.join(repo, 'apps/web/dist'), sessionRegistry: registry,
  projectRegistry: new ProjectRegistry({ vesselHome: root }), reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
  sessionFactory: async () => {
    const controller = await SessionController.create({ workspaceRoot: root, model: 'mock', permission: 'danger-full-access', registry,
    provider: new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Shell', arguments: { command: 'echo offline' } }] } },
      { when: /.*/, minToolResults: 1, response: { text: 'Offline execution complete' } },
    ]), policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml'),
    nativeSandbox: { isAvailable: async () => true, execute: async () => ({ stdout: 'offline', stderr: '', exitCode: 0, sandboxed: true, isolationTier: 'bwrap-ns',
      constraints: { readOnlyPaths: ['/'], memoryLimitBytes: null, privilegeReduction: 'Bubblewrap namespace confinement.' } }) } });
    await controller.session.appendSync({ type: 'audit/denial', toolName: 'Write', toolCallId: 'fixture-denial', reason: 'Write outside workspace denied', stage: 'rule', surface: false });
    return controller;
  },
});
let browser: any;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  const base = `http://127.0.0.1:${server.port}`;
  const created = await fetch(base + '/api/sessions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root }) });
  if (!created.ok) throw new Error(await created.text());
  await page.addInitScript(() => localStorage.setItem('vessel.ui.modules', JSON.stringify({ Swarm: true, CognitiveRules: true, Tasks: false, ChangedFiles: false })));
  await page.goto(base + '/api/health');
  await page.locator('input[type=password]').fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('heading', { name: 'Swarm topology' }).waitFor();
  await page.getByRole('img', { name: 'Swarm peer connections' }).waitFor();
  await page.getByRole('list', { name: 'Reflective rules' }).waitFor();
  await page.getByLabel('Category', { exact: true }).selectOption('tool_failure');
  await page.getByText('No matching reflective rules.', { exact: true }).waitFor();
  await page.getByLabel('Category', { exact: true }).selectOption('policy_denial');
  await page.getByRole('list', { name: 'Reflective rules' }).waitFor();
  await page.getByLabel('Search rules', { exact: true }).fill('no-such-lesson');
  await page.getByText('No matching reflective rules.', { exact: true }).waitFor();
  await page.getByLabel('Search rules', { exact: true }).fill('');
  await page.locator('.topic-title').first().click();
  await page.locator('.composer-input').fill('Run offline fixture');
  await page.locator('.composer button[type=submit]').click();
  await page.locator('.tool-row summary').filter({ hasText: 'Sandbox: bwrap-ns' }).waitFor();
  await page.locator('.tool-row summary').click();
  await page.locator('.tool-row .sandbox-audit-drawer').getByText('Bubblewrap namespace confinement.', { exact: true }).waitFor();
  await page.locator('.tool-row .sandbox-audit-drawer').getByText('No native memory cap configured.', { exact: true }).waitFor();
  await page.locator('.tool-row .sandbox-audit-drawer code').filter({ hasText: /^\/$/ }).waitFor();
  await page.screenshot({ path: path.join(import.meta.dirname, 'sandbox-drawer.png'), fullPage: true, mask: [page.locator('.sandbox-audit-details code')] });
  await page.locator('.tool-row .sandbox-audit-drawer button').focus();
  await page.keyboard.press('Escape');
  if (await page.locator('.tool-row details').evaluate((element: HTMLDetailsElement) => element.open)) throw new Error('Escape did not close the sandbox drawer');
  await page.getByText('Talking sandbox audits', { exact: true }).click();
  await page.locator('.sandbox-audit-history summary').filter({ hasText: 'Sandbox: bwrap-ns' }).waitFor();
  await page.getByRole('heading', { name: 'Swarm topology' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(import.meta.dirname, 'desktop.png'), fullPage: true });
  await page.getByRole('heading', { name: 'Cognitive rules' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(import.meta.dirname, 'rules.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(import.meta.dirname, 'mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow || errors.length) throw new Error(JSON.stringify({ overflow, errors }));
  console.log('PASS: authenticated production UI, SVG topology, category/live search, actual Mock Shell SSE badge, recorded read-only roots/memory/privileges, Escape closes drawer, Talking persisted audits, desktop/mobile no horizontal overflow, no page errors. Port 31885.');
} finally {
  await browser?.close();
  await server.close();
  // Only this check's own os.tmpdir directory; all consumers have closed.
  fs.rmSync(root, { recursive: true, force: true });
}
