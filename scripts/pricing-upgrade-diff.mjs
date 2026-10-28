import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const fields = ['input', 'output', 'cacheRead', 'cacheWrite'];
function readCatalog(file) {
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) || !catalog.models || typeof catalog.models !== 'object' || Array.isArray(catalog.models)) throw new Error(`${file}: missing or invalid models`);
  const models = Object.create(null);
  for (const [key, value] of Object.entries(catalog.models)) {
    if (!key.trim() || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${file}: invalid model ${key}`);
    const price = {};
    for (const field of fields) {
      const v = value[field];
      if (v === undefined && field !== 'input' && field !== 'output') continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${file}: ${key}.${field} must be a nonnegative number`);
      price[field] = v;
    }
    models[key] = price;
  }
  return models;
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 6 || new Set([args[0], args[2], args[4]]).size !== 3 || !['--from', '--to', '--out'].every(flag => [args[0], args[2], args[4]].includes(flag)) || [args[1], args[3], args[5]].some(v => !v || v.startsWith('--'))) throw new Error('usage: node scripts/pricing-upgrade-diff.mjs --from <old.json> --to <new.json> --out <repairs.json>');
  const options = Object.fromEntries([[args[0], args[1]], [args[2], args[3]], [args[4], args[5]]]);
  const output = path.resolve(options['--out']);
  if ([options['--from'], options['--to']].some(file => path.resolve(file) === output)) throw new Error('output must differ from input files');
  const oldModels = readCatalog(options['--from']);
  const newModels = readCatalog(options['--to']);
  const repairs = [];
  for (const key of Object.keys(oldModels)) {
    if (!(key in newModels)) { console.error(`Skipping removed model ${key}: no new value to repair to`); continue; }
    const from = oldModels[key], to = newModels[key];
    if (fields.some(field => from[field] !== to[field])) repairs.push({ key, from, to });
  }
  for (const key of Object.keys(newModels)) if (!(key in oldModels)) console.error(`Skipping new model ${key}: no old value to guard`);
  const temp = `${output}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(repairs, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temp, output);
  console.log(`Wrote ${repairs.length} repairs to ${output}`);
} catch (error) {
  console.error(`pricing-upgrade-diff: ${error.message}`);
  process.exitCode = 1;
}
