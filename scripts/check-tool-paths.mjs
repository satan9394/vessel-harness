#!/usr/bin/env node
/**
 * 扫描可执行文件与操作文档中的过期工具路径。
 * 用法：node scripts/check-tool-paths.mjs [--root <dir>] [--self-test]
 * 退出码：0 = 无命中；1 = 有命中或扫描失败；2 = 参数错误。
 * 有意保留旧路径的文档行（例如规则本身在引述旧根）可加 `tool-path-guard: allow` 标记，该行即跳过。
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const extensions = new Set('.ps1 .psm1 .mjs .js .cjs .ts .md .json .toml .yml .yaml'.split(' '));
// 分隔符允许重复，兼容 JSON 中转义后的 Windows 路径。
const patterns = [
  /NVM[_]Windows/gi,
  /nvm[\\/]+installs[\\/]+v\d[\d.]*/gi,
  /@openai[\\/]+codex[\\/]+node_modules[\\/]+@openai[\\/]+codex-win32-x64[\\/]+vendor[\\/]+/gi,
];

function scan(root) {
  // 同时包含未跟踪文件，新增脚本和验收探针无需 git add 就能被检查。
  const files = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  }).split('\0').filter(Boolean));
  let scanned = 0;
  const hits = [];
  for (const file of [...files].sort()) {
    if (!extensions.has(path.posix.extname(file).toLowerCase())) continue;
    if (/^(evidence|tasks)\//.test(file) || /(^|\/)(node_modules|dist)\//.test(file)) continue;
    if (/^docs\/diagrams\/[^/]+\.finalize\.json$/.test(file)) continue;
    const target = path.join(root, file);
    let content;
    try {
      // 不跟随链接读取仓库外的内容；已在工作树删除的索引项没有内容可扫。
      if (!lstatSync(target).isFile()) continue;
      content = readFileSync(target, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    scanned++;
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      // 文档里引述旧路径是合法的（规则、迁移记录、历史报告）：显式标记即跳过该行。
      if (/tool-path-guard:\s*allow/.test(line)) continue;
      for (const pattern of patterns) {
        for (const match of line.matchAll(pattern)) hits.push(`${file}:${index + 1}: ${match[0]}`);
      }
    }
  }
  console.log(`scanned ${scanned} file(s)`);
  for (const hit of hits) console.log(hit);
  return hits.length ? 1 : 0;
}

function selfTest() {
  const fixture = mkdtempSync(path.join(tmpdir(), 'vessel-tool-paths-'));
  const obsoleteRoot = ['NVM', 'Windows'].join('_');
  const pinned = ['nvm', 'installs', 'v26.13.0'];
  const vendor = ['@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', ''];
  const put = (root, file, content) => {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  };
  const run = root => {
    const result = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8', windowsHide: true });
    assert.ifError(result.error);
    return result;
  };
  try {
    const bad = path.join(fixture, 'bad');
    const clean = path.join(fixture, 'clean');
    for (const root of [bad, clean]) {
      mkdirSync(root);
      execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
    }
    const tokens = [obsoleteRoot, pinned.join('\\'), pinned.join('/'), vendor.join('\\'),
      obsoleteRoot.toLowerCase(), pinned.join('\\\\').toUpperCase(), vendor.join('\\\\').toUpperCase()];
    put(bad, 'probe.ps1', `# 探针\n${tokens.join('\n')}\n`);
    const failed = run(bad);
    assert.equal(failed.status, 1, failed.stderr);
    assert.match(failed.stdout, /scanned 1 file\(s\)/);
    for (const [index, token] of tokens.entries()) {
      assert.ok(failed.stdout.includes(`probe.ps1:${index + 2}: ${token}`), failed.stdout);
    }
    put(clean, 'ok.ps1', '$tool = "nvm/.nodejs/node.exe"\n');
    put(clean, 'notes.MD', '使用当前版本指针。\n');
    for (const file of ['evidence/old.md', 'tasks/old.ps1', 'docs/diagrams/test.finalize.json',
      'node_modules/tool/index.js', 'dist/tool.js', 'nested/node_modules/tool.js', 'nested/dist/tool.js', 'image.svg']) {
      put(clean, file, obsoleteRoot);
    }
    // 既检查索引文件，也检查未跟踪文件；排除规则对已跟踪的生成物同样有效。
    execFileSync('git', ['-c', 'core.autocrlf=false', 'add', '--force', '--', '.'], { cwd: clean, windowsHide: true });
    put(clean, 'untracked.ts', 'export const ready = true;\n');
    const passed = run(clean);
    assert.equal(passed.status, 0, passed.stdout + passed.stderr);
    assert.equal(passed.stdout.trim(), 'scanned 3 file(s)');
    put(clean, 'docs/live.md', obsoleteRoot);
    const live = run(clean);
    assert.equal(live.status, 1, live.stderr);
    assert.ok(live.stdout.includes(`docs/live.md:1: ${obsoleteRoot}`), live.stdout);
    // 显式标记的行跳过命中（文档引述旧路径的合法场景），且不影响其它行。
    put(clean, 'docs/allowed.md', `引述旧根 ${obsoleteRoot} <!-- tool-path-guard: allow -->\n`);
    put(clean, 'docs/not-allowed.md', `未标记 ${obsoleteRoot}\n`);
    const allowed = run(clean);
    assert.equal(allowed.status, 1, allowed.stdout);
    assert.ok(!allowed.stdout.includes('docs/allowed.md'), allowed.stdout);
    assert.ok(allowed.stdout.includes('docs/not-allowed.md:1'), allowed.stdout);
    console.log('self-test ok');
    return 0;
  } finally {
    // 仅清理本进程刚创建、位于系统临时根下且子进程已结束的 fixture。
    rmSync(fixture, { recursive: true, force: true });
  }
}

let root = path.resolve(path.dirname(script), '..');
let test = false;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--self-test') test = true;
  else if (args[index] === '--root' && args[index + 1] && !args[index + 1].startsWith('--')) root = path.resolve(args[++index]);
  else {
    console.error('usage: node scripts/check-tool-paths.mjs [--root <dir>] [--self-test]');
    process.exit(2);
  }
}
try {
  process.exitCode = test ? selfTest() : scan(root);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
