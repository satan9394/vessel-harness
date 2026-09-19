import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vesselHome } from './vesselHome.js';

describe('vesselHome — 状态根唯一实现（G-08 轻量收敛）', () => {
  it('等价：<home>/.vessel（缺省 os.homedir()），语义与原字面量逐字相同', () => {
    expect(vesselHome()).toBe(path.join(os.homedir(), '.vessel'));
    expect(vesselHome('/tmp/abc')).toBe(path.join('/tmp/abc', '.vessel'));
    expect(vesselHome('C:\\Users\\x')).toBe(path.join('C:\\Users\\x', '.vessel'));
  });

  it('静态守卫：字面量 path.join(home, \'.vessel\') 只在本模块（防再次复制）', () => {
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url)); // packages/shared/src → repo root
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.isDirectory()) {
          if (['node_modules', 'dist', '.git', '.harness'].includes(e.name)) return [];
          return walk(path.join(dir, e.name));
        }
        const full = path.join(dir, e.name);
        return e.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
      });
    const carriers = [
      ...walk(path.join(repoRoot, 'packages')),
      ...walk(path.join(repoRoot, 'apps')),
    ]
      .filter((f) => fs.readFileSync(f, 'utf8').includes("path.join(home, '.vessel')"))
      .map((f) => path.relative(repoRoot, f).replace(/\\/g, '/'));
    expect(carriers).toEqual(['packages/shared/src/vesselHome.ts']);
  });
});
