import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const evidence = import.meta.dirname;
const startup = JSON.parse(fs.readFileSync(path.join(evidence, 'startup.json')));
const web = path.join(startup.root, 'web');
const server = http.createServer((req, res) => {
  if (req.url === '/fixture-stop') { res.end('stopping'); setImmediate(() => server.close()); return; }
  if (req.url.startsWith('/api/')) {
    const upstream = http.request({ hostname: '127.0.0.1', port: startup.ports.serve, path: req.url, method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    upstream.on('error', error => { res.writeHead(502); res.end(error.message); });
    req.pipe(upstream); return;
  }
  const file = req.url.startsWith('/assets/') ? path.join(web, path.basename(req.url.split('?')[0]) ? 'assets/' + path.basename(req.url.split('?')[0]) : '') : path.join(web, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
server.listen(5697, '127.0.0.1', () => {
  const proof = { pid: process.pid, port: 5697, web, backend: startup.ports.serve, purpose: 'TEMP production build with untouched real vessel serve API; Host and Origin forwarded unchanged' };
  fs.writeFileSync(path.join(evidence, 'frontend.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
});
