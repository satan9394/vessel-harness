import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const evidence = import.meta.dirname;
const repo = path.resolve(evidence, '../../..');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
const dictionary = text => Object.fromEntries(['zh', 'en'].map(lang => {
  const body = text.split(`export const ${lang}: Messages = `)[1].split('\n};')[0] + '\n}';
  return [lang, Function('return (' + body + ')')()];
}));
const before = await dictionary(git('show', 'HEAD:apps/web/src/i18n.ts'));
const after = await dictionary(fs.readFileSync(path.join(repo, 'apps/web/src/i18n.ts'), 'utf8'));
const dictionaries = Object.fromEntries(['zh', 'en'].map(lang => [lang, {
  existingValuesUnchanged: Object.keys(before[lang]).every(key => before[lang][key] === after[lang][key]),
  added: Object.fromEntries(Object.entries(after[lang]).filter(([key]) => !(key in before[lang]))),
}]));
const productPaths = git('diff', '--name-only').trim().split('\n').filter(p => p.startsWith('apps/') || p.startsWith('packages/'));
const allowed = ['apps/web/src/components/team/TeamNodeDrawer.tsx', 'apps/web/src/components/team/TeamNodeDrawer.test.tsx', 'apps/web/src/i18n.ts'];
const sourceHashes = Object.fromEntries(allowed.map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, p))).digest('hex')]));
const cardPath = 'tasks/365-team-drawer-copy-and-toggle-polish.md';
const originalCard = execFileSync('git', ['show', 'HEAD:' + cardPath], { cwd: repo });
const card = fs.readFileSync(path.join(repo, cardPath));
const index = fs.readFileSync(path.join(repo, 'apps/web/dist/index.html'), 'utf8');
const assets = [...index.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
const result = {
  baseline: git('rev-parse', 'HEAD').trim(), productPaths,
  sourceScopePass: productPaths.every(p => allowed.includes(p)) && productPaths.length === 3,
  dictionaries, sourceHashes, cardExistingBytesPreserved: card.subarray(0, originalCard.length).equals(originalCard),
  boardUnchanged: git('diff', '--', 'tasks/README.md') === '',
  build: { directory: path.join(repo, 'apps/web/dist'), assets: Object.fromEntries(assets.map(asset => [asset, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, 'apps/web/dist', asset))).digest('hex')])) },
};
fs.writeFileSync(path.join(evidence, 'scope-audit.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (!result.sourceScopePass || !result.cardExistingBytesPreserved || !result.boardUnchanged || !Object.values(dictionaries).every(value => value.existingValuesUnchanged && Object.keys(value.added).length === 5)) process.exitCode = 1;
