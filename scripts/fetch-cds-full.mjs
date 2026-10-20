import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const outDir = 'E:/Code_file/Projects/Vessel_Harness/evidence/reference-cds';
fs.mkdirSync(outDir, { recursive: true });

async function fetchFull() {
  const enc = encodeURIComponent('Claude Design System (CDS).full.md');
  const url = `https://raw.githubusercontent.com/Caho1/open-claude-ui/main/docs/v1/${enc}`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Vessel-Fetcher' } }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const target = path.join(outDir, 'Claude-Design-System.full.md');
        fs.writeFileSync(target, data, 'utf8');
        console.log(`Saved Claude-Design-System.full.md (${data.length} bytes)`);
        resolve();
      });
    }).on('error', reject);
  });
}

fetchFull().catch(e => console.error('Fetch error:', e.message));
