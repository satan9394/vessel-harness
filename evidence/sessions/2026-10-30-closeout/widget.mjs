import fs from 'node:fs';
import path from 'node:path';
const evidence = import.meta.dirname;
const startup = JSON.parse(fs.readFileSync(path.join(evidence, 'startup.json')));
const fixture = JSON.parse(fs.readFileSync(path.join(evidence, 'fixture-data.json')));
const id = fixture.session.id;
const base = `http://127.0.0.1:${startup.ports.serve}`;
const mode = process.argv[2] ?? 'create';
const controller = new AbortController();
const response = await fetch(`${base}/api/sessions/${id}/events?hydrate=1`, { signal: controller.signal });
if (!response.ok) throw new Error(`SSE ${response.status}`);
const chunks = [];
const reading = (async () => {
  try { for await (const chunk of response.body) chunks.push(Buffer.from(chunk)); }
  catch (error) { if (error.name !== 'AbortError') throw error; }
})();
await new Promise(resolve => setTimeout(resolve, 200));
const turnResponse = await fetch(`${base}/api/sessions/${id}/turns`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: `WRITE_FIXTURE: ${mode === 'create' ? 'create new' : 'overwrite existing'} fixture.txt with before and second lines.` }) });
const turn = await turnResponse.json();
await new Promise(resolve => setTimeout(resolve, 200));
controller.abort(); await reading;
const raw = Buffer.concat(chunks).toString('utf8');
const events = raw.split('\n').filter(line => line.startsWith('data: ')).map(line => { try { return JSON.parse(line.slice(6)); } catch { return { unparsed: line }; } });
const logPath = path.join(startup.ws, '.harness', 'sessions', id, 'session.jsonl');
const records = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const widgets = events.filter(e => ['widget_block', 'widget'].includes(e.type));
const widgetRecords = records.filter(r => /widget/.test(r.type));
const toolRecords = records.filter(r => ['tool/call', 'tool/result'].includes(r.type) && r.toolName === 'Write');
const proof = { mode, sessionId: id, turnStatus: turnResponse.status, turn, fileContent: fs.readFileSync(path.join(startup.ws, 'fixture.txt'), 'utf8'), logPath,
  counts: Object.fromEntries(['widget_block', 'widget'].map(type => [type, widgets.filter(e => e.type === type).length])), widgets, widgetRecords, toolRecords, events, raw };
fs.writeFileSync(path.join(evidence, `t3-${mode}.json`), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ mode, turn, counts: proof.counts, widgetRecords: widgetRecords.length, toolRecords: toolRecords.length }));
