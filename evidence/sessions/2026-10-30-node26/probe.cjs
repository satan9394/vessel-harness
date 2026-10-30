const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-node26-probe-'));
fs.writeFileSync(path.join(base, 'value.cjs'), 'module.exports=0');
fs.writeFileSync(path.join(base, 'repro.cjs'), "require('node:assert/strict').equal(require('./value.cjs'),1,'TARGET_BUG')");
const result = spawnSync(process.execPath, ['repro.cjs'], { cwd: base });
fs.writeFileSync(path.join(__dirname, 'red-stderr.raw.log'), result.stderr);
fs.writeFileSync(path.join(__dirname, 'red-stdout.raw.log'), result.stdout);
const output = result.stderr.toString().trim();
const red = {
  node: process.version, exit: result.status, stdoutEmpty: !result.stdout.toString().trim(),
  prefix: /^node:assert[:/]/.test(output), versionTail: /\nNode\.js v\d+\.\d+\.\d+$/.test(output),
  assertionCount: (output.match(/^AssertionError(?: \[ERR_ASSERTION\])?:/gm) ?? []).length,
  otherError: /^(?!AssertionError)[A-Za-z]*Error(?: \[[^\]]+\])?:/m.test(output),
  baselineReason: output.includes('TARGET_BUG'),
};
const outside = path.join(base, 'outside'); fs.mkdirSync(outside);
const links = [];
for (const type of ['dir', 'junction']) {
  const link = path.join(base, type);
  try {
    fs.symlinkSync(outside, link, type);
    const stat = fs.lstatSync(link);
    links.push({ type, isSymbolicLink: stat.isSymbolicLink(), isDirectory: stat.isDirectory(),
      ino: stat.ino, bigintIno: String(fs.lstatSync(link, { bigint: true }).ino),
      realpath: fs.realpathSync(link), readlink: fs.readlinkSync(link) });
  } catch (error) { links.push({ type, code: error.code, message: error.message }); }
}
const inodes = ['trash', 'directory-link', 'other'].map(name => {
  const directory = path.join(base, name); fs.mkdirSync(directory);
  return { name, ino: fs.lstatSync(directory).ino, bigintIno: String(fs.lstatSync(directory, { bigint: true }).ino) };
});
fs.writeFileSync(path.join(__dirname, 'probe.json'), JSON.stringify({ red, links, inodes }, null, 2) + '\n');
console.log(JSON.stringify({ red, links, inodes }, null, 2));
// Keep this probe's fixtures available for inspection; never touches user state.
