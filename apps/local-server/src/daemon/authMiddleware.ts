import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

/** Bearer headers only; query strings never carry launch credentials. */
export function authMiddleware(req: IncomingMessage, res: ServerResponse, token: string, pathname: string): boolean {
  if (req.method === 'GET' && pathname === '/api/health') return true;
  const authorization = req.headers.authorization;
  const actual = typeof authorization === 'string' && /^Bearer [0-9a-f]{48}$/.test(authorization)
    ? Buffer.from(authorization.slice(7)) : Buffer.alloc(0);
  const expected = Buffer.from(token);
  if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
  return false;
}

/** Explicit local token entry. Only health is public; every asset fetch uses Bearer. */
export const DAEMON_LOGIN_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Vessel daemon</title>
<body><h1>Connect to Vessel</h1><p>Enter the launch token from the local daemon.token file shown by vessel daemon start. The token stays in this tab's memory.</p>
<form><label>Launch token <input type="password" autocomplete="off" required pattern="[0-9a-f]{48}"></label><button>Connect</button></form><p role="alert" id="error"></p>
<script type="module">
document.querySelector('form').addEventListener('submit', async event => {
 event.preventDefault(); const token = document.querySelector('input').value;
 const get = async url => { const response = await fetch(url, {headers:{Authorization:'Bearer '+token},cache:'no-store'}); if(!response.ok) throw new Error('Connection failed: HTTP '+response.status); return response; };
 const blobs=[];
 try {
  const html=await (await get('/')).text(); const page=new DOMParser().parseFromString(html,'text/html');
  const scripts=[...page.querySelectorAll('script[type="module"][src]')];
  if(!scripts.length) throw new Error('Web assets missing. Run npm run -w @vessel/web build.');
  for(const link of page.querySelectorAll('link[rel="stylesheet"]')) { const style=document.createElement('style'); style.textContent=await(await get(new URL(link.getAttribute('href'),location.origin))).text(); link.replaceWith(style); }
  for(const script of scripts) { const code=await(await get(new URL(script.getAttribute('src'),location.origin))).text(); blobs.push(URL.createObjectURL(new Blob([code],{type:'text/javascript'}))); script.remove(); }
  page.querySelectorAll('link[rel="modulepreload"]').forEach(link=>link.remove());
  window.__VESSEL_DAEMON_TOKEN__=token;
  document.head.replaceChildren(...page.head.childNodes); document.body.replaceChildren(...page.body.childNodes);
  for(const blob of blobs) await import(blob);
 } catch(error) { const target=document.getElementById('error') ?? document.body.appendChild(document.createElement('p')); target.setAttribute('role','alert'); target.textContent=String(error); }
 finally { for(const blob of blobs) URL.revokeObjectURL(blob); }
});
</script></body></html>`;
