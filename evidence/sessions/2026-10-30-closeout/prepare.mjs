import fs from 'node:fs';
import path from 'node:path';
const evidence = import.meta.dirname;
const startup = JSON.parse(fs.readFileSync(path.join(evidence, 'startup.json')));
const base = `http://127.0.0.1:${startup.ports.serve}`;
const teamBase = `http://127.0.0.1:${startup.ports.team}`;
async function api(base, route, method = 'GET', body) {
  const response = await fetch(base + route, { method, headers: { Origin: base, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${JSON.stringify(value)}`);
  return value;
}
for (const origin of [base, teamBase]) {
  await api(origin, '/api/health');
  await api(origin, '/api/providers', 'POST', { name: 'fixture', protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${startup.ports.provider}/v1`, apiKey: '', models: ['fixture-model'] });
}
const { session } = await api(base, '/api/sessions', 'POST', { workspaceRoot: startup.ws, provider: 'fixture', model: 'fixture-model', permission: 'workspace-write' });
const title = '头部观感复核：这是用于挤压会话头部的超长标题，检查调用次数、用量与费用在窄视口仍然完整可读。'.repeat(3);
await api(base, `/api/sessions/${session.id}/topic`, 'PATCH', { title });
const reply = await api(base, `/api/sessions/${session.id}/turns`, 'POST', { prompt: 'Please provide one assistant reply for the header verification fixture.' });
fs.writeFileSync(path.join(evidence, 'fixture-data.json'), JSON.stringify({ session, title, reply, startup }, null, 2));
const { session: teamSession } = await api(teamBase, '/api/sessions', 'POST', { workspaceRoot: startup.ws, provider: 'fixture', model: 'fixture-model', permission: 'workspace-write' });
await api(teamBase, `/api/sessions/${teamSession.id}/topic`, 'PATCH', { title: 'T2 runtime summary scope proof' });
const stages = [];
for (const length of [298, 300, 570]) {
  const { stage } = await api(teamBase, `/api/sessions/${teamSession.id}/team-stages`, 'POST', { task: `SUMMARY_${length}`, mode: 'fast', tasks: [{ id: `summary_${length}`, title: `Summary ${length}`, description: `SUMMARY_${length}`, assignedRole: 'generator', dependencies: [], status: 'pending' }] });
  await api(teamBase, `/api/team/stages/${stage.id}/approve`, 'POST', {});
  let settled;
  for (let i = 0; i < 100; i++) {
    settled = (await api(teamBase, `/api/team/stages/${stage.id}`)).stage;
    if (settled.status === 'finished') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  stages.push({ requestedLength: length, stage: settled, receivedLength: settled.tasks[0].result?.output.length });
}
const expected = JSON.parse(fs.readFileSync(path.join(startup.root, 'expected.json')));
fs.writeFileSync(path.join(evidence, 't2-runtime.json'), JSON.stringify({ teamSession, expected, stages, scopeBlocker: 'packages/agents/src/team/TeamRuntime.ts:getStage trims output at 300 before HTTP; apps/local-server/src/teamRoutes.ts:get calls getStage; no full task-result HTTP route. Drawer cannot reconstruct 570 original characters from the 301-character projection.' }, null, 2));
console.log(JSON.stringify({ sessionId: session.id, reply: reply.kind, stages: stages.map(s => ({ input: s.requestedLength, output: s.receivedLength })) }));
