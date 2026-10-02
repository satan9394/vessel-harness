// Offline foreground browser fixture. Port 30179 must be free before running.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVesselServer } from '@vessel/local-server';
import { ProjectRegistry, SessionRegistry, ReviewHandoffStore } from '@vessel/application';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-epic179-browser-'));
for (const name of ['SESSION', 'PROVIDER', 'USAGE', 'TASKQUEUE', 'ITERATIONS', 'HANDOFFS', 'MCP', 'SETTINGS']) {
  process.env[`VESSEL_${name}_ROOT`] = path.join(root, name.toLowerCase());
}
const token = 'a'.repeat(48); // Test credential; never a real daemon token.
const projects = new ProjectRegistry({ vesselHome: root });
projects.open(root);
const server = createVesselServer({ port: 30179, authToken: token,
  staticDir: path.join(repo, 'apps/web/dist'), projectRegistry: projects,
  sessionRegistry: new SessionRegistry({ vesselHome: root }),
  reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
});
await server.listen();
const response = await fetch('http://127.0.0.1:30179/api/sessions', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ workspaceRoot: root }),
});
if (!response.ok) throw new Error(`Fixture session failed: ${response.status}`);
console.log(JSON.stringify({ url: 'http://127.0.0.1:30179/api/health', root, session: await response.json() }));
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  // Fixture retains its own temporary data for inspection; no user files are deleted.
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
