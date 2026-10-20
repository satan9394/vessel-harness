import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const outDir = 'E:/Code_file/Projects/Vessel_Harness/evidence/reference-cds';
fs.mkdirSync(outDir, { recursive: true });

const files = [
  '01-设计哲学与设计令牌体系.md',
  '02-基础原子交互控件库.md',
  '03-会话流与指令输入引擎.md',
  '04-动效物理学、着色器与环境光影.md',
  '08-AI-Agent-前端-UI-与动效开发指南.md'
];

async function fetchFile(filename) {
  const enc = encodeURIComponent(filename);
  const url = `https://raw.githubusercontent.com/Caho1/open-claude-ui/main/docs/v1/${enc}`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Vessel-Fetcher' } }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const target = path.join(outDir, filename);
        fs.writeFileSync(target, data, 'utf8');
        console.log(`Saved: ${filename} (${data.length} bytes)`);
        resolve();
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Downloading Open Claude UI design system references...');
  for (const f of files) {
    try {
      await fetchFile(f);
    } catch (e) {
      console.error(`Error fetching ${f}:`, e.message);
    }
  }
  console.log('Done.');
}

main();
