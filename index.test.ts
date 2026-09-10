/**
 * task 112 — 根发布入口测试：验证根 index.ts 产出的真实分发面
 * （版本/元数据运行时读 package.json、CLI 入口引用指向真实 @vessel/cli）。
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { version, packageMetadata, cliEntry, cliEntryReady } from './index.js';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

function readRootPackageJson(): { name: string; version: string; description: string; private: boolean } {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
    description: string;
    private: boolean;
  };
}

describe('root package entry (task 112)', () => {
  it('version 与根 package.json version 对齐（运行时读取，非硬编码）', () => {
    const pkg = readRootPackageJson();
    expect(version).toBe(pkg.version);
  });

  it('packageMetadata 与根 package.json 对齐（private 壳包真实元数据）', () => {
    const pkg = readRootPackageJson();
    expect(packageMetadata.name).toBe(pkg.name);
    expect(packageMetadata.version).toBe(pkg.version);
    expect(packageMetadata.description).toBe(pkg.description);
    expect(packageMetadata.private).toBe(true);
  });

  it('cliEntry 引用指向真实 CLI 包 @vessel/cli（bin=vessel）', () => {
    expect(cliEntry.package).toBe('@vessel/cli');
    expect(cliEntry.bin).toBe('vessel');
    expect(cliEntry.devSource).toBe('apps/cli/src/cli.ts');
    expect(cliEntry.builtArtifact).toBe('apps/cli/dist/cli.js');
  });

  it('cliEntryReady(): dev 源（apps/cli/src/cli.ts）必须存在 → ready', () => {
    const r = cliEntryReady();
    expect(r.ready).toBe(true);
    expect(r.checked).toHaveLength(2);
    // dev 源在仓库中真实存在（硬校验，防引用腐化）
    expect(fs.existsSync(path.join(repoRoot, cliEntry.devSource))).toBe(true);
  });
});